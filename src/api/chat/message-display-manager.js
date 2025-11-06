import { myLog } from '@/utils/log.js'

// 在 Uni-app 环境中，uni 是全局对象
 
const getCurrentUserId = () => {
  try {
    
    return uni.getStorageSync('userInfo')?.agentId
  } catch {
    return null
  }
}

/**
 * 统一的消息排序比较器：
 * - 优先按 serverMsgId 升序
 * - 次要按 timestamp 升序
 */
export function compareMessagesForDisplay(a, b) {
  const aHasId = typeof a?.serverMsgId === 'number' || (typeof a?.serverMsgId === 'string' && a.serverMsgId !== '')
  const bHasId = typeof b?.serverMsgId === 'number' || (typeof b?.serverMsgId === 'string' && b.serverMsgId !== '')
  if (aHasId && bHasId) {
    const aId = Number(a.serverMsgId)
    const bId = Number(b.serverMsgId)
    if (!Number.isNaN(aId) && !Number.isNaN(bId)) {
      return aId - bId
    }
  }
  const timeA = a?.timestamp ? new Date(a.timestamp).getTime() : 0
  const timeB = b?.timestamp ? new Date(b.timestamp).getTime() : 0
  return timeA - timeB
}

/**
 * 对消息数组进行稳定排序（原地排序）
 */
export function sortMessagesInPlace(messages) {
  if (Array.isArray(messages)) {
    messages.sort(compareMessagesForDisplay)
  }
  return messages
}

/**
 * 消息显示策略管理器
 * 
 * 核心逻辑：
 * 1. 统一的消息加载：调用后端接口，后端自动判断返回未读消息或历史消息
 * 2. 未读消息：后端返回所有未读消息，前端完整显示
 * 3. 已读消息：后端返回固定数量的历史消息，前端折叠显示
 * 4. 无消息：后端返回空，前端不做任何操作
 * 
 * 使用场景：
 * - 用户正在聊天：新消息立即显示，不折叠
 * - 用户登录后首次点击聊天列表界面的入口：后端自动判断，返回合适的消息
 * - 实时聊天：新消息立即显示，自动滚动到最新
 * 
 * 设计原则：
 * - 简化前端逻辑：让后端处理复杂的判断逻辑
 * - 统一接口：一个方法处理所有情况
 * - 解耦性：与ChatManager解耦，通过回调函数通信
 */
class MessageDisplayManager {
  constructor(options = {}) {
    // 基础配置
    this.conversationId = options.conversationId
    this.clientMaxServerMsgId = options.clientMaxServerMsgId || 0
    
    // 消息状态管理
    this.displayedServerMsgIds = new Set() // 已显示的 serverMsgId 集合，用于服务器推送的新消息去重

    // allAckedMessages: 所有已经持久化到服务器端的消息（有serverMsgId）
    // 包含：1) 通过HTTP接口拉取的历史消息 2) 通过WebSocket接收的实时消息 3) 已成功发送的消息
    // 这个数组是消息的完整数据集，用于消息去重、排序和跳号检测
    this.allAckedMessages = [] // 所有已确认的消息
    // pendingMessages: 临时消息（无serverMsgId，包括发送中/失败/重发中的消息）
    // 包含：1) 正在发送中的消息（status='sending'） 2) 发送失败的消息（status='failed'）
    // 3) 重发中的消息（status='retrying'，timestamp更新为当前时间，会排到最后）
    // 这些消息在发送成功后会从pendingMessages移除，服务器消息会通过WebSocket推送到allAckedMessages
    this.pendingMessages = [] // 临时消息列表
    this.visibleMessages = [] // 当前可见的消息（合并allAckedMessages和pendingMessages后排序）
    
    // 分页状态
    // 分页从 0 开始计数，首次“加载更多”应请求第 1 页
    this.currentHistoryPage = 0 // 当前历史消息已加载到的页码（不含即将请求的页）
    this.isLoadingMore = false // 是否正在加载更多历史消息
    this.hasMoreHistory = true // 是否还有更多历史消息
    
    // 显示配置
    this.maxVisibleMessages = options.maxVisibleMessages || 50 // 屏幕最多显示的消息数
    
    // HTTP管理器
    this.chatHttpManager = options.chatHttpManager // HTTP请求管理器
    
    // 回调函数
    this.onMessagesUpdate = options.onMessagesUpdate // 消息更新回调
    this.onScrollToLatest = options.onScrollToLatest // 滚动到最新消息回调
    this.onLoadMore = options.onLoadMore // 加载更多回调
    
    myLog('info', 'MessageDisplayManager initialized', {
      conversationId: this.conversationId,
      clientMaxServerMsgId: this.clientMaxServerMsgId,
      maxVisibleMessages: this.maxVisibleMessages
    })
  }
  

  
   /**
   * 安全合并消息数组（基于 clientMsgId 去重）
   * @param {Array} existingMessages - 已有消息数组
   * @param {Array} newMessages - 新消息数组
   * @returns {Array} 去重后的合并消息数组
   */
   safeMergeMessages(existingMessages, newMessages) {
    // 创建 clientMsgId 到消息的映射，用于去重
    const messageMap = new Map()
    const messagesWithoutId = [] // 存储没有 clientMsgId 的消息
    
    // 先添加已有消息
    existingMessages.forEach(msg => {
      if (msg.clientMsgId) {
        messageMap.set(msg.clientMsgId, msg)
      } else {
        // 没有 clientMsgId 的消息也保留
        messagesWithoutId.push(msg)
      }
    })
    
      // 再添加新消息（如果有重复的 clientMsgId，保留旧消息）
      newMessages.forEach(msg => {
        if (msg.clientMsgId) {
          const existingMsg = messageMap.get(msg.clientMsgId)
          if (existingMsg) {
            // 如果重复，保留旧消息，丢弃新消息
            return
          }else{
            messageMap.set(msg.clientMsgId, msg)
          }
        }
      })
    
    // 返回去重后的消息数组（有 clientMsgId 的去重后 + 没有 clientMsgId 的）
    return [...Array.from(messageMap.values()), ...messagesWithoutId]
  }

  /**
   * 上拉加载更多历史消息
   * @param {Object} options - 加载选项
   */
  async loadMoreHistoryMessages() {
    if (this.isLoadingMore || !this.hasMoreHistory) {
      return
    }
    
    this.isLoadingMore = true
    myLog('info', 'Loading more history messages', { currentPage: this.currentHistoryPage })
    
    try {
      // 实现思路：
      // 1. 加载更多已读的历史消息
      // 2. 这些是用户之前看过的消息，按需加载
      // 3. 将新消息插入到消息列表前面
      // 4. 更新分页状态，支持继续加载
      
      if (this.onLoadMore) {
        const result = await this.onLoadMore({
          conversationId: this.conversationId,
          pageSize: 20,
          currentPage: this.currentHistoryPage + 1
        })
        
        if (result && result.messages && result.messages.length > 0) {
          // 历史消息需要插入到开头，先进行去重处理
          const deduplicatedMessages = this.deduplicateMessages(result.messages)
          const formattedMessages = this.formatMessages(deduplicatedMessages)
          
          if (formattedMessages.length > 0) {
            // 安全合并：将去重后的历史消息与已有消息合并（避免重复）
            this.allAckedMessages = this.safeMergeMessages(this.allAckedMessages, formattedMessages)
            
            // 更新分页状态
            this.currentHistoryPage++
            this.hasMoreHistory = result.messages.length === 20
            
            // 重新计算可见消息
            this.calculateVisibleMessages()
            
            // 通知消息更新
            if (this.onMessagesUpdate) {
              this.onMessagesUpdate({
                allAckedMessages: this.allAckedMessages,
                visibleMessages: this.visibleMessages,
                hasMoreHistory: this.hasMoreHistory,
                isLoadingMore: this.isLoadingMore
              })
            }
            
            myLog('info', 'Loaded more history messages', {
              newCount: formattedMessages.length,
              totalCount: this.allAckedMessages.length,
              hasMoreHistory: this.hasMoreHistory,
              duplicates: result.messages.length - deduplicatedMessages.length
            })
          } else {
            myLog('info', 'All loaded messages were duplicates')
          }
        } else {
          this.hasMoreHistory = false
          myLog('info', 'No more history messages available')
        }
      }
    } catch (error) {
      myLog('error', 'Failed to load more history messages', error)
    } finally {
      this.isLoadingMore = false
    }
  }
  
  /**
   * 消息去重处理
   * @param {Array} messages - 待处理的消息数组
   * @returns {Array} 去重后的消息数组
   */
  deduplicateMessages(messages) {
    // 消息去重逻辑实现
    // 1. ✅ 维护已显示的 serverMsgId 集合 (this.displayedServerMsgIds)
    // 2. ✅ 过滤掉重复的消息 (基于 serverMsgId 判断)
    // 3. ✅ 更新已显示消息ID集合 (添加到 Set 中)
    // 4. ✅ 返回去重后的消息数组
    
    if (!Array.isArray(messages)) {
      return []
    }
    
    const newMessages = messages.filter(msg => {
      if (!msg.serverMsgId) {
        return true // 没有serverMsgId的消息不过滤
      }
      
      if (this.displayedServerMsgIds.has(msg.serverMsgId)) {
        myLog('debug', 'Duplicate message filtered', { serverMsgId: msg.serverMsgId })
        return false // 已显示过，跳过
      }
      
      this.displayedServerMsgIds.add(msg.serverMsgId)
      return true // 新消息，需要显示
    })
    
    myLog('debug', 'Message deduplication', {
      original: messages.length,
      filtered: newMessages.length,
      duplicates: messages.length - newMessages.length
    })
    
    return newMessages
  }
  
  /**
   * 格式化消息，补齐展示所需字段
   * @param {Array|Object} messages - 原始消息或消息数组
   * @returns {Array} 已格式化的消息数组
   */
  formatMessages(messages) {
    const messageArray = Array.isArray(messages) ? messages : [messages]
    if (!messageArray || messageArray.length === 0) {
      return []
    }

    const currentUserId = getCurrentUserId()

    return messageArray.map(originalMessage => {
      const msg = { ...originalMessage }

      // 注意：type 字段的判断逻辑已移到 Vue 组件中（customerService.vue），
      // 因为这是前端显示逻辑，不应该影响后台数据库

      if (!msg.time && msg.timestamp) {
        const timestamp = new Date(msg.timestamp)
        if (!Number.isNaN(timestamp.getTime())) {
          const y = timestamp.getFullYear()
          const m = (timestamp.getMonth() + 1).toString().padStart(2, '0')
          const d = timestamp.getDate().toString().padStart(2, '0')
          const hh = timestamp.getHours().toString().padStart(2, '0')
          const mm = timestamp.getMinutes().toString().padStart(2, '0')
          msg.time = `${y}-${m}-${d} ${hh}:${mm}`
        }
      }

      if (!msg.status) {
        msg.status = 'sent'
      }

      return msg
    })
  }

  /**
   * 更新消息显示状态
   * @param {Array} messages - 消息数组
   */
  async updateMessageDisplayState(messages) {
    if (!Array.isArray(messages)) {
      return
    }
    // 去重处理
    const deduplicatedMessages = this.deduplicateMessages(messages)
    if (deduplicatedMessages.length === 0) {
      return
    }
    // 局部排序：统一使用比较器（serverMsgId 升序，降级到时间戳）
    const sortedNewMessages = sortMessagesInPlace(deduplicatedMessages)
    // 检查是否有跳号
    const hasGap = this.checkMessageGap(sortedNewMessages)
    if (hasGap) {
      // 有跳号：发起HTTP补漏请求
      await this.handleMessageGap(sortedNewMessages)
    } else {
      // 无跳号：直接显示
      this.displayMessages(sortedNewMessages)
    }
  }
  
  /**
   * 检查消息跳号
   * @param {Array} newMessages - 新消息数组
   * @returns {boolean} 是否有跳号
   */
  checkMessageGap(newMessages) {
    if (this.allAckedMessages.length === 0) return false
    
    const lastServerMsgId = this.allAckedMessages[0].serverMsgId
    const firstNewServerMsgId = newMessages[0].serverMsgId
    
    // 如果新消息的ID不是连续的，说明有跳号
    return firstNewServerMsgId !== lastServerMsgId + 1
  }
  
  /**
   * 处理消息跳号
   * @param {Array} newMessages - 新消息数组
   */
  async handleMessageGap(newMessages) {
    try {
      myLog('info', 'Detected message gap, requesting missing messages', {
        lastServerMsgId: this.allAckedMessages[0].serverMsgId,
        firstNewServerMsgId: newMessages[0].serverMsgId
      })
      
      // 发起HTTP补漏请求
      const missingResult = await this.requestMissingMessages(newMessages)
      
      if (missingResult.data.hasMissingMessages && missingResult.data.missingMessages.length > 0) {
        // 有补漏消息：安全合并显示（避免重复）
        const mergedMessages = this.safeMergeMessages(missingResult.data.missingMessages, newMessages)
        this.displayMessages(mergedMessages)
        
        myLog('info', 'Missing messages recovered', {
          missingCount: missingResult.data.missingCount,
          totalCount: mergedMessages.length
        })
      } else {
        // 无补漏消息：直接显示新消息
        this.displayMessages(newMessages)
        
        myLog('info', 'No missing messages found, displaying new messages')
      }
    } catch (error) {
      myLog('error', 'Failed to handle message gap', error)
      // 补漏失败：直接显示新消息
      this.displayMessages(newMessages)
    }
  }
  
  /**
   * 请求缺失消息
   * @param {Array} newMessages - 新消息数组
   * @returns {Promise<Object>} 补漏结果
   */
  async requestMissingMessages(newMessages) {
    const lastServerMsgId = this.allAckedMessages[0].serverMsgId
    const firstNewServerMsgId = newMessages[0].serverMsgId
    
    // 直接调用HTTP接口补漏
    if (this.chatHttpManager) {
      return await this.chatHttpManager.checkMissingMessages({
        conversationId: this.conversationId,
        startServerMsgId: lastServerMsgId,
        endServerMsgId: firstNewServerMsgId
      })
    }
    
    return {
      hasMissingMessages: false,
      missingMessages: [],
      missingCount: 0
    }
  }
  
  /**
   * 显示消息
   * @param {Array} messages - 消息数组
   */
  displayMessages(messages) {
    // 安全合并到所有消息列表（去重）并全量排序，保证展示顺序稳定
    this.allAckedMessages = this.safeMergeMessages(this.allAckedMessages, messages)
    sortMessagesInPlace(this.allAckedMessages)
    // 计算可见消息
    this.calculateVisibleMessages()
    // 通知消息更新
    if (this.onMessagesUpdate) {
      this.onMessagesUpdate({
        allAckedMessages: this.allAckedMessages,
        visibleMessages: this.visibleMessages,
        hasMoreHistory: this.hasMoreHistory,
        isLoadingMore: this.isLoadingMore
      })
    }
    // 格式化消息
    const formattedMessages = this.formatMessages(messages)
    // 通知有新消息到达，让上层决定是否滚动
    if (this.onScrollToLatest) {
      this.onScrollToLatest(messages)
    }
  }
  
  /**
   * 计算可见消息
   * 合并allAckedMessages和pendingMessages，使用sortMessagesInPlace统一排序
   */
  calculateVisibleMessages() {
    // 1. 去重：移除pendingMessages中已成功发送的消息（通过clientMsgId匹配allAckedMessages）
    // 需要在合并前先清理pendingMessages，避免重复显示
    this.removeDuplicatedPendingMessages()
    // 2. 合并已确认消息和临时消息
    this.visibleMessages = [...this.allAckedMessages, ...this.pendingMessages]
    // 3. 统一排序：使用sortMessagesInPlace，会自动处理有/无serverMsgId的消息
    sortMessagesInPlace(this.visibleMessages)
    myLog('debug', 'Calculated visible messages', {
      allAckedCount: this.allAckedMessages.length,
      pendingCount: this.pendingMessages.length,
      visibleCount: this.visibleMessages.length
    })
  }
  
  /**
   * 移除pendingMessages中已成功发送的消息（去重）
   * 当消息发送成功时，allAckedMessages中会有相同clientMsgId的消息（有serverMsgId）
   * 此时需要从pendingMessages中移除临时消息，避免重复显示
   */
  removeDuplicatedPendingMessages() {
    const initialPendingCount = this.pendingMessages.length
    
    // 创建clientMsgId映射，用于快速查找
    const ackedClientMsgIds = new Set()
    this.allAckedMessages.forEach(msg => {
      if (msg.clientMsgId) {
        ackedClientMsgIds.add(msg.clientMsgId)
      }
    })
        // 过滤pendingMessages，移除已在allAckedMessages中存在的消息
    this.pendingMessages = this.pendingMessages.filter(pending => {
      // 如果pending消息有clientMsgId，且allAckedMessages中已有相同clientMsgId的消息，则移除
      if (pending.clientMsgId && ackedClientMsgIds.has(pending.clientMsgId)) {
        myLog('debug', 'Removing duplicated pending message', { clientMsgId: pending.clientMsgId })
        return false
      }
      return true
    })
    
    const removedCount = initialPendingCount - this.pendingMessages.length
    if (removedCount > 0) {
      myLog('debug', 'Removed duplicated pending messages', { 
        removedCount, 
        remainingPendingCount: this.pendingMessages.length 
      })
    }
  }
  
  /**
   * 判断是否应该滚动到最新消息
   * @param {Array} newMessages - 新消息数组
   * @param {Object} scrollState - 滚动状态 { isAtBottom: boolean, hasScrolledUp: boolean }
   * @returns {boolean}
   */
  shouldScrollToLatest(newMessages, scrollState = {}) {
    // 新方案：基于用户滚动位置判断，而非时间
    // 只有用户在底部时才自动滚动
    return scrollState.isAtBottom === true
  }
  
  
  /**
   * 添加新消息
   * @param {Array|Object} messages - 新消息或消息数组
   */
  applyOneMessages(messages) {
    const formattedMessages = this.formatMessages(messages)
    if (formattedMessages.length === 0) {
      return
    }
    return this.updateMessageDisplayState(formattedMessages)
  }
  
  /**
   * 更新clientMaxServerMsgId
   * @param {number} serverMsgId - 服务器消息ID
   */
  updateClientMaxServerMsgId(serverMsgId) {
    if (serverMsgId && serverMsgId > this.clientMaxServerMsgId) {
      this.clientMaxServerMsgId = serverMsgId
      myLog('debug', 'Updated clientMaxServerMsgId', { 
        old: this.clientMaxServerMsgId, 
        new: serverMsgId 
      })
    }
  }
  
  /**
   * 添加临时消息到pendingMessages
   * @param {Object} message - 临时消息对象（无serverMsgId）
   */
  addPendingMessage(message) {
    if (!message || !message.clientMsgId) {
      myLog('warn', 'Cannot add pending message: missing clientMsgId', message)
      return
    }
    
    // 检查是否已存在相同的clientMsgId
    const existingIndex = this.pendingMessages.findIndex(msg => msg.clientMsgId === message.clientMsgId)
    if (existingIndex >= 0) {
      myLog('debug', 'Updating existing pending message', { clientMsgId: message.clientMsgId })
      // 更新现有消息（用于重发场景）
      this.pendingMessages[existingIndex] = { ...this.pendingMessages[existingIndex], ...message }
    } else {
      // 添加新消息
      this.pendingMessages.push(message)
      myLog('debug', 'Added pending message', { clientMsgId: message.clientMsgId, status: message.status })
    }
    
    // 重新计算可见消息并通知更新
    this.calculateVisibleMessages()
    if (this.onMessagesUpdate) {
      this.onMessagesUpdate({
        allAckedMessages: this.allAckedMessages,
        visibleMessages: this.visibleMessages,
        hasMoreHistory: this.hasMoreHistory,
        isLoadingMore: this.isLoadingMore
      })
    }
  }
  
  
  /**
   * 更新临时消息状态
   * @param {String} clientMsgId - 客户端消息ID
   * @param {String} status - 新状态（'sending' | 'failed' | 'retrying'）
   * @param {Number} timestamp - 可选，更新时间戳（重发时使用，会排到最后）
   */
  updatePendingMessageStatus(clientMsgId, status, timestamp = null) {
    if (!clientMsgId) {
      return
    }
    
    const message = this.pendingMessages.find(msg => msg.clientMsgId === clientMsgId)
    if (message) {
      message.status = status
      if (timestamp !== null) {
        message.timestamp = timestamp
      }
      
      myLog('debug', 'Updated pending message status', { clientMsgId, status, hasTimestamp: timestamp !== null })
      
      // 重新计算可见消息并通知更新
      this.calculateVisibleMessages()
      if (this.onMessagesUpdate) {
        this.onMessagesUpdate({
          allAckedMessages: this.allAckedMessages,
          visibleMessages: this.visibleMessages,
          hasMoreHistory: this.hasMoreHistory,
          isLoadingMore: this.isLoadingMore
        })
      }
    } else {
      myLog('warn', 'Cannot update pending message: not found', { clientMsgId })
    }
  }
  
  /**
   * 重置状态
   */
  reset() {
    this.displayedServerMsgIds.clear()
    this.allAckedMessages = []
    this.pendingMessages = []
    this.visibleMessages = []
    this.currentHistoryPage = 1
    this.isLoadingMore = false
    this.hasMoreHistory = true
    
    myLog('info', 'MessageDisplayManager reset')
  }
  
  /**
   * 获取状态信息
   * @returns {Object} 状态信息
   */
  getState() {
    return {
      conversationId: this.conversationId,
      clientMaxServerMsgId: this.clientMaxServerMsgId,
      allAckedMessagesCount: this.allAckedMessages.length,
      pendingMessagesCount: this.pendingMessages.length,
      visibleMessagesCount: this.visibleMessages.length,
      displayedServerMsgIdsCount: this.displayedServerMsgIds.size,
      currentHistoryPage: this.currentHistoryPage,
      isLoadingMore: this.isLoadingMore,
      hasMoreHistory: this.hasMoreHistory
    }
  }
}

export default MessageDisplayManager
