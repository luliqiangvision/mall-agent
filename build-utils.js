import fs from 'fs'
import path from 'path'

/**
 * 创建复制静态文件插件
 * 将 static 目录复制到构建输出目录
 */
export function createCopyStaticPlugin(profile) {
  return {
    name: 'copy-static-plugin',
    apply: 'build',
    writeBundle() {
      const outDir = path.resolve(process.cwd(), `dist/${profile}/build/h5`)
      const staticDir = path.resolve(process.cwd(), 'static')
      
      if (fs.existsSync(staticDir)) {
        const destStaticDir = path.join(outDir, 'static')
        
        // 递归复制目录
        const copyDir = (src, dest) => {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true })
          }
          
          const entries = fs.readdirSync(src, { withFileTypes: true })
          
          for (const entry of entries) {
            const srcPath = path.join(src, entry.name)
            const destPath = path.join(dest, entry.name)
            
            if (entry.isDirectory()) {
              copyDir(srcPath, destPath)
            } else {
              fs.copyFileSync(srcPath, destPath)
            }
          }
        }
        
        copyDir(staticDir, destStaticDir)
        console.log(`📁 复制静态文件: static -> ${destStaticDir}`)
      }
    }
  }
}
