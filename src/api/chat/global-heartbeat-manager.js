import { myLog } from '@/utils/log.js'
import { getWebSocketConnection } from './websocket-connection.js'
import { getEventBus } from './message-event-bus.js'
import { getShopChatManager } from './shop-chat-manager.js'

/**
 * 全局心跳管理器（单例）
 * 职责：管理所有会话的心跳发送和响应处理
 * 
 * 设计原则：
 * 1. 全局单例，应用生命周期内唯一
 * 2. 聚合所有店铺的会话，发送一次心跳
 * 3. 处理心跳响应，更新缓存
 */
class GlobalHeartbeatManager {
  constructor() {
    this.heartbeatTimer = null
    this.eventBus = getEventBus()
    // 存储所有会话ID（从缓存和临时添加的）
    this.conversationIds = new Set()
    
    myLog('info', 'GlobalHeartbeatManager initialized')
  }
  
  /**
   * 从缓存获取所有会话的 conversationId
   * @returns {Array<String>} conversationId 数组
   */
  getAllConversationIdsFromCache() {
    if (!window.conversationCache) {
      return []
    }
    
    const conversationIds = []
    for (const [, cache] of Object.entries(window.conversationCache)) {
      if (cache.conversationId) {
        conversationIds.push(cache.conversationId)
      }
    }
    
    return conversationIds
  }
  
  /**
   * 开始心跳
   */
  startHeartbeat() {
    if (this.heartbeatTimer) {
      myLog('warn', 'Heartbeat already started')
      return
    }
    
    myLog('debug', 'Starting heartbeat')
    
    // 立即发送一次心跳
    this.sendHeartbeat()
    
    // 设置定时心跳（每60秒一次）
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, 60000)
    
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
   * 添加新会话到心跳列表
   * @param {String} conversationId - 会话ID
   */
  addNewConversationToHeartbeat(conversationId) {
    if (!conversationId) return
    
    // 添加到 conversationIds 集合（自动去重）
    this.conversationIds.add(conversationId)
    myLog('debug', `Added conversationId to heartbeat: ${conversationId}`)
    
    // 如果心跳还没开始，启动心跳
    if (!this.heartbeatTimer) {
      myLog('info', 'Starting heartbeat for new conversation')
      this.startHeartbeat()
    } else {
      this.sendHeartbeat()
    }
  }
  
  /**
   * 初始化会话ID列表（从缓存加载）
   * 应该在聊天列表加载完成后调用，也就是登录后会调用http的getChatWindowList接口，存到聊天列表的缓存里，没有这一步的话，心跳无法发送
   * 因为商品详情页进入的聊天窗口只是其中一个店铺的，它那边只能是追加到conversationIds里，是不知道其他店铺的会话id的，所以全局心跳管理器
   * 只能是聊天列表页来进行初始化。需要注意的是心跳的触发时需要点击我的消息或者商品详情页的聊天按钮，否则客户登陆后不聊天就没必要去维系心跳
   */
  initializeConversationIds() {
    // 从缓存获取所有 conversationId
    const conversationIds = this.getAllConversationIdsFromCache()
    
    // 添加到 this.conversationIds
    conversationIds.forEach(id => {
      this.conversationIds.add(id)
    })
    
    myLog('info', 'Initialized conversationIds from cache', {
      count: this.conversationIds.size
    })
  }
  
  /**
   * 发送心跳（不带参数）
   */
  sendHeartbeat() {
    const wsConnection = getWebSocketConnection()
    if (!wsConnection || !wsConnection.isConnectionActive()) {
      myLog('warn', 'WebSocket not connected, cannot send heartbeat')
      return
    }
    
    // 收集心跳数据
    const items = []
    
    // 使用实例字段的 conversationIds
    const shopChatManager = getShopChatManager()
    
    for (const conversationId of this.conversationIds) {
      // 从缓存获取 clientMaxServerMsgId
      let clientMaxServerMsgId = 0
      
      // 方式1：从聊天列表（我的消息）的缓存获取
      const cacheKey = Object.keys(window.conversationCache || {}).find(shopId => {
        const cache = window.conversationCache[shopId]
        return cache?.conversationId === conversationId
      })
      
      if (cacheKey && window.conversationCache[cacheKey]) {
        const cache = window.conversationCache[cacheKey]
        if (cache.messages && cache.messages.length > 0) {
          clientMaxServerMsgId = cache.messages[cache.messages.length - 1].serverMsgId || 0
        }
        if (cache.clientMaxServerMsgId) {
          clientMaxServerMsgId = cache.clientMaxServerMsgId
        }
      }
      
      // 方式2：从 ShopChatManager 获取（如果已创建实例），这个还是有必要的，因为如果登录后，虽然调用了getChatWindowList接口，但是客户可能直接去商品详情里聊天
      // 这个新的还不存在的聊天窗口，getChatWindowList从数据库是没办法读取到的，因此需要从ShopChatManager获取
      if (clientMaxServerMsgId === 0) {
        // 从 conversationId 找到对应的 shopId
        const session = Array.from(shopChatManager.shopSessions.values())
          .find(s => s.conversationId === conversationId)
        
        if (session) {
          clientMaxServerMsgId = session.messageDisplayManager?.clientMaxServerMsgId || 
                                   session.clientMaxServerMsgId || 0
        }
      }
      
      items.push({
        conversationId: conversationId,
        clientMaxServerMsgId: Number(clientMaxServerMsgId) || 0
      })
    }
    
    if (items.length === 0) {
      myLog('debug', 'No conversations to send heartbeat')
      return
    }
    
    const heartbeatMessage = {
      interfaceName: '/agent/heartbeat',
      version: 1,
      payload: { items }
    }
    wsConnection.send(heartbeatMessage)
    void heartbeatMessage
  }
  
  /**
   * 处理心跳响应
   * @param {Object} payload - 心跳响应数据
   */
  handleHeartbeatResponse(payload) {
    if (!payload || !payload.items) {
      myLog('warn', 'Invalid heartbeat response', payload)
      return
    }
    
    myLog('debug', 'Handling heartbeat response', payload)
    
    // 遍历每个会话的结果
    for (const item of payload.items) {
      const { conversationId, needPull, pullFrom, latestServerMsgId } = item
      
      if (!conversationId) continue
      
      // 如果需要拉取，发起拉取请求，这是兜底的方案，就是假设服务端的消息主动推送出问题了，导致客户端没有收到消息，所以需要主动拉取
      if (needPull) {
        myLog('debug', `Conversation ${conversationId} needs pull`, { pullFrom, latestServerMsgId })
        
        // 构建拉取消息请求
        const pullRequest = {
          conversationId: conversationId,
          timestamp: Date.now(),
          serverMsgId: pullFrom || latestServerMsgId || 0
        }
        
        myLog('debug', 'Sending pull message request', pullRequest)
        
        // 调用 ChatSessionManager 的 pullMessage 方法（通过事件总线）
        // 或者直接发送 WebSocket 请求
        this.sendPullMessageRequest(pullRequest)
      }
    }
  }
  
  /**
   * 发送拉取消息请求到 WebSocket
   * @param {Object} pullRequest - 拉取请求 { conversationId, timestamp, serverMsgId }
   */
  sendPullMessageRequest(pullRequest) {
    const wsConnection = getWebSocketConnection()
    if (!wsConnection || !wsConnection.isConnectionActive()) {
      myLog('warn', 'WebSocket not connected, cannot send pull message request')
      return
    }
    
    const msg = {
      interfaceName: '/agent/pullMessage',
      version: 1,
      payload: pullRequest
    }
    
    wsConnection.send(msg)
    myLog('debug', 'Pull message request sent', pullRequest)
  }
}

// 导出单例
let globalHeartbeatManagerInstance = null

export function getGlobalHeartbeatManager() {
  if (!globalHeartbeatManagerInstance) {
    globalHeartbeatManagerInstance = new GlobalHeartbeatManager()
  }
  return globalHeartbeatManagerInstance
}

export default GlobalHeartbeatManager

