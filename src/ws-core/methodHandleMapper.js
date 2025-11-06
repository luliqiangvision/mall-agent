// 读取业务层配置清单（统一入口）
// 设计说明：
// - 本类仅负责“入站消息”的解析与分发，不持有也不操作任何业务状态
// - 路由清单以“函数引用”形式提供 handler，避免字符串方法名造成的重命名漂移
// - 好处：当处理函数被重命名时，IDE/编译器会在配置处报红提示，便于及时修复
import routesConfig from '@/api/chat/websocket_method_routes.config.js'
import { myLog } from '@/utils/log.js'

/**
 * methodHandleMapper（纯解析器）
 * - 自行加载配置，维护 interface -> handler 的映射
 * - 直接调用处理函数，不参与业务状态
 */
class MethodHandleMapper {
  constructor() {
    this.interfaceToHandler = new Map()
    this.loadConfig(routesConfig)
  }

  loadConfig(routeList) {
    if (!Array.isArray(routeList)) return
    this.interfaceToHandler.clear()
    routeList.forEach(r => {
      if (r && r.interfaceName && r.handler) {
        // 直接引用处理函数
        if (typeof r.handler === 'function') {
          this.interfaceToHandler.set(r.interfaceName, r.handler)
        } else {
          console.warn(`Handler for interface "${r.interfaceName}" is not a function`)
        }
      }
    })
  }

  /**
   * 分发：根据配置直接调用对应的处理函数
   */
  dispatch(message) {
    const interfaceName = message && message.interfaceName
    if (!interfaceName) {
      myLog && myLog('error', 'Inbound message missing interfaceName field', message)
      return false
    }

    const handler = this.interfaceToHandler.get(interfaceName)
    if (handler && typeof handler === 'function') {
      handler(message)
      return true
    }
    myLog && myLog('error', `No handler found for interface: ${interfaceName}`, message)
    return false
  }
}

export default MethodHandleMapper