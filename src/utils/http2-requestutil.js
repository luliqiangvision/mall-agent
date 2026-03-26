/**
 * HTTP/2.0 请求工具类
 * 专门用于已读接口等需要HTTP/2.0的请求
 * 跨平台支持：H5、App、小程序
 */

import { myLog } from './log.js'

/**
 * HTTP/2.0 请求工具类
 */
class Http2RequestUtil {
  constructor() {
    this.isSupported = false
    this.requestInterceptors = [] // 请求拦截器列表
    this.responseInterceptors = [] // 响应拦截器列表
    this.errorInterceptors = [] // 错误拦截器列表
    this.checkSupport()
    this.setupInterceptors() // 初始化拦截器
  }

  /**
   * 初始化拦截器（请求、响应、错误）
   */
  setupInterceptors() {
    // 请求拦截器：添加认证token
    this.addRequestInterceptor((config) => {
      const token = uni.getStorageSync('token') // 使用 token 作为 key
      if (token) {
        config.header = {
          ...config.header,
          Authorization: token
        }
      }
      myLog('debug', 'HTTP/2.0 request interceptor applied', { hasToken: !!token })
      return config
    })
    
    // 响应拦截器：严格按照新的 JsonResult 格式处理 { success, data, errorCode, errorMessage }
    this.addResponseInterceptor((response) => {
      if (!response) return response

      const payload = response.data || {}

      // 要求服务端必须返回 JsonResult 风格的 success 字段
      if (payload && payload.success !== undefined) {
        const successFlag = Boolean(payload.success)

        if (!successFlag) {
          myLog('warn', 'HTTP/2.0 response business error:', { errorCode: payload.errorCode, errorMessage: payload.errorMessage })

          uni.showToast({
            title: payload.errorMessage || '请求失败',
            duration: 1500
          })

          // 鉴权异常处理（后端也可能通过 HTTP 状态码表达）
          if (response.statusCode === 401 || payload.errorCode === '401') {
            uni.showModal({
              title: '提示',
              content: '你已被登出，可以取消继续留在该页面，或者重新登录',
              confirmText: '重新登录',
              cancelText: '取消',
              success(res) {
                if (res.confirm) {
                  uni.reLaunch({
                    url: '/pages/login/index'
                  })
                }
              }
            })
          }

          throw new Error(payload.errorMessage || 'Request failed')
        }

        // 返回标准化数据
        return {
          success: true,
          data: payload.data,
          statusCode: response.statusCode
        }
      }

      // 严格模式：没有 success 字段视为格式错误
      myLog('error', 'HTTP/2.0 response missing required `success` field', { url: response.url, statusCode: response.statusCode })
      throw new Error('Invalid response format: missing `success` field')
    })
    
    // 错误拦截器：统一错误处理
    this.addErrorInterceptor((error) => {
      myLog('error', 'HTTP/2.0 error interceptor applied', error)
      
      // 显示错误提示
      uni.showToast({
        title: error.message || '请求失败',
        duration: 1500
      })
      
      return error
    })
    
    myLog('debug', 'HTTP/2.0 interceptors setup completed')
  }

  /**
   * 检查平台是否支持HTTP/2.0
   */
  checkSupport() {
    // 判断是否在浏览器环境
    if (typeof window !== 'undefined' && typeof window.fetch !== 'undefined') {
      this.isSupported = true
      myLog('debug', 'HTTP/2.0 support detected: Browser environment with fetch API')
    } else if (typeof uni !== 'undefined') {
      // 判断是否在 uni-app 环境
      const systemInfo = uni.getSystemInfoSync()
      myLog('debug', 'HTTP/2.0 platform check:', { 
        platform: systemInfo.platform,
        system: systemInfo.system,
        uniPlatform: systemInfo.uniPlatform 
      })
      
      // uni-app 平台支持情况：
      // - H5: 浏览器自动协商，可能支持
      // - App: 需要原生插件，通常不支持
      // - 小程序: 不支持
      if (systemInfo.uniPlatform === 'web' || systemInfo.uniPlatform === 'h5') {
        this.isSupported = true
        myLog('debug', 'HTTP/2.0 support detected: H5 platform')
      } else {
        this.isSupported = false
        myLog('debug', 'HTTP/2.0 not supported on this platform:', systemInfo.uniPlatform)
      }
    } else {
      this.isSupported = false
      myLog('debug', 'HTTP/2.0 support check failed: Unknown environment')
    }
  }

  /**
   * 添加请求拦截器
   * @param {Function} interceptor - 拦截器函数 (config) => config
   */
  addRequestInterceptor(interceptor) {
    if (typeof interceptor === 'function') {
      this.requestInterceptors.push(interceptor)
      myLog('debug', 'Request interceptor added')
    }
  }

  /**
   * 添加响应拦截器
   * @param {Function} interceptor - 拦截器函数 (response) => response
   */
  addResponseInterceptor(interceptor) {
    if (typeof interceptor === 'function') {
      this.responseInterceptors.push(interceptor)
      myLog('debug', 'Response interceptor added')
    }
  }

  /**
   * 添加错误拦截器
   * @param {Function} interceptor - 拦截器函数 (error) => error
   */
  addErrorInterceptor(interceptor) {
    if (typeof interceptor === 'function') {
      this.errorInterceptors.push(interceptor)
      myLog('debug', 'Error interceptor added')
    }
  }

  /**
   * 应用请求拦截器
   * @param {Object} config - 请求配置
   * @returns {Object} 处理后的配置
   */
  applyRequestInterceptors(config) {
    let processedConfig = config
    for (const interceptor of this.requestInterceptors) {
      processedConfig = interceptor(processedConfig)
    }
    return processedConfig
  }

  /**
   * 应用响应拦截器
   * @param {Object} response - 响应对象
   * @returns {Object} 处理后的响应
   */
  applyResponseInterceptors(response) {
    let processedResponse = response
    for (const interceptor of this.responseInterceptors) {
      processedResponse = interceptor(processedResponse)
    }
    return processedResponse
  }

  /**
   * 应用错误拦截器
   * @param {Error} error - 错误对象
   * @returns {Error} 处理后的错误
   */
  applyErrorInterceptors(error) {
    let processedError = error
    for (const interceptor of this.errorInterceptors) {
      processedError = interceptor(processedError)
    }
    return processedError
  }

  /**
   * 发送HTTP/2.0请求（仅用于已读接口）
   * @param {Object} options - 请求选项
   * @param {String} options.url - 请求URL
   * @param {Object} options.data - 请求数据
   * @param {String} options.method - 请求方法（默认POST）
   * @param {Object} options.header - 自定义请求头
   * @returns {Promise<Object>} 响应结果
   */
  async request(options = {}) {
    const { url, data, method = 'POST', header = {} } = options
    
    // 应用请求拦截器
    const config = this.applyRequestInterceptors({
      url,
      data,
      method,
      header
    })
    
    myLog('debug', 'HTTP/2.0 Request:', config)

    // 检查平台支持
    if (!this.isSupported) {
      myLog('warn', 'HTTP/2.0 not supported, falling back to HTTP/1.1')
      return this.fallbackToHttp1(config.url, config.data, config.method, config.header)
    }

    // 检查是否在浏览器环境（支持fetch API）
    if (typeof window !== 'undefined' && typeof window.fetch !== 'undefined') {
      return this.requestWithFetch(config.url, config.data, config.method, config.header)
    } else {
      // 使用 uni.request（虽然可能不支持HTTP/2.0，但会尝试）
      return this.requestWithUni(config.url, config.data, config.method, config.header)
    }
  }

  /**
   * 使用 fetch API 发送HTTP/2.0请求（浏览器环境）
   * @param {String} url - 请求URL
   * @param {Object} data - 请求数据
   * @param {String} method - 请求方法
   * @param {Object} header - 自定义请求头
   * @returns {Promise<Object>} 响应结果
   */
  async requestWithFetch(url, data, method, header) {
    try {
      myLog('debug', 'Sending HTTP/2.0 request with fetch API')
      
      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...header
        },
        body: JSON.stringify(data)
        // HTTP/2.0 会自动协商，浏览器会尽力使用最好的协议版本
        // 无需手动指定，交给浏览器和服务端协商
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()

      myLog('debug', 'HTTP/2.0 request successful', { status: response.status })

      // 严格接受 JsonResult 并返回其中的 data（不再包一层）
      if (!result || result.success === undefined) {
        myLog('error', 'Invalid JSON response format from server (expected JsonResult)', { url, status: response.status })
        throw new Error('Invalid response format')
      }

      if (!result.success) {
        uni.showToast({ title: result.errorMessage || '请求失败', duration: 1500 })
        if (response.status === 401 || result.errorCode === '401') {
          uni.showModal({
            title: '提示',
            content: '你已被登出，可以取消继续留在该页面，或者重新登录',
            confirmText: '重新登录',
            cancelText: '取消',
            success(res) {
              if (res.confirm) {
                uni.reLaunch({ url })
              }
            }
          })
        }
        throw new Error(result.errorMessage || 'Request failed')
      }

      return result.data
    } catch (error) {
      myLog('error', 'HTTP/2.0 fetch request failed', error)
      
      // 应用错误拦截器
      throw this.applyErrorInterceptors(error)
    }
  }

  /**
   * 使用 uni.request 发送请求（可能降级到HTTP/1.1）
   * @param {String} url - 请求URL
   * @param {Object} data - 请求数据
   * @param {String} method - 请求方法
   * @param {Object} header - 自定义请求头
   * @returns {Promise<Object>} 响应结果
   */
  async requestWithUni(url, data, method, header) {
    try {
      myLog('debug', 'Sending request with uni.request (may fallback to HTTP/1.1)')
      
      // uni.request 本身不直接支持HTTP/2.0
      // 需要通过服务端协商，或者在uni-app配置中启用HTTP/2.0
      const response = await new Promise((resolve, reject) => {
        uni.request({
          url: url,
          method: method,
          data: data,
          header: {
            'Content-Type': 'application/json',
            // 尝试启用HTTP/2.0（服务端可能会忽略）
            ...header
          },
          success: (res) => {
            myLog('debug', 'uni.request success', { statusCode: res.statusCode })
            resolve(res)
          },
          fail: (err) => {
            myLog('error', 'uni.request failed', err)
            reject(err)
          }
        })
      })

      if (response.statusCode === 200) {
        const res = response.data || {}
        if (!res || res.success === undefined) {
          myLog('error', 'Invalid JSON response format from server (expected JsonResult)', { url, statusCode: response.statusCode })
          throw new Error('Invalid response format')
        }

        if (!res.success) {
          uni.showToast({ title: res.errorMessage || '请求失败', duration: 1500 })
          if (response.statusCode === 401 || res.errorCode === '401') {
            uni.showModal({
              title: '提示',
              content: '你已被登出，可以取消继续留在该页面，或者重新登录',
              confirmText: '重新登录',
              cancelText: '取消',
              success(resModal) {
                if (resModal.confirm) {
                  uni.reLaunch({ url })
                }
              }
            })
          }
          throw new Error(res.errorMessage || 'Request failed')
        }

        return res.data
      } else {
        throw new Error(`Request failed with status code: ${response.statusCode}`)
      }
    } catch (error) {
      myLog('error', 'uni.request failed', error)
      
      // 应用错误拦截器
      throw this.applyErrorInterceptors(error)
    }
  }

  /**
   * 降级到HTTP/1.1
   * @param {String} url - 请求URL
   * @param {Object} data - 请求数据
   * @param {String} method - 请求方法
   * @param {Object} header - 自定义请求头
   * @returns {Promise<Object>} 响应结果
   */
  async fallbackToHttp1(url, data, method, header) {
    myLog('debug', 'Falling back to HTTP/1.1', { url, method })
    
    try {
      const response = await new Promise((resolve, reject) => {
        uni.request({
          url: url,
          method: method,
          data: data,
          header: {
            'Content-Type': 'application/json',
            ...header
          },
          success: (res) => {
            myLog('debug', 'HTTP/1.1 request success', { statusCode: res.statusCode })
            resolve(res)
          },
          fail: (err) => {
            myLog('error', 'HTTP/1.1 request failed', err)
            reject(err)
          }
        })
      })

      if (response.statusCode === 200) {
        const res = response.data || {}
        if (!res || res.success === undefined) {
          myLog('error', 'Invalid JSON response format from server (expected JsonResult)', { url, statusCode: response.statusCode })
          throw new Error('Invalid response format')
        }

        if (!res.success) {
          uni.showToast({ title: res.errorMessage || '请求失败', duration: 1500 })
          throw new Error(res.errorMessage || 'Request failed')
        }

        return res.data
      } else {
        throw new Error(`Request failed with status code: ${response.statusCode}`)
      }
    } catch (error) {
      myLog('error', 'Fallback to HTTP/1.1 failed', error)
      
      // 应用错误拦截器
      throw this.applyErrorInterceptors(error)
    }
  }

  /**
   * 检查当前平台是否支持HTTP/2.0
   * @returns {Boolean} 是否支持
   */
  isSupportedPlatform() {
    return this.isSupported
  }
}

// 导出单例
let http2RequestUtilInstance = null

export function getHttp2RequestUtil() {
  if (!http2RequestUtilInstance) {
    http2RequestUtilInstance = new Http2RequestUtil()
  }
  return http2RequestUtilInstance
}

export default Http2RequestUtil

