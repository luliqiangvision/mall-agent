// 这个js就是门面，让其他js可以访问到配置文件
// @/utils/appConfig
// Profile配置系统 - 类似Maven profiles的动态环境配置

// 声明全局变量（避免ESLint报错）
/* global __APP_CONFIG__ */

// 从构建时注入的配置中获取当前环境配置
const isInjected = typeof __APP_CONFIG__ !== 'undefined'
const APP_CONFIG = isInjected ? __APP_CONFIG__ : {
  // 兜底配置，防止构建时注入失败
  API_BASE_URL: 'http://cn-qz-plc-1.ofalias.net:55212/mall-portal',
  WS_BASE_URL: 'ws://cn-qz-plc-1.ofalias.net:55212',
  CHAT_BASE_URL: '192.168.8.109:80',
  APP_TITLE: '商城应用-开发环境',
  LOG_LEVEL: 'debug',
  IP_LOOKUP_URL: 'https://api.myip.la/cn?json'
}

console.log('[appConfig] __APP_CONFIG__ 已注入:', isInjected)
console.log('[appConfig] WS_BASE_URL =', APP_CONFIG.WS_BASE_URL)
console.log('[appConfig] API_BASE_URL =', APP_CONFIG.API_BASE_URL)
console.log('[appConfig] CHAT_BASE_URL =', APP_CONFIG.CHAT_BASE_URL)

// 导出完整配置对象
export { APP_CONFIG }

// 导出常用配置项（保持向后兼容）
export const API_BASE_URL = APP_CONFIG.API_BASE_URL
export const WS_BASE_URL = APP_CONFIG.WS_BASE_URL
export const CHAT_BASE_URL = APP_CONFIG.CHAT_BASE_URL
export const APP_TITLE = APP_CONFIG.APP_TITLE
export const LOG_LEVEL = APP_CONFIG.LOG_LEVEL
export const IP_LOOKUP_URL = APP_CONFIG.IP_LOOKUP_URL