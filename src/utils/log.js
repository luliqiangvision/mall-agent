// 调用样例,这是为了统一所有端的日志打印,单纯用console.log的话,安卓那边catlog看不到日志
// myLog('info', '启动成功');
// myLog('warn', '请求接口时间过长');
// myLog('error', '接口返回错误');
// myLog('debug', '调试数据', someVar);

import { LOG_LEVEL } from './appConfig.js'

/**
 * 日志级别优先级定义
 * 数字越小优先级越高，只有当前日志级别 >= 配置的日志级别时才会输出
 */
const LOG_LEVELS = {
  error: 0,    // 错误级别
  warn: 1,     // 警告级别
  info: 2,     // 信息级别
  debug: 3     // 调试级别
}

/**
 * 检查当前日志级别是否应该输出
 * @param {string} currentLevel - 当前日志级别
 * @returns {boolean} 是否应该输出
 */
function shouldLog(currentLevel) {
  const currentLevelPriority = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info
  const configLevelPriority = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.debug

  return currentLevelPriority <= configLevelPriority
}

/**
 * 过滤敏感数据
 * @param {any} data - 需要过滤的数据
 * @returns {any} 过滤后的数据
 */
function filterSensitiveData(data) {
  if (typeof data !== 'object' || data === null) {
    return data
  }

  // 检查是否是 Vue 组件实例或其他特殊对象
  if (data && typeof data === 'object') {
    // 检查是否是 Vue 组件实例
    if (data.__vnode || data.$el || data.$options || data._isVue) {
      return '[Vue Component Instance]'
    }

    // 检查是否是 DOM 元素
    if (data.nodeType || data.tagName) {
      return '[DOM Element]'
    }

    // 检查是否是函数
    if (typeof data === 'function') {
      return '[Function]'
    }

    // 检查是否是 Date 对象
    if (data instanceof Date) {
      return data.toISOString()
    }

    // 检查是否是 RegExp
    if (data instanceof RegExp) {
      return data.toString()
    }
  }

  if (Array.isArray(data)) {
    return data.map(item => filterSensitiveData(item))
  }

  // 只处理普通对象，避免枚举 Vue 组件实例
  const filtered = {}
  try {
    // 使用 Object.keys 而不是 Object.entries，减少性能开销
    const keys = Object.keys(data)
    for (const key of keys) {
      // 过滤敏感字段
      if (isSensitiveKey(key)) {
        filtered[key] = '[FILTERED]'
      } else if (typeof data[key] === 'object' && data[key] !== null) {
        // 递归过滤嵌套对象
        filtered[key] = filterSensitiveData(data[key])
      } else {
        filtered[key] = data[key]
      }
    }
  } catch (error) {
    // 如果无法枚举属性，返回类型信息
    return `[${data.constructor?.name || 'Object'}] (无法枚举属性)`
  }

  return filtered
}

/**
 * 判断是否为敏感字段名
 * @param {string} key - 字段名
 * @returns {boolean} 是否为敏感字段
 */
function isSensitiveKey(key) {
  const sensitiveKeys = [
    // 认证相关
    'authorization', 'token', 'password', 'secret', 'key',
    'auth', 'credential', 'session', 'cookie', 'apiKey',
    'accessToken', 'refreshToken', 'idToken', 'bearer',

    // 业务敏感信息
    'orderId', 'businessLine', 'payChannel', 'amount', 'productCode',
    'clientIp', 'deviceInfo', 'tenantId', 'userId', 'customerId',
    'phone', 'email', 'idCard', 'bankCard', 'account',

    // 支付相关
    'payment', 'pay', 'money', 'price', 'cost', 'fee',
    'balance', 'wallet', 'credit', 'debit',
    'notifyUrl', 'returnUrl', 'callbackUrl', 'redirectUrl',

    // 其他敏感信息
    'ssn', 'social', 'passport', 'license', 'serial'
  ]

  return sensitiveKeys.some(sensitiveKey =>
    key.toLowerCase().includes(sensitiveKey.toLowerCase())
  )
}

export function myLog(level, ...args) {
  // 检查日志级别，如果不满足条件则不输出
  if (!shouldLog(level)) {
    return
  }

  // 统一使用北京时间(UTC+8)并输出为: YYYY-MM-DD HH:mm:ss.SSS
  function formatBeijingTime(date = new Date()) {
    try {
      const utcMs = date.getTime() + date.getTimezoneOffset() * 60000
      const bj = new Date(utcMs + 8 * 3600000)
      const y = bj.getFullYear()
      const m = String(bj.getMonth() + 1).padStart(2, '0')
      const d = String(bj.getDate()).padStart(2, '0')
      const hh = String(bj.getHours()).padStart(2, '0')
      const mm = String(bj.getMinutes()).padStart(2, '0')
      const ss = String(bj.getSeconds()).padStart(2, '0')
      const ms = String(bj.getMilliseconds()).padStart(3, '0')
      return `${y}-${m}-${d} ${hh}:${mm}:${ss}.${ms}`
    } catch (_) {
      // 兜底：退回 ISO 字符串，避免因环境兼容问题丢日志
      return new Date().toISOString()
    }
  }

  const timeStr = formatBeijingTime()
  // 智能处理不同类型的参数，过滤敏感信息
  const processedArgs = args.map(arg => {
    if (arg instanceof Error) {
      // 错误对象：显示错误信息和堆栈
      return `${arg.message}\n${arg.stack}`
    } else if (typeof arg === 'object' && arg !== null) {
      // 普通对象：过滤敏感信息后格式化
      try {
        const sanitizedArg = filterSensitiveData(arg)
        return JSON.stringify(sanitizedArg, null, 2)
      } catch (error) {
        // 如果JSON序列化失败，尝试提取可序列化的属性
        try {
          if (Array.isArray(arg)) {
            // 处理数组，提取每个元素的基本信息
            return `[Array(${arg.length})] ${arg.map((item, index) => {
              if (typeof item === 'object' && item !== null) {
                return `[${index}]: ${item.constructor?.name || 'Object'}`
              }
              return `[${index}]: ${String(item)}`
            }).join(', ')}`
          } else {
            // 处理对象，提取可序列化的属性
            const safeProps = {}
            for (const [key, value] of Object.entries(arg)) {
              if (typeof value === 'function') {
                safeProps[key] = '[Function]'
              } else if (typeof value === 'object' && value !== null) {
                safeProps[key] = `[${value.constructor?.name || 'Object'}]`
              } else {
                safeProps[key] = value
              }
            }
            return JSON.stringify(safeProps, null, 2)
          }
        } catch {
          // 最后的兜底方案
          return `[${arg.constructor?.name || 'Object'}] (无法序列化)`
        }
      }
    } else {
      // 基本类型：直接转换
      return String(arg)
    }
  })
  const msg = `[${timeStr}] ${processedArgs.join(' ')}`
  // 判断是否在 Web 浏览器环境（PC 或手机 H5 浏览器）
  if (typeof navigator !== 'undefined' && /Chrome|Safari|Firefox/.test(navigator.userAgent)) {
    switch (level) {
    case 'debug': console.debug(msg);break
    case 'info': console.info(msg);break
    case 'warn': console.warn(msg);break
    case 'error': console.error(msg);break
	 //如果 level 不是这些 → 默认调用 info 级别（通过递归调用 myLog）
    default: myLog('info', msg)
    }
  }
  // 判断是否在 App端, 使用 HBuilder 的 plus.runtime.log 打印日志（映射到 Android Logcat / iOS Xcode）
	 else if (typeof plus !== 'undefined' && plus.runtime && plus.runtime.log) {
    // 这里 plus.runtime.log 不分等级，我们手动添加level前缀来实现区分
    plus.runtime.log(`[${level.toUpperCase()}] ${msg}`)
  } else {
  // 如果既不是浏览器，也不是 plus.runtime.log（比如某些特殊平台），再次 fallback 调用 myLog("info", msg)
    myLog('info',`[${level.toUpperCase()}] ${msg}`)
  }
} 