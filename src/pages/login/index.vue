<template>
	<view class="login-container">
		<view class="login-form-layout">
			<view class="login-header">
				<text class="login-title">客服系统</text>
			</view>
			
			<view class="form-wrapper">
				<view class="form-item">
					<view class="input-wrapper">
						<text class="input-icon">👤</text>
						<input
							v-model="loginForm.username"
							class="input"
							placeholder="请输入用户名"
							placeholder-class="input-placeholder"
							maxlength="20"
						/>
					</view>
				</view>
				
				<view class="form-item">
					<view class="input-wrapper">
						<text class="input-icon">🔒</text>
						<input
							v-model="loginForm.password"
							:type="pwdType"
							class="input"
							placeholder="请输入密码"
							placeholder-class="input-placeholder"
							@confirm="handleLogin"
							maxlength="20"
						/>
						<view class="show-pwd" @click="showPwd">
							<text class="pwd-icon">{{ pwdType === 'password' ? '👁️' : '👁️‍🗨️' }}</text>
						</view>
					</view>
				</view>
				
				<view class="form-item">
					<button 
						:loading="loading" 
						type="primary" 
						class="login-button"
						@click="handleLogin"
					>
						登录
					</button>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
import { myLog } from '@/utils/log.js'
import ChatHttpManager from '@/api/chat/chat-http.js'
import { getUnreadCountManager } from '@/api/chat/unread-count-manager.js'

export default {
	name: 'login',
	data() {
		return {
			loginForm: {
				username: 'admin',
				password: ''
			},
			loading: false,
			pwdType: 'password'
		}
	},
	onLoad() {
		// 检查是否已登录
		const token = uni.getStorageSync('token')
		if (token) {
			// 已登录，跳转到首页
			uni.switchTab({
				url: '/pages/home/index'
			})
		} else {
			// 尝试从缓存读取用户名
			const cachedUsername = uni.getStorageSync('username')
			if (cachedUsername) {
				this.loginForm.username = cachedUsername
			}
		}
	},
	methods: {
		showPwd() {
			if (this.pwdType === 'password') {
				this.pwdType = 'text'
			} else {
				this.pwdType = 'password'
			}
		},
		validateForm() {
			// 验证用户名（只检查是否为空）
			if (!this.loginForm.username || !this.loginForm.username.trim()) {
				uni.showToast({
					title: '请输入用户名',
					icon: 'none',
					duration: 2000
				})
				return false
			}
			
			// 验证密码
			if (!this.loginForm.password || this.loginForm.password.length < 3) {
				uni.showToast({
					title: '密码不能小于3位',
					icon: 'none',
					duration: 2000
				})
				return false
			}
			
			return true
		},
		// 获取聊天窗口列表（登录成功后调用）
		async getChatWindowList(agentId) {
			try {
				myLog('debug', '获取聊天窗口列表, agentId:', agentId)

				// 初始化HTTP管理器
				const chatHttpManager = new ChatHttpManager({
					conversationId: null,
					onMessageRenderCallback: (data) => {
						myLog('debug', '收到获取聊天窗口列表响应:', data)
						if (data.interface === '/getChatWindowList' && data.payload.success) {
							// 初始化缓存对象
							if (!window.conversationCache) {
								window.conversationCache = {}
							}

							// 初始化未读数管理器（单例）
							const unreadCountManager = getUnreadCountManager()

							// 遍历所有会话数据，存储到缓存并统计未读数
							const conversations = data.payload.conversations || {}
							let totalUnread = 0

							for (const [conversationId, viewData] of Object.entries(conversations)) {
								// 统计未读消息数
								totalUnread += viewData.unreadCount || 0

								// 从 shop 对象中读取店铺信息
								const shop = viewData.shop || {}
								const shopId = shop.shopId
								const messages = viewData.messages || []  // 所有消息（不仅是未读的）

								// 缓存消息数据到 window.conversationCache（供后续聊天窗口使用）
								if (shopId) {
									// 计算 clientMaxServerMsgId
									let clientMaxServerMsgId = 0
									if (messages.length > 0) {
										const latestMsg = messages[messages.length - 1]
										clientMaxServerMsgId = latestMsg.serverMsgId || 0
									}

									window.conversationCache[shopId] = {
										conversationId: conversationId,
										messages: messages,  // 存储所有返回的消息数据
										clientMaxServerMsgId: clientMaxServerMsgId,
										shopInfo: shop  // 缓存店铺信息
									}
									myLog('debug', `缓存店铺 ${shopId} 的消息，数量:`, messages.length, 'clientMaxServerMsgId:', clientMaxServerMsgId)
								}

								// 将未读数存储到 unreadCountManager
								unreadCountManager.setUnreadCount(conversationId, viewData.unreadCount || 0)
							}

							myLog('debug', '总未读消息数:', totalUnread)

							// 立即更新 tabBar badge，让用户看到未读消息红点
							this.updateTabBarBadge(totalUnread)

							myLog('debug', '已将消息存储到 conversationCache')
							myLog('debug', '已将未读数存储到 unreadCountManager')
						}
					},
					onError: (error) => {
						myLog('error', '获取聊天窗口列表失败:', error)
					}
				})

				// 调用获取聊天窗口列表接口
				await chatHttpManager.getChatWindowList({
					userId: agentId  // API参数名仍为userId，但值使用agentId
				})
			} catch (error) {
				myLog('error', '获取聊天窗口列表失败:', error)
				// 不阻断登录流程，静默失败
			}
		},
		// 更新 tabBar badge（显示未读消息数）
		// 注意：登录页面不是 TabBar 页面，所以这里只缓存数据，不直接更新 badge
		// badge 会在跳转到首页后，由首页的 onShow 方法从缓存读取并更新
		updateTabBarBadge(count) {
			// 将未读数存储到缓存，让 TabBar 页面（首页或聊天列表页）自己更新 badge
			try {
				uni.setStorageSync('totalUnreadCount', count)
				myLog('debug', `已缓存未读数到本地: ${count}，将在切换到 TabBar 页面后更新 badge`)
			} catch (e) {
				myLog('debug', '缓存未读数失败', e)
			}
			// 不在这里调用 setTabBarBadge，因为登录页面不是 TabBar 页面，会报错
		},
		handleLogin() {
			if (!this.validateForm()) {
				return
			}
			
			this.loading = true
			
		// 调用 Vuex action
		this.$store.dispatch('Login', this.loginForm).then(() => {
			this.loading = false
			// 缓存用户名
			uni.setStorageSync('username', this.loginForm.username)
			
			myLog('info', '登录成功')
			uni.showToast({
				title: '登录成功',
				icon: 'success',
				duration: 1500
			})
			
			// 登录成功后调用获取聊天窗口列表接口（获取聊天列表）
			const userInfo = uni.getStorageSync('userInfo')
			if (userInfo && userInfo.agentId) {
				this.getChatWindowList(userInfo.agentId)
			}
			
			// 跳转到首页
			setTimeout(() => {
				uni.switchTab({
					url: '/pages/home/index'
				})
			}, 1500)
		}).catch((error) => {
				this.loading = false
				myLog('error', '登录失败', error)
				const errorMsg = error?.message || error?.errMsg || '登录失败，请重试'
				uni.showToast({
					title: errorMsg,
					icon: 'none',
					duration: 2000
				})
			})
		}
	}
}
</script>

<style lang="scss" scoped>
.login-container {
	min-height: 100vh;
	width: 100%;
	background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 40upx;
}

.login-form-layout {
	width: 100%;
	max-width: 720upx;
	background-color: #fff;
	border-radius: 16upx;
	padding: 80upx 60upx;
	box-shadow: 0 8upx 32upx rgba(0, 0, 0, 0.1);
	border-top: 10upx solid #409EFF;
}

.login-header {
	text-align: center;
	margin-bottom: 60upx;
	
	.login-title {
		font-size: 48upx;
		font-weight: bold;
		color: #409EFF;
	}
}

.form-wrapper {
	.form-item {
		margin-bottom: 40upx;
	}
}

.input-wrapper {
	position: relative;
	background-color: #f5f7fa;
	border-radius: 8upx;
	padding: 24upx 30upx;
	display: flex;
	align-items: center;
	border: 2upx solid #e4e7ed;
	transition: border-color 0.3s;
	
	&:focus-within {
		border-color: #409EFF;
	}
	
	.input-icon {
		font-size: 32upx;
		margin-right: 20upx;
		color: #909399;
	}
	
	.input {
		flex: 1;
		font-size: 28upx;
		color: #303133;
		background-color: transparent;
	}
	
	.show-pwd {
		padding: 10upx;
		font-size: 32upx;
		cursor: pointer;
		
		.pwd-icon {
			color: #909399;
		}
	}
}

.login-button {
	width: 100%;
	height: 88upx;
	line-height: 88upx;
	font-size: 32upx;
	margin-top: 20upx;
	background-color: #409EFF;
	color: #fff;
	border-radius: 8upx;
	border: none;
}

.input-placeholder {
	color: #c0c4cc;
}
</style>

