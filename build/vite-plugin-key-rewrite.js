// 混淆的历史尝试 & 失败背景（为何采用当前方案）
// 1) Babel 插件路线（@babel/core/transformSync）
//    - 把 key 改为 ["orderId"]：也不知道是没改过来还是在后续流程中经常被静态折叠/规范化回 'orderId'；关闭了transformObjectKeys之后,发现orderid是加了引号的'orderId',应该是后续流程中被规范化了；
//    => 结果：仍有明文字符串出现,这会导致一些敏感的方法会因为参数名而更容易被人猜到是干嘛的,存在安全隐患。
// 2) javascript-obfuscator 的 transformObjectKeys + stringArray
//    - transformObjectKeys 只是把裸键规范为字符串键，依赖后续 stringArray 才能真正抽走；
//    - stringArray 即便 stringArrayThreshold=1，仍有启发式/安全性跳过场景；
//    - 非最后一步执行时，仍可能被后续处理影响；
//    => 结果：在部分文件/场景下仍能看到 'orderId' 明文。
// 3) 现成 vite 插件的 include/exclude 难以精准命中 & 无法保证"最后一步混淆"
//    - 我们已将混淆放在 closeBundle，作为最后一步；
//    - 但为确保后续看不到明文键，本插件在更早（transform）即改写对象键；
//    - 两者配合：先改键 → 再混淆（stringArray 建议开启），显著降低还原可读性。
//
// 结论：当前方案在构建最前/合适阶段对脚本源码做"最小、可控"的改写（仅对象字面量键 → [k('key')])，说白了就是在源码打包落盘前做一次"只影响打包流"的预处理,就是偷鸡摸狗，
// 再由 closeBundle 混淆作为最后一步，且建议同时启用 stringArray（threshold=1 + encoding=rc4），以避免明文键或字符串在产物中出现。

// 安全性与风险控制（本文件代码已实现以下对策）：
// - 避免误伤注释：显式跳过 // 与 /* */
// - 避免误伤字符串：显式跳过 ' " ` 三类字符串与模板字符串
// - 仅限对象属性位置：要求前导为 { 或 , 且后随 :
// - 跳过 accessor：get/set 前缀不改，避免破坏 getter/setter
// - 跳过已计算属性：若前一非空白是 [ 则不改
// - 白名单目录：仅 src/api/**、src/pages/** 范围内处理；跳过 node_modules
// - .vue 仅处理脚本虚拟模块：只命中 .vue?vue&type=script，不碰模板/样式
// - 兜底：任何异常 try/catch 返回原代码，保证构建不中断
// - 可观测：命中打印 transformed 日志，便于排障与确认覆盖范围

// 说明：最前置"源码预处理"插件集合，仅作用于打包流，不落盘。
// - JS/TS：enforce='pre' 改写对象字面量键 → [k('key')]
// - .vue：仅处理脚本虚拟模块（?vue&type=script），不碰模板/样式
//
// 背景与时序说明：
// 本插件作为"源码预处理"位于流水线最前/合适阶段，仅改打包流中的代码，不写回磁盘；最终混淆保留在 closeBundle 最后一步执行。
//
// ⚠️ 为什么要在 ?vue&type=script 阶段改？
// 因为：
// 在这个阶段，你看到的就是 script 源码已经被编译成 纯 JS 的版本（setup 语法糖已经拆了）。
// 模板和样式还分开着，不会混在一起。
// 所以你可以安全地只改对象 key，不会误动模板里的 {{ orderId }}。
// 如果等到"全部合并之后"再动：
// 是可以的，但那时候所有 .vue 的脚本、模板、样式都已经混成一坨 JS chunk。
// 你要做 精准替换会困难得多（因为模板编译后的 render 函数里也可能出现冒号、key 的形式）

function createRewriter() {
  function rewriteKeys(source) {
    let i = 0
    const n = source.length
    let out = ''
    let changed = false
    let inS = false, inD = false, inT = false
    let inLC = false, inBC = false
    while (i < n) {
      const ch = source[i]
      const prev = source[i - 1]
      // 行注释
      if (!inS && !inD && !inT && !inBC && ch === '/' && source[i + 1] === '/') { inLC = true; out += ch; i++; out += source[i]; i++; continue }
      if (inLC) { out += ch; i++; if (ch === '\n') inLC = false; continue }
      // 块注释
      if (!inS && !inD && !inT && !inLC && ch === '/' && source[i + 1] === '*') { inBC = true; out += ch; i++; out += source[i]; i++; continue }
      if (inBC) { out += ch; i++; if (ch === '*' && source[i] === '/') { out += source[i]; i++; inBC = false } continue }
      // 字符串/模板字符串
      if (!inD && !inT && ch === '\'' && prev !== '\\') { inS = !inS; out += ch; i++; continue }
      if (!inS && !inT && ch === '"' && prev !== '\\') { inD = !inD; out += ch; i++; continue }
      if (!inS && !inD && ch === '`' && prev !== '\\') { inT = !inT; out += ch; i++; continue }
      if (inS || inD || inT) { out += ch; i++; continue }
      // 字符串键：'key' 或 "key"
      if (ch === '\'' || ch === '"') {
        const start = i
        const quote = ch
        let j = i + 1
        let key = ''
        while (j < n) {
          const cj = source[j]
          if (cj === '\\') { j += 2; continue }
          if (cj === quote) break
          key += cj; j++
        }
        if (j >= n) { out += ch; i++; continue }
        let k = j + 1
        while (k < n && /\s/.test(source[k])) k++
        if (source[k] !== ':') { out += ch; i++; continue }
        let b = start - 1
        while (b >= 0 && /\s/.test(source[b])) b--
        if (b < 0 || (source[b] !== '{' && source[b] !== ',')) { out += ch; i++; continue }
        out += `[k('${key}')]`
        changed = true
        i = j + 1
        while (i < n && /\s/.test(source[i])) { out += source[i]; i++ }
        out += ':'; i++
        continue
      }
      // 标识符键：ident:
      if (/[A-Za-z_$]/.test(ch)) {
        const start = i
        let j = i + 1
        while (j < n && /[A-Za-z0-9_$]/.test(source[j])) j++
        const ident = source.slice(start, j)
        if (ident === 'get' || ident === 'set') { out += ident; i = j; continue }
        let k = j
        while (k < n && /\s/.test(source[k])) k++
        if (source[k] !== ':') { out += ident; i = j; continue }
        let b = start - 1
        while (b >= 0 && /\s/.test(source[b])) b--
        if (b < 0 || (source[b] !== '{' && source[b] !== ',')) { out += ident; i = j; continue }
        let bb = b - 1
        while (bb >= 0 && /\s/.test(source[bb])) bb--
        if (bb >= 0 && source[bb] === '[') { out += ident; i = j; continue }
        out += `[k('${ident}')]`
        changed = true
        while (j < k) { out += source[j]; j++ }
        out += ':'; i = k + 1
        continue
      }
      out += ch; i++
    }
    if (changed && /\[k\('/.test(out)) {
      if (!/\bfunction\s+k\s*\(|\bconst\s+k\s*=|\blet\s+k\s*=|\bk\s*=\s*\(/.test(out)) {
        out = 'const k=(s)=>s;\n' + out
      }
    }
    return { code: out, changed }
  }
  return { rewriteKeys }
}

function createPlugins() {
  const getDebugFlag = () => {
    try {
      return !!(typeof globalThis !== 'undefined' && (globalThis.DEBUG_KEY_REWRITE_VUE === '1' || globalThis.DEBUG_KEY_REWRITE_VUE === true))
    } catch (_) { return false }
  }
  const debugVue = getDebugFlag()
  const { rewriteKeys } = createRewriter()

  const isScriptLikeQuery = (id) => {
    const qIndex = id.indexOf('?')
    if (qIndex === -1) return false
    const query = id.slice(qIndex)
    // 兼容多种形态：type=script / type=script-setup / setup / lang.ts|lang.js|lang.tsx|lang.jsx / lang=ts|lang=js
    if (/[?&]type=script\b/.test(query)) return true
    if (/[?&]type=script-setup\b/.test(query)) return true
    if (/[?&]setup(=true)?\b/.test(query)) return true
    if (/[?&]lang\.(t|j)sx?\b/.test(query)) return true
    if (/[?&]lang=(t|j)sx?\b/.test(query)) return true
    return false
  }

  const pre = {
    name: 'key-rewrite-pre',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const norm = id.replace(/\\/g, '/')
      if (!norm.includes('/src/')) return null
      if (norm.includes('/node_modules/')) return null
      if (!/\.(js|ts|mjs|cjs)$/.test(norm)) return null
      const include = [
        '/src/api/',
        '/src/pages/'
      ]
      if (!include.some(d => norm.includes(d))) return null
      try {
        const { code: out, changed } = rewriteKeys(code)
        if (changed && out !== code) {
          console.log(`[key-rewrite-pre] transformed ${norm}`)
          return { code: out, map: null }
        }
      } catch (_) {}
      return null
    }
  }

  const vueScript = {
    name: 'key-rewrite-vue-script',
    apply: 'build',
    enforce: 'post', // 等 SFC 拆分后，仅处理脚本虚拟模块
    transform(code, id) {
      const norm = id.replace(/\\/g, '/')
      // 调试：观察进入本钩子的所有 .vue 相关 id（仅在 DEBUG 开启时）
      if (debugVue && (norm.includes('.vue?') || norm.endsWith('.vue'))) {
        console.log(`[key-rewrite-vue:debug] incoming ${norm}`)
      }
      // 兼容：有的插件生成 *.vue?type=script（不含 ?vue），统一仅判断 base 是否 .vue 与 query 是否含脚本信号
      const base = norm.split('?')[0]
      if (!base.endsWith('.vue')) return null
      const isScriptLike = isScriptLikeQuery(norm)
      if (!isScriptLike) return null
      // 临时调试：观察实际 id 结构，便于进一步放宽/收紧匹配条件（构建稳定后可移除）
      if (debugVue) {
        console.log(`[key-rewrite-vue:debug] id=${norm}`)
      }
      const include = [
        '/src/pages/',
        '/src/components/',
        '/src/api/'
      ]
      if (!include.some(d => base.includes(d))) return null
      try {
        const { code: out, changed } = rewriteKeys(code)
        if (changed && out !== code) {
          console.log(`[key-rewrite-vue] transformed ${norm}`)
          return { code: out, map: null }
        }
      } catch (_) {}
      return null
    }
  }

  return { pre, vueScript }
}

export default function keyRewritePlugin() {
  const { pre, vueScript } = createPlugins()
  return [pre, vueScript]
}

export function keyRewritePre() {
  return createPlugins().pre
}

export function keyRewriteVue() {
  return createPlugins().vueScript
}

