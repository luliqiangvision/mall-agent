import WebSocketClient from '@/ws-core/websocketClient.js'
import { getEventBus } from './message-event-bus.js'
import { myLog } from '@/utils/log.js'

/**
 * WebSocket 连接管理器（单例）
 * 职责：只负责连接管理、心跳、消息发送/接收
 * 
 * 设计原则：
 * 1. 仅一个实例，避免多个连接
 * 2. 不包含业务逻辑，收到消息后发布到事件总线
 * 3. 所有会话共享这个连接
 */
class WebSocketConnection {
  constructor() {
    this.ws = null
    this.eventBus = getEventBus()
    this.isConnecting = false
    this.isConnected = false
    
    // 重定向 WebSocket 消息到事件总线
    this.messageHandler = this.handleMessage.bind(this)
    
    myLog('info', 'WebSocketConnection initialized')
  }
  
  /**
   * 连接 WebSocket
   */
  connect() {
    if (this.ws) {
      myLog('warn', 'WebSocket already connected')
      return
    }
    
    if (this.isConnecting) {
      myLog('warn', 'WebSocket is connecting')
      return
    }
    
    this.isConnecting = true
    
    this.ws = new WebSocketClient({
      clientSendsHeartbeat: true, // true=业务层发送心跳，框架不发送；false=框架发送心跳
      onConnected: () => {
        this.isConnected = true
        this.isConnecting = false
        this.eventBus.publishConnectionChange(true)
        this.eventBus.publishReconnectComplete()
        myLog('info', 'WebSocket connected')
      },
      onDisconnected: (disconnectInfo) => {
        this.isConnected = false
        this.isConnecting = false
        this.eventBus.publishConnectionChange(false)
        
        // 发布断开详情事件
        if (disconnectInfo) {
          this.eventBus.publishDisconnect({
            code: disconnectInfo.code,
            reason: disconnectInfo.reason,
            wasClean: disconnectInfo.wasClean,
            isServerRequested: disconnectInfo.isServerRequested,
            errorCategory: disconnectInfo.errorCategory,
            errorType: disconnectInfo.errorType || 'UNKNOWN',
            closeReason: disconnectInfo.closeReason
          })
        }
        
        myLog('info', 'WebSocket disconnected', disconnectInfo)
      },
      onReconnecting: (attempt, delay) => {
        myLog('debug', `WebSocket reconnecting, attempt: ${attempt}, delay: ${delay}`)
      },
      onError: (error) => {
        myLog('error', 'WebSocket error', error)
        // 发布错误事件
        this.eventBus.publishDisconnect({
          code: error.code || 0,
          reason: error.message || 'WebSocket error',
          wasClean: false,
          isServerRequested: false,
          errorType: 'PROTOCOL_ERROR',
          error: error
        })
      }
    })
    
    // 重定向 WebSocket 内部的消息处理
    this.ws.onMessage = this.messageHandler
    
    this.ws.connect()
  }
  
  /**
   * 处理接收到的消息，发布到事件总线
   * @param {Object} message - WebSocket 消息
   */
  handleMessage(message) {
    try {
      myLog('debug', 'WebSocket message received', { interfaceName: message.interfaceName })
      
      // 发布到事件总线（原始消息保持结构）
      const envelope = {
        conversationId: message.payload?.conversationId || null,
        interfaceName: message.interfaceName,
        version: message.version,
        payload: message.payload,
        websocketCode: message.websocketCode,
        success: message.success,
        errorMessage: message.errorMessage
      }
      this.eventBus.publish(envelope)
    } catch (error) {
      myLog('error', 'Failed to handle message', error)
    }
  }
  
  /**
   * 发送消息
   * @param {Object} message - 消息对象
   * @returns {boolean} 是否发送成功
   */
  send(message) {
    if (!this.ws) {
      myLog('error', '[WebSocketConnection] 客户端未初始化 (ws is null)')
      return false
    }
    
    if (!this.isConnected) {
      myLog('error', '[WebSocketConnection] 连接未激活 (isConnected=false)')
      return false
    }
    
    try {
      myLog('debug', '[WebSocketConnection] 发送消息', { interfaceName: message.interfaceName })
      this.ws.send(message)
      return true
    } catch (error) {
      myLog('error', '[WebSocketConnection] 发送消息时抛出异常', error)
      return false
    }
  }
  
  /**
   * 发送心跳
   * @param {Object} data - 心跳数据
   */
  sendHeartbeat(data) {
    if (!this.ws) {
      myLog('warn', 'WebSocket not connected, cannot send heartbeat')
      return false
    }
    
    try {
      this.ws.sendHeartbeat(data)
      return true
    } catch (error) {
      myLog('error', 'Failed to send heartbeat', error)
      return false
    }
  }
  
  /**
   * 断开连接
   */
  disconnect() {
    if (this.ws) {
      this.ws.destroy()
      this.ws = null
      this.isConnected = false
      this.eventBus.publishConnectionChange(false)
      myLog('info', 'WebSocket disconnected')
    }
  }
  
  /**
   * 检查是否已连接
   * @returns {boolean}
   */
  isConnectionActive() {
    return this.isConnected && this.ws !== null
  }
}

// 导出单例
let instance = null

export function getWebSocketConnection() {
  if (!instance) {
    instance = new WebSocketConnection()
  }
  return instance
}

export default getWebSocketConnection()

