/**
 * 已读状态管理器
 * 功能：
 * - 管理每个对话的最大已读 serverMsgId
 * - 判断消息是否已读
 * - 提供已读更新接口
 */

import { myLog } from '@/utils/log.js'

class ReadStatusManager {
  constructor() {
    // 存储每个对话的最大已读 serverMsgId
    // key: conversationId, value: maxReadServerMsgId
    this.maxReadServerMsgIdMap = new Map()
    
    // 防抖定时器
    this.pendingMarkAsReadTimer = new Map()
    
    myLog('debug', 'ReadStatusManager initialized')
  }

  /**
   * 初始化对话的已读状态（从 getChatWindowList 接口获取）
   * @param {String} conversationId - 对话ID
   * @param {Number} maxReadServerMsgId - 最大已读消息ID
   */
  initConversationReadStatus(conversationId, maxReadServerMsgId) {
    if (!conversationId) {
      myLog('warn', 'ReadStatusManager.initConversationReadStatus: conversationId is empty')
      return
    }
    
    this.maxReadServerMsgIdMap.set(conversationId, maxReadServerMsgId || 0)
    myLog('debug', `ReadStatusManager.initConversationReadStatus: conversationId=${conversationId}, maxReadServerMsgId=${maxReadServerMsgId}`)
  }

  /**
   * 批量初始化对话的已读状态
   * @param {Object} conversations - 对话列表对象 { conversationId: { maxReadServerMsgId } }
   */
  initConversationsReadStatus(conversations) {
    myLog('debug', 'ReadStatusManager.initConversationsReadStatus: Initializing read status for multiple conversations', conversations)
    
    for (const [conversationId, data] of Object.entries(conversations)) {
      if (data && typeof data.maxReadServerMsgId !== 'undefined') {
        this.initConversationReadStatus(conversationId, data.maxReadServerMsgId)
      }
    }
    
    myLog('debug', `ReadStatusManager.initConversationsReadStatus: Initialized ${this.maxReadServerMsgIdMap.size} conversations`)
  }

  /**
   * 判断消息是否已读
   * @param {String} conversationId - 对话ID
   * @param {Number} serverMsgId - 消息ID
   * @returns {Boolean} 是否已读
   */
  isMessageRead(conversationId, serverMsgId) {
    if (!conversationId || !serverMsgId) {
      myLog('warn', 'ReadStatusManager.isMessageRead: conversationId or serverMsgId is empty', { conversationId, serverMsgId })
      return false
    }
    
    const maxReadId = this.maxReadServerMsgIdMap.get(conversationId) || 0
    const isRead = serverMsgId <= maxReadId
    
    myLog('debug', `ReadStatusManager.isMessageRead: conversationId=${conversationId}, serverMsgId=${serverMsgId}, maxReadId=${maxReadId}, isRead=${isRead}`)
    
    return isRead
  }

  /**
   * 更新对话的已读状态（本地更新，不发起HTTP请求）
   * @param {String} conversationId - 对话ID
   * @param {Number} serverMsgId - 消息ID
   */
  updateReadStatus(conversationId, serverMsgId) {
    if (!conversationId || !serverMsgId) {
      myLog('warn', 'ReadStatusManager.updateReadStatus: conversationId or serverMsgId is empty', { conversationId, serverMsgId })
      return
    }
    
    const currentMaxReadId = this.maxReadServerMsgIdMap.get(conversationId) || 0
    const newMaxReadId = Math.max(currentMaxReadId, serverMsgId)
    
    this.maxReadServerMsgIdMap.set(conversationId, newMaxReadId)
    myLog('debug', `ReadStatusManager.updateReadStatus: conversationId=${conversationId}, serverMsgId=${serverMsgId}, newMaxReadId=${newMaxReadId}`)
  }

  /**
   * 获取对话的最大已读消息ID
   * @param {String} conversationId - 对话ID
   * @returns {Number} 最大已读消息ID
   */
  getMaxReadServerMsgId(conversationId) {
    const maxReadId = this.maxReadServerMsgIdMap.get(conversationId) || 0
    myLog('debug', `ReadStatusManager.getMaxReadServerMsgId: conversationId=${conversationId}, maxReadId=${maxReadId}`)
    return maxReadId
  }

  /**
   * 清理对话的已读状态
   * @param {String} conversationId - 对话ID
   */
  clearConversationReadStatus(conversationId) {
    if (!conversationId) {
      myLog('warn', 'ReadStatusManager.clearConversationReadStatus: conversationId is empty')
      return
    }
    
    this.maxReadServerMsgIdMap.delete(conversationId)
    myLog('debug', `ReadStatusManager.clearConversationReadStatus: conversationId=${conversationId}`)
  }

  /**
   * 获取所有对话的已读状态（用于调试）
   * @returns {Object} 所有对话的已读状态
   */
  getAllReadStatus() {
    const status = {}
    this.maxReadServerMsgIdMap.forEach((maxReadId, conversationId) => {
      status[conversationId] = maxReadId
    })
    myLog('debug', 'ReadStatusManager.getAllReadStatus:', status)
    return status
  }
}

// 导出单例
let readStatusManagerInstance = null

export function getReadStatusManager() {
  if (!readStatusManagerInstance) {
    readStatusManagerInstance = new ReadStatusManager()
  }
  return readStatusManagerInstance
}

export default ReadStatusManager

