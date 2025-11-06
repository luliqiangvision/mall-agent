/**
 * Simple WebSocket message router.
 * Responsibilities:
 * - Maintain a mapping from interface name to handler function
 * - Dispatch inbound messages to the appropriate handler
 * - Provide a default handler for unknown interfaces
 */

class WsRouter {
  constructor(options = {}) {
    this.handlers = new Map()
    this.defaultHandler = options.defaultHandler || null
    this.createContext = options.createContext || (() => ({}))
  }

  /**
   * Register a handler for a specific interface
   * @param {string} interfaceName
   * @param {(ctx: any) => void} handler
   */
  register(interfaceName, handler) {
    if (typeof interfaceName !== 'string' || !interfaceName) return
    if (typeof handler !== 'function') return
    this.handlers.set(interfaceName, handler)
  }

  /**
   * Dispatch a message to the appropriate handler
   * @param {object} message - Envelope from server
   */
  dispatch(message) {
    const interfaceName = message && message.interfaceName
    const handler = this.handlers.get(interfaceName) || this.defaultHandler
    if (typeof handler === 'function') {
      const ctx = this.createContext(message)
      try {
        handler(ctx)
      } catch (error) {
        // swallow to avoid breaking message loop; rely on caller logging
        if (ctx && ctx.log) {
          ctx.log('error', 'Router handler error', { interfaceName, error })
        }
      }
    }
  }
}

export default WsRouter


