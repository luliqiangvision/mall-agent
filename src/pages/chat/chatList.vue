<template>
    <view class="chat-list-container">
        <!-- 聊天列表 -->
        <scroll-view class="chat-list" scroll-y="true">
            <!-- 空状态 -->
            <view class="empty-state" v-if="conversationList.length === 0 && !isLoading">
                <text class="empty-text">暂无聊天记录</text>
            </view>

            <!-- 加载中 -->
            <view class="loading-state" v-if="isLoading">
                <text class="loading-text">加载中...</text>
            </view>

            <!-- 聊天列表项 -->
            <view class="chat-item" v-for="(conversation, index) in conversationList" :key="conversation.conversationId"
                @click="openConversation(conversation)">
                <!-- 店铺头像 -->
                <view class="avatar-container">
                    <image class="avatar" :src="conversation.shopIcon || '/static/default-shop.png'" mode="aspectFill">
                    </image>
                    <view class="unread-badge" v-if="conversation.unreadCount > 0">{{ conversation.unreadCount > 99 ?
                        '99+' : conversation.unreadCount }}</view>
                </view>

                <!-- 消息内容 -->
                <view class="chat-content">
                    <view class="chat-header">
                        <text class="shop-name">{{ getDisplayShopName(conversation) }}</text>
                        <text class="time">{{ formatTime(conversation.lastMessageTime) }}</text>
                    </view>
                    <view class="last-message">
                        <text class="last-message-text">{{ conversation.lastMessage }}</text>
                    </view>
                </view>
            </view>
        </scroll-view>
    </view>
</template>

<script>
import ChatHttpManager from '@/api/chat/chat-http.js';
import { getChatWebSocketConnection } from '@/api/chat/chat-session-manager.js';
import { getEventBus } from '@/api/chat/message-event-bus.js';
import { getUnreadCountManager } from '@/api/chat/unread-count-manager.js';
import { getShopChatManager } from '@/api/chat/shop-chat-manager.js';
import { getGlobalHeartbeatManager } from '@/api/chat/global-heartbeat-manager.js';
import { myLog } from '@/utils/log.js';

export default {
    data() {
        return {
            conversationList: [],
            totalUnreadCount: 0,
            isLoading: false,
            chatHttpManager: null,
            eventBus: null,
            unreadCountManager: null,
            unsubscribeEvents: null // EventBus 取消订阅函数
        };
    },
    async onLoad() {
        console.log('ChatList页面加载');
        // 初始化未读数管理器
        this.unreadCountManager = getUnreadCountManager();
        // 初始化HTTP管理器
        this.initChatHttpManager();
        // 加载聊天列表
        await this.loadChatList();
        // 初始化心跳管理器（从缓存加载会话ID）
        const heartbeatManager = getGlobalHeartbeatManager();
        heartbeatManager.initializeConversationIds();
        // 启动心跳
        heartbeatManager.startHeartbeat();
        // 初始化 WebSocket
        this.initWebSocket();
        // 订阅 EventBus 消息
        this.subscribeToEvents();
    },
    async onShow() {
        // 当页面显示时，重新加载聊天列表（确保数据是最新的）
        // 初始化HTTP管理器（如果还未初始化）
        if (!this.chatHttpManager) {
            this.initChatHttpManager();
        }
        // 重新加载聊天列表
        await this.loadChatList();
        
        // 点击消息标签（TabBar）进入聊天列表页时，启动心跳
        // 初始化心跳管理器（从缓存加载会话ID）
        const heartbeatManager = getGlobalHeartbeatManager();
        heartbeatManager.initializeConversationIds();
        // 启动心跳（如果还未启动）
        heartbeatManager.startHeartbeat(); // startHeartbeat 内部会检查是否已启动，避免重复启动
        
        // 更新 tabBar badge（如果加载失败，从缓存读取）
        if (this.totalUnreadCount > 0) {
            this.updateTabBarBadge(this.totalUnreadCount);
        } else {
            // 如果 totalUnreadCount 为0，尝试从缓存读取（登录时可能已缓存）
            const cachedCount = uni.getStorageSync('totalUnreadCount') || 0
            if (cachedCount > 0) {
                this.updateTabBarBadge(cachedCount);
            }
        }
    },
    onUnload() {
        // 页面卸载时清理资源
        myLog('debug', 'ChatList 页面卸载');
        // 取消订阅事件
        if (this.unsubscribeEvents) {
            this.unsubscribeEvents();
        }
        // 注意：心跳由 GlobalHeartbeatManager 统一管理，不在这里停止
    },
    methods: {
        // 初始化HTTP管理器
        initChatHttpManager() {
            this.chatHttpManager = new ChatHttpManager({
                // baseUrl 使用 ChatHttpManager 的默认值（从 CHAT_BASE_URL 获取）
                conversationId: null, // 列表页面不需要单个会话ID
                onMessageRenderCallback: (data) => this.handleMessageReceived(data),
                onError: (error) => {
                    console.error('HTTP聊天错误:', error);
                }
            });
        },
        // 初始化 WebSocket
        initWebSocket() {
            myLog('debug', '初始化 WebSocket');
            this.eventBus = getEventBus();
            // 连接 WebSocket
            const wsConnection = getChatWebSocketConnection();
            if (!wsConnection.isConnectionActive()) {
                wsConnection.connect();
            }
            // 监听 WebSocket 连接状态变化（心跳由 GlobalHeartbeatManager 统一管理）
            this.eventBus.subscribeConnection((connected) => {
                if (connected) {
                    myLog('debug', 'WebSocket 连接成功');
                } else {
                    myLog('debug', 'WebSocket 断开');
                }
            });
        },
        // 加载聊天列表
        async loadChatList() {
            this.isLoading = true;
            try {
                const userInfo = uni.getStorageSync('userInfo');
                if (!userInfo || !userInfo.agentId) {
                    console.warn('用户未登录或agentId不存在，无法加载聊天列表');
                    return;
                }
                
                console.log('加载聊天列表, agentId:', userInfo.agentId);
                const result = await this.chatHttpManager.getChatWindowList({
                    userId: userInfo.agentId  // API参数名仍为userId，但值从agentId获取
                });
                if (result && result.success && result.conversations) {
                    this.processConversationData(result.conversations);
                } else {
                    console.warn('加载聊天列表失败:', result);
                }
            } catch (error) {
                console.error('加载聊天列表失败:', error);
                uni.showToast({
                    title: '加载失败',
                    icon: 'none'
                });
            } finally {
                this.isLoading = false;
            }
        },
        // 处理会话数据
        processConversationData(conversationMap) {
            console.log('处理会话数据:', conversationMap);
            // 初始化缓存对象
            if (!window.conversationCache) {
                window.conversationCache = {};
            }
            // 将Map转换为数组
            const conversationList = [];
            let totalUnread = 0;
            for (const [conversationId, viewData] of Object.entries(conversationMap)) {
                // 从 shop 对象中读取店铺信息
                const shop = viewData.shop || {};
                const shopId = shop.id;
                const messages = viewData.messages || [];
                // 缓存消息数据（供 customerService.vue 使用）
                if (shopId) {
                    // 计算 clientMaxServerMsgId
                    let clientMaxServerMsgId = 0;
                    if (messages.length > 0) {
                        const latestMsg = messages[messages.length - 1];
                        clientMaxServerMsgId = latestMsg.serverMsgId || 0;
                    }
                    window.conversationCache[shopId] = {
                        conversationId: conversationId,
                        messages: messages,
                        clientMaxServerMsgId: clientMaxServerMsgId
                    };
                    console.log(`缓存店铺 ${shopId} 的消息，数量:`, messages.length, 'clientMaxServerMsgId:', clientMaxServerMsgId);
                }
                const conversation = {
                    conversationId: conversationId,
                    shopId: shopId,
                    shopName: shop.shopName,
                    shopIcon: shop.shopIcon,
                    shopStatus: shop.shopStatus,
                    contactPhone: shop.contactPhone,
                    lastMessage: this.getLastMessage(messages),
                    lastMessageTime: this.getLastMessageTime(messages),
                    unreadCount: viewData.unreadCount,
                    messages: messages
                };
                conversationList.push(conversation);
                totalUnread += conversation.unreadCount;
                // 初始化未读数管理器
                this.unreadCountManager.setUnreadCount(conversationId, viewData.unreadCount || 0);
            }

            // 排序：优先按未读数（有未读的放上面），然后按 conversationId
            conversationList.sort((a, b) => {
                // 第一排序规则：按未读消息数（降序）
                const unreadDiff = (b.unreadCount || 0) - (a.unreadCount || 0);
                if (unreadDiff !== 0) {
                    return unreadDiff;
                }
                // 第二排序规则：按 conversationId
                return a.conversationId.localeCompare(b.conversationId);
            });
            this.conversationList = conversationList;
            this.totalUnreadCount = totalUnread;
            // 更新 tabBar badge
            this.updateTabBarBadge(totalUnread);
            console.log('处理完成, 会话数:', conversationList.length, '总未读数:', totalUnread);
        },

        // 获取最后一条消息
        getLastMessage(messages) {
            if (!messages || messages.length === 0) {
                return '暂无消息';
            }
            const lastMsg = messages[messages.length - 1];
            return lastMsg.content || '暂无消息';
        },

        // 获取最后消息时间
        getLastMessageTime(messages) {
            if (!messages || messages.length === 0) {
                return new Date().toISOString();
            }
            const lastMsg = messages[messages.length - 1];
            return lastMsg.timestamp || new Date().toISOString();
        },

        // 获取显示用的店铺名称（拼接 conversationId 后十位，这是为了区分不同的客户）
        getDisplayShopName(conversation) {
            if (!conversation || !conversation.shopName) {
                return '';
            }
            
            const shopName = conversation.shopName;
            if (conversation.conversationId) {
                // 获取 conversationId 的后十位
                const conversationIdStr = String(conversation.conversationId);
                const lastTenDigits = conversationIdStr.length >= 10 
                    ? conversationIdStr.slice(-10) 
                    : conversationIdStr;
                return `${shopName}${lastTenDigits}`;
            }
            
            return shopName;
        },
        // 格式化时间（仅显示年月日）
        formatTime(timestamp) {
            if (!timestamp) return '';

            const date = new Date(timestamp);
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');

            return `${year}/${month}/${day}`;
        },

        // 更新 tabBar badge
        updateTabBarBadge(count) {
            // tabBar 配置中，"消息"是第2个标签（索引从0开始，所以是索引1）
            // 索引0：首页
            // 索引1：消息
            const tabIndex = 1;

            // 检查当前页面是否是 TabBar 页面
            try {
                const pages = getCurrentPages();
                if (!pages || pages.length === 0) {
                    return;
                }
                const currentPage = pages[pages.length - 1];
                const currentRoute = currentPage ? currentPage.route : '';
                
                // TabBar 页面路径列表（去掉前面的 / 和 .vue 后缀）
                const tabBarPages = ['pages/home/index', 'pages/chat/chatList'];
                const isTabBarPage = tabBarPages.some(page => {
                    // 处理路径格式差异（可能带 / 前缀或 .vue 后缀）
                    return currentRoute === page || currentRoute === `/${page}` || currentRoute.includes(page);
                });

                // 如果当前不是 TabBar 页面，则不更新 badge（避免报错）
                // 但当页面显示时（onShow）会重新更新，所以这里可以跳过
                if (!isTabBarPage) {
                    return;
                }
            } catch (e) {
                // 如果获取页面栈失败，尝试继续执行（可能在特殊情况下）
                console.warn('检查当前页面失败:', e);
            }

            try {
                if (count > 0) {
                    uni.setTabBarBadge({
                        index: tabIndex,
                        text: count > 99 ? '99+' : count.toString()
                    }).catch(err => {
                        // 使用 Promise.catch 捕获异步错误
                        console.warn('设置 tabBar badge 失败:', err);
                    });
                } else {
                    // 移除 badge 前先检查是否存在，避免报错
                    uni.removeTabBarBadge({
                        index: tabIndex
                    }).catch(err => {
                        // 如果移除失败（比如 badge 不存在），忽略错误
                        console.log('移除 tabBar badge 失败（可能不存在）:', err);
                    });
                }
            } catch (error) {
                // 如果 tabBar 未初始化或其他错误，忽略
                console.warn('更新 tabBar badge 失败:', error);
            }
        },

        // 订阅 EventBus 消息
        subscribeToEvents() {
            this.eventBus = getEventBus();

            // 订阅心跳响应
            this.unsubscribeEvents = this.eventBus.subscribe('*', (messageData) => {
                this.handleEventBusMessage(messageData);
            });

            myLog('debug', 'ChatList subscribed to EventBus');
        },

        // 处理 EventBus 消息
        handleEventBusMessage(messageData) {
            const { conversationId, payload, interfaceName, success, websocketCode, errorMessage, version } = messageData;

            // 处理心跳响应
            if (interfaceName === '/heartbeat') {
                this.handleHeartbeatResponse(payload);
            }

            // 处理拉取消息请求响应
            if (interfaceName === '/pullMessageRequest') {
                this.handlePullMessageRequestResponse(payload);
            }
        },

        // 处理心跳响应
        handleHeartbeatResponse(payload) {
            if (!payload || !payload.items) return;

            myLog('debug', '收到心跳响应', payload);

            // 遍历心跳返回的每个会话结果
            for (const item of payload.items) {
                const { conversationId, newMessages } = item;

                if (newMessages && newMessages.length > 0) {
                    // 有新消息，更新未读数
                    this.unreadCountManager.incrementUnreadCount(conversationId, newMessages.length);

                    // 更新会话列表
                    this.updateConversationInList(conversationId, newMessages);
                }
            }

            // 更新总未读数
            this.updateTotalUnreadCount();
        },

        // 更新会话列表中的会话信息
        updateConversationInList(conversationId, newMessages) {
            const conversation = this.conversationList.find(c => c.conversationId === conversationId);
            if (!conversation) return;

            // 更新最后一条消息
            if (newMessages.length > 0) {
                const lastMsg = newMessages[newMessages.length - 1];
                conversation.lastMessage = lastMsg.content || '新消息';
                conversation.lastMessageTime = lastMsg.timestamp || new Date().toISOString();
            }

            // 更新未读数
            conversation.unreadCount = this.unreadCountManager.getUnreadCount(conversationId);
        },

        // 更新总未读数
        updateTotalUnreadCount() {
            this.totalUnreadCount = this.unreadCountManager.getTotalUnreadCount();
            this.updateTabBarBadge(this.totalUnreadCount);
        },

        // 打开会话
        openConversation(conversation) {
            console.log('打开会话:', conversation);

            // 构建跳转URL
            const params = {
                conversationId: conversation.conversationId,
                shopId: conversation.shopId,
                shopName: encodeURIComponent(conversation.shopName),
                hasMessages: conversation.messages ? conversation.messages.length : 0
            }

            // 如果有店铺logo，添加到参数中
            if (conversation.shopIcon) {
                params.shopIcon = encodeURIComponent(conversation.shopIcon)
            }

            const url = `/pages/chat/customerService?${Object.keys(params).map(k => `${k}=${params[k]}`).join('&')}`

            // 跳转到聊天窗口
            uni.navigateTo({ url });
        },

        // 处理接收到的消息
        handleMessageReceived(data) {
            console.log('收到消息:', data);

            // 处理获取聊天窗口列表响应
            if (data.interface === '/getChatWindowList') {
                this.handleInitConversationView(data.payload);
                return;
            }
        },

        // 处理拉取消息请求响应
        handlePullMessageRequestResponse(payload) {
            if (!payload) return;

            myLog('debug', '收到拉取消息请求响应', payload);

            const { conversationId, message } = payload;

            if (message && message.length > 0) {
                // 有新消息，更新未读数
                this.unreadCountManager.incrementUnreadCount(conversationId, message.length);

                // 更新会话列表
                this.updateConversationInList(conversationId, message);
            }

            // 更新总未读数
            this.updateTotalUnreadCount();
        },

        // 处理初始化会话视图响应
        handleInitConversationView(payload) {
            console.log('初始化会话视图响应:', payload);

            if (payload.success && payload.conversations) {
                this.processConversationData(payload.conversations);
            } else {
                console.warn('初始化会话视图失败:', payload.error);
            }
        }
    }
};
</script>

<style lang="scss" scoped>
.chat-list-container {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background-color: #f5f5f5;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20upx 30upx;
    background-color: #fff;
    border-bottom: 1px solid #eee;

    .title {
        font-size: 36upx;
        font-weight: bold;
        color: #333;
    }
}

.chat-list {
    flex: 1;
    padding: 0;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 500upx;
    color: #999;

    .empty-text {
        font-size: 32upx;
    }
}

.loading-state {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 500upx;

    .loading-text {
        font-size: 28upx;
        color: #999;
    }
}

.chat-item {
    display: flex;
    align-items: center;
    padding: 30upx;
    background-color: #fff;
    border-bottom: 1px solid #f0f0f0;
}

.avatar-container {
    position: relative;
    margin-right: 20upx;

    .avatar {
        width: 100upx;
        height: 100upx;
        border-radius: 50%;
    }

    .unread-badge {
        position: absolute;
        top: -4upx;
        right: -4upx;
        background-color: #fa436a;
        color: white;
        font-size: 20upx;
        padding: 2upx 8upx;
        border-radius: 20upx;
        min-width: 32upx;
        text-align: center;
    }
}

.chat-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    .chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10upx;

        .shop-name {
            font-size: 32upx;
            font-weight: bold;
            color: #333;
        }

        .time {
            font-size: 24upx;
            color: #999;
        }
    }

    .last-message {
        .last-message-text {
            font-size: 28upx;
            color: #666;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }
}
</style>
