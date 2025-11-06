# 客服系统前端

基于 Vue3 + Vite + Element Plus 的现代化客服系统前端项目。

## 🚀 技术栈

- **前端框架**: Vue 3.3.8 (Composition API)
- **构建工具**: Vite 5.0.0
- **UI框架**: Element Plus 2.4.4
- **状态管理**: Pinia 2.1.7
- **路由管理**: Vue Router 4.2.5
- **HTTP客户端**: Axios 1.6.0
- **图表库**: ECharts 5.4.3 + Vue-ECharts 6.6.1
- **样式预处理**: SCSS
- **包管理**: pnpm

## 📁 项目结构

```
src/
├── api/           # API接口层
├── assets/        # 静态资源
├── components/    # 公共组件
├── icons/         # SVG图标系统
├── router/        # 路由配置
├── stores/        # Pinia状态管理
├── styles/        # 全局样式
├── utils/         # 工具函数
└── views/         # 页面组件
```

## 🔧 环境配置

项目支持多环境配置，通过 `PROFILE` 环境变量控制：

- **开发环境**: `pnpm run dev`
- **测试环境**: `pnpm run build:test`
- **预生产环境**: `pnpm run build:preprod`
- **生产环境**: `pnpm run build`

配置文件位于 `config/` 目录下，支持以下配置项：
- `BASE_API`: API基础地址
- `APP_TITLE`: 应用标题
- `LOG_LEVEL`: 日志级别
- `WS_URL`: WebSocket地址

## 🚀 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发环境启动

```bash
pnpm run dev
```

### 构建生产版本

```bash
pnpm run build
```

## 📋 功能模块

### 已实现功能
- ✅ 用户登录/登出
- ✅ 权限控制
- ✅ 响应式布局
- ✅ 多环境配置
- ✅ 代码混淆
- ✅ 路由守卫
- ✅ 状态管理

### 待实现功能
- 🔄 实时聊天系统
- 🔄 工单管理
- 🔄 知识库
- 🔄 客户管理
- 🔄 员工管理
- 🔄 统计分析

## 🎨 设计特点

### 架构设计
- **模块化**: 按功能模块组织代码
- **组件化**: 可复用的UI组件
- **类型安全**: 支持TypeScript（可选）
- **响应式**: 适配不同屏幕尺寸

### 样式系统
- **SCSS变量**: 统一的颜色和尺寸变量
- **混入**: 常用的样式混入
- **主题定制**: Element Plus主题定制
- **动画**: 流畅的过渡动画

### 构建优化
- **代码分割**: 按需加载
- **资源压缩**: 生产环境代码混淆
- **SourceMap**: 开发环境调试支持
- **静态资源**: 自动复制和优化

## 🔒 权限控制

- 基于Token的身份验证
- 动态路由生成
- 角色权限控制
- 路由守卫机制

## 📱 响应式设计

- 桌面端优先设计
- 移动端适配
- 侧边栏折叠
- 弹性布局

## 🛠️ 开发工具

- **ESLint**: 代码规范检查
- **Prettier**: 代码格式化
- **Husky**: Git钩子
- **Lint-staged**: 暂存区检查

## 📄 许可证

MIT License
