'use strict'

// 声明全局变量（避免ESLint报错）
/* global __APP_CONFIG__ */

/**
 * 从构建时注入的配置中获取当前环境配置
 * 如果构建时注入失败，使用兜底配置
 */
let APP_CONFIG
if (typeof __APP_CONFIG__ !== 'undefined') {
  // __APP_CONFIG__ 是 Vite define 注入的 JSON 字符串，需要解析
  try {
    APP_CONFIG = typeof __APP_CONFIG__ === 'string' ? JSON.parse(__APP_CONFIG__) : __APP_CONFIG__
  } catch (e) {
    console.warn('Failed to parse __APP_CONFIG__, using default config', e)
    APP_CONFIG = {
      NODE_ENV: 'development',
      BASE_API: 'http://localhost:80/customer-service',
      CHAT_BASE_URL: 'localhost:80',
      APP_TITLE: '客服系统-开发环境',
      LOG_LEVEL: 'debug',
      WS_URL: 'ws://localhost:80/customer-service/ws'
    }
  }
} else {
  // 兜底配置（构建时注入失败时使用）
  APP_CONFIG = {
    NODE_ENV: 'development',
    BASE_API: 'http://localhost:80/customer-service',
    CHAT_BASE_URL: 'localhost:80',
    APP_TITLE: '客服系统-开发环境',
    LOG_LEVEL: 'debug',
    WS_URL: 'ws://localhost:80/customer-service/ws'
  }
}

// 导出完整配置对象
export { APP_CONFIG }

// 导出具体配置项
export const NODE_ENV = APP_CONFIG.NODE_ENV
export const BASE_API = APP_CONFIG.BASE_API
export const CHAT_BASE_URL = APP_CONFIG.CHAT_BASE_URL
export const APP_TITLE = APP_CONFIG.APP_TITLE
export const LOG_LEVEL = APP_CONFIG.LOG_LEVEL
export const WS_URL = APP_CONFIG.WS_URL

// 默认导出配置对象
export default APP_CONFIG
