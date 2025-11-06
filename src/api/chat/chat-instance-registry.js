// 简单的实例注册表：按会话键索引实例
// 说明：前端缺少反射与 Spring Bean 容器能力，无法在“被 import 的静态函数”里自动注入实例
// 因此采用显式注册：由业务实例在构造/销毁生命周期注册/注销自己

const instanceMap = new Map()

export function registerInstance(key, instance) {
  if (!key || !instance) return
  instanceMap.set(key, instance)
}

export function unregisterInstance(key) {
  if (!key) return
  instanceMap.delete(key)
}

export function getInstance(key) {
  return key ? instanceMap.get(key) : null
}


