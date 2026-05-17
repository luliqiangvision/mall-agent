/**
 * 客服消息工作台 — HTTP 列表轮询器（单例）
 *
 * 职责：
 * - 按固定间隔（默认 15s）调用 loadWorkbench，拉取当前角色所需的会话 list 接口
 * - 与 WebSocket 消息心跳分工：心跳只对「已知会话」对账新消息；本模块负责「列表集合是否变化」
 *
 * 生命周期（在 App.vue / store 中挂载）：
 * - 登录成功、App 回前台：startWorkbenchPoller()
 * - App 进后台、登出、401：stopWorkbenchPoller()
 *
 * 页面订阅：
 * - chatList 通过 subscribe() 接收每轮轮询结果，刷新分段 Tab 与列表行
 * - 新订阅者会立即收到上一轮缓存的 lastWorkbench（避免白屏）
 *
 * @see conversation-workbench-config.js  角色 → 分段 → 接口映射
 * @see conversation-workbench-loader.js  并行请求与数据合并
 */

import { myLog } from '@/utils/log.js'
import ChatHttpManager from '@/api/chat/chat-http.js'
import { loadWorkbench, cacheWindowList } from './conversation-workbench-loader.js'
import { getGlobalHeartbeatManager } from './global-heartbeat-manager.js'
import { getUnreadCountManager } from './unread-count-manager.js'

/** 工作台 list 接口轮询间隔（毫秒），可按环境调整 */
export const WORKBENCH_POLL_INTERVAL_MS = 15000

/** TabBar「消息」项下标（pages.json tabBar.list 顺序） */
const TAB_BAR_MESSAGE_INDEX = 1

class ConversationWorkbenchPoller {
  constructor() {
    /** @type {ReturnType<typeof setInterval> | null} */
    this.timerId = null
    /** 防止上一轮未完成时重叠请求 */
    this.tickInProgress = false
    /** @type {Set<(workbench: object, meta: { source: string }) => void>} */
    this.listeners = new Set()
    /** 最近一轮成功结果，供后进入页面的订阅者使用 */
    this.lastWorkbench = null
    /** 轮询专用 HTTP 实例（无页面级回调） */
    this.chatHttp = new ChatHttpManager({ conversationId: null })
  }

  /**
   * 订阅轮询结果
   * @param {(workbench: object, meta: { source: string }) => void} listener
   *   meta.source 示例：'interval' | 'pageLoad' | 'pageShow' | 'manual' | 'joinSuccess' | 'cache'
   * @returns {() => void} 取消订阅
   */
  subscribe(listener) {
    this.listeners.add(listener)
    if (this.lastWorkbench) {
      try {
        listener(this.lastWorkbench, { source: 'cache' })
      } catch (e) {
        myLog('error', 'Workbench poller listener error (cache)', e)
      }
    }
    return () => this.listeners.delete(listener)
  }

  /**
   * 启动定时轮询（已启动则忽略）
   * 会先立即执行一轮 tick，再按 WORKBENCH_POLL_INTERVAL_MS 周期执行
   */
  start() {
    if (this.timerId != null) return
    if (!this.canPoll()) {
      myLog('debug', 'Workbench poller not started: no login')
      return
    }
    myLog('info', 'Workbench poller started', { intervalMs: WORKBENCH_POLL_INTERVAL_MS })
    this.tick({ source: 'start' })
    this.timerId = setInterval(() => {
      this.tick({ source: 'interval' })
    }, WORKBENCH_POLL_INTERVAL_MS)
  }

  /** 停止定时轮询 */
  stop() {
    if (this.timerId != null) {
      clearInterval(this.timerId)
      this.timerId = null
      myLog('info', 'Workbench poller stopped')
    }
  }

  /**
   * 立即执行一轮拉取（不重置定时器）
   * 用于：进入消息页、切换预览角色、抢接待成功/失败后刷新列表
   * @param {{ source?: string }} options
   */
  refreshNow(options = {}) {
    return this.tick({ source: options.source || 'manual' })
  }

  /** 是否具备轮询条件：已登录且存在 agentId */
  canPoll() {
    const token = uni.getStorageSync('token')
    const userInfo = uni.getStorageSync('userInfo') || {}
    return !!(token && userInfo.agentId)
  }

  /**
   * 单轮轮询：拉 list → 写缓存 → 同步未读/心跳会话集 → 通知订阅者
   * @param {{ source?: string }} meta 调用来源，便于页面决定是否保留当前分段
   */
  async tick(meta = {}) {
    if (this.tickInProgress) {
      myLog('debug', 'Workbench poll skipped: previous tick in progress')
      return this.lastWorkbench
    }
    if (!this.canPoll()) return null

    this.tickInProgress = true
    const userInfo = uni.getStorageSync('userInfo') || {}
    const agentType = userInfo.agentType || 'pre-sales'

    try {
      const workbench = await loadWorkbench(this.chatHttp, {
        agentType,
      })
      cacheWindowList(workbench.windowList)
      this.syncHeartbeatConversationIds(workbench)
      this.syncUnreadFromWorkbench(workbench)
      this.lastWorkbench = workbench
      uni.setStorageSync('totalUnreadCount', workbench.totalUnreadCount || 0)
      this.updateTabBarBadge(workbench.totalUnreadCount || 0)
      this.listeners.forEach((fn) => {
        try {
          fn(workbench, meta)
        } catch (e) {
          myLog('error', 'Workbench poller listener error', e)
        }
      })
      myLog('debug', 'Workbench poll done', {
        source: meta.source,
        agentType,
        totalUnread: workbench.totalUnreadCount,
      })
      return workbench
    } catch (e) {
      myLog('error', 'Workbench poll failed', { source: meta.source, error: e })
      return this.lastWorkbench
    } finally {
      this.tickInProgress = false
    }
  }

  /** 将各分段未读写入 UnreadCountManager，供 Tab 角标与行内红点 */
  syncUnreadFromWorkbench(workbench) {
    const unreadCountManager = getUnreadCountManager()
    for (const seg of Object.values(workbench.segmentData || {})) {
      for (const item of seg.items || []) {
        unreadCountManager.setUnreadCount(item.conversationId, item.unreadCount || 0)
      }
    }
  }

  /**
   * 把本轮所有 conversationId 并入全局消息心跳集合
   * 否则 WS heartbeat 无法对「新出现在 list 里但尚未打开聊天窗」的会话拉消息
   */
  syncHeartbeatConversationIds(workbench) {
    const heartbeatManager = getGlobalHeartbeatManager()
    const ids = new Set()
    for (const seg of Object.values(workbench.segmentData || {})) {
      for (const item of seg.items || []) {
        if (item.conversationId) ids.add(item.conversationId)
      }
    }
    for (const conversationId of Object.keys(workbench.windowList || {})) {
      ids.add(conversationId)
    }
    ids.forEach((id) => heartbeatManager.conversationIds.add(id))
    heartbeatManager.initializeConversationIds()
  }

  /** 在 TabBar 页面更新「消息」角标（非 TabBar 页静默跳过） */
  updateTabBarBadge(count) {
    try {
      const pages = getCurrentPages()
      const currentRoute = pages[pages.length - 1]?.route || ''
      const tabBarPages = ['pages/home/index', 'pages/chat/chatList']
      if (!tabBarPages.some((p) => currentRoute.includes(p))) return
    } catch (e) {
      return
    }
    try {
      if (count > 0) {
        uni.setTabBarBadge({
          index: TAB_BAR_MESSAGE_INDEX,
          text: count > 99 ? '99+' : String(count),
        }).catch(() => {})
      } else {
        uni.removeTabBarBadge({ index: TAB_BAR_MESSAGE_INDEX }).catch(() => {})
      }
    } catch (e) {
      /* TabBar 未就绪时忽略 */
    }
  }
}

let instance = null

export function getWorkbenchPoller() {
  if (!instance) {
    instance = new ConversationWorkbenchPoller()
  }
  return instance
}

export function startWorkbenchPoller() {
  getWorkbenchPoller().start()
}

export function stopWorkbenchPoller() {
  getWorkbenchPoller().stop()
}

export default ConversationWorkbenchPoller
