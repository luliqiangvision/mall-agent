/**
 * 客服消息工作台 — 开发用 Mock 数据
 *
 * 使用场景：
 * - H5 未登录或接口失败时，chatList 开启「Mock开」（workbenchUseMock=true）
 * - 轮询器 loadWorkbench({ useMock: true }) 走本模块，不请求后端
 *
 * 数据结构需与 loadWorkbench / buildFromRaw 期望的 listPayloads + windowList 一致
 */

export function getMockWorkbenchPayload(agentType) {
  const base = (id, extra = {}) => ({
    conversationId: id,
    customerId: 'c100',
    customerName: '客户昵称',
    lastMessage: '最后一条消息摘要',
    lastMessageTime: Date.now() - 3600000,
    unreadCount: 1,
    status: 'active',
    createdAt: Date.now() - 7200000,
    tenantId: 1,
    ...extra,
  })

  const payloads = {
    listConversations: {
      conversations: [
        base('conv_shop_001', {
          customerName: '王先生',
          lastMessage: '好的，我帮您查一下订单',
          unreadCount: 2,
        }),
        base('conv_shop_002', {
          customerName: '李女士',
          lastMessage: '请问还在吗？',
        }),
      ],
      totalUnreadCount: 3,
      conversationUnreadCounts: { conv_shop_001: 2, conv_shop_002: 1 },
    },
    listConversationsWithoutConfiguredAgentReception: {
      conversations: [
        base('conv_wait_001', {
          customerName: '藏宝斋客户',
          lastMessage: '新客户咨询',
          status: 'waiting',
          unreadCount: 0,
          createdAt: Date.now() - 180000,
        }),
        base('conv_wait_002', {
          customerName: '珍品坊客户',
          lastMessage: '新客户咨询',
          status: 'waiting',
          unreadCount: 0,
          createdAt: Date.now() - 480000,
        }),
      ],
      totalUnreadCount: 0,
      conversationUnreadCounts: {},
    },
    listParticipantConversations: {
      conversations: [
        base('conv_collab_001', {
          customerName: '联合鉴定群',
          lastMessage: '法务：条款已确认',
        }),
      ],
      totalUnreadCount: 1,
      conversationUnreadCounts: { conv_collab_001: 1 },
    },
    listCorporateConversations: {
      conversations: [
        base('conv_corp_wait', {
          customerName: '张先生',
          lastMessage: '咨询平台合作入驻',
          status: 'waiting',
          unreadCount: 0,
        }),
        base('conv_corp_active', {
          customerName: '王总',
          lastMessage: '年度框架协议跟进',
          unreadCount: 1,
        }),
      ],
      totalUnreadCount: 1,
      conversationUnreadCounts: { conv_corp_active: 1 },
    },
  }

  const windowList = {
    conv_shop_001: {
      unreadCount: 2,
      shop: {
        shopId: 'shop_001',
        shopName: '寻宝小店',
        shopIcon: '/static/default-shop.png',
      },
      messages: [{ content: '好的，我帮您查一下订单', timestamp: Date.now(), serverMsgId: 10 }],
    },
    conv_shop_002: {
      unreadCount: 1,
      shop: { shopId: 'shop_002', shopName: '古玩阁', shopIcon: '/static/default-shop.png' },
      messages: [{ content: '请问还在吗？', timestamp: Date.now(), serverMsgId: 8 }],
    },
    conv_collab_001: {
      unreadCount: 1,
      shop: { shopId: 'shop_003', shopName: '官方直营', shopIcon: '/static/default-shop.png' },
      messages: [{ content: '法务：条款已确认', timestamp: Date.now(), serverMsgId: 5 }],
    },
  }

  return { listPayloads: payloads, windowList, agentType }
}
