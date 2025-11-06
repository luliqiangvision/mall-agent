import { myLog } from '@/utils/log.js'

/**
 * 消息事件总线
 * 负责WebSocket消息的发布订阅，实现观察者模式
 * 
 * 设计思想：
 * 1. 一个消息可以通知多个监听器（如：会话列表页 + 会话详情页）
 * 2. 按 conversationId 分发消息
 * 3. 支持全局监听（'*'）和特定会话监听（conversationId）
 */
class MessageEventBus {
  constructor() {
    // 监听器映射：conversationId -> [listener1, listener2, ...]
    this.listeners = new Map()
    
    // 连接状态监听器
    this.connectionListeners = new Set()
    
    // 重连完成监听器
    this.reconnectListeners = new Set()
    
    // 断开事件监听器
    this.disconnectListeners = new Set()
    
    myLog('info', 'MessageEventBus initialized')
  }
  
  /**
   * 订阅消息
   * @param {string} conversationId - 会话ID，'*' 表示监听所有会话
   * @param {Function} listener - 监听器函数
   * @returns {Function} 取消订阅函数
   */
  subscribe(conversationId, listener) {
    if (typeof listener !== 'function') {
      myLog('error', 'Listener must be a function')
      return
    }
    
    const key = conversationId || '*'
    
    if (!this.listeners.has(key)) {
      this.listeners.set(key, [])
    }
    
    this.listeners.get(key).push(listener)
    myLog('debug', `Subscribed to conversation: ${key}, total listeners: ${this.listeners.get(key).length}`)
    
    // 返回取消订阅函数
    return () => {
      this.unsubscribe(key, listener)
    }
  }
  
  /**
   * 取消订阅
   * @param {string} conversationId - 会话ID
   * @param {Function} listener - 监听器函数
   */
  unsubscribe(conversationId, listener) {
    const key = conversationId || '*'
    const listeners = this.listeners.get(key)
    
    if (listeners) {
      const index = listeners.indexOf(listener)
      if (index > -1) {
        listeners.splice(index, 1)
        myLog('debug', `Unsubscribed from conversation: ${key}, remaining listeners: ${listeners.length}`)
        
        // 如果没有监听器了，删除这个键
        if (listeners.length === 0) {
          this.listeners.delete(key)
        }
      }
    }
  }
  
  /**
   * 发布消息
   * @param {Object} messageData - 消息数据 { conversationId, message, interface, ... }
   */
  publish(messageData) {
    const { conversationId } = messageData
    
    // 1. 通知特定会话的监听器
    if (conversationId) {
      const specificListeners = this.listeners.get(conversationId) || []
      specificListeners.forEach(listener => {
        try {
          listener(messageData)
        } catch (error) {
          myLog('error', 'Listener error', error)
        }
      })
    }
    
    // 2. 通知全局监听器（会话列表页等）
    const globalListeners = this.listeners.get('*') || []
    globalListeners.forEach(listener => {
      try {
        listener(messageData)
      } catch (error) {
        myLog('error', 'Global listener error', error)
      }
    })
    
    myLog('debug', `Published message for conversation: ${conversationId}, specific listeners: ${this.listeners.get(conversationId)?.length || 0}, global listeners: ${globalListeners.length}`)
  }
  
  /**
   * 订阅连接状态变化
   * @param {Function} listener - 监听器函数 (connected) => void
   * @returns {Function} 取消订阅函数
   */
  subscribeConnection(listener) {
    if (typeof listener !== 'function') return
    
    this.connectionListeners.add(listener)
    myLog('debug', `Subscribed to connection events, total listeners: ${this.connectionListeners.size}`)
    
    return () => {
      this.unsubscribeConnection(listener)
    }
  }
  
  /**
   * 取消订阅连接状态
   * @param {Function} listener - 监听器函数
   */
  unsubscribeConnection(listener) {
    this.connectionListeners.delete(listener)
    myLog('debug', `Unsubscribed from connection events, remaining listeners: ${this.connectionListeners.size}`)
  }
  
  /**
   * 发布连接状态变化
   * @param {boolean} connected - 连接状态
   */
  publishConnectionChange(connected) {
    this.connectionListeners.forEach(listener => {
      try {
        listener(connected)
      } catch (error) {
        myLog('error', 'Connection listener error', error)
      }
    })
    myLog('debug', `Published connection change: ${connected}, listeners: ${this.connectionListeners.size}`)
  }
  
  /**
   * 订阅重连完成事件
   * @param {Function} listener - 监听器函数 () => void
   * @returns {Function} 取消订阅函数
   */
  subscribeReconnectComplete(listener) {
    if (typeof listener !== 'function') return
    
    this.reconnectListeners.add(listener)
    myLog('debug', `Subscribed to reconnect complete, total listeners: ${this.reconnectListeners.size}`)
    
    return () => {
      this.reconnectListeners.delete(listener)
      myLog('debug', `Unsubscribed from reconnect complete, remaining listeners: ${this.reconnectListeners.size}`)
    }
  }
  
  /**
   * 发布重连完成事件
   */
  publishReconnectComplete() {
    this.reconnectListeners.forEach(listener => {
      try {
        listener()
      } catch (error) {
        myLog('error', 'Reconnect listener error', error)
      }
    })
    myLog('debug', `Published reconnect complete, listeners: ${this.reconnectListeners.size}`)
  }
  
  /**
   * 订阅断开事件
   * @param {Function} listener - 监听器函数 (disconnectInfo) => void
   * @returns {Function} 取消订阅函数
   */
  subscribeDisconnect(listener) {
    if (typeof listener !== 'function') return
    
    this.disconnectListeners.add(listener)
    myLog('debug', `Subscribed to disconnect events, total listeners: ${this.disconnectListeners.size}`)
    
    return () => {
      this.unsubscribeDisconnect(listener)
    }
  }
  
  /**
   * 取消订阅断开事件
   * @param {Function} listener - 监听器函数
   */
  unsubscribeDisconnect(listener) {
    this.disconnectListeners.delete(listener)
    myLog('debug', `Unsubscribed from disconnect events, remaining listeners: ${this.disconnectListeners.size}`)
  }
  
  /**
   * 发布断开事件
   * @param {Object} disconnectInfo - 断开信息 { code, reason, wasClean, isServerRequested, errorCategory, errorType, closeReason }
   */
  publishDisconnect(disconnectInfo) {
    this.disconnectListeners.forEach(listener => {
      try {
        listener(disconnectInfo)
      } catch (error) {
        myLog('error', 'Disconnect listener error', error)
      }
    })
    myLog('debug', `Published disconnect event, listeners: ${this.disconnectListeners.size}`, disconnectInfo)
  }

  /**
   * 清除所有监听器（主要用于测试或重置）
   */
  clear() {
    this.listeners.clear()
    this.connectionListeners.clear()
    this.reconnectListeners.clear()
    this.disconnectListeners.clear()
    myLog('info', 'MessageEventBus cleared')
  }
}

// 导出单例
let instance = null

export function getEventBus() {
  if (!instance) {
    instance = new MessageEventBus()
  }
  return instance
}

export default getEventBus()
