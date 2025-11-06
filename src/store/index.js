import { createStore } from 'vuex'
import { myLog } from '@/utils/log.js'
import { login, logout, getInfo } from '@/api/login.js'

// store/index.js - Vuex 状态管理，管理全局应用状态
const store = createStore({
  state: {
    hasLogin: false, // 用户登录状态
    userInfo: {}, // 用户信息
    token: '', // 用户token
    roles: [], // 用户角色
    authVersion: 0 // 每次登录/登出递增，用于通知页面刷新
  },
  mutations: {
    // 登录mutation - 更新登录状态和用户信息
    login(state, provider) {
      state.hasLogin = true
      state.userInfo = provider.userInfo || provider
      state.token = provider.token || ''
      state.roles = provider.roles || []
      
      // 缓存用户登陆状态
      uni.setStorageSync('userInfo', state.userInfo)
      if (state.token) {
        uni.setStorageSync('token', state.token)
      }
      myLog('info', '登录成功', state.userInfo)
      state.authVersion++
    },
    // 登出mutation - 清除登录状态和用户信息
    logout(state) {
      state.hasLogin = false
      state.userInfo = {}
      state.token = ''
      state.roles = []
      uni.removeStorageSync('userInfo')
      uni.removeStorageSync('token')
      state.authVersion++
      myLog('info', '登出成功')
    },
    // 设置用户信息
    setUserInfo(state, userInfo) {
      state.userInfo = userInfo
      if (userInfo && userInfo.id) {
        state.hasLogin = true
      }
    },
    // 设置token
    SET_TOKEN(state, token) {
      state.token = token
      if (token) {
        uni.setStorageSync('token', token)
      }
    },
    // 兼容旧的 mutation 名
    setToken(state, token) {
      state.token = token
      if (token) {
        uni.setStorageSync('token', token)
      }
    },
    // 设置角色
    setRoles(state, roles) {
      state.roles = roles || []
    }
  },
  actions: {
    // 登录
    Login({ commit }, userInfo) {
      const username = userInfo.username.trim()
      return new Promise((resolve, reject) => {
        login(username, userInfo.password).then(response => {
          // 新的接口响应格式：CommonResult<Map<String, String>>
          // response 已经是 CommonResult 对象（因为响应拦截器返回了 response.data）
          // response.data 包含 { token: "xxx", tokenHead: "Bearer " }
          const tokenData = response.data || {}
          
          if (!tokenData.token) {
            myLog('error', '登录响应中缺少 token', response)
            reject(new Error(response.message || '登录失败：未获取到 token'))
            return
          }
          
          // 组合 tokenHead + token 作为完整的 token 字符串
          const tokenHead = tokenData.tokenHead || ''
          const token = tokenData.token || ''
          const tokenStr = tokenHead + token
          
          myLog('info', '登录成功，获取到 token', { 
            hasTokenHead: !!tokenHead, 
            tokenLength: token.length 
          })
          
          // 先保存 token
          commit('setToken', tokenStr)
          
          // 登录接口只返回 token，需要调用 /agent/info 接口获取用户信息
          // 新的接口响应格式：CommonResult<Map<String, Object>>
          // response.data 包含 { agentId, agentName, icon, menus, roles }
          getInfo().then(infoResponse => {
            const userInfoData = infoResponse.data || infoResponse
            
            // 根据新的接口格式，返回的数据包含：
            // - agentId: 客服ID（重要字段，用于后续业务逻辑）
            // - agentName: 客服名称（对应 mall-admin 的 username）
            // - icon: 头像（可能为 null）
            // - menus: 菜单列表（返回空列表）
            // - roles: 角色列表（使用 agentType 作为角色，可能为空数组）
            
            // 保存用户信息和 token
            commit('login', {
              userInfo: {
                username: userInfoData.agentName || username, // 使用 agentName 作为 username
                agentName: userInfoData.agentName || username,
                icon: userInfoData.icon || null,
                menus: userInfoData.menus || [],
                agentId: userInfoData.agentId, // 接口已返回 agentId
                ...userInfoData // 包含所有字段（agentId, agentName, icon, menus, roles）
              },
              token: tokenStr,
              roles: userInfoData.roles || [] // roles 可能是空数组，这是正常的
            })
            
            myLog('info', '登录成功，已获取用户信息', { 
              agentId: userInfoData.agentId,
              agentName: userInfoData.agentName,
              roles: userInfoData.roles,
              hasIcon: !!userInfoData.icon
            })
            
            resolve()
          }).catch(infoError => {
            myLog('error', '获取用户信息失败', infoError)
            // 即使获取用户信息失败，也保存 token 和基本信息
            commit('login', {
              userInfo: {
                username: username,
                agentName: username
              },
              token: tokenStr,
              roles: []
            })
            // 获取用户信息失败不影响登录流程，但记录错误
            resolve()
          })
        }).catch(error => {
          myLog('error', '登录失败', error)
          reject(error)
        })
      })
    },

    // 获取用户信息
    GetInfo({ commit, state }) {
      return new Promise((resolve, reject) => {
        getInfo().then(response => {
          // 新的接口响应格式：CommonResult<Map<String, Object>>
          // response.data 包含 { agentId, agentName, icon, menus, roles }
          const data = response.data || response
          
          // 根据新的接口格式：
          // - agentId: 客服ID（重要字段）
          // - agentName: 客服名称（对应 mall-admin 的 username）
          // - icon: 头像（可能为 null）
          // - menus: 菜单列表（返回空列表）
          // - roles: 角色列表（使用 agentType 作为角色，可能为空数组）
          
          // 注意：roles 可能为空数组，这是正常的（客服可能没有角色概念）
          // 但如果 roles 不为空，则设置角色
          if (data.roles && Array.isArray(data.roles) && data.roles.length > 0) {
            commit('setRoles', data.roles)
          }
          
          // 保存用户信息
          commit('setUserInfo', {
            username: data.agentName || '', // 使用 agentName 作为 username
            agentName: data.agentName || '',
            agentId: data.agentId, // 接口已返回 agentId
            icon: data.icon || null,
            menus: data.menus || [],
            ...data
          })
          
          resolve(response)
        }).catch(error => {
          myLog('error', '获取用户信息失败', error)
          reject(error)
        })
      })
    },

    // 登出
    LogOut({ commit, state }) {
      return new Promise((resolve, reject) => {
        logout(state.token).then(() => {
          commit('logout')
          resolve()
        }).catch(error => {
          reject(error)
        })
      })
    },

    // 前端 登出
    FedLogOut({ commit }) {
      return new Promise(resolve => {
        commit('logout')
        resolve()
      })
    }
  }
})

export default store

