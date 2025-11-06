// 直接 import 方式：导入各业务处理函数并原样导出供路由使用
// 注意：避免循环依赖，确保 chat-message-response-handlers.js 不再 import 本文件
import { handleReplySendRequest } from './chat-message-response-handlers.js'
import { handleNotifyPull } from './chat-message-response-handlers.js'
import { handleHeartbeat } from './chat-message-response-handlers.js'
import { handleCheckMessage } from './chat-message-response-handlers.js'
import { handlePullMessage } from './chat-message-response-handlers.js'
import { handleReplyPullMessageRequest } from './chat-message-response-handlers.js'

export default { 
  handleReplySendRequest, 
  handleNotifyPull, 
  handleHeartbeat, 
  handleCheckMessage,
  handlePullMessage,
  handleReplyPullMessageRequest
}
