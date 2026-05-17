/**
 * 客服消息工作台 — 数据加载与合并
 *
 * loadWorkbench：按角色并行请求各 list 接口 + 可选 getChatWindowList，
 * 将 ActiveConversations 与 ConversationViewVO 合并为页面用的 segmentData / conversationList 行。
 *
 * 一般由 conversation-workbench-poller 定时调用；
 * 开发预览可传 useMock: true。
 */

import { myLog } from '@/utils/log.js'
import {
  getDefaultSegmentId,
  getSegmentDefinitions,
  shouldFetchChatWindowList,
  SEGMENT_IDS,
} from './conversation-workbench-config.js'
import { getMockWorkbenchPayload } from './conversation-workbench-mock.js'

/**
 * 合并 list 行与 getChatWindowList 预览，生成 UI 列表项
 * @param {object} info ConversationInfo（list 接口）
 * @param {object} segment 分段配置（含 needsJoin、id）
 * @param {object|undefined} windowView ConversationViewVO（messages / shop / unreadCount）
 */
function enrichConversationRow(info, segment, windowView) {
  const shop = windowView?.shop || {}
  const messages = windowView?.messages || []
  const isWaiting = info.status === 'waiting'
  const isCorpSegment = segment.id === SEGMENT_IDS.CORP

  let needsJoin = false
  if (segment.needsJoin === true) {
    needsJoin = isWaiting
  } else if (segment.needsJoin === 'waitingOnly') {
    needsJoin = isWaiting
  }

  let avatarType = 'shop'
  if (isCorpSegment) {
    avatarType = isWaiting ? 'waiting' : 'corporate'
  } else if (isWaiting && segment.id === SEGMENT_IDS.WAITING) {
    avatarType = 'waiting'
  } else if (!shop.shopId && !shop.shopName) {
    avatarType = 'corporate'
  }

  const shopName = shop.shopName || ''
  let title = info.customerName || '客户'
  if (shopName) {
    title = `${shopName}${formatConvSuffix(info.conversationId)}`
  } else if (avatarType === 'corporate' || avatarType === 'waiting') {
    title = info.customerName || '客户'
  }

  return {
    ...info,
    segmentId: segment.id,
    needsJoin,
    avatarType,
    title,
    shopId: shop.shopId || '',
    shopName: shop.shopName || '',
    shopIcon: shop.shopIcon || '',
    messages,
    unreadCount: info.unreadCount ?? windowView?.unreadCount ?? 0,
    lastMessage: info.lastMessage || getLastFromMessages(messages) || (isWaiting ? '新客户咨询' : '暂无消息'),
    lastMessageTime: info.lastMessageTime || getLastTimeFromMessages(messages),
    waitingMinutes: isWaiting && info.createdAt ? Math.max(1, Math.floor((Date.now() - info.createdAt) / 60000)) : 0,
  }
}

/** 店铺名后拼接会话 ID 后几位，区分同店多客户 */
function formatConvSuffix(conversationId) {
  if (!conversationId) return ''
  const s = String(conversationId)
  const tail = s.length >= 10 ? s.slice(-10) : s
  return tail
}

function getLastFromMessages(messages) {
  if (!messages?.length) return ''
  return messages[messages.length - 1].content || ''
}

function getLastTimeFromMessages(messages) {
  if (!messages?.length) return Date.now()
  return messages[messages.length - 1].timestamp || Date.now()
}

/** list 接口失败或空数据时的占位结构 */
function emptyActive() {
  return { conversations: [], totalUnreadCount: 0, conversationUnreadCounts: {} }
}

/**
 * 拉取并组装完整工作台数据
 * @param {import('./chat-http.js').default} chatHttp
 * @param {{ useMock?: boolean, agentType?: string }} options
 * @returns {Promise<{
 *   agentType: string,
 *   segments: Array,
 *   segmentData: Record<string, { items: Array, count: number }>,
 *   activeSegmentId: string,
 *   totalUnreadCount: number,
 *   windowList: Record<string, object>
 * }>}
 */
export async function loadWorkbench(chatHttp, options = {}) {
  const userInfo = uni.getStorageSync('userInfo') || {}
  const agentType = options.agentType || userInfo.agentType || 'pre-sales'
  const useMock = options.useMock === true

  if (useMock) {
    return buildFromRaw(getMockWorkbenchPayload(agentType), agentType)
  }

  const definitions = getSegmentDefinitions(agentType)
  const listPayloads = {}
  let windowList = {}

  const apiCalls = definitions.map(async (seg) => {
    try {
      const data = await chatHttp[seg.api]({})
      listPayloads[seg.api] = data || emptyActive()
    } catch (e) {
      myLog('warn', `Workbench list failed: ${seg.api}`, e)
      listPayloads[seg.api] = emptyActive()
    }
  })

  const windowCall = shouldFetchChatWindowList(agentType)
    ? chatHttp
        .getChatWindowList({})
        .then((res) => {
          if (res?.success && res.conversations) windowList = res.conversations
        })
        .catch((e) => {
          myLog('warn', 'getChatWindowList failed', e)
        })
    : Promise.resolve()

  await Promise.all([...apiCalls, windowCall])

  return buildFromRaw({ listPayloads, windowList, agentType }, agentType)
}

/**
 * 将各接口原始数据转为 UI 结构，并计算默认选中分段、可见 Tab
 */
function buildFromRaw(raw, agentType) {
  const { listPayloads, windowList } = raw
  const definitions = getSegmentDefinitions(agentType)
  const segmentData = {}
  let totalUnread = 0
  const seenUnread = new Set()

  for (const seg of definitions) {
    const active = listPayloads[seg.api] || emptyActive()
    const rows = (active.conversations || []).map((info) =>
      enrichConversationRow(info, seg, windowList[info.conversationId]),
    )
    segmentData[seg.id] = {
      ...seg,
      items: rows,
      totalUnreadCount: active.totalUnreadCount || 0,
      count: rows.length,
    }
    for (const [cid, n] of Object.entries(active.conversationUnreadCounts || {})) {
      if (!seenUnread.has(cid)) {
        seenUnread.add(cid)
        totalUnread += n || 0
      }
    }
  }

  const visibleSegments = definitions.filter((seg) => {
    const data = segmentData[seg.id]
    if (!data) return false
    if (seg.id === SEGMENT_IDS.COLLAB && agentType === 'pre-sales') {
      return data.count > 0
    }
    if (seg.id === SEGMENT_IDS.WAITING && agentType === 'corporate') {
      return data.count > 0
    }
    return true
  })

  let activeSegmentId = getDefaultSegmentId(agentType)
  const waitingSeg = visibleSegments.find((s) => s.id === SEGMENT_IDS.WAITING)
  if (agentType === 'pre-sales' && waitingSeg && segmentData[SEGMENT_IDS.WAITING]?.count > 0) {
    activeSegmentId = SEGMENT_IDS.WAITING
  }
  if (!visibleSegments.some((s) => s.id === activeSegmentId)) {
    activeSegmentId = visibleSegments[0]?.id || activeSegmentId
  }

  return {
    agentType,
    segments: visibleSegments.map((s) => ({
      id: s.id,
      label: s.label,
      badge: segmentData[s.id]?.count || 0,
      badgeUnread: segmentData[s.id]?.totalUnreadCount || 0,
      isWaitingTab: s.id === SEGMENT_IDS.WAITING || s.id === SEGMENT_IDS.CORP,
    })),
    segmentData,
    activeSegmentId,
    totalUnreadCount: totalUnread,
    windowList,
  }
}

/**
 * 将 getChatWindowList 结果写入全局缓存，供 customerService 首屏与消息心跳使用
 * - conversationCacheByConvId[conversationId]：按会话隔离缓存，避免同 shopId 多会话串消息
 */
export function cacheWindowList(windowList) {
  if (typeof window === 'undefined') return
  // 必须按 conversationId 隔离：客服侧同一个 shopId 下可能同时有多个客户会话。
  // 用 shopId 做缓存 key 会让不同聊天窗口互相覆盖并串消息。
  if (!window.conversationCacheByConvId) window.conversationCacheByConvId = {}

  for (const [conversationId, viewData] of Object.entries(windowList || {})) {
    const shop = viewData.shop || {}
    const messages = viewData.messages || []
    let clientMaxServerMsgId = 0
    if (messages.length > 0) {
      clientMaxServerMsgId = messages[messages.length - 1].serverMsgId || 0
    }
    const entry = {
      conversationId,
      messages,
      clientMaxServerMsgId,
      shopInfo: shop,
      shopId: shop.shopId,
    }
    window.conversationCacheByConvId[conversationId] = entry
  }
}
