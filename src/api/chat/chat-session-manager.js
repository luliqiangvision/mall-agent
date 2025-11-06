import { myLog } from "@/utils/log.js";
import MessageDisplayManager from "./message-display-manager.js";
import { getWebSocketConnection } from "./websocket-connection.js";
import { getEventBus } from "./message-event-bus.js";
import { getGlobalHeartbeatManager } from "./global-heartbeat-manager.js";

/**
 * 聊天会话管理器
 * 职责：管理特定会话的消息处理、状态、回调
 *
 * 设计原则：
 * 1. 可以有多个实例（每个会话一个）
 * 2. 通过事件总线接收 WebSocket 消息
 * 3. 通过 WebSocket 连接发送消息
 * 4. 持有 Vue 页面的回调函数
 */
class ChatSessionManager {
  constructor(options = {}) {
    // 使用共享的 WebSocket 连接
    this.wsConnection = getWebSocketConnection();
    // 消息超时配置
    this.messageTimeout = options.messageTimeout || 30000; // 默认30秒
    this.messageTimeoutMap = new Map(); // clientMsgId -> timeout timer（消息超时定时器映射）
    this.sentMessages = new Map(); // clientMsgId -> 消息内容（用于发送成功后添加到MessageDisplayManager）
    // 当前会话本地已知的最大 serverMsgId
    this.clientMaxServerMsgId = options.clientMaxServerMsgId || 0;
    // 会话ID（临时）
    this.conversationId = options.conversationId;
    // 店铺ID（从入口页透传）
    this.shopId = options.shopId;

    // HTTP管理器
    this.chatHttpManager = options.chatHttpManager;

    // 消息显示管理器
    this.messageDisplayManager = new MessageDisplayManager({
      conversationId: this.conversationId,
      clientMaxServerMsgId: this.clientMaxServerMsgId,
      maxVisibleMessages: 50,
      chatHttpManager: this.chatHttpManager,
      onMessagesUpdate: (data) => this.showNewMessageDisplayToUI(data),
      onScrollToLatest: () => this.handleScrollToLatest(),
      onLoadMore: (request) => this.handleLoadMore(request),
    });
    // 回调函数（由调用方显式传入）
    this.onConnectionChange = options.onConnectionChange;
    this.onMessageRenderCallback = options.onMessageRenderCallback; // Vue页面传入的消息渲染回调
    this.onMessageStatusChange = options.onMessageStatusChange;
    this.onError = options.onError;

    // 事件总线，之前这里是采用实例注册的方式来做，也就是由于前端没有语言级反射与 Spring Bean 容器，这里在构造器中显式注册到实例目录
    // 便于被静态导出的路由处理函数按会话键查回本实例并转发调用，相当于是当前的实例的引用注册起来，websocket服务端的消息推送过来后，获取
    // 当前对象的引用才可以调用当前对象的一些方法，因为这些方法不是静态方法，是实例方法，所以需要获取当前实例的引用才可以调用，现在采用了
    // 事件总线方式后就不需要原来的方法了，因为聊天窗口和聊天列表都需要更新消息，有多个vue的界面需要更新消息，只能采用这种订阅和广播的方式来做
    this.eventBus = getEventBus();

    // 订阅事件
    this.subscribeToEvents();

    // 自动建立连接
    this.connect();

    myLog("info", "ChatSessionManager initialized", {
      conversationId: this.conversationId,
    });
  }

  /**
   * 订阅事件总线
   */
  subscribeToEvents() {
    // 订阅会话消息
    if (this.conversationId) {
      this.unsubscribeMessage = this.eventBus.subscribe(
        this.conversationId,
        (messageData) => {
          this.handleIncomingMessage(messageData);
        }
      );
    }

    // 订阅连接状态
    this.unsubscribeConnection = this.eventBus.subscribeConnection(
      (connected) => {
        this.handleConnectionStatusChange(connected);
      }
    );

    // 订阅重连完成事件
    this.unsubscribeReconnect = this.eventBus.subscribeReconnectComplete(() => {
      this.handleReconnectComplete();
    });

    // 订阅断开事件
    this.unsubscribeDisconnect = this.eventBus.subscribeDisconnect(
      (disconnectInfo) => {
        this.handleDisconnect(disconnectInfo);
      }
    );
  }

  /**
   * 处理接收到的消息
   */
  handleIncomingMessage(messageData) {
    const {
      conversationId,
      payload,
      interfaceName,
      version,
      websocketCode,
      success,
      errorMessage,
    } = messageData;

    myLog("debug", "ChatSessionManager received message", {
      conversationId,
      interfaceName,
    });

    const wrapper = {
      interfaceName,
      version,
      payload,
      websocketCode,
      success,
      errorMessage,
    };

    // 根据消息类型分发处理
    switch (interfaceName) {
      case "/replySendRequest":
        this.handleReplySendRequest(wrapper);
        break;
      case "/notifyPull":
        this.handleNotifyPull(wrapper);
        break;
      case "/heartbeat":
        this.handleHeartbeat(wrapper, Date.now());
        break;
      case "/checkMessageRequest":
        this.handleCheckMessageResponse(wrapper);
        break;
      case "/pullMessageRequest":
        this.handlePullMessageResponse(wrapper);
        break;
      default:
        myLog("warn", "Unknown message interface", interfaceName);
    }
  }

  /**
   * 处理连接状态变化
   */
  handleConnectionStatusChange(connected) {
    if (this.onConnectionChange) {
      this.onConnectionChange(connected);
    }

    if (connected) {
      // 连接成功后通过全局心跳管理器发送心跳
      const heartbeatManager = getGlobalHeartbeatManager();
      heartbeatManager.sendHeartbeat();
    }
  }

  /**
   * 处理重连完成
   * 重连成功后主动检查是否有遗漏的消息（可能服务器换了）
   */
  handleReconnectComplete() {
    if (!this.conversationId) return; // 列表页不需要检查消息

    myLog("info", "Reconnect completed, checking for missing messages", {
      conversationId: this.conversationId,
      clientMaxServerMsgId: this.clientMaxServerMsgId,
    });

    // 主动检查是否有遗漏的消息
    this.checkReconnectMessages({
      conversationId: this.conversationId,
      clientMaxServerMsgId: this.clientMaxServerMsgId,
    });
  }

  /**
   * 处理断开事件
   * @param {Object} disconnectInfo - 断开信息 { code, reason, wasClean, isServerRequested, errorCategory, errorType, closeReason }
   */
  handleDisconnect(disconnectInfo) {
    myLog("info", "WebSocket disconnected", disconnectInfo);

    // 区分不同类型的断开
    // 1. 标准 WebSocket 协议错误 (1000-1015)
    // 2. 自定义业务码 (4000-4999): 如客服结束会话、重复登录被踢等
    // 3. 服务器错误 (5000-5999)

    const { code, errorCategory } = disconnectInfo;

    // TODO: 根据断开原因做相应处理
    if (errorCategory === "CUSTOM_BUSINESS") {
      // 自定义业务断开，比如客服认为问题已解决，主动结束会话
      myLog("info", "Custom business disconnect detected", {
        code,
        reason: disconnectInfo.reason,
      });
      // 可以在这里添加业务逻辑，比如显示提示信息
    } else if (
      errorCategory === "SERVER_ERROR" ||
      errorCategory === "PROTOCOL_ERROR"
    ) {
      // 协议层错误或服务器错误 (5000-5999)
      myLog("warn", "Protocol or server error", {
        code,
        reason: disconnectInfo.reason,
      });
    } else if (errorCategory === "ABNORMAL_CLOSE") {
      // 异常关闭，比如网络问题
      myLog("warn", "Abnormal close, likely network issue", {
        code,
        reason: disconnectInfo.reason,
      });
    }

    // 清理待处理消息
    this.clearAllPendingMessages();

    // 如果有错误回调，调用它
    if (typeof this.onError === "function") {
      this.onError({
        type: "DISCONNECT",
        ...disconnectInfo,
      });
    }
  }

  /**
   * 初始化WebSocket连接
   */
  connect() {
    if (!this.wsConnection.isConnectionActive()) {
      this.wsConnection.connect();
    }
  }

  /**
   * 处理"发送请求结果"的回复（/replySendRequest）
   * 规范：
   * - message.interface === '/replySendRequest'
   * - message.payload.clientMsgId: 原请求的 clientMsgId
   * - message.payload.code: 0 表示成功，非 0 表示失败
   * - message.payload.errorMsg: 失败时可选的错误信息
   */
  async handleReplySendRequest(message) {
    try {
      const payload = message.payload || {};
      const clientMsgId = payload.clientMsgId;
      // 成功判定优先使用 WebSocketDataWrapper：websocketCode === 200 或 success === true
      const wrapperCode = Number(message.websocketCode);
      const wrapperSuccess = message.success === true;
      const isSuccessByWrapper = wrapperCode === 200 || wrapperSuccess;
      const isSuccess = isSuccessByWrapper;

      if (!clientMsgId) {
        myLog(
          "warn",
          "[handleReplySendRequest] missing clientMsgId in payload"
        );
        return;
      }

      // 已收到服务端回执：清理超时定时器（避免 UI 一直转圈）
      const timerId = this.messageTimeoutMap.get(clientMsgId);
      if (timerId) {
        clearTimeout(timerId);
        this.messageTimeoutMap.delete(clientMsgId);
      }

      // 成功时若带有 serverMsgId，则更新本会话最大已知 serverMsgId，并将消息添加到MessageDisplayManager
      if (
        isSuccess &&
        typeof payload.serverMsgId !== "undefined" &&
        payload.serverMsgId !== null
      ) {
        const num = Number(payload.serverMsgId);
        if (!Number.isNaN(num)) {
          this.clientMaxServerMsgId = Math.max(
            Number(this.clientMaxServerMsgId) || 0,
            num
          );
          // 获取存储的消息内容并添加到MessageDisplayManager（作为服务器消息）
          const sentMessage = this.sentMessages.get(clientMsgId);
          if (sentMessage && this.messageDisplayManager) {
            // 构建完整的消息对象（有serverMsgId）
            const messageToAdd = {
              ...sentMessage,
              serverMsgId: num,
              status: "sent",
            };
            // 添加到MessageDisplayManager的allAckedMessages（它会自动去重、排序、更新UI）
            this.messageDisplayManager.applyOneMessages(messageToAdd);
            myLog(
              "info",
              "Sent message added to MessageDisplayManager allAckedMessages",
              {
                clientMsgId,
                serverMsgId: num,
              }
            );
          }
          // 清理已发送成功的消息
          this.sentMessages.delete(clientMsgId);
        }
      }

      if (typeof this.onMessageStatusChange === "function") {
        const extra = {};
        if (!isSuccess) {
          extra.errorMsg = message.errorMessage || payload.errorMsg;
          // 发送失败时，清理存储的消息内容
          this.sentMessages.delete(clientMsgId);
        } else if (
          typeof payload.serverMsgId !== "undefined" &&
          payload.serverMsgId !== null
        ) {
          extra.serverMsgId = payload.serverMsgId;
        }
        this.onMessageStatusChange(
          clientMsgId,
          isSuccess ? "sent" : "failed",
          extra
        );
      }
    } catch (e) {
      myLog("error", "handleReplySendRequest error", e);
    }
  }

  /**
   * 处理服务端发送的"通知拉取"消息（/notifyPull）
   * 服务端主动通知客户端有新消息，客户端收到后主动调用 /pullMessage 接口拉取消息
   */
  handleNotifyPull(message) {
    try {
      myLog("debug", "handleNotifyPull received", {
        conversationId: this.conversationId,
        payload: message.payload,
        needPull: message.payload?.needPull,
        latestServerMsgId: message.payload?.latestServerMsgId,
        pullFrom: message.payload?.pullFrom,
      });

      const payload = message.payload;
      if (!payload) {
        myLog("warn", "Invalid notifyPull message payload");
        return;
      }

      // 检查 WebSocket 连接状态
      if (!this.wsConnection || !this.wsConnection.isConnectionActive()) {
        myLog("error", "WebSocket not connected, cannot pull messages");
        return;
      }

      // 构建拉取消息请求
      const pullRequest = {
        conversationId: payload.conversationId || this.conversationId,
        type: payload.type, // 服务端通知中已包含消息类型，用于后续渲染处理
        timestamp: payload.timestamp || Date.now(),
        serverMsgId:
          payload.serverMsgId || payload.pullFrom || this.clientMaxServerMsgId,
      };

      myLog("debug", "Sending pull message request", pullRequest);

      // 调用现有的 pullMessage 方法
      this.pullMessage(pullRequest);
    } catch (e) {
      myLog("error", "handleNotifyPull error", e);
    }
  }

  /**
   * 处理心跳返回的单会话结果
   * @param {Object} item - { conversationId, needPull, latestServerMsgId, pullFrom }
   * @param {Number|String} serverTime - 服务器时间戳
   */
  handleHeartbeat(message, serverTime) {
    try {
      const payload = message?.payload;
      if (!payload || !Array.isArray(payload.items)) {
        myLog("warn", "Invalid heartbeat payload", message);
        return;
      }
      payload.items.forEach((item) =>
        this.handleHeartbeatItem(item, serverTime)
      );
    } catch (e) {
      myLog("error", "handleHeartbeat instance error", e);
    }
  }

  handleHeartbeatItem(item, serverTime) {
    try {
      if (!item || item.conversationId !== this.conversationId) return;
      myLog("info", "handleHeartbeat result", { serverTime, item });
      if (item.needPull) {
        // 合成一个 /notifyPull 消息，复用现有处理逻辑
        const msg = {
          interfaceName: "/notifyPull",
          version: 1,
          payload: {
            conversationId: this.conversationId,
            latestServerMsgId: item.latestServerMsgId,
            pullFrom: item.pullFrom,
          },
        };
        this.handleNotifyPull(msg);
      }
    } catch (e) {
      myLog("error", "handleHeartbeat item error", e);
    }
  }

  /**
   * 将消息显示状态展示给UI层
   * @param {Object} data - 消息显示数据 { visibleMessages, allAckedMessages, hasMoreHistory, isLoadingMore }
   */
  showNewMessageDisplayToUI(data) {
    try {
      // myLog('debug', 'Showing new message display to UI', data)

      // 转发给Vue页面的消息渲染回调
      // data.visibleMessages：MessageDisplayManager计算出的当前应该显示的消息
      // data.allAckedMessages：MessageDisplayManager中存储的所有已确认的消息（完整数据源）
      if (this.onMessageRenderCallback) {
        this.onMessageRenderCallback({
          interface: "/messagesUpdate",
          payload: {
            success: true,
            messages: data.visibleMessages, // 传递给Vue组件，最终会合并到this.messages进行渲染
            allAckedMessages: data.allAckedMessages, // 完整数据源，用于调试或其他用途
            hasMoreHistory: data.hasMoreHistory,
            isLoadingMore: data.isLoadingMore,
            conversationId: this.conversationId,
          },
        });
      }

      // 更新clientMaxServerMsgId（从最新消息获取）
      if (data.allAckedMessages && data.allAckedMessages.length > 0) {
        const latestMessage =
          data.allAckedMessages[data.allAckedMessages.length - 1];
        if (latestMessage.serverMsgId) {
          this.clientMaxServerMsgId = latestMessage.serverMsgId;
          this.messageDisplayManager.updateClientMaxServerMsgId(
            latestMessage.serverMsgId
          );
        }
      }
    } catch (error) {
      myLog("error", "Failed to show message display to UI", error);
    }
  }

  /**
   * 处理新消息到达回调，通知UI层决定是否滚动
   * @param {Array} newMessages - 新到达的消息
   */
  handleScrollToLatest(newMessages = []) {
    try {
      myLog(
        "debug",
        "New messages arrived, notifying UI to decide scroll behavior",
        { messageCount: newMessages.length }
      );

      // 通知Vue页面有新消息到达，让UI层决定是否滚动
      if (this.onMessageRenderCallback) {
        this.onMessageRenderCallback({
          interface: "/newMessagesArrived",
          payload: {
            conversationId: this.conversationId,
            newMessages: newMessages,
            messageCount: newMessages.length,
          },
        });
      }
    } catch (error) {
      myLog("error", "Failed to handle new messages arrival", error);
    }
  }

  /**
   * 处理加载更多回调
   * @param {Object} request - 加载请求
   * @returns {Promise<Object>} 加载结果
   */
  async handleLoadMore(request) {
    try {
      myLog("debug", "Handling load more request", request);

      // 使用 HTTP 接口进行分页拉取
      if (this.chatHttpManager) {
        const result = await this.chatHttpManager.pullMessageWithPagedQuery(
          request
        );
        return result;
      } else {
        throw new Error("ChatHttpManager not available");
      }
    } catch (error) {
      myLog("error", "Failed to handle load more", error);
      throw error;
    }
  }

  /**
   * 处理重连检查消息响应
   * @param {Object} message - 服务端响应消息
   */
  async handleCheckMessageResponse(message) {
    try {
      myLog("debug", "Handling check message response", message);

      const payload = message.payload;
      if (!payload) {
        myLog("warn", "Invalid check message response payload");
        return;
      }

      if (
        message.success &&
        payload.messages &&
        Array.isArray(payload.messages)
      ) {
        myLog("info", "Check message found messages", {
          count: payload.messages.length,
        });

        // 调用MessageDisplayManager处理消息（确保消息被正确添加到allAckedMessages）
        if (this.messageDisplayManager) {
          await this.messageDisplayManager.applyOneMessages(payload.messages);
        }

        // 更新clientMaxServerMsgId
        if (payload.messages.length > 0) {
          const latestMessage = payload.messages[payload.messages.length - 1];
          if (latestMessage.serverMsgId) {
            this.clientMaxServerMsgId = latestMessage.serverMsgId;
            this.messageDisplayManager.updateClientMaxServerMsgId(
              latestMessage.serverMsgId
            );
          }
        }
      } else {
        myLog("info", "No missing messages found during reconnect check");
      }
    } catch (error) {
      myLog("error", "Failed to handle check message response", error);
    }
  }

  /**
   * 处理实时消息拉取响应
   * @param {Object} message - 服务端响应消息
   */
  async handlePullMessageResponse(message) {
    try {
      myLog("debug", "Handling pull message response", message);

      // 数据结构：{ success: true, payload: { message: {...}, serverMsgId: 115, ... } }
      if (!message.success || !message.payload || !message.payload.message) {
        myLog("info", "No new messages found");
        return;
      }

      const payload = message.payload;
      const messageData = payload.message;

      myLog("info", "Pull message found new message", {
        serverMsgId: messageData.serverMsgId,
      });

      // 调用MessageDisplayManager添加消息（传入数组格式，确保消息被正确添加到allAckedMessages）
      if (this.messageDisplayManager) {
        // 确保传入数组格式，与其他方法保持一致
        await this.messageDisplayManager.applyOneMessages([messageData]);
      }

      // 更新clientMaxServerMsgId（优先使用外层 payload.serverMsgId，否则使用消息内部的 serverMsgId）
      const serverMsgId = payload.serverMsgId || messageData.serverMsgId;
      if (serverMsgId) {
        this.clientMaxServerMsgId = serverMsgId;
        this.messageDisplayManager.updateClientMaxServerMsgId(serverMsgId);
      }
    } catch (error) {
      myLog("error", "Failed to handle pull message response", error);
    }
  }

  /**
   * 处理 /pullMessageRequest 的响应结果
   * @param {Object} message - 服务端响应消息
   */
  async handleReplyPullMessageRequest(message) {
    try {
      myLog("debug", "Handling reply pull message request", message);

      const payload = message.payload;
      if (!payload) {
        myLog("warn", "Invalid reply pull message request payload");
        return;
      }

      if (message.success) {
        // 处理成功响应
        if (payload.message) {
          myLog(
            "info",
            "Reply pull message request found message",
            payload.message
          );

          // 调用MessageDisplayManager添加消息（确保消息被正确添加到allAckedMessages）
          if (this.messageDisplayManager) {
            await this.messageDisplayManager.applyOneMessages([
              payload.message,
            ]);
          }

          // 更新clientMaxServerMsgId
          if (payload.message.serverMsgId) {
            this.clientMaxServerMsgId = payload.message.serverMsgId;
            this.messageDisplayManager.updateClientMaxServerMsgId(
              payload.message.serverMsgId
            );
          }
        } else {
          myLog("info", "No message found in reply pull message request");
        }
      } else {
        myLog(
          "warn",
          "Reply pull message request failed",
          message.message || "Unknown error"
        );
      }
    } catch (error) {
      myLog("error", "Failed to handle reply pull message request", error);
    }
  }

  /**
   * 格式化消息时间
   */
  formatMessageTime(timestamp) {
    const date = new Date(timestamp);
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const d = date.getDate().toString().padStart(2, "0");
    const hh = date.getHours().toString().padStart(2, "0");
    const mm = date.getMinutes().toString().padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}`;
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.clearAllPendingMessages();
  }

  /**
   * 重连检查消息接口
   * @param {Object} request - { conversationId, clientMaxServerMsgId }
   */
  async checkReconnectMessages(request) {
    try {
      const conversationId = request.conversationId || this.conversationId;
      const clientMaxServerMsgId =
        request.clientMaxServerMsgId || this.clientMaxServerMsgId;

      myLog("info", "Checking for missing messages after reconnect", {
        conversationId,
        clientMaxServerMsgId,
      });

      // 使用 HTTP 接口检查遗漏消息
      if (!this.chatHttpManager) {
        myLog("error", "ChatHttpManager not available");
        return;
      }

      // 调用 HTTP 接口检查遗漏消息
      // 这里需要获取当前最大的 serverMsgId，可以从最近的消息中获取
      // 暂时使用简单的逻辑：从 clientMaxServerMsgId + 1 开始检查到当前最新的消息ID
      const params = {
        conversationId: conversationId,
        startServerMsgId: clientMaxServerMsgId + 1,
        endServerMsgId: Date.now(), // 使用当前时间戳作为结束ID
      };

      const result = await this.chatHttpManager.checkMissingMessages(params);

      // 处理结果
      if (
        result &&
        result.hasMissingMessages &&
        result.missingMessages &&
        result.missingMessages.length > 0
      ) {
        myLog(
          "info",
          `Found ${result.missingCount} missing messages, displaying them`,
          {
            conversationId,
            missingCount: result.missingCount,
            messages: result.missingMessages,
          }
        );

        // 使用 MessageDisplayManager 处理和显示遗漏的消息（确保消息被正确添加到allAckedMessages）
        await this.messageDisplayManager.applyOneMessages(
          result.missingMessages
        );

        // 更新 clientMaxServerMsgId
        const maxServerMsgId = Math.max(
          ...result.missingMessages.map((msg) => msg.serverMsgId || 0)
        );
        if (maxServerMsgId > this.clientMaxServerMsgId) {
          this.clientMaxServerMsgId = maxServerMsgId;
          this.messageDisplayManager.clientMaxServerMsgId = maxServerMsgId;
        }

        myLog("info", "Missing messages processed", {
          updatedMaxServerMsgId: this.clientMaxServerMsgId,
        });
      } else {
        myLog("info", "No missing messages found");
      }
    } catch (error) {
      myLog("error", "Failed to check missing messages", error);
    }
  }

  /**
   * 实时消息拉取接口
   * @param {Object} request - 拉取请求参数 { conversationId, type, timestamp, serverMsgId }
   */
  pullMessage(request) {
    if (!this.wsConnection || !this.wsConnection.isConnectionActive()) {
      myLog("error", "WebSocket not connected");
      return;
    }

    // 构建请求参数，符合后台 PullMessageRequest 结构
    const payload = {
      conversationId: request.conversationId || this.conversationId,
      timestamp: request.timestamp || Date.now(),
      serverMsgId: request.serverMsgId || this.clientMaxServerMsgId,
    };

    const msgData = {
      interfaceName: "/agent/pullMessage",
      version: 1,
      payload,
    };

    const sent = this.wsConnection.send(msgData);
    if (sent) {
      myLog("debug", "Pull message request sent", msgData);
    } else {
      myLog("error", "Failed to send pull message request");
    }
  }

  /**
   * 生成clientMsgId
   * 根据 agentType 判断前缀：
   * - agentType === 'pre-sales' → 'hpre:'
   * - 其他 → 'hpost:' 售后,还没有实现
   */
  generateClientMsgId() {
    const userInfo = uni.getStorageSync('userInfo')
    const agentType = userInfo?.agentType
    const prefix = agentType === 'pre-sales' ? 'hpre:' : 'hpost:'
    return `${prefix}${Date.now()}:${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 发送文本消息
   * @param {String} content - 消息内容
   * @param {Object} options - 额外选项
   * @returns {Object} - 返回消息对象，包含clientMsgId
   */
  sendTextMessage(content, options = {}) {
    // 若未连接：立即触发一次手动重连，交由上层决定何时再次调用发送
    if (!this.isConnected() && this.wsConnection) {
      // 因为进入聊天接口就已经去建立连接了，所以发送消息的时候，如果不是连接状态，重连的操作是正确的
      this.wsConnection.reconnect();
      return { success: false, error: "RECONNECTING", reconnecting: true };
    }

    if (!content || !content.trim()) {
      return {
        success: false,
        error: "EMPTY_CONTENT",
      };
    }

    // 生成clientMsgId（如果提供了就用提供的，用于重发）
    const clientMsgId = options.clientMsgId || this.generateClientMsgId();

    // 构建消息体
    const msgData = {
      interfaceName: "/agent/sendMessage",
      version: 1,
      payload: {
        clientMsgId: clientMsgId,
        conversationId: this.conversationId,
        shopId: this.shopId, // 店铺ID（客服端必需字段）
        type: "text",
        fromUserId: uni.getStorageSync("userInfo")?.agentId,
        // senderId 为发送者ID；在客户侧无转发场景，等同于 fromUserId
        senderId: uni.getStorageSync("userInfo")?.agentId,
        timestamp: Date.now(),
        content: content.trim(),
        uiState: "sending",
      },
    };

    // 发送消息
    const sent = this.wsConnection.send(msgData);

    if (sent) {
      // 存储消息内容，用于发送成功后添加到MessageDisplayManager
      const messageData = {
        clientMsgId: clientMsgId,
        conversationId: this.conversationId,
        type: "text",
        content: content.trim(),
        fromUserId: msgData.payload.fromUserId,
        senderId: msgData.payload.senderId,
        timestamp: msgData.payload.timestamp,
        status: "sending",
      };
      this.sentMessages.set(clientMsgId, messageData);

      // 添加到MessageDisplayManager的pendingMessages（用于显示和管理临时消息状态）
      if (this.messageDisplayManager) {
        // 格式化消息（补齐type、time等字段）
        const formattedMessage = this.messageDisplayManager.formatMessages(messageData)[0]
        if (formattedMessage) {
          this.messageDisplayManager.addPendingMessage(formattedMessage)
          myLog('debug', 'Added message to pendingMessages', { clientMsgId })
        }
      }

      // 设置超时定时器
      const timeoutId = setTimeout(() => {
        this.handleMessageTimeout(clientMsgId);
      }, this.messageTimeout);

      this.messageTimeoutMap.set(clientMsgId, timeoutId);

      return {
        success: true,
        clientMsgId: clientMsgId,
        content: content.trim(),
        timestamp: Date.now(),
      };
    } else {
      return {
        success: false,
        error: "SEND_FAILED",
        clientMsgId: clientMsgId,
      };
    }
  }

  /**
   * 处理消息超时
   */
  handleMessageTimeout(clientMsgId) {
    myLog("warn", `Message timeout: ${clientMsgId}`);
    this.messageTimeoutMap.delete(clientMsgId);

    // 更新pendingMessages中的状态为failed
    if (this.messageDisplayManager) {
      this.messageDisplayManager.updatePendingMessageStatus(
        clientMsgId,
        "failed"
      );
    }

    // 清理存储的内容
    this.sentMessages.delete(clientMsgId);

    // 通知状态变化
    if (typeof this.onMessageStatusChange === "function") {
      this.onMessageStatusChange(clientMsgId, "failed");
    }
  }

  /**
   * 重发消息
   * @param {String} clientMsgId - 消息ID
   * @param {String} content - 消息内容
   */
  retryMessage(clientMsgId, content) {
    myLog("info", `Retrying message: ${clientMsgId}`);
    // 若未连接：立即触发一次手动重连，交由上层决定何时再次调用发送
    if (!this.isConnected() && this.wsConnection) {
      // 因为进入聊天接口就已经去建立连接了，所以发送消息的时候，如果不是连接状态，重连的操作是正确的
      this.wsConnection.reconnect();
      return {
        success: false,
        error: "RECONNECTING",
        reconnecting: true,
        clientMsgId,
      };
    }

    // 更新pendingMessages中的状态为retrying，更新时间戳（会排到最后）
    if (this.messageDisplayManager) {
      const now = Date.now();
      this.messageDisplayManager.updatePendingMessageStatus(
        clientMsgId,
        "retrying",
        {
          timestamp: now,
          time: this.formatMessageTime(now),
        }
      );
    }

    // 使用相同的clientMsgId发送（保证幂等）
    const result = this.sendTextMessage(content, { clientMsgId });
    if (!result.success && typeof this.onMessageStatusChange === "function") {
      this.onMessageStatusChange(clientMsgId, "failed");
    }
    return result;
  }

  /**
   * 清除所有待处理的消息超时定时器
   */
  clearAllPendingMessages() {
    this.messageTimeoutMap.forEach((timerId) => clearTimeout(timerId));
    this.messageTimeoutMap.clear();
  }

  /**
   * 获取连接状态
   */
  isConnected() {
    return this.wsConnection ? this.wsConnection.isConnectionActive() : false;
  }

  /**
   * 设置会话ID
   */
  setConversationId(conversationId) {
    if (this.conversationId !== conversationId) {
      // 取消旧的订阅
      if (this.unsubscribeMessage) {
        this.unsubscribeMessage();
      }

      this.conversationId = conversationId;

      // 更新消息显示管理器的会话ID
      if (this.messageDisplayManager) {
        this.messageDisplayManager.conversationId = conversationId;
      }

      // 重新订阅
      if (this.conversationId) {
        this.unsubscribeMessage = this.eventBus.subscribe(
          this.conversationId,
          (messageData) => {
            this.handleIncomingMessage(messageData);
          }
        );
      }

      myLog("info", "ConversationId updated", { conversationId });
    }
  }

  /**
   * 销毁实例
   */
  destroy() {
    // 取消订阅
    if (this.unsubscribeMessage) {
      this.unsubscribeMessage();
    }
    if (this.unsubscribeConnection) {
      this.unsubscribeConnection();
    }
    if (this.unsubscribeReconnect) {
      this.unsubscribeReconnect();
    }
    if (this.unsubscribeDisconnect) {
      this.unsubscribeDisconnect();
    }

    this.disconnect();

    // 清空回调
    this.onMessageRenderCallback = null;
    this.onConnectionChange = null;
    this.onMessageStatusChange = null;
    this.onError = null;

    myLog("info", "ChatSessionManager destroyed", {
      conversationId: this.conversationId,
    });
  }
}

export default ChatSessionManager;

/**
 * 创建聊天会话管理器实例
 */
export function createChatSessionManager(options = {}) {
  return new ChatSessionManager(options);
}

/**
 * 获取 WebSocket 连接单例
 */
export function getChatWebSocketConnection() {
  return getWebSocketConnection();
}
