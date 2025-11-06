import { myLog } from '@/utils/log.js'

/**
 * 未读数管理器（全局单例）
 * 职责：管理所有会话的未读消息数
 * 
 * 设计原则：
 * 1. 全局单例，应用生命周期内唯一
 * 2. 管理所有会话的未读数
 * 3. 提供更新、查询接口
 */
class UnreadCountManager {
  constructor() {
    // 存储每个会话的未读数
    // key: conversationId, value: unreadCount
    this.unreadMap = new Map()
        
    // 监听器列表（用于通知 UI 更新）
    this.listeners = new Set()
        
    myLog('info', 'UnreadCountManager initialized')
  }
    
  /**
     * 设置会话的未读数
     * @param {String} conversationId - 会话ID
     * @param {Number} unreadCount - 未读数
     */
  setUnreadCount(conversationId, unreadCount) {
    if (!conversationId) return
        
    const oldCount = this.unreadMap.get(conversationId) || 0
    this.unreadMap.set(conversationId, unreadCount)
        
    myLog('debug', `Updated unread count for conversation ${conversationId}`, {
      oldCount,
      newCount: unreadCount
    })
        
    // 通知所有监听器
    this.notifyListeners(conversationId, unreadCount)
  }
    
  /**
     * 增加会话的未读数
     * @param {String} conversationId - 会话ID
     * @param {Number} increment - 增加数量
     */
  incrementUnreadCount(conversationId, increment = 1) {
    if (!conversationId) return
        
    const currentCount = this.unreadMap.get(conversationId) || 0
    this.setUnreadCount(conversationId, currentCount + increment)
  }
    
  /**
     * 减少会话的未读数
     * @param {String} conversationId - 会话ID
     * @param {Number} decrement - 减少数量
     */
  decrementUnreadCount(conversationId, decrement = 1) {
    if (!conversationId) return
        
    const currentCount = this.unreadMap.get(conversationId) || 0
    this.setUnreadCount(conversationId, Math.max(0, currentCount - decrement))
  }
    
  /**
     * 获取会话的未读数
     * @param {String} conversationId - 会话ID
     * @returns {Number} 未读数
     */
  getUnreadCount(conversationId) {
    return this.unreadMap.get(conversationId) || 0
  }
    
  /**
     * 获取所有会话的未读数
     * @returns {Map} 未读数映射
     */
  getAllUnreadCounts() {
    return new Map(this.unreadMap)
  }
    
  /**
     * 获取总未读数
     * @returns {Number} 总未读数
     */
  getTotalUnreadCount() {
    let total = 0
    this.unreadMap.forEach(count => {
      total += count
    })
    return total
  }
    
  /**
     * 清空会话的未读数
     * @param {String} conversationId - 会话ID
     */
  clearUnreadCount(conversationId) {
    if (!conversationId) return
        
    this.unreadMap.delete(conversationId)
    this.notifyListeners(conversationId, 0)
        
    myLog('debug', `Cleared unread count for conversation ${conversationId}`)
  }
    
  /**
     * 批量设置未读数（用于初始化）
     * @param {Object} unreadMap - 未读数映射 { conversationId: count }
     */
  setUnreadCounts(unreadMap) {
    for (const [conversationId, count] of Object.entries(unreadMap)) {
      this.setUnreadCount(conversationId, count)
    }
        
    myLog('info', 'Batch updated unread counts', {
      conversationCount: Object.keys(unreadMap).length
    })
  }
    
  /**
     * 添加监听器
     * @param {Function} listener - 监听器函数 (conversationId, unreadCount) => void
     * @returns {Function} 取消监听函数
     */
  addListener(listener) {
    this.listeners.add(listener)
        
    // 返回取消监听函数
    return () => {
      this.listeners.delete(listener)
    }
  }
    
  /**
     * 通知所有监听器
     * @param {String} conversationId - 会话ID
     * @param {Number} unreadCount - 未读数
     */
  notifyListeners(conversationId, unreadCount) {
    this.listeners.forEach(listener => {
      try {
        listener(conversationId, unreadCount)
      } catch (error) {
        myLog('error', 'Error in unread count listener', error)
      }
    })
  }
}

// 导出单例
let unreadCountManagerInstance = null

export function getUnreadCountManager() {
  if (!unreadCountManagerInstance) {
    unreadCountManagerInstance = new UnreadCountManager()
  }
  return unreadCountManagerInstance
}

export default UnreadCountManager

