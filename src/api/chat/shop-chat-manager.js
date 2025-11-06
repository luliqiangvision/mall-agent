import { createChatSessionManager } from './chat-session-manager.js'
import { myLog } from '@/utils/log.js'

/**
 * 店铺聊天管理器（客服端）
 * 职责：按店铺和会话管理 ChatSessionManager 实例，实现长周期管理
 * 
 * 业务需求：
 * - 客服端场景：一个客户咨询（一个 conversationId）就需要一个 ChatSessionManager 实例
 * - 不再是一个店铺一个实例，而是一个店铺+会话组合一个实例
 * - 支持同一个店铺的不同客户咨询（不同 conversationId）同时存在多个实例
 * 
 * 设计原则：
 * 1. 每个 shopId + conversationId 组合对应一个 ChatSessionManager 实例
 * 2. 长生命周期：只在彻底关闭小程序时回收
 * 3. 页面切换时复用同一个实例（基于相同的 shopId 和 conversationId）
 * 4. 全局单例，避免重复创建
 * 
 * 使用场景：
 * - 客服在店铺A与客户1（conversationId1）聊天 → 创建 shopA_conversationId1 的实例
 * - 切换到店铺A的客户2（conversationId2）聊天 → 创建 shopA_conversationId2 的实例
 * - 返回客户1 → 复用 shopA_conversationId1 的实例（allAckedMessages 还在）
 */
class ShopChatManager {
  constructor() {
    // 按 shopId + conversationId 组合作为 key 存储 ChatSessionManager 实例
    // key 格式：`${shopId}_${conversationId}`
    this.shopSessions = new Map()
    
    myLog('info', 'ShopChatManager initialized')
  }
  
  /**
   * 生成会话 key（shopId + conversationId 组合）
   * @param {String} shopId - 店铺ID
   * @param {String} conversationId - 会话ID
   * @returns {String} 会话 key
   */
  generateSessionKey(shopId, conversationId) {
    if (!shopId) return null
    if (!conversationId) return shopId // 如果没有 conversationId，仅使用 shopId（向后兼容）
    return `${shopId}_${conversationId}`
  }
  
  /**
   * 获取或创建店铺会话的 ChatSessionManager 实例
   * @param {Object} options - 选项 { shopId, conversationId, ... }
   * @returns {Object} ChatSessionManager 实例
   */
  getOrCreateShopSession(options) {
    const { shopId, conversationId, ...chatOptions } = options
    
    if (!shopId) {
      myLog('error', 'No shopId provided')
      return null
    }
    
    if (!conversationId) {
      myLog('error', 'No conversationId provided')
      return null
    }
    
    // 生成会话 key（shopId + conversationId 组合）
    const sessionKey = this.generateSessionKey(shopId, conversationId)
    
    // 检查是否已存在该店铺+会话的实例
    if (this.shopSessions.has(sessionKey)) {
      const existingSession = this.shopSessions.get(sessionKey)
      myLog('debug', `Reusing existing session for shop ${shopId} and conversation ${conversationId}`, {
        sessionKey,
        messageCount: existingSession.messageDisplayManager?.allAckedMessages?.length || 0,
        pendingCount: existingSession.messageDisplayManager?.pendingMessages?.length || 0
      })
      
      return existingSession
    }
    
    // 创建新的店铺会话实例（一个 shopId + conversationId 组合对应一个实例）
    myLog('info', `Creating new session for shop ${shopId} and conversation ${conversationId}`, { sessionKey })
    
    const session = createChatSessionManager({
      shopId,
      conversationId,
      ...chatOptions
    })
    
    this.shopSessions.set(sessionKey, session)
    
    myLog('info', `Created new session for shop ${shopId} and conversation ${conversationId}`, {
      sessionKey,
      totalSessions: this.shopSessions.size
    })
    
    return session
  }
  
  /**
   * 获取指定店铺和会话的实例
   * @param {String} shopId - 店铺ID
   * @param {String} conversationId - 会话ID
   * @returns {Object|null} ChatSessionManager 实例或 null
   */
  getShopSession(shopId, conversationId) {
    if (!shopId) return null
    if (!conversationId) return null
    
    const sessionKey = this.generateSessionKey(shopId, conversationId)
    return this.shopSessions.get(sessionKey) || null
  }
  
  /**
   * 销毁指定店铺和会话的实例
   * @param {String} shopId - 店铺ID
   * @param {String} conversationId - 会话ID
   */
  destroyShopSession(shopId, conversationId) {
    if (!shopId || !conversationId) return
    
    const sessionKey = this.generateSessionKey(shopId, conversationId)
    const session = this.shopSessions.get(sessionKey)
    if (session) {
      myLog('info', `Destroying session for shop ${shopId} and conversation ${conversationId}`, { sessionKey })
      session.destroy()
      this.shopSessions.delete(sessionKey)
      
      myLog('info', `Destroyed session for shop ${shopId} and conversation ${conversationId}`, {
        sessionKey,
        remainingSessions: this.shopSessions.size
      })
    }
  }
  
  /**
   * 销毁指定店铺的所有会话实例（用于清理某个店铺的所有客户咨询）
   * @param {String} shopId - 店铺ID
   */
  destroyAllSessionsForShop(shopId) {
    if (!shopId) return
    
    const keysToDelete = []
    this.shopSessions.forEach((session, key) => {
      if (key.startsWith(`${shopId}_`)) {
        keysToDelete.push(key)
      }
    })
    
    keysToDelete.forEach(key => {
      const session = this.shopSessions.get(key)
      if (session) {
        myLog('info', `Destroying session ${key}`)
        session.destroy()
        this.shopSessions.delete(key)
      }
    })
    
    myLog('info', `Destroyed all sessions for shop ${shopId}`, {
      destroyedCount: keysToDelete.length,
      remainingSessions: this.shopSessions.size
    })
  }
  
  /**
   * 销毁所有会话实例（用于小程序彻底关闭时）
   */
  destroyAllSessions() {
    myLog('info', 'Destroying all shop sessions', {
      totalSessions: this.shopSessions.size
    })
    
    this.shopSessions.forEach((session, sessionKey) => {
      myLog('debug', `Destroying session ${sessionKey}`)
      session.destroy()
    })
    
    this.shopSessions.clear()
    
    myLog('info', 'All shop sessions destroyed')
  }
  
  /**
   * 获取所有店铺会话的信息
   * @returns {Array} 会话信息列表
   */
  getAllSessionsInfo() {
    return Array.from(this.shopSessions.entries()).map(([sessionKey, session]) => {
      const [shopId, conversationId] = sessionKey.includes('_') 
        ? sessionKey.split('_') 
        : [sessionKey, null]
      
      return {
        sessionKey,
        shopId,
        conversationId: conversationId || session.conversationId,
        isConnected: session.isConnected(),
        allAckedCount: session.messageDisplayManager?.allAckedMessages?.length || 0,
        pendingCount: session.messageDisplayManager?.pendingMessages?.length || 0
      }
    })
  }
  
  /**
   * 获取会话数量
   * @returns {Number} 会话数量
   */
  getSessionsCount() {
    return this.shopSessions.size
  }
}

// 导出单例
let shopChatManagerInstance = null

export function getShopChatManager() {
  if (!shopChatManagerInstance) {
    shopChatManagerInstance = new ShopChatManager()
  }
  return shopChatManagerInstance
}

export default ShopChatManager

