<script>
/**
 * vuex管理登陆状态，具体可以参考官方登陆模板示例
 * App.vue - 应用根组件，处理全局生命周期和状态
 */
import {
	mapMutations
} from 'vuex';
import { myLog } from '@/utils/log.js';
import { getShopChatManager } from '@/api/chat/shop-chat-manager.js';

export default {
	methods: {
		...mapMutations(['login']) // 映射Vuex的login mutation
	},
	onLaunch: function () {
		const ua = navigator.userAgent;
		myLog("info", '内核标识 →', ua.match(/TBS\/\d+/)?.[0] || '系统内核');
		// 预期输出："TBS/xxxxx"(X5版本号)

		// 应用启动时执行 - 恢复用户登录状态
		const token = uni.getStorageSync('token')
		const userInfo = uni.getStorageSync('userInfo') || {}
		
		// 判断本地是否有用户登录信息（userInfo对象中有id属性且为真）
		// userInfo.id 通常代表用户唯一标识，只有已登录用户才会有id
		if (token && userInfo && userInfo.id) {
			//读取userInfo去更新登录状态
			this.login({
				userInfo: userInfo,
				token: token,
				roles: userInfo.roles || []
			}) // 调用Vuex mutation更新登录状态
		}

	},
	onShow: function () {
		/**
		 * 应用显示时触发（生命周期钩子）
		 * 触发时机：
		 *   - 应用启动后进入前台时
		 *   - 应用从后台切回前台时
		 * 常见用途：
		 *   - 每次用户回到应用时刷新数据、检测登录状态、统计埋点等
		 */
		// 应用显示时执行
		myLog("info", 'App Show');
	},
	onHide: function () {
		/**
		 * 应用隐藏时触发（生命周期钩子）
		 * 触发时机：
		 *   - 应用从前台切到后台时（如按Home键、切到其他App）
		 * 常见用途：
		 *   - 保存数据、暂停定时器、统计埋点等
		 */
		// 应用隐藏时执行
		myLog("info", 'App Hide');
	},
	onExit: function () {
		myLog("info", 'App Exit - Cleaning up shop chat managers');
		try {
			const shopChatManager = getShopChatManager();
			shopChatManager.destroyAllSessions();
			myLog("info", 'All shop chat sessions cleaned up');
		} catch (error) {
			myLog("error", 'Failed to cleanup shop chat sessions', error);
		}
	},
}
</script>

<style lang='scss'>
/*
	全局公共样式和字体图标
*/
view,
scroll-view,
swiper,
swiper-item,
cover-view,
cover-image,
icon,
text,
rich-text,
progress,
button,
checkbox,
form,
input,
label,
radio,
slider,
switch,
textarea,
navigator,
audio,
camera,
image,
video {
	box-sizing: border-box;
}

/* 骨架屏替代方案 */
.Skeleton {
	background: #f3f3f3;
	padding: 20upx 0;
	border-radius: 8upx;
}

/* 图片载入替代方案 */
.image-wrapper {
	font-size: 0;
	background: #f3f3f3;
	border-radius: 4px;

	image {
		width: 100%;
		height: 100%;
		transition: .6s;
		opacity: 0;

		&.loaded {
			opacity: 1;
		}
	}
}

.clamp {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	display: block;
}

.common-hover {
	background: #f5f5f5;
}

/*边框*/
.b-b:after,
.b-t:after {
	position: absolute;
	z-index: 3;
	left: 0;
	right: 0;
	height: 0;
	content: '';
	transform: scaleY(.5);
	border-bottom: 1px solid $border-color-base;
}

.b-b:after {
	bottom: 0;
}

.b-t:after {
	top: 0;
}

/* button样式改写 */
uni-button,
button {
	height: 80upx;
	line-height: 80upx;
	font-size: $font-lg + 2upx;
	font-weight: normal;

	&.no-border:before,
	&.no-border:after {
		border: 0;
	}
}

uni-button[type=default],
button[type=default] {
	color: $font-color-dark;
}

/* input 样式 */
.input-placeholder {
	color: #999999;
}

.placeholder {
	color: #999999;
}
</style>
