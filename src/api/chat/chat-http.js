import { myLog } from '@/utils/log.js'
import request from '@/utils/requestUtil'
import { getHttp2RequestUtil } from '@/utils/http2-requestutil.js'
import { CHAT_BASE_URL } from '@/utils/appConfig.js'

/**
 * 聊天 HTTP 接口管理类
 * 负责处理聊天相关的 HTTP 请求，包括：
 * - 分页拉取消息（/pullMessageWithPagedQuery）
 * - 会话预检查功能
 * - 其他查询和管理功能
 * 
 * 与 WebSocket 的职责分工：
 * - WebSocket：即时消息发送、心跳、实时消息拉取、重连检查、核心聊天推送（/notifyPull）
 * - HTTP：分页查询、历史消息、会话管理、预检查功能
 */
class ChatHttpManager {
  constructor(options = {}) {
    // 基础配置 - 从 CHAT_BASE_URL 获取，自己添加协议
    const chatHost = CHAT_BASE_URL
    const httpBaseUrl = `http://${chatHost}/chat`
    this.baseUrl = options.baseUrl || httpBaseUrl
    this.conversationId = options.conversationId
    this.shopId = options.shopId
    
    // 回调函数
    this.onMessageRenderCallback = options.onMessageRenderCallback
    this.onError = options.onError
    
    myLog('info', 'ChatHttpManager initialized', { baseUrl: this.baseUrl })
  }

  /**
   * 根据用户ID和店铺ID预检会话是否存在
   * @param {String} userId - 用户ID
   * @param {String} shopId - 店铺ID
   * @returns {Promise<Object>} 返回预检查结果
   */
  async checkConversationByShopId(userId, shopId) {
    try {
      myLog('debug', 'HTTP: Checking conversation by shopId', { userId, shopId })
      
      const response = await request({
        url: `${this.baseUrl}/agent-service/conversation/check`,
        method: 'POST',
        data: {
          userId: userId,
          shopId: shopId
        }
      })
      
      return response
    } catch (error) {
      myLog('error', 'HTTP: Failed to check conversation by shopId', error)
      
      if (this.onError) {
        this.onError(error)
      }
      
      throw error
    }
  }

  /**
   * 会话预检查（检查是否有现有会话）
   * @param {Object} options - 选项
   * @param {String} options.shopId - 店铺ID
   * @param {String} options.userId - 用户ID
   * @returns {Promise<Object>} 返回预检查结果
   */
  async preCheckConversation(options = {}) {
    try {
      myLog('debug', 'HTTP: Pre-checking conversation', options)
      
      const params = {
        shopId: options.shopId || this.shopId,
        userId: options.userId || uni.getStorageSync('userInfo')?.agentId
      }

      const response = await request({
        url: `${this.baseUrl}/agent-service/conversation/preCheck`,
        method: 'GET',
        data: params
      })

      if (response && response.data) {
        const result = response.data
        
        return {
          success: true,
          hasExistingConversation: result.hasExistingConversation || false,
          conversationId: result.conversationId || null,
          latestMessageTime: result.latestMessageTime || null,
          unreadCount: result.unreadCount || 0
        }
      } else {
        throw new Error('Invalid response: missing data')
      }
    } catch (error) {
      myLog('error', 'HTTP: Failed to pre-check conversation', error)
      
      if (this.onError) {
        this.onError(error)
      }

      throw error
    }
  }

  /**
   * 分页拉取消息
   * @param {Object} queryParams - 请求参数
   * @param {String} queryParams.conversationId - 会话ID
   * @param {Number} queryParams.pageSize - 每页大小，默认10
   * @param {Number} queryParams.currentPage - 当前页码，默认1
   * @returns {Promise<Object>} 返回消息列表和分页信息
   */
  async pullMessageWithPagedQuery(queryParams) {
    try {
      myLog('debug', 'HTTP: Pulling messages with paged query', queryParams)
      
      const params = {
        conversationId: queryParams.conversationId || this.conversationId,
        pageSize: queryParams.pageSize || 10,
        currentPage: queryParams.currentPage || 1
      }

      const response = await request({
        url: `${this.baseUrl}/agent-service/conversation/pullMessageWithPagedQuery`,
        method: 'POST',
        data: params
      })

      if (response && response.data) {
        const result = response.data
        
        // 直接使用原始消息数据，不格式化（保留 fromUserId 等所有字段）
        if (result.chatMessages && Array.isArray(result.chatMessages)) {
          const responseData = {
            success: true,
            messages: result.chatMessages, // 直接使用原始消息，保留所有字段（包括 fromUserId）
            conversationId: result.conversationId,
            currentPage: result.currentPage,
            totalPages: result.totalPages,
            hasMore: result.chatMessages.length === params.pageSize
          }

          return responseData
        } else {
          throw new Error('Invalid response format: missing chatMessages')
        }
      } else {
        throw new Error('Invalid response: missing data')
      }
    } catch (error) {
      myLog('error', 'HTTP: Failed to pull messages with paged query', error)
      
      if (this.onError) {
        this.onError(error)
      }

      throw error
    }
  }


  /**
   * 获取会话历史消息（首次加载）
   * @param {Object} options - 选项
   * @param {String} options.conversationId - 会话ID
   * @param {Number} options.pageSize - 每页大小
   * @returns {Promise<Object>} 返回消息列表
   */
  async getConversationHistory(options = {}) {
    try {
      myLog('debug', 'HTTP: Getting conversation history', options)
      
      const params = {
        conversationId: options.conversationId || this.conversationId,
        pageSize: options.pageSize || 20
      }

      const response = await request({
        url: `${this.baseUrl}/agent-service/conversation/history`,
        method: 'GET',
        data: params
      })

      if (response && response.data) {
        const result = response.data
        
        // 直接使用原始消息数据，不格式化（保留 fromUserId 等所有字段）
        if (result.messages && Array.isArray(result.messages)) {
          return {
            success: true,
            messages: result.messages, // 直接使用原始消息，保留所有字段（包括 fromUserId）
            conversationId: result.conversationId,
            hasMore: result.hasMore || false
          }
        } else {
          throw new Error('Invalid response format: missing messages')
        }
      } else {
        throw new Error('Invalid response: missing data')
      }
    } catch (error) {
      myLog('error', 'HTTP: Failed to get conversation history', error)
      
      if (this.onError) {
        this.onError(error)
      }

      throw error
    }
  }

  /**
   * 获取会话信息
   * @param {String} conversationId - 会话ID
   * @returns {Promise<Object>} 返回会话信息
   */
  async getConversationInfo(conversationId) {
    try {
      myLog('debug', 'HTTP: Getting conversation info', { conversationId })
      
      const response = await request({
        url: `${this.baseUrl}/agent-service/conversation/info`,
        method: 'GET',
        data: { conversationId: conversationId || this.conversationId }
      })

      if (response && response.data) {
        return {
          success: true,
          conversation: response.data
        }
      } else {
        throw new Error('Invalid response: missing data')
      }
    } catch (error) {
      myLog('error', 'HTTP: Failed to get conversation info', error)
      
      if (this.onError) {
        this.onError(error)
      }

      throw error
    }
  }


  /**
   * 获取聊天窗口列表（获取用户所有会话列表）
   * @param {Object} options - 选项
   * @param {String} options.userId - 用户ID
   * @returns {Promise<Object>} 返回会话列表数据
   */
  async getChatWindowList(options = {}) {
    try {
      myLog('debug', 'HTTP: Getting chat window list', options)
      
      const data = {
        userId: options.userId || uni.getStorageSync('userInfo')?.agentId
      }

      const response = await request({
        url: `${this.baseUrl}/agent-service/conversation/getChatWindowList`,
        method: 'POST',
        data: data
      })

      if (response && response.data) {
        const result = {
          success: true,
          conversations: response.data || {}
        }

        // 调用消息渲染回调
        if (this.onMessageRenderCallback) {
          this.onMessageRenderCallback({
            interface: '/getChatWindowList',
            payload: result
          })
        }

        return result
      } else {
        throw new Error('Invalid response: missing data')
      }
    } catch (error) {
      myLog('error', 'HTTP: Failed to get chat window list', error)
      
      const errorData = {
        success: false,
        error: error.message || 'Get chat window list failed'
      }

      // 调用消息渲染回调，传递错误信息
      if (this.onMessageRenderCallback) {
        this.onMessageRenderCallback({
          interface: '/getChatWindowList',
          payload: errorData
        })
      }

      if (this.onError) {
        this.onError(error)
      }

      throw error
    }
  }

  /**
   * 格式化消息时间
   * @param {Number|String} timestamp - 时间戳
   * @returns {String} 格式化后的时间字符串
   */
  formatMessageTime(timestamp) {
    const date = new Date(timestamp)
    const y = date.getFullYear()
    const m = (date.getMonth() + 1).toString().padStart(2, '0')
    const d = date.getDate().toString().padStart(2, '0')
    const hh = date.getHours().toString().padStart(2, '0')
    const mm = date.getMinutes().toString().padStart(2, '0')
    return `${y}-${m}-${d} ${hh}:${mm}`
  }

  /**
   * 设置会话ID
   * @param {String} conversationId - 会话ID
   */
  setConversationId(conversationId) {
    this.conversationId = conversationId
    myLog('debug', 'HTTP: Conversation ID updated', { conversationId })
  }

  /**
   * 设置店铺ID
   * @param {String} shopId - 店铺ID
   */
  setShopId(shopId) {
    this.shopId = shopId
    myLog('debug', 'HTTP: Shop ID updated', { shopId })
  }

  /**
   * 检查缺失的消息
   * @param {Object} params - 检查参数
   * @param {string} params.conversationId - 会话ID
   * @param {number} params.startServerMsgId - 范围查询起始serverMsgId（不包含）
   * @param {number} params.endServerMsgId - 范围查询结束serverMsgId（不包含）
   * @returns {Promise<Object>} 检查结果
   */
  async checkMissingMessages(params) {
    try {
      myLog('debug', 'HTTP: Checking missing messages', params)
      
      const response = await request({
        url: `${this.baseUrl}/agent-service/conversation/checkMissingMessages`,
        method: 'POST',
        data: {
          conversationId: params.conversationId,
          startServerMsgId: params.startServerMsgId,
          endServerMsgId: params.endServerMsgId
        }
      })
      
      // requestUtil.js 已处理了 code !== 200 的情况，这里直接返回 response (CheckMissingMessagesResponse)
      myLog('debug', 'HTTP: Missing messages check result', response)
      return response
    } catch (error) {
      myLog('error', 'HTTP: Check missing messages failed', error)
      
      if (this.onError) {
        this.onError(error)
      }
      
      // 网络错误或业务错误（requestUtil 已 reject），返回空结果
      return {
        hasMissingMessages: false,
        missingMessages: [],
        missingCount: 0,
        conversationId: params.conversationId
      }
    }
  }

  /**
   * 标记消息为已读（HTTP接口）
   * @param {Object} options - 选项
   * @param {String} options.conversationId - 对话ID
   * @param {Number} options.serverMsgId - 消息ID
   * @param {Number} options.retryCount - 重试次数（默认0，最多5次）
   * @returns {Promise<Object>} 响应结果
   */
  async markAsRead(options = {}) {
    const { conversationId, serverMsgId, retryCount = 0 } = options
    const maxRetries = 5
    
    try {
      myLog('debug', 'HTTP: Marking message as read', { conversationId, serverMsgId, retryCount })
      
      if (!conversationId || !serverMsgId) {
        throw new Error('conversationId and serverMsgId are required')
      }
      
      // 已读接口使用 HTTP/2.0 协议
      const http2Util = getHttp2RequestUtil()
      
      myLog('debug', 'Using HTTP/2.0 request util for markAsRead', {
        isSupported: http2Util.isSupportedPlatform(),
        conversationId,
        serverMsgId
      })
      
      const response = await http2Util.request({
        url: `${this.baseUrl}/agent-service/conversation/markAsRead`,
        method: 'POST',
        data: {
          conversationId,
          serverMsgId
        }
      })
      
      myLog('debug', 'HTTP/2.0 markAsRead response:', { 
        hasResponse: !!response, 
        hasData: !!(response && response.data),
        dataType: typeof (response && response.data),
        data: response && response.data
      })
      
      if (response && response.data !== undefined) {
        // response.data 已经是 Boolean 值（true/false）
        myLog('debug', 'HTTP: Message marked as read successfully', { 
          conversationId, 
          serverMsgId,
          result: response.data
        })
        return {
          success: true,
          data: response.data  // Boolean 值
        }
      } else {
        throw new Error('Invalid response: missing data')
      }
    } catch (error) {
      myLog('error', 'HTTP: Failed to mark message as read', { conversationId, serverMsgId, retryCount, error })
      
      // 重试逻辑
      if (retryCount < maxRetries) {
        myLog('debug', `HTTP: Retrying mark as read (${retryCount + 1}/${maxRetries})`, { conversationId, serverMsgId })
        
        // 等待1秒后重试
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // 递归重试
        return this.markAsRead({
          conversationId,
          serverMsgId,
          retryCount: retryCount + 1
        })
      } else {
        myLog('error', 'HTTP: Max retries reached for mark as read', { conversationId, serverMsgId })
        return {
          success: false,
          error: error.message || 'Mark as read failed'
        }
      }
    }
  }

  /**
   * 销毁实例
   */
  destroy() {
    this.onMessageRenderCallback = null
    this.onError = null
    myLog('info', 'ChatHttpManager destroyed')
  }
}

export default ChatHttpManager
