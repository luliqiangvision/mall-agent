import request from '@/utils/requestUtil'

// 登录接口
export function login(agentName, password) {
  return request({
    url: '/agent/login',
    method: 'post',
    data: {
      agentName,
      password
    }
  })
}

// 登出接口
export function logout(token) {
  return request({
    url: '/agent/logout',
    method: 'post',
    header: token ? {
      Authorization: token
    } : {}
  })
}

// 获取用户信息
export function getInfo() {
  return request({
    url: '/agent/info',
    method: 'get'
  })
}
