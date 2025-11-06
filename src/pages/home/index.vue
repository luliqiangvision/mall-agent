<template>
	<view class="home-container">
		<view class="header">
			<view class="logout-btn" @click="handleLogout">
				<text class="logout-text">退出登录</text>
			</view>
		</view>
		
		<view class="content">
			<view class="welcome-section">
				<text class="welcome-text">欢迎使用客服系统</text>
				<text class="sub-text">您的专属客服助手</text>
			</view>
		</view>
	</view>
</template>

<script>
import { logout } from '@/api/login.js'
import { removeToken } from '@/utils/auth.js'
import { myLog } from '@/utils/log.js'

export default {
	name: 'home',
	data() {
		return {
			
		}
	},
	onLoad() {
		// 检查登录状态
		const token = uni.getStorageSync('token')
		if (!token) {
			// 未登录，跳转到登录页
			uni.reLaunch({
				url: '/pages/login/index'
			})
		}
	},
	onShow() {
		// 从缓存读取未读数并更新 badge（如果登录时已缓存）
		this.updateTabBarBadgeFromCache()
	},
	methods: {
		// 从缓存读取未读数并更新 badge
		updateTabBarBadgeFromCache() {
			try {
				const count = uni.getStorageSync('totalUnreadCount') || 0
				const tabIndex = 1 // "消息"标签的索引
				
				if (count > 0) {
					uni.setTabBarBadge({
						index: tabIndex,
						text: count > 99 ? '99+' : count.toString()
					})
				} else {
					uni.removeTabBarBadge({
						index: tabIndex
					})
				}
			} catch (error) {
				myLog('debug', '更新 tabBar badge 失败', error)
			}
		},
		async handleLogout() {
			uni.showModal({
				title: '提示',
				content: '确定要退出登录吗？',
				confirmText: '确定',
				cancelText: '取消',
				success: async (res) => {
					if (res.confirm) {
						try {
							const token = uni.getStorageSync('token')
							// 调用退出登录接口
							if (token) {
								await logout(token)
							}
							// 清除本地token
							removeToken()
							myLog('info', '退出登录成功')
							
							uni.showToast({
								title: '已退出登录',
								icon: 'success',
								duration: 1500
							})
							
							// 跳转到登录页
							setTimeout(() => {
								uni.reLaunch({
									url: '/pages/login/index'
								})
							}, 1500)
						} catch (error) {
							myLog('error', '退出登录失败', error)
							// 即使接口失败，也清除本地token并跳转
							removeToken()
							uni.reLaunch({
								url: '/pages/login/index'
							})
						}
					}
				}
			})
		}
	}
}
</script>

<style lang="scss" scoped>
.home-container {
	min-height: 100vh;
	background-color: #f5f5f5;
}

.header {
	position: relative;
	padding: 40upx 30upx;
	background-color: #fff;
	border-bottom: 1px solid #eee;
	display: flex;
	align-items: center;
	justify-content: flex-end;
	
	.logout-btn {
		padding: 12upx 24upx;
		background-color: #f5f5f5;
		border-radius: 8upx;
		cursor: pointer;
		transition: background-color 0.3s;
		
		&:active {
			background-color: #e0e0e0;
		}
		
		.logout-text {
			font-size: 26upx;
			color: #666;
		}
	}
}

.content {
	padding: 40upx 30upx;
}

.welcome-section {
	text-align: center;
	padding: 60upx 0;
	background-color: #fff;
	border-radius: 16upx;
	
	.welcome-text {
		display: block;
		font-size: 48upx;
		font-weight: bold;
		color: #409EFF;
		margin-bottom: 20upx;
	}
	
	.sub-text {
		display: block;
		font-size: 28upx;
		color: #909399;
	}
}
</style>
