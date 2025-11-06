/**
 * WebSocket 方法路由清单（业务可维护）
 *
 * 角色定位（类比后端 MVC）：
 * - 本文件 类似 Controller 层：只维护“接口名(interface) → 处理函数(handler)”的映射，不承载业务
 * - ws-method-registry.js 类似Service接口（都是引用其他js实现的方法，自己不干活） 门面：提供已装配好的处理函数集合（可继续扩展更多门面/分模块）
 * - MethodHandleMapper = 路由分发器：读取本清单后直接调用 handler(message)
 *
 * 使用原则：
 * - 使用“函数引用”而非字符串方法名，方法重命名时 IDE 会在此处报红，避免映射漂移
 * - 如需新增一组门面，可在 registry 中聚合后，在此追加映射项即可
 */

import methods from './ws-method-registry.js' // 导出的是已装配好的“方法映射关联表”（门面/Service）

export default [
  { interfaceName: '/replySendRequest',  handler: methods.handleReplySendRequest },
  { interfaceName: '/notifyPull',      handler: methods.handleNotifyPull },
  { interfaceName: '/heartbeat',        handler: methods.handleHeartbeat },
  { interfaceName: '/checkMessageRequest', handler: methods.handleCheckMessage },
  { interfaceName: '/pullMessageRequest', handler: methods.handleReplyPullMessageRequest }
]