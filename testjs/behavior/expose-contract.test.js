// =========================================================================
// expose-contract.test.js —— 跨组件契约：实例调用 ↔ defineExpose 对账
//
// 运行：npm run test:behavior
// 背景：Options API 时代组件实例方法天然公开；转 <script setup> 后必须
// defineExpose，漏一个就是「静默空转」（?. 调用把 undefined 吞掉）——
// DynamicTable 的 beginRowsAnimWindow 曾这么坏了整轮（删行动画悄悄失效）。
// 本测试给这条契约上钉子：
//   · 模板里 ref="x" 挂在组件上 → script 对 x.value.M() 的调用必须 M ∈ 该组件 defineExpose；
//   · 跨文件调用（ctx 闭包携带的实例）回退到全局 expose 并集；
//   · defineExpose 的 getter/方法键全算（含 get rootEl() 形态）。
// =========================================================================
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '../../student-frontend/src')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|vue)$/.test(e.name)) out.push(p)
  }
  return out
}
const files = walk(SRC)
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/')

// Map/Date/DOM/回调闭包等「非组件实例」方法：调用它们不要求 defineExpose
const NON_INSTANCE_METHODS = new Set([
  // 数组/字符串/Map/Set
  'map', 'filter', 'find', 'findIndex', 'findLast', 'forEach', 'some', 'every', 'reduce', 'reduceRight',
  'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat', 'includes', 'indexOf', 'lastIndexOf',
  'join', 'split', 'sort', 'reverse', 'flat', 'flatMap', 'at', 'fill', 'copyWithin',
  'trim', 'toLowerCase', 'toUpperCase', 'padStart', 'padEnd', 'startsWith', 'endsWith', 'repeat',
  'charAt', 'charCodeAt', 'codePointAt', 'match', 'matchAll', 'replace', 'search', 'toString', 'valueOf',
  'toLocaleString', 'toFixed', 'toPrecision', 'has', 'get', 'set', 'keys', 'values', 'entries', 'clear',
  'add', 'delete', 'size',
  // 日期
  'getMonth', 'getFullYear', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getTime',
  // DOM / canvas
  'focus', 'blur', 'click', 'scrollIntoView', 'animate', 'remove', 'appendChild', 'insertBefore',
  'querySelector', 'querySelectorAll', 'getBoundingClientRect', 'contains', 'closest', 'matches',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'preventDefault', 'stopPropagation',
  'getContext', 'toDataURL', 'abort', 'scrollTo', 'getComputedStyle',
  // Promise
  'then', 'catch', 'finally',
  // 非组件的 ref 载荷：dialogCallback 的回调闭包 {confirm,cancel,extra}、serialSaver 句柄等
  'confirm', 'cancel', 'extra', 'request', 'busy', 'error', 'ok', 'msg',
])

// ---- 1) 收集每个组件的 defineExpose 键 ----
const exposeOf = new Map() // 文件 → Set
const globalExposed = new Set()
for (const f of files) {
  if (!f.endsWith('.vue')) continue
  const s = fs.readFileSync(f, 'utf8')
  const keys = new Set()
  for (const m of s.matchAll(/defineExpose\(\{([\s\S]*?)\}\)/g)) {
    const block = m[1]
    for (const g of block.matchAll(/get\s+([A-Za-z_$][\w$]*)\s*\(/g)) keys.add(g[1])
    // 逗号切段后取每段首标识符：foo / foo() {...} / foo: x 都覆盖（含末键）
    for (const part of block.split(',')) {
      const g = part.trim().match(/^(?:get\s+|async\s+)?([A-Za-z_$][\w$]*)/)
      if (g) keys.add(g[1])
    }
  }
  if (keys.size) {
    exposeOf.set(f, keys)
    for (const k of keys) globalExposed.add(k)
  }
}

// ---- 2) 模板 ref="x" → 组件（大写标签或组件标签）/ 原生元素 ----
const refToComponents = new Map() // refName → Set(组件文件)
const domRefNames = new Set()
for (const f of files) {
  if (!f.endsWith('.vue')) continue
  const s = fs.readFileSync(f, 'utf8')
  const tpl = (s.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''
  // 开始标签内同时有组件名（大写开头）与 ref="x"
  for (const m of tpl.matchAll(/<([A-Z][\w$]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\sref="([A-Za-z_$][\w$]*)"/g)) {
    const [, tag, , refName] = m
    // 组件文件解析：从 script 的 import 里找同名导入
    const imp = s.match(new RegExp("import\\s+" + tag + "\\s+from\\s+['\"]([^'\"]+)['\"]"))
    if (imp) {
      let p = path.normalize(path.join(path.dirname(f), imp[1]))
      if (!p.endsWith('.vue') && fs.existsSync(p + '.vue')) p += '.vue'
      if (fs.existsSync(p)) {
        if (!refToComponents.has(refName)) refToComponents.set(refName, new Set())
        refToComponents.get(refName).add(p)
      }
    }
  }
  // 原生标签上的 ref="x"
  for (const m of tpl.matchAll(/<([a-z][a-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\sref="([A-Za-z_$][\w$]*)"/g)) {
    domRefNames.add(m[3])
  }
}

// ---- 3) 扫描调用/访问点：name.value.M ----
function scanCalls() {
  const hits = []
  for (const f of files) {
    let s = fs.readFileSync(f, 'utf8')
    if (f.endsWith('.vue')) s = (s.match(/<script[^>]*>([\s\S]*?)<\/script>/) || [])[1] || ''
    s = s.split('\n').map((l) => (/(^\s*\/\/|\*\/\/)/.test(l) ? '' : l)).join('\n') // 去注释行
    for (const m of s.matchAll(/([A-Za-z_$][\w$]*)\.value\??\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      hits.push({ file: f, ref: m[1], method: m[2] })
    }
  }
  return hits
}

test('expose 契约：全库至少识别出既有 expose 与组件 ref（扫描器自检）', () => {
  assert.ok(globalExposed.has('beginRowsAnimWindow'), 'DynamicTable 的 expose 应被识别')
  assert.ok(globalExposed.has('focusInput'), 'AiComposer 的 expose 应被识别')
  assert.ok(refToComponents.size > 0, '应识别出模板里的组件 ref')
})

test('expose 契约：DynamicTable 必须暴露 beginRowsAnimWindow（删行/恢复动画，曾静默空转）', () => {
  const dt = [...exposeOf.keys()].find((f) => f.endsWith('DynamicTable.vue'))
  assert.ok(dt, 'DynamicTable.vue 应含 defineExpose')
  assert.ok(exposeOf.get(dt).has('beginRowsAnimWindow'))
})

test('expose 契约：每次 xxx.value.method() 调用，method 必须被 defineExpose', () => {
  const bad = []
  for (const { file, ref, method } of scanCalls()) {
    if (NON_INSTANCE_METHODS.has(method)) continue
    if (domRefNames.has(ref)) continue // 原生元素 ref：DOM 方法面不设限
    const targets = refToComponents.get(ref)
    if (targets) {
      // ref 能映射到具体组件：调的方法必须在那个组件的 expose 里
      const ok = [...targets].some((t) => (exposeOf.get(t) || new Set()).has(method))
      if (!ok) bad.push(`${rel(file)} → ${ref}.value.${method}()（${[...targets].map(rel).join('/')} 未暴露）`)
    } else {
      // 跨文件/ctx 携带的实例：回退全局并集
      if (!globalExposed.has(method)) bad.push(`${rel(file)} → ${ref}.value.${method}()（全局无任何组件暴露此方法）`)
    }
  }
  assert.deepEqual(bad, [], '以下调用没有 defineExpose 支撑（script setup 下会静默空转）：\n' + bad.join('\n'))
})

test('expose 契约：defineExpose 键不能为空集（组件被外部 ref 就得有暴露面）', () => {
  // 仅约束「模板里被 ref 的组件」：ref 了却什么都没暴露 = 白 ref（多半是转换遗漏）
  const suspicious = []
  for (const [refName, comps] of refToComponents) {
    for (const c of comps) {
      if (!exposeOf.has(c)) suspicious.push(`${refName} → ${rel(c)}（模板 ref 了但组件无 defineExpose）`)
    }
  }
  assert.deepEqual(suspicious, [], suspicious.join('\n'))
})
