const js = require('@eslint/js')
const vue = require('eslint-plugin-vue')
const globals = require('globals')

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.vue'],
    plugins: {
      vue
    },
    rules: {
      ...vue.configs.recommended.rules,
      'vue/no-unused-components': 'warn',
      'vue/valid-template-root': 'error',
      'vue/no-unused-vars': 'warn'
    }
  },
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        // 浏览器环境
        ...globals.browser,
        // uni-app 全局变量
        uni: 'readonly',
        plus: 'readonly',
        // 其他全局变量
        console: 'readonly',
        navigator: 'readonly',
        window: 'readonly',
        document: 'readonly'
      }
    },
    rules: {
      // 基本规则
      'no-undef': 'error',
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'no-debugger': 'warn',
      
      // 代码风格
      'indent': ['error', 2],
      'quotes': ['error', 'single'],
      'semi': ['error', 'never'],
      'comma-dangle': ['error', 'never'],
      
      // 安全性
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error'
    }
  }
]

