import Request from '@/js_sdk/luch-request/request.js'
import { CHAT_BASE_URL } from '@/utils/appConfig.js'
import { myLog } from '@/utils/log.js'

const http = new Request()

http.setConfig((config) => { /* 设置全局配置 */ 
  // CHAT_BASE_URL 只包含域名和端口，需要自己添加 http:// 协议头
  config.baseUrl = `http://${CHAT_BASE_URL}` /* 根域名不同 */
  config.header = {
    ...config.header,
  }
  return config
})

/**
 * 自定义验证器，如果返回true 则进入响应拦截器的响应成功函数(resolve)，否则进入响应拦截器的响应错误函数(reject)
 * 后端需要使用统一的泛型来约束
 * @param {number} statusCode - 请求响应体statusCode（只读）
 * @return {boolean} 如果为true,则 resolve, 否则 reject
 */
http.validateStatus = (statusCode) => {
  return statusCode === 200
}

http.interceptor.request((config, cancel) => { /* 请求之前拦截器 */ 
  const token = uni.getStorageSync('token') // 使用 token 作为 key
  if (token) {
    config.header = {
      Authorization: token,
      ...config.header,
    }
  }
  else {
    config.header = {
      ...config.header,
    }
  }
  /*
	if (!token) { // 如果token不存在，调用cancel 会取消本次请求，但是该函数的catch() 仍会执行
	  cancel('token 不存在') // 接收一个参数，会传给catch((err) => {}) err.errMsg === 'token 不存在'
	}
	*/
  return config
})

http.interceptor.response((response) => { /* 请求之后拦截器 */
  const res = response.data
  if (res.code !== 200) {
    // 提示错误信息
      uni.showToast({
        title: res.message,
      duration: 1500,
      })
    // 401未登录处理
    if (res.code === 401) {
      uni.showModal({
        title: '提示',
        content: '你已被登出，可以取消继续留在该页面，或者重新登录',
        confirmText: '重新登录',
        cancelText: '取消',
        success(res) {
          if (res.confirm) {
            uni.reLaunch({
              url: '/pages/login/index',
            })
          }
          else if (res.cancel) {
            myLog('info', '用户点击取消')
          }
        },
      })
    }
    return Promise.reject(response)
  }
  else {
    return response.data
  }
}, (response) => {
  // 提示错误信息
  myLog('info', 'response error', response)
  uni.showToast({
    title: response.errMsg,
    duration: 1500,
  })
  return Promise.reject(response)
})

export function request(options = {}) {
  return http.request(options)
}

export default request 