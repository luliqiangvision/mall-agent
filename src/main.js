// main.js - 项目入口文件
// 引入Vue框架
import { createApp } from 'vue'
// 引入根组件App
import App from './App.vue'
// 引入全局状态管理store
import store from './store'

/**
 * 全局消息提示方法
 * 全局工具方法 定义全局消息提示方法msg，方便全局调用统一的提示框
 * @param {string} title - 提示的内容文本
 * @param {number} duration - 提示持续时间（毫秒），默认1500
 * @param {boolean} mask - 是否显示透明蒙层，防止触摸穿透，默认false
 * @param {string} icon - 图标类型，可选值：'none'（无图标）、'success'、'loading'等，默认'none'
 */
function msg(title, duration = 1500, mask = false, icon = 'none') {
  // 如果title为空则不显示提示
  if (Boolean(title) === false) {
    return
  }
  // 调用uni-app的showToast方法显示提示
  uni.showToast({
    title,
    duration,
    mask,
    icon
  })
}

/**
 * 获取上一个页面的Vue实例对象
 * @returns {object} prePage - 上一个页面的Vue实例对象
 */
function prePage() {
  // 获取当前页面栈
  const pages = getCurrentPages()
  // 获取上一个页面对象
  const prePage = pages[pages.length - 2]
  // #ifdef H5
  // H5端直接返回页面对象
  return prePage
  // #endif
  // 非H5端返回页面的$vm（Vue实例）
  return prePage.$vm
}

// 全局配置
// 关闭生产环境提示,后期这里要改造,多个环境有不同的配置  todo
// 创建 Vue 实例并挂载 - 这是整个应用的启动入口
const app = createApp(App)
// 挂载全局事件总线到Vue原型，方便组件间通信
app.config.globalProperties.$fire = app
// 挂载全局状态管理store到Vue原型
app.config.globalProperties.$store = store
// 挂载全局API方法到Vue原型，便于全局调用msg和prePage
app.config.globalProperties.$api = { msg, prePage }
App.mpType = 'app'// 设置App的mpType属性为'app'，标识为应用入口
app.mount('#app')// 挂载Vue实例，启动应用
