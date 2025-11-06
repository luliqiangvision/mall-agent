import { myLog } from '@/utils/log.js'
import { getEventBus } from './message-event-bus.js'

/**
 * WebSocket 消息处理器
 * 这些函数由 ws-method-registry 导入，作为路由处理器
 * 
 * 处理流程：
 * 1. 接收 WebSocket 消息
 * 2. 发布到事件总线，由订阅者处理
 */

const publishToEventBus = (message) => {
  const payload = message?.payload
  const eventBus = getEventBus()

  eventBus.publish({
    conversationId: payload?.conversationId || null,
    interfaceName: message.interfaceName,
    version: message.version,
    payload,
    websocketCode: message.websocketCode,
    success: message.success,
    errorMessage: message.errorMessage
  })
}

/**
 * 处理发送请求的回复
 */
export function handleReplySendRequest(message) {
  publishToEventBus(message)
}

/**
 * 处理 /notifyPull 消息
 */
export function handleNotifyPull(message) {
  const cid = message.payload?.conversationId
  
  // debug 日志：记录服务端推送的消息拉取通知
  myLog('debug', 'Received notifyPull message from server', {
    conversationId: cid,
    payload: message.payload,
    needPull: message.payload?.needPull,
    latestServerMsgId: message.payload?.latestServerMsgId,
    pullFrom: message.payload?.pullFrom
  })
  
  publishToEventBus(message)
}

/**
 * 处理心跳返回（可能包含多个会话的结果）
 */
export function handleHeartbeat(message) {
  try {
    publishToEventBus(message)
  } catch (e) {
    myLog('error', 'handleHeartbeat error', e)
  }
}

/**
 * 处理重连检查消息
 */
export function handleCheckMessage(message) {
  try {
    publishToEventBus(message)
  } catch (e) {
    myLog('error', 'handleCheckMessage error', e)
  }
}

/**
 * 处理实时消息拉取
 */
export function handlePullMessage(message) {
  try {
    publishToEventBus(message)
  } catch (e) {
    myLog('error', 'handlePullMessage error', e)
  }
}

/**
 * 处理 /pullMessageRequest 的响应结果
 */
export function handleReplyPullMessageRequest(message) {
  try {
    publishToEventBus(message)
  } catch (e) {
    myLog('error', 'handleReplyPullMessageRequest error', e)
  }
}
