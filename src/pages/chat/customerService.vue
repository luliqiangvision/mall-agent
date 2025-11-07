<template>
    <view class="container">
        <view class="header">
            <image v-if="shopInfo && shopInfo.shopIcon" class="shop-icon" :src="shopInfo.shopIcon" mode="aspectFill">
            </image>
            <text class="title">{{ shopInfo && shopInfo.shopName ? shopInfo.shopName : '' }}</text>
        </view>

        <!-- 悬浮商品卡片 -->
        <view class="floating-product-card" v-if="showProductCard">
            <view class="close-btn" @click="closeProductCard">×</view>
            <view class="product-card-content">
                <image :src="productInfo.pic" class="product-thumbnail"></image>
                <view class="product-info">
                    <text class="product-title">{{ productInfo.name }}</text>
                    <text class="product-price">¥ {{ productInfo.price }}</text>
                </view>
                <button class="send-to-service-btn" @click="sendProductToService">发给客服</button>
            </view>
        </view>

        <view class="chat-container" :style="{ top: chatAreaTop + 'px', bottom: chatAreaBottom + 'px' }">
            <scroll-view ref="messageScrollView" class="message-list" scroll-y="true" @scroll="onScroll"
                @scrolltoupper="onScrollToUpper" @scrolltolower="onScrollToLower" :scroll-with-animation="true"
                :scroll-top="scrollTop" :scroll-into-view="intoViewId">
                <!-- 加载更多提示 -->
                <view class="load-more-container">
                    <view class="load-more-content" v-if="isLoadingMore">
                        <view class="loading-spinner"></view>
                        <text class="load-more-text">正在加载更多...</text>
                    </view>
                    <view class="load-more-content" v-else-if="!hasMoreHistory">
                        <text class="load-more-text no-more">没有更多消息了</text>
                    </view>
                    <view class="load-more-content" v-else>
                        <text v-if="!isScrollable" class="load-more-text clickable"
                            @click="manualLoadMore">点击加载更多</text>
                        <text v-else class="load-more-text">{{ loadMoreText }}</text>
                    </view>
                </view>

                <view class="message-item" v-for="(message, index) in finalRealDisplayMessages" :key="index"
                    :class="message.type" :id="getSafeMessageId(message, index)">
                    <view class="message-row" :class="message.type">
                        <!-- 左侧：用户（客户）头像或状态区 -->
                        <view v-if="message.type === 'user'" class="avatar-wrap left">
                            <image class="avatar" :src="userAvatar"></image>
                        </view>
                        <view v-else class="side-status left">
                            <!-- 客服消息左侧为空 -->
                        </view>

                        <!-- 中间：消息气泡（带尖角，指向头像侧） -->
                        <view class="message-content">
                            <text>{{ message.content }}</text>
                        </view>

                        <!-- 右侧：机器人或人工客服头像 -->
                        <view v-if="message.type === 'robot' || message.type === 'humanAgent'"
                            class="avatar-wrap right">
                            <image class="avatar" :src="getServiceAvatar(message)"></image>
                        </view>
                        <view v-else class="side-status right">
                            <!-- 用户消息右侧状态区（发送中/失败） -->
                            <view class="status-loading" v-if="message.status === 'sending'">
                                <view class="loading-spinner"></view>
                            </view>
                            <view class="status-failed" v-if="message.status === 'failed'">
                                <text class="fail-icon" @click="retryMessage(message)">!</text>
                                <text class="retry-text">点击重发</text>
                            </view>
                        </view>
                    </view>
                    <text class="message-time">{{ message.time }}</text>
                </view>
            </scroll-view>
        </view>

        <!-- 新消息浮窗 -->
        <view class="new-message-float" v-if="showNewMessageFloat" @click="onNewMessageFloatClick">
            <text class="float-icon">▼</text>
            <text class="float-text">{{ newMessageCount }}条新消息</text>
        </view>

        <view class="input-container">
            <input ref="messageInput" class="message-input" v-model="inputMessage" placeholder="请输入您的问题..."
                :focus="shouldFocusInput" @confirm="sendMessage" />
            <button class="send-btn" @click="sendMessage">发送</button>
        </view>


    </view>
</template>

<script>
import { CHAT_BASE_URL } from '@/utils/appConfig.js';
import { createChatSessionManager, getChatWebSocketConnection } from '@/api/chat/chat-session-manager.js';
import { getShopChatManager } from '@/api/chat/shop-chat-manager.js';
import { getGlobalHeartbeatManager } from '@/api/chat/global-heartbeat-manager.js';
import ChatHttpManager from '@/api/chat/chat-http.js';
import { getReadStatusManager } from '@/api/chat/read-status-manager.js';
import { myLog } from '@/utils/log.js';

export default {
    data() {
        return {
            showProductCard: false,
            productInfo: null,
            inputMessage: '',
            // 聊天管理器
            chatManager: null,
            chatHttpManager: null,
            isConnected: false,
            // 头像（可替换为真实头像）
            userAvatar: '/static/tab-my.png',
            agentAvatar: '/static/agent.svg',
            robotAvatar: '/static/robot.svg',
            shopId: '',
            shopInfo: null, // 店铺信息（包含logo）
            // 预检结果
            conversationId: null,
            clientMaxServerMsgId: 0,
            // 滚动状态管理
            hasScrolledUp: false, // 是否向上滚动过
            newMessageCount: 0, // 新消息数量（用于浮窗显示）
            showNewMessageFloat: false, // 是否显示新消息浮窗
            wasAtBottomBeforeUpdate: false, // 消息更新前是否在底部（用于判断新消息到达时是否自动滚动）
            // 加载更多状态管理
            isLoadingMore: false, // 是否正在加载更多历史消息
            hasMoreHistory: true, // 是否还有更多历史消息
            loadMoreText: '下拉加载更多', // 加载更多提示文字
            // 已读状态管理
            readStatusManager: null, // 已读状态管理器
            intersectionObserver: null, // Intersection Observer实例
            // scroll-view 滚动控制
            scrollTop: 0,
            scrollTimer: null,
            // 输入框焦点控制（H5/小程序更稳定）
            shouldFocusInput: true,
            // 聊天滚动区上下边界（像素）
            chatAreaTop: 0,
            chatAreaBottom: 0,
            // 滚动能力与顶部点击加载提示
            isScrollable: true,
            showClickLoad: false,
            // 使用锚点滚动到最后一条消息
            intoViewId: '',
            // 消息更新键（用于强制计算属性重新计算）
            messagesUpdateKey: 0,
            // 底部判断容错值（单位：px），用于判断是否在聊天窗口底部
            // 值越大，判断越宽松（允许更多偏差）
            // 值越小，判断越严格（必须完全到底部）
            bottomThreshold: 100 // 默认 100px 容错空间，可根据需要调整
        };
    },
    async onLoad(options) {
        if (options.shopId) {
            this.shopId = options.shopId;
        }

        // 从URL参数获取conversationId（客服端从聊天列表跳转时已传递）
        if (options.conversationId) {
            this.conversationId = options.conversationId;
        }

        // 从URL参数获取店铺信息
        if (options.shopName) {
            const shopName = decodeURIComponent(options.shopName);
            this.shopInfo = {
                shopName: shopName,
                shopIcon: options.shopIcon ? decodeURIComponent(options.shopIcon) : null
            };
        }

        // 如果有商品信息，显示悬浮商品卡片
        if (options.productId) {
            this.productInfo = {
                id: options.productId,
                name: options.productName ? decodeURIComponent(options.productName) : '',
                pic: options.productPic ? decodeURIComponent(options.productPic) : '',
                price: options.productPrice
            };
            this.showProductCard = true;
            this.clearProductQueryParams();
        }

        // 从缓存读取消息（如果有，从"我的消息"进入时）
        const cache = window.conversationCache?.[this.shopId];
        const cachedMessages = cache?.messages || [];

        // 从缓存获取 shopId（如果URL参数中没有，但缓存中有）
        if (!this.shopId && cache?.shopId) {
            this.shopId = cache.shopId;
        }

        // 从缓存获取店铺信息（如果有，且URL参数中没有）
        if (cache?.shopInfo && !this.shopInfo) {
            this.shopInfo = cache.shopInfo;
        }

        // 从缓存获取 clientMaxServerMsgId（如果有）
        if (cache?.clientMaxServerMsgId) {
            this.clientMaxServerMsgId = cache.clientMaxServerMsgId;
        }

        // 客服端不需要预检查接口，conversationId 和 clientMaxServerMsgId 已从URL参数或缓存中获取

        // 初始化HTTP管理器
        this.initChatHttpManager();

        // 初始化聊天管理器
        this.initChatManager();


        // 如果有缓存，直接加入消息，说明这是从聊天列表页进入聊天窗口，直接把查询到的消息放进来，因为这个聊天列表页的消息是登陆后查询一次，然后放到缓存里，
        // 而且聊天列表有订阅心跳相关事件，有新消息会拉取并存入缓存，正常情况下都是最新的消息了，不过进入聊天窗口后，聊天窗口自己也会拉取最新的消息，
        // 显示管理器则是有跳号检测，不担心中间最新的消息之间有跳号
        if (cachedMessages.length > 0) {
            console.log('从缓存加载消息，数量:', cachedMessages.length);
            this.chatManager.messageDisplayManager.applyOneMessages(cachedMessages);
        }

        // 初始化已读状态管理器
        this.initReadStatusManager();

        // 初始化 Intersection Observer（监听消息可见性）
        this.initIntersectionObserver();
    },
    onReady() {
        // 计算聊天滚动区上下边界
        try {
            const q3 = uni.createSelectorQuery().in(this);
            q3.select('.header').boundingClientRect((rect) => {
                const headerH = rect ? rect.height : 0;
                const q4 = uni.createSelectorQuery().in(this);
                q4.select('.input-container').boundingClientRect((iRect) => {
                    const inputH = iRect ? iRect.height : 0;
                    // 加一点补偿，避免顶部1px边线造成遮挡
                    this.chatAreaTop = Math.floor(headerH) + 20;
                    this.chatAreaBottom = Math.floor(inputH);
                    // 初次渲染后检测是否可滚
                    this.$nextTick(() => this.updateScrollableStatus());
                }).exec();
            }).exec();
        } catch (err) { }
    },
    onShow() {
        // 每次页面显示时，强制滚动到最底部
        // 用户退出聊天窗口后再次进入，应该看到最新消息
        this.$nextTick(() => {
            setTimeout(() => {
                this.scrollToLatest(true);
            }, 100);
        });
    },
    computed: {
        // finalRealDisplayMessages: 从MessageDisplayManager.visibleMessages读取（无状态）
        // 所有消息（包括临时消息）都在MessageDisplayManager中管理，Vue组件只负责展示
        // 依赖 messagesUpdateKey 确保每次 visibleMessages 更新时都能重新计算
        finalRealDisplayMessages() {
            // 访问 messagesUpdateKey 让计算属性依赖它
            const _ = this.messagesUpdateKey; // 用于触发响应式更新
            if (this.chatManager && this.chatManager.messageDisplayManager) {
                // 返回新数组，确保 Vue 能检测到变化，并为每个消息设置 type
                const messages = this.chatManager.messageDisplayManager.visibleMessages || []
                return messages.map(msg => {
                    const message = { ...msg }
                    // 根据 clientMsgId 前缀判断消息类型（显示样式相关，放在前端处理）
                    message.type = this.getMessageType(message)
                    return message
                })
            }
            return []
        }
    },
    watch: {
        // 消息变化后，重新评估是否需要显示"点击加载更多"
        finalRealDisplayMessages: {
            handler() {
                this.$nextTick(() => this.updateScrollableStatus());
            },
            deep: true
        }
    },
    onUnload() {
        // 断开 Intersection Observer
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
            myLog('debug', 'Intersection Observer disconnected');
        }

        // 全局单例策略：不在页面卸载时销毁，保持长连接
    },
    methods: {
        // 清理URL中的商品参数，防止刷新后再次弹出浮窗
        clearProductQueryParams() {
            if (typeof window === 'undefined') {
                return;
            }

            try {
                const keysToRemove = ['productId', 'productName', 'productPic', 'productPrice'];

                // 处理 hash 路由（H5常见场景）
                if (window.location.hash && window.location.hash.includes('?')) {
                    const [hashPath, hashQuery = ''] = window.location.hash.split('?');
                    const params = new URLSearchParams(hashQuery);
                    let changed = false;

                    keysToRemove.forEach((key) => {
                        if (params.has(key)) {
                            params.delete(key);
                            changed = true;
                        }
                    });

                    if (changed) {
                        const newHashQuery = params.toString();
                        const newHash = newHashQuery ? `${hashPath}?${newHashQuery}` : hashPath;
                        const newUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${newHash}`;
                        window.history.replaceState(null, '', newUrl);
                        return;
                    }
                }

                // 非 hash 模式
                const url = new URL(window.location.href);
                let changed = false;

                keysToRemove.forEach((key) => {
                    if (url.searchParams.has(key)) {
                        url.searchParams.delete(key);
                        changed = true;
                    }
                });

                if (changed) {
                    const newUrl = `${url.pathname}${url.search}${url.hash}`;
                    window.history.replaceState(null, '', newUrl);
                }
            } catch (error) {
                console.warn('Failed to clear product query params:', error);
            }
        },

        // 预检会话是否存在
        async preCheckConversation() {
            console.log('开始预检会话，shopId:', this.shopId);

            if (!this.shopId) {
                console.warn('No shopId provided, skipping conversation pre-check');
                return;
            }

            const userInfo = uni.getStorageSync('userInfo');
            console.log('获取到userInfo:', userInfo);

            if (!userInfo || !userInfo.agentId) {
                console.warn('No agentId found in userInfo, skipping conversation pre-check');
                return;
            }

            const userId = userInfo.agentId;

            try {
                myLog('debug', '发送预检请求', { userId, shopId: this.shopId });
                // 创建一个临时的 ChatHttpManager 实例用于预检
                const tempHttpManager = new ChatHttpManager();
                const result = await tempHttpManager.checkConversationByShopId(userId, this.shopId);

                // requestUtil 返回的是 CommonResult，数据结构：{ code, message, data }
                // data 是 ConversationCheckResponse：{ hasConversation, conversationId, clientMaxServerMsgId, shop }
                const data = result.data;
                myLog('debug', '预检响应数据', { hasData: !!data, hasShop: !!(data && data.shop) });

                // 保存店铺信息（用于header显示）
                if (data && data.shop) {
                    myLog('debug', '找到店铺信息', { shopName: data.shop.shopName, shopIcon: data.shop.shopIcon });
                    this.shopInfo = data.shop;
                }

                if (data.hasConversation) {
                    this.conversationId = data.conversationId;
                    this.clientMaxServerMsgId = data.clientMaxServerMsgId || 0;
                } else {
                    // 不存在会话，创建新会话
                    this.conversationId = this.generateConversationId(userId);
                    this.clientMaxServerMsgId = 0;
                }
            } catch (error) {
                myLog('error', 'Conversation pre-check failed', error);
                // 预检失败时也创建新会话，确保conversationId不为null,这样先保证会话,但可能造成一个店铺多个对话框,会有bug,所以这里后面要做error日志上报的配套管理
                const userId = uni.getStorageSync('userInfo')?.agentId;
                if (userId) {
                    this.conversationId = this.generateConversationId(userId);
                    this.clientMaxServerMsgId = 0;
                    console.log('Pre-check failed, created new conversation:', this.conversationId);
                }
            }
        },

        // 生成conversationId：时间戳 + 用户ID（纯数字串，便于数据库索引）
        generateConversationId(userId) {
            const timestamp = Date.now(); // 毫秒级时间戳
            return `${timestamp}${userId}`;
        },

        // 初始化HTTP管理器
        initChatHttpManager() {
            this.chatHttpManager = new ChatHttpManager({
                // baseUrl 使用 ChatHttpManager 的默认值（从 CHAT_BASE_URL 获取）
                conversationId: this.conversationId,
                onMessageRenderCallback: (data) => this.handleMessageReceived(data),
                onError: (error) => {
                    console.error('HTTP聊天错误:', error);
                }
            });
        },

        // 初始化聊天管理器
        initChatManager() {
            // 获取店铺聊天管理器（全局单例）
            const shopChatManager = getShopChatManager();

            // 获取或创建该店铺的 ChatSessionManager 实例（按店铺长期保存）
            this.chatManager = shopChatManager.getOrCreateShopSession({
                shopId: this.shopId,
                conversationId: this.conversationId, // 预检结果
                clientMaxServerMsgId: this.clientMaxServerMsgId, // 预检结果
                chatHttpManager: this.chatHttpManager,
                onMessageRenderCallback: (data) => this.handleMessageReceived(data),  // ChatManager -> Vue页面的消息渲染回调
                onConnectionChange: (connected) => {
                    this.isConnected = connected;
                    console.log('连接状态变化:', connected);
                    if (connected) {
                        // 原本这里在客户是商品详情页进入聊天窗口时，会拉取历史消息，现在不需要了，因为聊天窗口列表页已经拉取过一次了
                    }
                },
                onMessageStatusChange: (clientMsgId, status, extra) => {
                    this.updateMessageStatus(clientMsgId, status, extra);
                },
                onError: (error) => {
                    console.error('聊天错误:', error);
                }
            });
        },

        // 初始化已读状态管理器
        initReadStatusManager() {
            myLog('debug', 'Initializing read status manager');
            this.readStatusManager = getReadStatusManager();

            // 初始化当前对话的已读状态
            if (this.conversationId && this.clientMaxServerMsgId) {
                this.readStatusManager.initConversationReadStatus(
                    this.conversationId,
                    this.clientMaxServerMsgId
                );
                myLog('debug', 'Initialized read status for conversation', { conversationId: this.conversationId, clientMaxServerMsgId: this.clientMaxServerMsgId });
            }
        },

        // 初始化 Intersection Observer（监听消息可见性）
        initIntersectionObserver() {
            myLog('debug', 'Initializing Intersection Observer');

            // 创建观察器
            this.intersectionObserver = uni.createIntersectionObserver(this, {
                thresholds: [0, 1.0], // 触发阈值：元素进入和离开可视区时都触发
                initialRatio: 0 // 初始时不可见
            });

            // 监听消息元素的可见性
            this.$nextTick(() => {
                this.observeMessages();
            });
        },

        // 获取安全的消息ID（用于DOM元素ID和CSS选择器）
        // 将 clientMsgId 中的特殊字符（如冒号）替换为安全字符
        getSafeMessageId(message, index) {
            const id = message.clientMsgId || `index-${index}`;
            // 将冒号替换为下划线，确保CSS选择器有效
            return `message-${String(id).replace(/:/g, '_')}`;
        },

        // 观察所有消息元素
        observeMessages() {
            if (!this.intersectionObserver) return;

            this.finalRealDisplayMessages.forEach((message, index) => {
                // 使用安全的ID生成函数，确保选择器有效
                const selector = `#${this.getSafeMessageId(message, index)}`;

                this.intersectionObserver.observe(selector, (res) => {
                    myLog('debug', 'Message visibility changed', { selector, intersectionRatio: res.intersectionRatio });

                    // 如果消息进入可视区（intersectionRatio > 0），且消息未读，则标记为已读
                    if (res.intersectionRatio > 0) {
                        this.handleMessageVisible(message);
                    }
                });
            });
        },

        // 处理消息可见性变化（自动已读）
        async handleMessageVisible(message) {
            myLog('debug', 'Handling message visibility', message);

            if (!message || !this.conversationId || !message.serverMsgId) {
                return;
            }

            // 判断消息是否已读
            const isRead = this.readStatusManager.isMessageRead(
                this.conversationId,
                message.serverMsgId
            );

            if (isRead) {
                myLog('debug', 'Message already read', { serverMsgId: message.serverMsgId });
                return;
            }

            // 发送已读请求
            myLog('debug', 'Sending mark as read request', { serverMsgId: message.serverMsgId });
            const result = await this.chatHttpManager.markAsRead({
                conversationId: this.conversationId,
                serverMsgId: message.serverMsgId
            });

            if (result && result.success) {
                // 更新本地已读状态
                this.readStatusManager.updateReadStatus(
                    this.conversationId,
                    message.serverMsgId
                );
                myLog('debug', 'Message marked as read successfully', { serverMsgId: message.serverMsgId });
            } else {
                myLog('error', 'Failed to mark message as read', { serverMsgId: message.serverMsgId, result });
            }
        },

        // 格式化消息时间
        formatMessageTime(timestamp) {
            const date = new Date(timestamp);
            const y = date.getFullYear();
            const m = (date.getMonth() + 1).toString().padStart(2, '0');
            const d = date.getDate().toString().padStart(2, '0');
            const hh = date.getHours().toString().padStart(2, '0');
            const mm = date.getMinutes().toString().padStart(2, '0');
            return `${y}-${m}-${d} ${hh}:${mm}`;
        },

        // 处理接收到的消息
        // 这是Vue页面的消息分发器，接收来自ChatManager的回调
        handleMessageReceived(data) {
            console.log('收到消息:', data);

            // 处理分页拉取消息的响应
            if (data.interface === '/pullMessageWithPagedQuery') {
                this.handlePullMessageResponse(data);
                return;
            }

            // 处理新消息到达（智能滚动）
            if (data.interface === '/newMessagesArrived') {
                this.handleNewMessagesArrived(data.payload);
                return;
            }

            // 处理消息显示更新（来自MessageDisplayManager）
            if (data.interface === '/messagesUpdate') {
                this.handleMessagesUpdate(data.payload);
                return;
            }

            // TODO: 处理其他类型的消息（如机器人回复、客服回复等）
        },

        // 处理新消息到达（智能滚动逻辑）
        // 注意：消息本身已经通过 /messagesUpdate 更新到 this.finalRealDisplayMessages 了
        // 这里只负责滚动逻辑
        handleNewMessagesArrived(payload) {
            console.log('新消息到达，处理滚动逻辑:', payload);

            // 使用消息更新前保存的底部状态进行判断
            // 因为消息更新后 scrollHeight 会增加，但 scrollTop 还没更新，会导致判断不准确
            if (this.wasAtBottomBeforeUpdate) {
                // 消息更新前在底部，新消息到达后自动滚动到底部
                this.$nextTick(() => {
                    this.performScrollToLatest();
                    console.log('消息更新前在底部，自动滚动到最新消息');
                });
            } else {
                // 消息更新前不在底部，显示新消息浮窗
                this.newMessageCount += payload.messageCount || 1;
                this.showNewMessageFloat = true;
                console.log('消息更新前不在底部，显示新消息浮窗，数量:', this.newMessageCount);
            }
        },

        // 处理消息显示更新（来自MessageDisplayManager）
        // payload.messages 是 MessageDisplayManager 的 visibleMessages（当前应该显示的消息）
        // 现在 finalRealDisplayMessages 是计算属性，直接从 MessageDisplayManager.visibleMessages 读取
        // 所以这里只需要更新加载状态即可
        handleMessagesUpdate(payload) {
            // 在消息更新前，先判断是否在底部（因为更新后 scrollHeight 会增加，判断会不准确）
            // 保存这个状态，用于后续新消息到达时的滚动判断
            this.checkIsAtBottom().then(isAtBottom => {
                this.wasAtBottomBeforeUpdate = isAtBottom;
            });

            // 递增 messagesUpdateKey 以触发计算属性重新计算
            // visibleMessages 不是 Vue 响应式数据，通过这种方式确保 Vue 能检测到变化
            this.messagesUpdateKey++;

            // 立即强制更新，因为 messagesUpdateKey++ 已经触发了计算属性的重新计算
            this.$forceUpdate();

            console.log('消息显示更新:', payload);
            // 消息数据已通过计算属性finalRealDisplayMessages自动从visibleMessages读取，无需手动合并

            // 更新加载状态
            if (typeof payload.isLoadingMore !== 'undefined') {
                this.isLoadingMore = payload.isLoadingMore;
            }
            if (typeof payload.hasMoreHistory !== 'undefined') {
                this.hasMoreHistory = payload.hasMoreHistory;
            }

            // 更新加载提示文字
            if (this.isLoadingMore) {
                this.loadMoreText = '正在加载更多...';
            } else if (!this.hasMoreHistory) {
                this.loadMoreText = '没有更多消息了';
            } else {
                this.loadMoreText = '下拉加载更多';
            }
        },

        // 处理分页拉取消息的响应
        // 注意：消息已经通过 MessageDisplayManager 自动处理，这里不再需要手动添加
        handlePullMessageResponse(message) {
            // 数据结构：{ success: true, payload: { message: {...}, serverMsgId: 115, ... } }
            // MessageDisplayManager 会通过回调自动更新消息，finalRealDisplayMessages 是计算属性会自动更新
            console.log('Pulled message:', message);
        },

        // 更新消息状态（兼容接口，实际不再需要，因为消息状态在 MessageDisplayManager 中管理）
        updateMessageStatus(clientMsgId, status, extra = {}) {
            // 消息状态现在由 MessageDisplayManager 统一管理
            // 此方法保留作为兼容接口，但不再需要手动更新
            console.log('updateMessageStatus called', { clientMsgId, status, extra });
        },

        // 发送消息
        sendMessage() {
            if (!this.inputMessage.trim()) {
                return;
            }

            const content = this.inputMessage;
            this.inputMessage = ''; // 清空输入框
            // 立即保持/恢复输入框焦点（通过受控 focus 属性更稳定）
            this.shouldFocusInput = false;
            this.$nextTick(() => {
                this.shouldFocusInput = true;
            });

            // 发送后保持输入框聚焦
            this.$nextTick(() => {
                if (this.$refs.messageInput && typeof this.$refs.messageInput.focus === 'function') {
                    this.$refs.messageInput.focus();
                }
                // H5 某些情况下需要延迟再次聚焦
                setTimeout(() => {
                    if (this.$refs.messageInput && typeof this.$refs.messageInput.focus === 'function') {
                        this.$refs.messageInput.focus();
                    }
                }, 50);
            });

            // 通过ChatManager发送消息
            // ChatManager 会自动添加到 pendingMessages，finalRealDisplayMessages 是计算属性会自动更新
            const result = this.chatManager.sendTextMessage(content);

            if (result.success) {
                // 发送后自动滚动到最新消息（强制）
                this.scrollToLatest(true);
            } else {
                // 发送失败提示
                if (result.error === 'NOT_CONNECTED') {
                    uni.showToast({
                        title: '连接已断开',
                        icon: 'none'
                    });
                } else if (result.error === 'RECONNECTING') {
                    uni.showToast({
                        title: '正在重连，请稍候...',
                        icon: 'none'
                    });
                }
            }
        },

        // 重发消息
        retryMessage(message) {
            if (message.status !== 'failed') {
                return;
            }

            // 通过ChatManager重发
            this.chatManager.retryMessage(message.clientMsgId, message.content);
        },

        // 获取当前时间
        getCurrentTime() {
            const now = new Date();
            const y = now.getFullYear();
            const m = (now.getMonth() + 1).toString().padStart(2, '0');
            const d = now.getDate().toString().padStart(2, '0');
            const hh = now.getHours().toString().padStart(2, '0');
            const mm = now.getMinutes().toString().padStart(2, '0');
            return `${y}-${m}-${d} ${hh}:${mm}`;
        },

        // 根据 clientMsgId 前缀判断消息类型（显示样式相关，放在前端处理）
        // 规则：
        // - c: 开头 → 'user'（客户）
        // - robot_system_ 开头 → 'robot'（机器人客服）
        // - hpre: 或 hpost: 开头 → 'humanAgent'（人工客服）
        getMessageType(message) {
            if (!message || !message.clientMsgId || typeof message.clientMsgId !== 'string') {
                return 'humanAgent' // 默认返回人工客服
            }

            const clientMsgId = message.clientMsgId
            if (clientMsgId.indexOf('c:') === 0) {
                return 'user'
            } else if (clientMsgId.indexOf('robot_system_') === 0) {
                return 'robot'
            } else if (clientMsgId.indexOf('hpre:') === 0 || clientMsgId.indexOf('hpost:') === 0) {
                return 'humanAgent'
            }

            return 'humanAgent' // 默认返回人工客服
        },

        // 根据消息类型返回客服头像
        // type 类型：'user'（用户）、'robot'（机器人客服）、'humanAgent'（人工客服）
        getServiceAvatar(message) {
            if (message.type === 'robot') {
                return this.robotAvatar;
            }
            if (message.type === 'humanAgent') {
                return this.agentAvatar;
            }
            if (message.type === 'user') {
                return this.userAvatar;
            }
            return this.agentAvatar;
        },

        // 检查是否在底部（主动查询）
        // 返回 Promise，使用 resolve 返回结果
        checkIsAtBottom() {
            // 创建 Promise，resolve 是 Promise 构造函数传入的回调函数
            // resolve(value) 的作用：将 value 作为 Promise 的成功结果返回给调用者
            // 调用者通过 .then(result => {...}) 接收这个值
            return new Promise((resolve) => {
                const query = uni.createSelectorQuery().in(this);

                // 对同一个元素分别添加 scrollOffset 和 boundingClientRect 查询
                const nodeQuery = query.select('.message-list');
                nodeQuery.scrollOffset();
                nodeQuery.boundingClientRect();

                query.exec((res) => {
                    // res[0] 是 scrollOffset 的结果
                    // res[1] 是 boundingClientRect 的结果
                    if (!res || res.length < 2) {
                        resolve(false);  // resolve(false) 表示 Promise 成功完成，返回 false
                        return;
                    }

                    const scrollRes = res[0];
                    const rect = res[1];

                    if (!scrollRes || !rect) {
                        resolve(false);  // resolve(false) 表示 Promise 成功完成，返回 false
                        return;
                    }

                    const scrollTop = scrollRes.scrollTop || 0;
                    const scrollHeight = scrollRes.scrollHeight || 0;
                    const clientHeight = rect.height || 0;

                    // 判断是否在底部（留一些容错空间）
                    // 使用可配置的容错值，允许一定偏差
                    const isAtBottom = scrollTop + clientHeight >= scrollHeight - this.bottomThreshold;

                    // console.log('[checkIsAtBottom] 滚动位置检查:', {
                    //     scrollTop,
                    //     scrollHeight,
                    //     clientHeight,
                    //     isAtBottom,
                    //     calculation: `${scrollTop} + ${clientHeight} >= ${scrollHeight} - 50`,
                    //     result: scrollTop + clientHeight,
                    //     threshold: scrollHeight - 50
                    // });

                    // resolve(isAtBottom) 的作用：
                    // 1. 表示 Promise 成功完成
                    // 2. 将 isAtBottom 的值返回给调用者
                    // 3. 调用者通过 .then(isAtBottom => {...}) 接收这个值
                    resolve(isAtBottom);
                });
            });
        },

        // 滚动到最新消息
        // force=true 时无条件滚到底（用于发送消息后）；否则仅在用户在底部时滚动
        scrollToLatest(force = false) {
            this.$nextTick(() => {
                if (!force) {
                    // 如果不是强制滚动，先检查是否在底部
                    this.checkIsAtBottom().then(isAtBottom => {
                        if (!isAtBottom) return;
                        this.performScrollToLatest();
                    });
                } else {
                    // 强制滚动
                    this.performScrollToLatest();
                }
            });
        },

        // 执行滚动到底部的操作
        performScrollToLatest() {
            // 再次等待 DOM 更新，确保能获取到最新的消息元素
            this.$nextTick(() => {
                // 使用锚点滚动，定位最后一条消息的元素 id
                const lastId = this.getLastMessageElementId();
                if (lastId) {
                    this.intoViewId = lastId;
                    // 短暂释放，避免后续相同 id 不触发滚动
                    setTimeout(() => { this.intoViewId = ''; }, 200);
                }
                // 同时释放 scrollTop 受控，以防外部遗留值影响
                this.scrollTop = undefined;
                this.hasScrolledUp = false;
                this.showNewMessageFloat = false;
                this.newMessageCount = 0;
            });
        },

        // 获取最后一条消息的元素 id（与模板中的 :id 保持一致）
        getLastMessageElementId() {
            if (!this.finalRealDisplayMessages || this.finalRealDisplayMessages.length === 0) return '';
            const lastIndex = this.finalRealDisplayMessages.length - 1;
            const last = this.finalRealDisplayMessages[lastIndex];
            return this.getSafeMessageId(last, lastIndex);
        },

        // 处理滚动事件（使用uni-app的查询API）
        onScroll(e) {
            // 使用主动查询方法检查是否在底部
            this.checkIsAtBottom().then(isAtBottom => {
                if (isAtBottom) {
                    // 滚动到底部，隐藏浮窗
                    this.showNewMessageFloat = false;
                    this.newMessageCount = 0;
                    this.hasScrolledUp = false;
                } else {
                    // 向上滚动
                    this.hasScrolledUp = true;
                }
            });
            // 滚动过程中同步检查（软键盘/布局变化导致高度变化时）
            this.updateScrollableStatus();
        },

        // 触底
        onScrollToLower() { },



        // 点击新消息浮窗，滚动到最新
        onNewMessageFloatClick() {
            // 强制滚动到底部
            this.scrollToLatest(true);
        },

        // 下拉加载更多历史消息
        async onScrollToUpper() {
            console.log('触发下拉加载更多');

            // 防止重复加载
            if (this.isLoadingMore || !this.hasMoreHistory) {
                return;
            }

            this.isLoadingMore = true;
            this.loadMoreText = '正在加载更多...';

            try {
                // 调用MessageDisplayManager的加载更多方法
                if (this.chatManager && this.chatManager.messageDisplayManager) {
                    await this.chatManager.messageDisplayManager.loadMoreHistoryMessages();

                    // 更新状态
                    this.isLoadingMore = this.chatManager.messageDisplayManager.isLoadingMore;
                    this.hasMoreHistory = this.chatManager.messageDisplayManager.hasMoreHistory;

                    if (!this.hasMoreHistory) {
                        this.loadMoreText = '没有更多消息了';
                    } else {
                        this.loadMoreText = '下拉加载更多';
                    }
                }
            } catch (error) {
                console.error('加载更多历史消息失败:', error);
                this.isLoadingMore = false;
                this.loadMoreText = '加载失败，点击重试';

                // 显示错误提示
                uni.showToast({
                    title: '加载失败',
                    icon: 'none'
                });
            }
            // 加载结束后（无论成功失败）更新滚动能力状态
            this.updateScrollableStatus();
        },

        // 手动触发顶部加载更多（当不足以滚动时可点击）
        manualLoadMore() {
            if (this.isLoadingMore || !this.hasMoreHistory) return;
            // 无论当前是否可滚动，点击都尝试加载上一页，等价触顶加载
            this.onScrollToUpper();
        },

        // 计算并更新滚动条是否出现与提示显示（聊天窗口信息太少会导致撑不满一页，导致无法激活滚动事件，进而无法触发加载分页查询历史聊天记录的http接口，导致一直无法加载更多历史消息）
        updateScrollableStatus() {
            // 先拿可视高度（容器高度），再拿内容高度
            this.$nextTick(() => {
                // 等待本次 DOM 更新完成后再测量，避免拿到旧尺寸
                const q1 = uni.createSelectorQuery().in(this);
                // 先测量滚动容器的可视高度（等价于 containerHeight）
                q1.select('.message-list').boundingClientRect((rect) => {
                    const containerHeight = rect ? rect.height : 0;
                    // 再读取滚动内容总高度（等价于 scrollHeight）
                    const q2 = uni.createSelectorQuery().in(this);
                    q2.select('.message-list').scrollOffset((res) => {
                        const contentHeight = (res && res.scrollHeight) || 0;
                        // 是否可滚：内容高度 > 容器高度（+2 为像素/边线容差）
                        const canScroll = contentHeight > containerHeight + 2;
                        this.isScrollable = canScroll;
                        // 不可滚且有更多历史、且非加载中 → 显示“点击加载更多”
                        this.showClickLoad = !canScroll && this.hasMoreHistory && !this.isLoadingMore;
                    }).exec();
                }).exec();
            });
        },

        // 关闭商品卡片
        closeProductCard() {
            this.showProductCard = false;
        },

        // 发送商品给客服
        sendProductToService() {
            if (!this.productInfo) return;

            // 构建商品链接（CHAT_BASE_URL 只包含域名和端口，需要添加 http:// 协议头）
            const productLink = `http://${CHAT_BASE_URL}/product/${this.productInfo.id}`;
            const content = `我想咨询这个商品：${this.productInfo.name}\n${productLink}`;

            // 通过ChatManager发送消息
            // ChatManager 会自动添加到 pendingMessages，finalRealDisplayMessages 是计算属性会自动更新
            const result = this.chatManager.sendTextMessage(content);

            if (result.success) {
                // 消息已自动添加到 pendingMessages，无需手动操作
            } else {
                // 发送失败提示
                if (result.error === 'NOT_CONNECTED') {
                    uni.showToast({
                        title: '连接已断开',
                        icon: 'none'
                    });
                } else if (result.error === 'RECONNECTING') {
                    uni.showToast({
                        title: '正在重连，请稍候...',
                        icon: 'none'
                    });
                }
            }

            // 关闭商品卡片
            this.showProductCard = false;
        }
    }
};
</script>

<style lang="scss" scoped>
::v-deep uni-page-head {
    display: none !important;
}

.container {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    background-color: #f5f5f5;
    overflow: hidden;
}

.header {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    padding: 20upx 30upx;
    background-color: #fff;
    border-bottom: 1px solid #eee;
    gap: 20upx;

    .shop-icon {
        width: 60upx;
        height: 60upx;
        border-radius: 8upx;
    }

    .title {
        font-size: 32upx;
        font-weight: bold;
        color: #333;
    }
}

.floating-product-card {
    position: fixed;
    bottom: 120upx;
    left: 20upx;
    right: 20upx;
    z-index: 100;
    background-color: #fff;
    border-radius: 16upx;
    box-shadow: 0 4upx 20upx rgba(0, 0, 0, 0.1);

    .close-btn {
        position: absolute;
        top: 10upx;
        right: 10upx;
        width: 40upx;
        height: 40upx;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 40upx;
        font-weight: 300;
        color: #999;
        z-index: 101;
    }

    .product-card-content {
        display: flex;
        /* 这个元素变成了 flex 容器 Flex 容器就是一个设置了 display: flex 的 HTML 元素。它就像一个"弹性盒子"，可以控制里面子元素的排列方式。它的直接子元素自动变成 flex 子项*/
        align-items: center;
        padding: 20upx;

        .product-thumbnail {
            /*flex 子项:每个 flex 子项可以理解为容器内的一个子元素,是弹性盒子的一部分,product-thumbnail是展示商品缩略图的*/
            width: 100upx;
            height: 100upx;
            border-radius: 8upx;
            margin-right: 20upx;
        }

        .product-info {
            /* flex 子项:每个 flex 子项可以理解为容器内的一个子元素*/
            flex: 1;
            /*这个的语法是flex: <grow> <shrink> <basis>,grow是增长因子,shrink是收缩因子,basis是基准值,flex: 1是 flex: 1 1 0% 的简写,这个子项会占用剩余的所有可用空间,就是扣除了product-thumbnail的剩余空间,浏览器F12就知道了*/
            min-width: 0;
            /* 关键：允许flex子项收缩,默认情况下，flex 子项的最小宽度等于其内容的宽度, 如果文本很长，flex 子项不会收缩到比文本更小,min-width: 0 告诉浏览器："允许我收缩到比内容更小",就是容纳文本的那个框可以比文本短,这样才能截断文本*/
            margin-right: 120upx;
            /* 为绝对定位的按钮留出空间 */

            .product-title {
                display: block;
                font-size: 26upx;
                color: #333;
                font-weight: bold;
                margin-bottom: 8upx;
                overflow: hidden;
                /* 隐藏超出部分,上面的min-width: 0已经截断了文本了,这里是文本的隐藏设置,超出部分隐藏 */
                text-overflow: ellipsis;
                /* 超出部分用省略号表示 */
                white-space: nowrap;
                /* 文本不换行 */
                width: 100%;
                /* 确保占满父容器宽度 */
            }

            .product-price {
                font-size: 28upx;
                color: #ff4444;
                font-weight: bold;
            }
        }

        .send-to-service-btn {
            position: absolute;
            bottom: 10upx;
            right: 10upx;
            background-color: #007AFF;
            color: #fff;
            border: none;
            border-radius: 16upx;
            padding: 6upx 12upx;
            font-size: 22upx;
            white-space: nowrap;
            height: auto;
            line-height: 1.2;
            display: inline-block;
            margin-left: auto;
            align-self: flex-end;
        }
    }
}

.chat-container {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;

    .message-list {
        flex: 1;
        padding: 20upx;
        min-height: 0;
        /* 重要：允许滚动 */
    }

    .message-item {
        margin-bottom: 30upx;

        .message-row {
            display: flex;
            align-items: center;
            gap: 12upx;
            padding: 0 20upx;
        }

        .message-row.service,
        .message-row.robot,
        .message-row.humanAgent {
            justify-content: flex-end;
        }

        .message-row.user {
            justify-content: flex-start;
        }

        .avatar-wrap {
            width: 72upx;
            height: 72upx;
            flex-shrink: 0;
        }

        .avatar {
            width: 72upx;
            height: 72upx;
            border-radius: 8upx;
            display: block;
        }

        .side-status {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            min-width: 0;
        }

        .message-content {
            position: relative;
            padding: 10upx 16upx;
            border-radius: 16upx;
            font-size: 28upx;
            line-height: 1.4;
            max-width: 60%;
            word-wrap: break-word;
            word-break: break-all;

            text {
                display: block;
                word-wrap: break-word;
                word-break: break-all;
            }
        }

        &.service .message-content,
        &.robot .message-content,
        &.humanAgent .message-content {
            background-color: #fff;
            color: #333;
        }

        &.user .message-content {
            background-color: #07C160;
            color: #fff;
        }

        &.service .message-content:after,
        &.robot .message-content:after,
        &.humanAgent .message-content:after {
            content: '';
            position: absolute;
            right: -8upx;
            top: 50%;
            transform: translateY(-50%);
            width: 0;
            height: 0;
            border-width: 12upx 0 12upx 12upx;
            border-style: solid;
            border-color: transparent transparent transparent #fff;
        }

        &.user .message-content:after {
            content: '';
            position: absolute;
            left: -8upx;
            top: 50%;
            transform: translateY(-50%);
            width: 0;
            height: 0;
            border-width: 12upx 12upx 12upx 0;
            border-style: solid;
            border-color: transparent #07C160 transparent transparent;
        }

        &.system {
            .message-content {
                background-color: #f0f0f0;
                color: #666;
                margin: 0 50upx;
                text-align: center;
            }
        }

        .message-time {
            display: block;
            text-align: center;
            font-size: 22upx;
            color: #999;
            margin-top: 10upx;
        }

        .status-loading {
            .loading-spinner {
                width: 32upx;
                height: 32upx;
                border: 3upx solid rgba(0, 0, 0, 0.15);
                border-top-color: #07C160;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
        }

        .status-failed {
            display: flex;
            align-items: center;
            gap: 6upx;

            .fail-icon {
                width: 32upx;
                height: 32upx;
                background-color: #ff4444;
                color: #fff;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24upx;
                font-weight: bold;
                cursor: pointer;
            }

            .retry-text {
                font-size: 22upx;
                color: #ff4444;
                text-decoration: underline;
                cursor: default;
            }
        }

        .message-status-outside {
            display: flex;
            align-items: center;
            gap: 8upx;
            cursor: pointer;
            margin-left: 10upx;

            .fail-icon {
                width: 32upx;
                height: 32upx;
                background-color: #ff4444;
                color: #fff;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24upx;
                font-weight: bold;
            }

            .retry-text {
                font-size: 22upx;
                color: #ff4444;
                text-decoration: underline;
            }
        }
    }
}

// 转圈圈动画
@keyframes spin {
    0% {
        transform: rotate(0deg);
    }

    100% {
        transform: rotate(360deg);
    }
}

.input-container {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 999;
    display: flex;
    align-items: center;
    padding: 20upx 30upx;
    background-color: #fff;
    border-top: 1px solid #eee;

    .message-input {
        flex: 1;
        height: 60upx;
        padding: 0 20upx;
        background-color: #f5f5f5;
        border-radius: 30upx;
        font-size: 28upx;
        margin-right: 20upx;
    }

    .send-btn {
        background-color: #007AFF;
        color: #fff;
        border: none;
        border-radius: 16upx;
        font-size: 26upx;
        display: inline-block;
        line-height: 1.2;
        padding: 6upx 12upx;
        height: auto;
        white-space: nowrap;
    }
}

/* 新消息浮窗样式 */
.new-message-float {
    position: fixed;
    bottom: 200upx;
    right: 30upx;
    background-color: #fff;
    color: #333;
    padding: 16upx 24upx;
    border-radius: 40upx;
    border: 1px solid #4cd964;
    box-shadow: 0 2upx 12upx rgba(0, 0, 0, 0.1);
    z-index: 1000;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8upx;
    animation: floatIn 0.3s ease-out;
}

.float-icon {
    font-size: 20upx;
    color: #4cd964;
    line-height: 1;
}

.float-text {
    font-size: 26upx;
    color: #333;
    font-weight: normal;
}

@keyframes floatIn {
    from {
        opacity: 0;
        transform: translateY(20upx);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* 加载更多样式 */
.load-more-container {
    padding: 28upx 0 20upx;
    /* 顶部加额外内边距，避免被头部边线压住 */
    text-align: center;
}

.load-more-content {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
}

.load-more-text {
    font-size: 24upx;
    color: #999;
}

.load-more-text.clickable {
    color: #007aff;
    text-decoration: underline;
    cursor: pointer;
    /* H5 提示可点击 */
}

.load-more-text.no-more {
    color: #ccc;
}

.load-more-content .loading-spinner {
    width: 24upx;
    height: 24upx;
    border: 2upx solid rgba(0, 0, 0, 0.15);
    border-top-color: #999;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-right: 10upx;
}
</style>
