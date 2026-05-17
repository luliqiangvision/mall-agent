<template>
    <view class="chat-list-container">
        <!-- 当前登录客服角色（只读，来自 /agent/info 的 agentType） -->
        <view class="role-bar" v-if="roleDisplayName">
            <text class="role-label">当前角色</text>
            <text class="role-value">{{ roleDisplayName }}</text>
        </view>

        <!-- 顶部分段 -->
        <scroll-view class="segment-bar" scroll-x v-if="segments.length > 1">
            <view
                v-for="seg in segments"
                :key="seg.id"
                class="segment-item"
                :class="{ active: activeSegmentId === seg.id }"
                @click="switchSegment(seg.id)"
            >
                <text class="segment-label">{{ seg.label }}</text>
                <view
                    v-if="getSegmentBadge(seg) > 0"
                    class="segment-badge"
                    :class="{ warning: seg.isWaitingTab }"
                >{{ getSegmentBadge(seg) > 99 ? '99+' : getSegmentBadge(seg) }}</view>
            </view>
        </scroll-view>

        <scroll-view class="chat-list" scroll-y>
            <view class="empty-state" v-if="conversationList.length === 0 && !isLoading">
                <text class="empty-text">{{ emptyText }}</text>
            </view>

            <view class="loading-state" v-if="isLoading">
                <text class="loading-text">加载中...</text>
            </view>

            <view
                class="chat-item"
                v-for="conversation in conversationList"
                :key="conversation.conversationId"
                :class="{ 'item-waiting': conversation.needsJoin }"
                @click="openConversation(conversation)"
            >
                <view class="avatar-container">
                    <image
                        v-if="conversation.avatarType === 'shop' && conversation.shopIcon"
                        class="avatar"
                        :src="conversation.shopIcon"
                        mode="aspectFill"
                    />
                    <view
                        v-else
                        class="avatar avatar-text"
                        :class="'avatar-' + conversation.avatarType"
                    >
                        <text>{{ avatarText(conversation.avatarType) }}</text>
                    </view>
                    <view class="unread-badge" v-if="conversation.unreadCount > 0">
                        {{ conversation.unreadCount > 99 ? '99+' : conversation.unreadCount }}
                    </view>
                </view>

                <view class="chat-content">
                    <view class="chat-header">
                        <text class="shop-name">{{ conversation.title }}</text>
                        <text class="time">{{ formatTime(conversation.lastMessageTime) }}</text>
                    </view>
                    <view class="last-message">
                        <text class="last-message-text">{{ conversationSubtitle(conversation) }}</text>
                    </view>
                    <view class="row-meta" v-if="conversation.needsJoin || conversation.avatarType === 'corporate'">
                        <text class="meta-tag" v-if="conversation.needsJoin">点击接待</text>
                        <text class="meta-tag corp" v-else-if="conversation.avatarType === 'corporate'">公司级</text>
                    </view>
                </view>

                <view class="waiting-pill" v-if="conversation.needsJoin">
                    <text>待接待</text>
                </view>
            </view>
        </scroll-view>
    </view>
</template>

<script>
/**
 * 客服消息列表页（TabBar「消息」）
 *
 * 数据流：
 * 1. conversation-workbench-poller 每 15s HTTP 拉各角色 list + getChatWindowList
 * 2. 本页 subscribe 轮询结果 → applyWorkbench 刷新分段 Tab 与列表
 * 3. WS 消息心跳仍由 GlobalHeartbeatManager 负责「已知会话」新消息，不负责新会话进列表
 *
 * 分段与接口映射见 conversation-workbench-config.js
 */
import ChatHttpManager from '@/api/chat/chat-http.js';
import { getWorkbenchPoller, startWorkbenchPoller } from '@/api/chat/conversation-workbench-poller.js';
import { getChatWebSocketConnection } from '@/api/chat/chat-session-manager.js';
import { getEventBus } from '@/api/chat/message-event-bus.js';
import { getUnreadCountManager } from '@/api/chat/unread-count-manager.js';
import { getGlobalHeartbeatManager } from '@/api/chat/global-heartbeat-manager.js';
import { myLog } from '@/utils/log.js';

/** agentType → 界面展示文案（与登录接口 agentType 一致） */
const ROLE_LABELS = {
    'pre-sales': '售前',
    'after-sales': '售后',
    corporate: '老板',
    legal: '法务',
    tax: '税务',
    system: '系统',
};

export default {
    data() {
        return {
            agentType: 'pre-sales',
            segments: [],
            activeSegmentId: 'mine',
            segmentData: {},
            conversationList: [],
            totalUnreadCount: 0,
            isLoading: false,
            chatHttpManager: null,
            eventBus: null,
            unreadCountManager: null,
            unsubscribeEvents: null,
            unsubWorkbenchPoll: null,
            joiningId: null,
        };
    },
    computed: {
        emptyText() {
            const seg = this.segments.find((s) => s.id === this.activeSegmentId);
            return seg ? `${seg.label}暂无会话` : '暂无聊天记录';
        },
        roleDisplayName() {
            const type = this.agentType || uni.getStorageSync('userInfo')?.agentType;
            if (!type) return '';
            return ROLE_LABELS[type] || type;
        },
    },
    async onLoad() {
        this.syncAgentTypeFromLogin();
        this.unreadCountManager = getUnreadCountManager();
        this.initChatHttpManager();
        this.bindWorkbenchPoller();
        startWorkbenchPoller();
        this.isLoading = true;
        await getWorkbenchPoller().refreshNow({ source: 'pageLoad' });
        this.isLoading = false;
        const heartbeatManager = getGlobalHeartbeatManager();
        heartbeatManager.startHeartbeat();
        this.initWebSocket();
        this.subscribeToEvents();
    },
    async onShow() {
        this.syncAgentTypeFromLogin();
        if (!this.chatHttpManager) {
            this.initChatHttpManager();
        }
        startWorkbenchPoller();
        getWorkbenchPoller().refreshNow({ source: 'pageShow' });
        const heartbeatManager = getGlobalHeartbeatManager();
        heartbeatManager.initializeConversationIds();
        heartbeatManager.startHeartbeat();
        const cachedCount = uni.getStorageSync('totalUnreadCount') || 0;
        if (cachedCount > 0) {
            this.updateTabBarBadge(cachedCount);
        }
    },
    onUnload() {
        if (this.unsubscribeEvents) {
            this.unsubscribeEvents();
        }
        if (this.unsubWorkbenchPoll) {
            this.unsubWorkbenchPoll();
            this.unsubWorkbenchPoll = null;
        }
    },
    methods: {
        /** 从登录态读取 agentType，工作台分段与轮询均以此为准 */
        syncAgentTypeFromLogin() {
            const userInfo = uni.getStorageSync('userInfo') || {};
            if (userInfo.agentType) {
                this.agentType = userInfo.agentType;
            }
        },
        initChatHttpManager() {
            this.chatHttpManager = new ChatHttpManager({
                conversationId: null,
                onMessageRenderCallback: (data) => this.handleMessageReceived(data),
                onError: (error) => console.error('HTTP聊天错误:', error),
            });
        },
        initWebSocket() {
            this.eventBus = getEventBus();
            const wsConnection = getChatWebSocketConnection();
            if (!wsConnection.isConnectionActive()) {
                wsConnection.connect();
            }
        },
        /** 订阅全局轮询器；interval/pageShow 时保留用户当前选中的分段 */
        bindWorkbenchPoller() {
            const poller = getWorkbenchPoller();
            this.unsubWorkbenchPoll = poller.subscribe((workbench, meta) => {
                const preserveActive =
                    meta?.source === 'interval' ||
                    meta?.source === 'pageShow' ||
                    meta?.source === 'manual';
                this.onWorkbenchUpdated(workbench, preserveActive);
            });
        },
        onWorkbenchUpdated(workbench, preserveActiveSegment = false) {
            if (!workbench) return;
            this.applyWorkbench(workbench, preserveActiveSegment);
            this.syncUnreadFromWorkbench(workbench);
            if (this.isLoading) {
                this.isLoading = false;
            }
        },
        applyWorkbench(workbench, preserveActiveSegment = false) {
            const prevSegment = this.activeSegmentId;
            this.agentType = workbench.agentType;
            this.segments = workbench.segments;
            this.segmentData = workbench.segmentData;
            if (
                preserveActiveSegment &&
                workbench.segments.some((s) => s.id === prevSegment)
            ) {
                this.activeSegmentId = prevSegment;
            } else {
                this.activeSegmentId = workbench.activeSegmentId;
            }
            this.totalUnreadCount = workbench.totalUnreadCount;
            this.refreshListForSegment(this.activeSegmentId);
            this.updateTabBarBadge(workbench.totalUnreadCount);
            uni.setStorageSync('totalUnreadCount', workbench.totalUnreadCount);
        },
        syncUnreadFromWorkbench(workbench) {
            for (const seg of Object.values(workbench.segmentData || {})) {
                for (const item of seg.items || []) {
                    this.unreadCountManager.setUnreadCount(item.conversationId, item.unreadCount || 0);
                }
            }
        },
        refreshListForSegment(segmentId) {
            const data = this.segmentData[segmentId];
            this.conversationList = data?.items ? [...data.items] : [];
        },
        switchSegment(segmentId) {
            if (this.activeSegmentId === segmentId) return;
            this.activeSegmentId = segmentId;
            this.refreshListForSegment(segmentId);
        },
        getSegmentBadge(seg) {
            if (seg.isWaitingTab) {
                const data = this.segmentData[seg.id];
                return data?.count || 0;
            }
            const data = this.segmentData[seg.id];
            return data?.badgeUnread || data?.totalUnreadCount || 0;
        },
        avatarText(type) {
            if (type === 'waiting') return '待';
            if (type === 'corporate') return '司';
            return '店';
        },
        conversationSubtitle(conversation) {
            if (conversation.needsJoin && conversation.waitingMinutes) {
                return `新客户咨询 · 等待 ${conversation.waitingMinutes} 分钟`;
            }
            return conversation.lastMessage || '暂无消息';
        },
        formatTime(timestamp) {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            const now = new Date();
            const isToday =
                date.getFullYear() === now.getFullYear() &&
                date.getMonth() === now.getMonth() &&
                date.getDate() === now.getDate();
            if (isToday) {
                const hh = date.getHours().toString().padStart(2, '0');
                const mm = date.getMinutes().toString().padStart(2, '0');
                return `${hh}:${mm}`;
            }
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            return `${month}/${day}`;
        },
        updateTabBarBadge(count) {
            const tabIndex = 1;
            try {
                const pages = getCurrentPages();
                const currentRoute = pages[pages.length - 1]?.route || '';
                const tabBarPages = ['pages/home/index', 'pages/chat/chatList'];
                if (!tabBarPages.some((p) => currentRoute.includes(p))) return;
            } catch (e) {
                return;
            }
            try {
                if (count > 0) {
                    uni.setTabBarBadge({
                        index: tabIndex,
                        text: count > 99 ? '99+' : String(count),
                    }).catch(() => {});
                } else {
                    uni.removeTabBarBadge({ index: tabIndex }).catch(() => {});
                }
            } catch (e) {
                /* ignore */
            }
        },
        subscribeToEvents() {
            this.eventBus = getEventBus();
            this.unsubscribeEvents = this.eventBus.subscribe('*', (messageData) => {
                this.handleEventBusMessage(messageData);
            });
        },
        handleEventBusMessage(messageData) {
            const { interfaceName, payload } = messageData;
            if (interfaceName === '/heartbeat') {
                this.handleHeartbeatResponse(payload);
            }
            if (interfaceName === '/pullMessageRequest') {
                this.handlePullMessageRequestResponse(payload);
            }
        },
        handleHeartbeatResponse(payload) {
            if (!payload?.items) return;
            for (const item of payload.items) {
                if (item.newMessages?.length) {
                    this.unreadCountManager.incrementUnreadCount(item.conversationId, item.newMessages.length);
                    this.updateConversationInList(item.conversationId, item.newMessages);
                }
            }
            this.totalUnreadCount = this.unreadCountManager.getTotalUnreadCount();
            this.updateTabBarBadge(this.totalUnreadCount);
        },
        updateConversationInList(conversationId, newMessages) {
            const conversation = this.conversationList.find((c) => c.conversationId === conversationId);
            if (!conversation || !newMessages.length) return;
            const lastMsg = newMessages[newMessages.length - 1];
            conversation.lastMessage = lastMsg.content || '新消息';
            conversation.lastMessageTime = lastMsg.timestamp || Date.now();
            conversation.unreadCount = this.unreadCountManager.getUnreadCount(conversationId);
        },
        handlePullMessageRequestResponse(payload) {
            if (!payload?.message?.length) return;
            this.unreadCountManager.incrementUnreadCount(payload.conversationId, payload.message.length);
            this.updateConversationInList(payload.conversationId, payload.message);
            this.totalUnreadCount = this.unreadCountManager.getTotalUnreadCount();
            this.updateTabBarBadge(this.totalUnreadCount);
        },
        async openConversation(conversation) {
            if (this.joiningId) return;

            if (conversation.needsJoin) {
                this.joiningId = conversation.conversationId;
                uni.showLoading({ title: '接待中...' });
                try {
                    const result = await this.chatHttpManager.joinConversation(conversation.conversationId);
                    if (result?.success === false) {
                        uni.showToast({
                            title: result.errorMessage || '接待失败',
                            icon: 'none',
                        });
                        await getWorkbenchPoller().refreshNow({ source: 'joinFailed' });
                        return;
                    }
                } catch (e) {
                    uni.showToast({ title: '接待失败', icon: 'none' });
                    await getWorkbenchPoller().refreshNow({ source: 'joinFailed' });
                    return;
                } finally {
                    uni.hideLoading();
                    this.joiningId = null;
                }
                await getWorkbenchPoller().refreshNow({ source: 'joinSuccess' });
            }

            const params = {
                conversationId: conversation.conversationId,
                shopId: conversation.shopId || '',
                shopName: encodeURIComponent(conversation.shopName || conversation.title || ''),
                hasMessages: conversation.messages ? conversation.messages.length : 0,
            };
            if (conversation.shopIcon) {
                params.shopIcon = encodeURIComponent(conversation.shopIcon);
            }
            const url = `/pages/chat/customerService?${Object.keys(params)
                .map((k) => `${k}=${params[k]}`)
                .join('&')}`;
            uni.navigateTo({ url });
        },
        handleMessageReceived() {
            /* 列表数据由 workbench 轮询统一刷新 */
        },
    },
};
</script>

<style lang="scss" scoped>
.chat-list-container {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background-color: #f5f5f5;
}

.role-bar {
    display: flex;
    align-items: center;
    gap: 16upx;
    padding: 20upx 30upx;
    background: #fff;
    border-bottom: 1px solid #eee;
    font-size: 26upx;

    .role-label {
        color: #999;
        flex-shrink: 0;
    }

    .role-value {
        color: #333;
        font-weight: bold;
    }
}

.segment-bar {
    white-space: nowrap;
    background: #fff;
    border-bottom: 1px solid #eee;
    padding: 16upx 12upx 0;
}

.segment-item {
    display: inline-flex;
    align-items: center;
    padding: 12upx 24upx 20upx;
    margin-right: 8upx;
    position: relative;
    color: #666;
    font-size: 28upx;

    &.active {
        color: #409eff;
        font-weight: bold;

        &::after {
            content: '';
            position: absolute;
            left: 24upx;
            right: 24upx;
            bottom: 8upx;
            height: 4upx;
            background: #409eff;
            border-radius: 2upx;
        }
    }

    .segment-badge {
        margin-left: 8upx;
        min-width: 32upx;
        height: 32upx;
        line-height: 32upx;
        padding: 0 8upx;
        font-size: 20upx;
        text-align: center;
        border-radius: 16upx;
        background: #409eff;
        color: #fff;

        &.warning {
            background: #fff7e6;
            color: #d48806;
            border: 1px solid #ffd591;
        }
    }
}

.chat-list {
    flex: 1;
    height: 0;
}

.empty-state,
.loading-state {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 400upx;
    color: #999;
    font-size: 28upx;
}

.chat-item {
    display: flex;
    align-items: center;
    padding: 28upx 30upx;
    background: #fff;
    border-bottom: 1px solid #f0f0f0;

    &.item-waiting {
        background: #fffbf0;
    }
}

.avatar-container {
    position: relative;
    margin-right: 20upx;
    flex-shrink: 0;

    .avatar {
        width: 96upx;
        height: 96upx;
        border-radius: 12upx;
    }

    .avatar-text {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32upx;
        font-weight: bold;
        color: #666;

        &.avatar-waiting {
            background: #fff7e6;
            color: #d48806;
        }

        &.avatar-corporate {
            background: #e6f4ff;
            color: #1677ff;
        }

        &.avatar-shop {
            background: #f5f5f5;
            color: #888;
        }
    }

    .unread-badge {
        position: absolute;
        top: -6upx;
        right: -6upx;
        background: #fa436a;
        color: #fff;
        font-size: 20upx;
        padding: 2upx 8upx;
        border-radius: 20upx;
        min-width: 32upx;
        text-align: center;
    }
}

.chat-content {
    flex: 1;
    min-width: 0;

    .chat-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8upx;

        .shop-name {
            font-size: 30upx;
            font-weight: bold;
            color: #333;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
        }

        .time {
            font-size: 24upx;
            color: #999;
            flex-shrink: 0;
            margin-left: 16upx;
        }
    }

    .last-message-text {
        font-size: 26upx;
        color: #666;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
    }

    .row-meta {
        margin-top: 8upx;

        .meta-tag {
            font-size: 22upx;
            color: #d48806;

            &.corp {
                color: #1677ff;
            }
        }
    }
}

.waiting-pill {
    flex-shrink: 0;
    margin-left: 12upx;
    padding: 8upx 16upx;
    background: #fff7e6;
    border: 1px solid #ffd591;
    border-radius: 8upx;
    font-size: 22upx;
    color: #d48806;
}
</style>
