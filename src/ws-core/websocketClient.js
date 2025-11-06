import { CHAT_BASE_URL } from '@/utils/appConfig.js'
import { myLog } from '@/utils/log.js'
import MethodHandleMapper from './methodHandleMapper.js'

/**
 * WebSocket客户端类
 * 功能：连接管理、自动重连、心跳机制
 */
class WebSocketClient {
  constructor(options = {}) {
    // WebSocket实例
    this.socketTask = null
    
    // 连接配置 - 从 CHAT_BASE_URL 获取，自己添加 ws:// 协议
    const chatHost = CHAT_BASE_URL
    const wsBaseUrl = `ws://${chatHost}`
    myLog('debug', `[WebSocketClient constructor] CHAT_BASE_URL = "${chatHost}"`)
    myLog('debug', `[WebSocketClient constructor] ws:// baseUrl = "${wsBaseUrl}"`)
    this.baseUrl = `${wsBaseUrl}/chat/agent-service`
    this.url = null // 将在 connect() 中拼接 token
    this.token = null
    
    // 连接状态
    this.status = 'DISCONNECTED' // DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING
    
    // 重连配置
    this.reconnectAttempts = 0 // 当前重连次数
    this.reconnectTimer = null // 重连定时器
    this.maxReconnectDelay = 30000 // 最大重连间隔30秒
    // 取消最大重连次数限制：无限重试
    this.isReconnectScheduled = false // 防重复排队标记：当为 true 时说明已安排指数退避重连，聊天界面用户手动调用 reconnect()或者发新消息，可绕过上述“已排队等待”的限制，立即触发重连
    this.isManualClose = false // 是否手动关闭
    
    // 心跳配置
    this.heartbeatTimer = null // 心跳定时器
    this.heartbeatInterval = 60000 // 心跳间隔60秒
    this.lastHeartbeatTime = 0 // 上次心跳时间
    
    // 入站分发器：在构造阶段装配清单，WebSocketClient 内部直接完成“接口→处理器”的路由
    this.methodHandleMapper = new MethodHandleMapper()
    
    // 回调函数：默认指向分发器（业务无需感知 mapper 的存在）
    this.onMessage = this.methodHandleMapper.dispatch.bind(this.methodHandleMapper)
    // 在发起连接前触发的钩子，允许调用方注入/调整回调、上下文等
    // 使用方式：new WebSocketClient({ onBeforeConnect: (client)=>{ client.onMessage = yourHandler } })
    this.onBeforeConnect = options.onBeforeConnect || options.beforeConnect || null
    this.onConnected = options.onConnected || (() => {})
    this.onDisconnected = options.onDisconnected || (() => {})
    this.onReconnecting = options.onReconnecting || (() => {})
    this.onError = options.onError || (() => {})
    
    // 是否由业务层自行发送心跳（true 时 ws-core 不发送默认心跳）
    this.clientSendsHeartbeat = Boolean(options.clientSendsHeartbeat)
    
    // 🔧 Hook 系统：类似 AOP 切面的生命周期钩子
    this.hooks = {
      afterReconnect: [],    // 重连成功后执行
      beforeDisconnect: [],   // 断开连接前执行
      afterConnect: [],       // 首次连接成功后执行
      onReconnectFailed: []   // 重连失败时执行
    }
    
    myLog('info', 'WebSocketClient initialized')
  }
  
  /**
   * 🔧 Hook 系统：注册生命周期钩子
   * @param {string} event - 钩子事件名
   * @param {Function} fn - 回调函数
   */
  on(event, fn) {
    if (this.hooks[event] && typeof fn === 'function') {
      this.hooks[event].push(fn)
      myLog('debug', `注册 ${event} 钩子，当前共 ${this.hooks[event].length} 个`)
    } else {
      myLog('warn', `无效的钩子事件: ${event} 或回调函数`)
    }
  }

  /**
   * 🔧 Hook 系统：移除生命周期钩子
   * @param {string} event - 钩子事件名
   * @param {Function} fn - 要移除的回调函数
   */
  off(event, fn) {
    if (this.hooks[event]) {
      const index = this.hooks[event].indexOf(fn)
      if (index > -1) {
        this.hooks[event].splice(index, 1)
        myLog('debug', `移除 ${event} 钩子，剩余 ${this.hooks[event].length} 个`)
      }
    }
  }

  /**
   * 🔧 Hook 系统：触发生命周期钩子
   * @param {string} event - 钩子事件名
   * @param {...any} args - 传递给回调函数的参数
   */
  emit(event, ...args) {
    if (this.hooks[event] && this.hooks[event].length > 0) {
      myLog('info', `触发 ${event} 钩子，执行 ${this.hooks[event].length} 个回调`)
      this.hooks[event].forEach((fn, index) => {
        try {
          fn(...args)
        } catch (error) {
          myLog('error', `${event} 钩子第 ${index + 1} 个回调执行失败`, error)
        }
      })
    }
  }

  /**
   * 🔧 便捷方法：注册重连成功后的业务回调
   * @param {Function} fn - 回调函数
   */
  onAfterReconnect(fn) {
    this.on('afterReconnect', fn)
  }

  /**
   * 🔧 便捷方法：注册首次连接成功后的业务回调
   * @param {Function} fn - 回调函数
   */
  onAfterConnect(fn) {
    this.on('afterConnect', fn)
  }

  /**
   * 🔧 便捷方法：注册断开连接前的业务回调
   * @param {Function} fn - 回调函数
   */
  onBeforeDisconnect(fn) {
    this.on('beforeDisconnect', fn)
  }

  /**
   * 连接WebSocket
   */
  connect() {
    // 防止重复连接
    if (this.status === 'CONNECTING' || this.status === 'CONNECTED') {
      myLog('warn', 'WebSocket already connecting or connected')
      return
    }

    // 连接前钩子：允许调用方在真正 connect 之前注入/调整回调
    try {
      if (typeof this.onBeforeConnect === 'function') {
        this.onBeforeConnect(this)
      }
    } catch (e) {
      myLog('warn', 'onBeforeConnect hook error', e)
    }
    
    // 获取token
    this.token = uni.getStorageSync('token')
    myLog('info', `Token 检查: ${this.token ? `已获取 (长度: ${this.token.length})` : '❌ 未找到'}`)
    if (!this.token) {
      myLog('error', '❌ Token not found, cannot connect WebSocket')
      this.onError({ message: 'Token not found' })
      return
    }
    
    // 🔧 获取当前运行平台
    const systemInfo = uni.getSystemInfoSync()
    const isWebPlatform = systemInfo.uniPlatform === 'h5' || systemInfo.uniPlatform === 'web'
    
    myLog('info', `当前运行平台: ${systemInfo.uniPlatform} ${isWebPlatform ? '(Web浏览器)' : '(App/小程序)'}`)
    
    // 🔧 处理 token 格式
    const hasBearer = this.token.startsWith('Bearer ')
    let authHeader = hasBearer ? this.token : `Bearer ${this.token}`
    const tokenValue = hasBearer ? this.token.substring(7) : this.token
    
    // 🔧 根据平台决定 token 传递方式
    let connectOptions = {}
    
    // 注意：某些服务器可能不支持通过 URL 参数传递 token，只支持 Header
    // 如果遇到 1002 Protocol error，可能需要让服务器端也支持 URL 参数方式
    // 或者统一使用 Header 方式（需要服务器端支持）
    
    if (isWebPlatform) {
      // Web 浏览器：token 放 URL 参数（浏览器 WebSocket 不支持自定义 Header）
      // 如果服务器不支持 URL 参数方式，可能需要使用 wss:// 或者让服务器端支持 URL 参数
      this.url = `${this.baseUrl}?token=${encodeURIComponent(tokenValue)}`
      connectOptions = {
        url: this.url
      }
      myLog('info', `🔌 [${systemInfo.uniPlatform}] 准备连接 WebSocket`)
      myLog('info', `[${systemInfo.uniPlatform}] 完整 URL: ${this.url}`)
      myLog('debug', `[${systemInfo.uniPlatform}] baseUrl: ${this.baseUrl}`)
      myLog('debug', `[${systemInfo.uniPlatform}] token 原始长度: ${tokenValue.length}`)
      myLog('debug', `[${systemInfo.uniPlatform}] token 原始前缀: ${tokenValue.substring(0, 50)}...`)
      myLog('debug', `[${systemInfo.uniPlatform}] token 编码后前缀: ${encodeURIComponent(tokenValue).substring(0, 50)}...`)
      myLog('debug', `[${systemInfo.uniPlatform}] Token 通过 URL 参数传递`)
      
      // 🔍 检查 token 是否包含可能导致问题的字符
      if (tokenValue.includes('\n') || tokenValue.includes('\r')) {
        myLog('warn', '⚠️ Token 包含换行符，可能导致协议错误')
      }
    } else {
      // App/小程序：token 放 Header（支持自定义 Header）
      this.url = this.baseUrl
      connectOptions = {
        url: this.url,
        header: {
          'Authorization': authHeader
        }
      }
      myLog('info', `🔌 [${systemInfo.uniPlatform}] 准备连接 WebSocket: ${this.url}`)
      myLog('debug', `[${systemInfo.uniPlatform}] Authorization Header 长度: ${authHeader.length}`)
      myLog('debug', `[${systemInfo.uniPlatform}] Authorization Header 前缀: ${authHeader.substring(0, 60)}...`)
    }
    
    this.status = 'CONNECTING'
    this.isManualClose = false
    
    // 创建WebSocket连接
    this.socketTask = uni.connectSocket({
      ...connectOptions,
      // 只代表连接请求发送成功，不代表连接成功
      success: () => {
        myLog('info', 'WebSocket connection initiated')
      },
      fail: (error) => {
        myLog('error', 'WebSocket connection failed', error)
        this.status = 'DISCONNECTED'
        this.onError(error)
        // 有些平台 fail 后不触发 onClose，这里也兜底安排一次重连
        if (!this.isManualClose && !this.isReconnectScheduled) {
          this.handleReconnect()
        }
      }
    })
    
    // 监听WebSocket打开
    this.socketTask.onOpen(() => {
      myLog('info', 'WebSocket connected successfully')
      this.status = 'CONNECTED'
      this.reconnectAttempts = 0 // 重置重连次数
      this.isReconnectScheduled = false
      this.onConnected()
      this.startHeartbeat() // 启动心跳
      
      // 🔧 触发生命周期钩子
      const isReconnect = this.reconnectAttempts > 0
      if (isReconnect) {
        this.emit('afterReconnect') // 重连成功后执行
      } else {
        this.emit('afterConnect') // 首次连接成功后执行
      }
    })
    
    // 监听WebSocket消息
    this.socketTask.onMessage((res) => {
      this.handleMessage(res.data)
    })
    
    // 监听WebSocket错误
    this.socketTask.onError((error) => {
      myLog('error', '❌ WebSocket error 触发', {
        error,
        errorType: typeof error,
        errorKeys: error ? Object.keys(error) : [],
        errorString: JSON.stringify(error)
      })
      this.status = 'DISCONNECTED'
      this.onError(error)
    })
    
    // 监听WebSocket关闭
    this.socketTask.onClose((res) => {
      myLog('error', '❌ WebSocket closed', {
        code: res.code,
        reason: res.reason || '(无reason)',
        wasClean: res.wasClean,
        fullRes: res
      })
      
      // 🔍 解析关闭码
      let closeReason = ''
      let errorCategory = 'UNKNOWN'
      
      // 标准 WebSocket 关闭码 (1000-1015)
      if (res.code >= 1000 && res.code <= 1015) {
        switch (res.code) {
        case 1000: closeReason = '正常关闭'; errorCategory = 'NORMAL_CLOSE'; break
        case 1001: closeReason = '端点离开（如服务器关闭或浏览器导航）'; errorCategory = 'GOING_AWAY'; break
        case 1002: closeReason = '协议错误'; errorCategory = 'PROTOCOL_ERROR'; break
        case 1003: closeReason = '不支持的数据类型'; errorCategory = 'UNSUPPORTED_TYPE'; break
        case 1005: closeReason = '未收到状态码'; errorCategory = 'NO_STATUS'; break
        case 1006: closeReason = '❌ 连接异常关闭（未完成握手或网络错误）'; errorCategory = 'ABNORMAL_CLOSE'; break
        case 1007: closeReason = '收到不一致的数据'; errorCategory = 'INVALID_DATA'; break
        case 1008: closeReason = '策略违规'; errorCategory = 'POLICY_VIOLATION'; break
        case 1009: closeReason = '消息过大'; errorCategory = 'MESSAGE_TOO_LARGE'; break
        case 1010: closeReason = '客户端期望扩展未协商'; errorCategory = 'EXTENSION_NEGOTIATION_FAILED'; break
        case 1011: closeReason = '服务器遇到意外情况'; errorCategory = 'SERVER_ERROR'; break
        case 1015: closeReason = 'TLS握手失败'; errorCategory = 'TLS_FAILURE'; break
        default: closeReason = `标准关闭码 (${res.code})`; break
        }
      }
      // 自定义业务关闭码 (4000-4999)
      else if (res.code >= 4000 && res.code < 5000) {
        errorCategory = 'CUSTOM_BUSINESS'
        switch (res.code) {
        case 4000: closeReason = '客服会话已结束'; break
        case 4001: closeReason = '客服主动结束会话'; break
        case 4002: closeReason = '会话超时关闭'; break
        case 4003: closeReason = '客服离线'; break
        case 4004: closeReason = '重复登录被踢下线'; break
        default: closeReason = `自定义业务码 (${res.code})`
        }
      }
      // 服务器错误码 (5000-5999)
      else if (res.code >= 5000 && res.code < 6000) {
        errorCategory = 'SERVER_ERROR'
        closeReason = `服务器错误 (${res.code})`
      }
      else {
        closeReason = `未知关闭码 (${res.code})`
      }
      myLog('error', `关闭原因: ${closeReason}`)
      
      this.status = 'DISCONNECTED'
      this.stopHeartbeat()
      
      // 判断是否服务端主动要求关闭
      const isServerRequested = this.isServerRequestedClose(res)
      
      // 构造断开信息
      const disconnectInfo = {
        code: res.code,
        reason: res.reason || closeReason,
        wasClean: res.wasClean,
        isServerRequested: isServerRequested,
        errorCategory: errorCategory, // 错误分类: NORMAL_CLOSE, CUSTOM_BUSINESS, SERVER_ERROR, etc.
        errorType: isServerRequested ? 'SERVER_REQUESTED' : 'NETWORK_ERROR', // 兼容旧字段
        closeReason: closeReason
      }
      
      // 调用回调，传递断开详情
      this.onDisconnected(disconnectInfo)
      
      // 手动关闭 or 服务端要求关闭 -> 不重连
      if (this.isManualClose || isServerRequested) {
        this.isManualClose = false // 重置标记，避免影响下次
        return
      }
      // 已在排队就别重复排
      if (this.isReconnectScheduled) return
      this.handleReconnect()
    })
  }
  
  /**
   * 处理接收到的消息
   */
  handleMessage(data) {
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : data
      myLog('debug', 'WebSocket message received', message)
      
      // 如果是心跳响应，更新心跳时间并交由分发器
      if (message.interfaceName === '/heartbeat') {
        this.lastHeartbeatTime = Date.now()
        myLog('debug', 'Heartbeat response received')
        // 让业务端也能处理心跳结果（needPull 等）
        this.onMessage(message)
        return
      }
      
      // 调用消息回调
      this.onMessage(message)
    } catch (error) {
      myLog('error', 'Failed to parse WebSocket message', error)
    }
  }
  
  /**
   * 发送消息
   */
  send(data) {
    if (this.status !== 'CONNECTED') {
      myLog('warn', `[WebSocketClient] 连接状态不正确，无法发送消息 (status=${this.status})`)
      return false
    }
    
    try {
      const message = typeof data === 'string' ? data : JSON.stringify(data)
      this.socketTask.send({
        data: message,
        success: () => {
          myLog('debug', '[WebSocketClient] 消息发送成功', data)
        },
        fail: (error) => {
          myLog('error', '[WebSocketClient] uni.connectSocket 发送失败', error)
          this.onError(error)
        }
      })
      return true
    } catch (error) {
      myLog('error', '[WebSocketClient] 序列化消息或调用 send API 时抛出异常', error)
      return false
    }
  }
  
  /**
   * 启动心跳
   */
  startHeartbeat() {
    this.stopHeartbeat() // 先停止之前的心跳
    
    this.lastHeartbeatTime = Date.now()
    
    this.heartbeatTimer = setInterval(() => {
      if (this.status === 'CONNECTED') {
        if (!this.clientSendsHeartbeat) {
          // 由框架默认发送心跳
          const heartbeatMsg = {
            interfaceName: '/agent/heartbeat',
            version: 1,
            payload: {
              timestamp: Date.now()
            }
          }
          this.send(heartbeatMsg)
          myLog('debug', 'Heartbeat sent (framework)')
        } else {
          // 业务层发送心跳（clientSendsHeartbeat=true）：此处仅检测超时，不发送
          myLog('debug', 'Heartbeat tick (client owned)')
        }
        
        // 检查心跳超时（2次心跳间隔未收到响应）
        const now = Date.now()
        if (now - this.lastHeartbeatTime > this.heartbeatInterval * 2) {
          myLog('warn', 'Heartbeat timeout, reconnecting...')
          // 暂时注释掉,影响开发了
          // this.handleReconnect() // 🔧 使用 handleReconnect 而不是直接 reconnect  
        }
      }
    }, this.heartbeatInterval)
    
    myLog('info', 'Heartbeat started')
  }
  
  /**
   * 停止心跳
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
      myLog('info', 'Heartbeat stopped')
    }
  }
  
  /**
   * 判断是否服务端要求关闭
   * @param {Object} res - onClose 回调的 res 参数
   * @returns {boolean} 是否服务端要求关闭
   */
  isServerRequestedClose(res) {
    // 约定：1000 为正常关闭，一律视为服务端要求关闭，不自动重连
    if (res?.code === 1000) return true
    // 其他：例如 1011（服务器异常）明确不重连
    if (res?.code === 1011) return true
    return false
  }

  /**
   * 处理重连
   * 说明：该方法采用指数退避排队机制，避免频繁重连；若需要“立即重连”（比如用户直接点击重发或者发送新消息，但websocket已经不是连接状态），请改用 reconnect()
   */
  handleReconnect() {
    if (this.isManualClose) return
    
    if (this.isReconnectScheduled) {
      myLog('debug', '重连已排队，跳过重复调用')
      return
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const delay = this.getReconnectDelay()
    this.reconnectAttempts++

    this.status = 'RECONNECTING'
    this.isReconnectScheduled = true
    this.onReconnecting(this.reconnectAttempts, delay)
    myLog('info', `Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.isReconnectScheduled = false
      this.reconnect()
    }, delay)
  }
  
  /**
   * 计算重连延迟（指数退避）
   */
  getReconnectDelay() {
    // 2^n * 1000，最大30000ms
    const delay = Math.min(
      Math.pow(2, this.reconnectAttempts) * 1000,
      this.maxReconnectDelay
    )
    return delay
  }
  
  /**
   * 重连
   */
  reconnect() {
    myLog('info', 'Attempting to reconnect...')
    // 为了在发起重连前，先把旧连接干净地关闭，避免同时存在两个 socket、心跳/回调重复、服务器端残留会话等
    this.disconnect(true) // true,主动关闭的标记
    this.connect() // 重新连接
  }
  
  /**
   * 断开连接
   * @param {Boolean} manual - 是否手动断开
   */
  disconnect(manual = true) {
    this.isManualClose = manual
    this.isReconnectScheduled = false // 清除重连标记
    
    // 🔧 触发断开前钩子
    this.emit('beforeDisconnect', { manual })
    
    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    
    // 停止心跳
    this.stopHeartbeat()
    
    // 关闭WebSocket连接
    if (this.socketTask) {
      this.socketTask.close({
        success: () => {
          myLog('info', 'WebSocket disconnected')
        }
      })
      this.socketTask = null
    }
    
    this.status = 'DISCONNECTED'
  }
  
  /**
   * 销毁实例
   */
  destroy() {
    this.disconnect(true)
    this.onMessage = null
    this.onConnected = null
    this.onDisconnected = null
    this.onReconnecting = null
    this.onError = null
    
    // 🔧 清理所有钩子
    Object.keys(this.hooks).forEach(event => {
      this.hooks[event] = []
    })
    
    myLog('info', 'WebSocketClient destroyed')
  }
  
  /**
   * 获取当前状态
   */
  getStatus() {
    return this.status
  }
  
  /**
   * 是否已连接
   */
  isConnected() {
    return this.status === 'CONNECTED'
  }
}

export default WebSocketClient

