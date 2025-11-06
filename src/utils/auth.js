// Token 存储 key：统一使用 'token' 作为 key，更简洁且符合常见约定
const TokenKey = 'token'

export function getToken() {
  return uni.getStorageSync(TokenKey) || ''
}

export function setToken(token) {
  return uni.setStorageSync(TokenKey, token)
}

export function removeToken() {
  return uni.removeStorageSync(TokenKey)
}
