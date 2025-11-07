import { fileURLToPath, URL } from 'node:url'
import fs from 'fs'
import path from 'path'

import { defineConfig } from 'vite'
// 注释掉原来的插件，方便回退
import Components from 'unplugin-vue-components/vite'
// import UniPages from '@uni-helper/vite-plugin-uni-pages' 不要开启,否则它会覆盖你自己写的page.json,那样底部栏就没有了
import UniPlatform from '@uni-helper/vite-plugin-uni-platform'
import uni from '@dcloudio/vite-plugin-uni'
import JavaScriptObfuscator from 'javascript-obfuscator'
import { keyRewritePre, keyRewriteVue } from './build/vite-plugin-key-rewrite.js'


// 声明全局变量类型
declare global {
  const __APP_CONFIG__: any
}

/**
 * 加载Profile配置
 * 从环境变量 PROFILE 获取环境配置
 */
function loadProfileConfig() {
  // 从环境变量获取 PROFILE，没有指定则报错
  const profile = process.env.PROFILE
  
  if (!profile) {
    throw new Error('❌ 未指定环境配置！请使用以下命令之一：\n' +
      '  pnpm run dev:h5        # 开发环境\n' +
      '  pnpm run test:h5       # 测试环境\n' +
      '  pnpm run preProd:h5    # 预生产环境\n' +
      '  pnpm run prod:h5       # 生产环境')
  }
  
  console.log(`🔧 加载环境配置: ${profile}`)
  console.log(`📁 输出目录: dist/${profile}/build/h5`)
  
  const configPath = path.resolve(process.cwd(), `config/${profile}.properties`)
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`❌ 配置文件不存在: ${configPath}\n` +
      `可用的环境配置: dev, test, preProd, prod`)
  }
  
  // 读取properties文件
  const content = fs.readFileSync(configPath, 'utf-8')
  const config: any = {}
  
  // 解析properties格式
  content.split('\n').forEach(line => {
    line = line.trim()
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=')
      if (key && valueParts.length > 0) {
        config[key.trim()] = valueParts.join('=').trim()
      }
    }
  })
  
  console.log(`✅ 成功加载配置:`, {
    CHAT_BASE_URL: config.CHAT_BASE_URL,
    WS_BASE_URL: config.WS_BASE_URL,
    APP_TITLE: config.APP_TITLE,
    LOG_LEVEL: config.LOG_LEVEL,
    IP_LOOKUP_URL: config.IP_LOOKUP_URL
  })
  
  return config
}

// 加载当前环境的配置
const profileConfig = loadProfileConfig()

export default defineConfig({
  // 设置基础路径为 /agent-frontend/，所有静态资源路径会自动加上这个前缀
  base: '/agent-frontend/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 修复 vue-router 弃用警告：将 vue-router/dist 的导入重定向到 vue-router
      'vue-router/dist/vue-router.esm-bundler.js': 'vue-router'
    }
  },
  
  // 注入Profile配置到全局变量
  define: {
    __APP_CONFIG__: JSON.stringify(profileConfig)
  },
  css: {
    devSourcemap: process.env.PROFILE === 'dev', // 只有开发环境才生成sourcemap
    preprocessorOptions: {
      scss: {
        // additionalData: 会在每一个 lang="scss" 的 <style> 中自动追加这行 @import，你就不需要手动写了。@/uni.scss：表示你 src/uni.scss 文件中包含了全局 SCSS 变量（如 $font-lg）的定义
        additionalData: `@import "@/uni.scss";`
      }
    }
  },
  
  build: {
    outDir: `dist/${process.env.PROFILE}/build/h5`, // 根据环境输出到不同目录
    // 生产/测试/预发环境生成 hidden sourcemap（仅上传到错误平台，不随产物发布）
    sourcemap: process.env.PROFILE !== 'dev' ? 'hidden' : true,
    minify: 'terser', // 启用 terser 压缩
    terserOptions: {
      compress: {
        drop_console: process.env.PROFILE !== 'dev', // 生产环境移除console
        drop_debugger: true, // 移除debugger
      },
      mangle: {
        // 混淆变量名
        toplevel: true,
      },
    },
    rollupOptions: {
      onwarn(warning, warn) {
        // 构建时严格检查配置,预防语法有错误仍能成功启动
        // 将所有警告转为错误，阻止构建
        throw new Error(`构建错误: ${warning.message}`)
      }
    }
  },
  // 开发模式也启用严格检查
  esbuild: {
    sourcemap: process.env.PROFILE === 'dev', // 只有开发环境才生成sourcemap
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  },
  plugins: [
    // 最前置"源码预处理"（只改打包流，不落盘）：处理纯 JS/TS 源码
    keyRewritePre(),
    // 使用 unplugin-vue-components 替代 vite-plugin-uni-components
    Components({
      dts: false,  // 不生成 TypeScript 类型声明文件
      // 注意：这个插件可能无法自动导入 uni-app 的 <view>、<text> 等组件
      // 如果出现问题，需要手动导入或回退到原来的插件
    }),


    // 作用：处理不同平台的代码差异（H5、微信小程序、App 等）
    // 问题：会在编译时插入平台特定代码，改变源代码结构
    // 影响：禁用后可能需要手动处理平台差异，但断点功能正常
    UniPlatform(),

    // 作用：uni-app 的核心编译插件，编译 .vue 文件，处理 uni-app 语法
    // 说明：这是必需的，不能删除，否则项目无法运行
    uni(),

    // SFC 脚本虚拟模块改写（需在 uni() 之后，才能拿到 *.vue?type=script 模块）
    keyRewriteVue(),

    // 构建后移动 sourcemap 到 dist/<PROFILE>/sourcemaps，并确保 assets 下不残留 .map
    (function moveSourcemapsPlugin() {
      return {
        name: 'move-sourcemaps-plugin',
        apply: 'build',
        writeBundle() {
          const profile = process.env.PROFILE
          if (!profile || profile === 'dev') return
          const outDir = path.resolve(process.cwd(), `dist/${profile}/build/h5`)
          const srcAssetsDir = path.resolve(outDir, 'assets')
          const destDir = path.resolve(process.cwd(), `dist/${profile}/sourcemaps`)
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true })
          }
          // 递归移动 .map 文件到 dist/<profile>/sourcemaps，保留相对目录结构
          const moveMapsRecursively = (dir, relativeBase = '') => {
            if (!fs.existsSync(dir)) return
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
              const absPath = path.join(dir, entry.name)
              const relPath = path.join(relativeBase, entry.name)
              if (entry.isDirectory()) {
                moveMapsRecursively(absPath, relPath)
              } else if (entry.isFile() && entry.name.endsWith('.map')) {
                const destPath = path.join(destDir, relPath)
                const destPathDir = path.dirname(destPath)
                if (!fs.existsSync(destPathDir)) {
                  fs.mkdirSync(destPathDir, { recursive: true })
                }
                fs.renameSync(absPath, destPath)
              }
            }
          }
          moveMapsRecursively(srcAssetsDir)
          // 额外：根目录下也可能生成 .map（极少数情况）
          moveMapsRecursively(outDir)
          // 校验：assets 下不应再残留 .map
          const hasAnyMap = (dir) => {
            if (!fs.existsSync(dir)) return false
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
              const absPath = path.join(dir, entry.name)
              if (entry.isDirectory()) {
                if (hasAnyMap(absPath)) return true
              } else if (entry.isFile() && entry.name.endsWith('.map')) {
                return true
              }
            }
            return false
          }
          if (hasAnyMap(srcAssetsDir)) {
            throw new Error('构建安全校验失败：assets 目录中仍存在 .map 文件，请检查移动逻辑')
          }
        }
      }
    })(),

    // 非开发环境启用定向高强度混淆（仅对关键敏感文件）
    ...(process.env.PROFILE !== 'dev' ? [
      (function selectiveObfuscatePlugin() {
        const includeSources = [
          path.resolve(process.cwd(), 'src/api/login.js'),
          path.resolve(process.cwd(), 'src/api/ticket.js'),
        ]
        const includeSourcesNormalized = includeSources.map(p => p.replace(/\\/g, '/'))
        // 说明：混淆在 closeBundle 阶段执行，作为打包流水线"最后一步"生效（见下方 closeBundle），
        // 可避免在 renderChunk/generateBundle 之后被其他流程再次规范化/覆盖
        const obfuscatorOptions = {
          compact: true, // 移除多余空白与换行，减小体积、降低可读性
          identifierNamesGenerator: 'hexadecimal', // 标识符改为十六进制名称,作用对象：变量名、函数名、类名等 标识符,不会处理对象字面量里的 字符串 key
          renameGlobals: false, // 不重命名全局变量，避免与运行时/外部冲突
          // transformObjectKeys: true, // 将对象字面量的键名转为字符串字面量键名,就是加上'',因为 javascript-obfuscator 的其他混淆选项（比如 stringArray）只会处理字符串字面量,如果你不转成字符串，orderId: 会被认为是一个"安全的属性名"，不会进混淆流程。
          // stringArray: true, // 启用字符串提取到数组,这个在我们这里,有的没有替换到数组里,比如paymentRequest的orderId在混淆后还是出现了,变成了'orderId'
          rotateStringArray: true, // 打乱字符串数组访问顺序
          stringArrayEncoding: ['rc4'], // 对字符串数组进行 RC4 编码
          stringArrayThreshold: 1, // 进入字符串数组的比例（0~1），越高越混淆,就是key被替换的比例,比如orderId被替换的概率就是这里设置的
          controlFlowFlattening: true, // 启用控制流扁平化（较重，影响性能）
          controlFlowFlatteningThreshold: 0.15, // 控制流扁平化的应用比例
          deadCodeInjection: false, // 不插入死代码（开启会增大体积并拖慢）
          unicodeEscapeSequence: false, // 不将字符串转为 \uXXXX（体积更大，收益有限）
        } as const
        const selectedFileNames = new Set<string>()
        return {
          name: 'selective-obfuscate',
          apply: 'build',
          enforce: 'post' as const,
          // 第一步：仅标记需要混淆的产物（不直接改代码）
          generateBundle(_opts, bundle) {
            const shouldObfuscate = (chunk) => {
              if (chunk.type !== 'chunk' || !chunk.code) return false
              const moduleIds = Object.keys(chunk.modules || {})
              return moduleIds.some((id) => {
                const idNorm = id.replace(/\\/g, '/')
                return includeSourcesNormalized.some((inc) => idNorm.includes(inc))
              })
            }
            for (const fileName of Object.keys(bundle)) {
              const item = bundle[fileName]
              if (item.type === 'chunk' && shouldObfuscate(item)) {
                selectedFileNames.add(fileName)
                console.log(`[selective-obfuscate] marked ${fileName}`)
              }
            }
          },
          // 第二步：在 closeBundle（文件已写盘）读取目标产物 -> 混淆 -> 回写
          // 目的：确保混淆位于流程末尾，避免被其他插件或者流程的后续步骤再将代码"折回/覆盖"
          closeBundle() {
            const profile = process.env.PROFILE
            if (!profile || profile === 'dev') return
            const outDir = path.resolve(process.cwd(), `dist/${profile}/build/h5`)
            for (const fileName of selectedFileNames) {
              try {
                const absPath = path.join(outDir, fileName)
                if (!fs.existsSync(absPath)) continue
                const code = fs.readFileSync(absPath, 'utf-8')
                const result = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions as any)
                fs.writeFileSync(absPath, result.getObfuscatedCode(), 'utf-8')
                console.log(`[selective-obfuscate] obfuscated ${fileName} (closeBundle)`) 
              } catch (e) {
                console.warn(`[selective-obfuscate] failed on ${fileName}:`, e)
              }
            }
          }
        } as any
      })()
    ] : []),

  ],
})

