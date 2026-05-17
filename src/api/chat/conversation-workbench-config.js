/**
 * 客服消息工作台 — 配置中心
 *
 * 根据登录用户 agentType（与 GET /agent/info 的 roles[0] 一致）
 * 决定：
 * 1. 消息页顶部分段 Tab 有哪些、文案是什么
 * 2. 每个分段对应哪个 list HTTP 接口（chat-http 方法名）
 * 3. 点击列表行是否要先 joinConversation（待接待 / 公司级 waiting）
 * 4. 是否额外请求 getChatWindowList（首屏最近消息 + 店铺信息，用于进聊天页缓存）
 *
 * 后台文档：mall-chat/doc/客服端会话列表接口与角色调用说明.md
 */

/** 分段唯一标识，与 UI、segmentData 的 key 一致 */
export const SEGMENT_IDS = {
  /** 店铺主接待 listConversations */
  MINE: 'mine',
  /** 未配置店铺客服接待 listConversationsWithoutConfiguredAgentReception */
  WAITING: 'waiting',
  /** 参与协作（非主接待）listParticipantConversations */
  COLLAB: 'collab',
  /** 公司级（无 shop）listCorporateConversations */
  CORP: 'corp',
}

/** @typedef {'mine'|'waiting'|'collab'|'corp'} SegmentId */

/**
 * 进入消息页时默认选中的分段
 * @param {string} agentType pre-sales | after-sales | corporate | legal | tax
 * @returns {SegmentId}
 */
export function getDefaultSegmentId(agentType) {
  if (agentType === 'pre-sales') return SEGMENT_IDS.WAITING
  if (agentType === 'corporate') return SEGMENT_IDS.CORP
  if (agentType === 'after-sales') return SEGMENT_IDS.COLLAB
  return SEGMENT_IDS.COLLAB
}

/**
 * 某角色需要请求的「分段」定义（加载后可能再按条数隐藏空 Tab）
 *
 * 分段字段说明：
 * - id: 分段 ID，见 SEGMENT_IDS
 * - label: Tab 文案
 * - api: chat-http 上的方法名，对应 POST /chat/agent-service/conversation/{api}
 * - needsJoin: false=直接进聊天；true=待接待必先接待；'waitingOnly'=仅 status=waiting 需 join（公司级）
 * - badgeFromCount: 角标用条数而非未读（待接待池常用）
 *
 * @param {string} agentType
 * @returns {Array<{ id: string, label: string, api: string, needsJoin: boolean|string, badgeFromCount?: boolean }>}
 */
export function getSegmentDefinitions(agentType) {
  const mine = { id: SEGMENT_IDS.MINE, label: '我的接待', api: 'listConversations', needsJoin: false }
  const waiting = {
    id: SEGMENT_IDS.WAITING,
    label: '待接待（店铺未配置客服人员）',
    api: 'listConversationsWithoutConfiguredAgentReception',
    needsJoin: true,
    badgeFromCount: true,
  }
  const collab = { id: SEGMENT_IDS.COLLAB, label: '协作', api: 'listParticipantConversations', needsJoin: false }
  const corp = {
    id: SEGMENT_IDS.CORP,
    label: '公司级',
    api: 'listCorporateConversations',
    needsJoin: 'waitingOnly',
  }
  const mineCorpLabel = { ...mine, label: '店铺接待' }
  const waitingShop = { ...waiting, label: '待接待' }

  switch (agentType) {
    case 'pre-sales':
      return [mine, waiting, collab]
    case 'after-sales':
      // 售后仅协作群
      return [collab]
    case 'corporate':
      // 公司级含老板拉群场景，不再单独要「协作」Tab
      return [corp, mineCorpLabel, waitingShop]
    case 'legal':
    case 'tax':
      // 法务/税务仅协作
      return [collab]
    default:
      return [collab]
  }
}

/**
 * 是否在 loadWorkbench 时并行请求 getChatWindowList
 * 法务/税务等可不拉；售前、售后、老板需要消息预览与 shop 缓存
 * @param {string} agentType
 */
export function shouldFetchChatWindowList(agentType) {
  return ['pre-sales', 'after-sales', 'corporate'].includes(agentType)
}

/**
 * 当前角色会调用的 list 接口方法名列表（不含 getChatWindowList / joinConversation）
 * @param {string} agentType
 * @returns {string[]}
 */
export function getListApiNames(agentType) {
  return getSegmentDefinitions(agentType).map((s) => s.api)
}
