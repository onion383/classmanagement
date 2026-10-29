// =========================================================================
// sfc-conventions.test.js —— 架构约定钉子（防止清理成果悄悄回潮）
//
// 运行：npm run test:behavior
// 钉住 2026-10-29 全量清理的四条硬约定（违者即回潮，当日定稿见工作日志）：
//   1. 全库 <script setup>：不允许 Options API 的 export default { ... }；
//   2. 实例代理 API 清零：不允许 getCurrentInstance（Vapor 下返回 null）；
//   3. 登录态单点：token/currentUser 裸 localStorage 键只允许出现在 authStorage.js；
//   4. 模板静态 ref 必须有 script 侧声明（ref="x" ↔ const x = ref()）。
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

function scriptOf(s) {
  return (s.match(/<script[^>]*>([\s\S]*?)<\/script>/) || [])[1] || ''
}
// 去掉整行注释与行内注释（宽松：只求钉子不被注释误伤）
function stripComments(s) {
  return s.split('\n').map((l) => (/(^\s*\/\/)/.test(l) ? '' : l.replace(/\/\/.*$/, ''))).join('\n')
}

test('约定：全库无 Options API（export default { ... }）', () => {
  const bad = []
  for (const f of files) {
    if (!f.endsWith('.vue')) continue
    if (/export\s+default\s*\{/.test(stripComments(scriptOf(fs.readFileSync(f, 'utf8'))))) bad.push(rel(f))
  }
  assert.deepEqual(bad, [], '以下组件仍是 Options API：\n' + bad.join('\n'))
})

test('约定：无 getCurrentInstance（Vapor 下实例代理不存在）', () => {
  const bad = []
  for (const f of files) {
    const s = stripComments(fs.readFileSync(f, 'utf8'))
    if (/getCurrentInstance\s*\(/.test(s)) bad.push(rel(f))
  }
  assert.deepEqual(bad, [], '以下文件引用了 getCurrentInstance：\n' + bad.join('\n'))
})

test('约定：token/currentUser 裸 localStorage 键只在 authStorage.js', () => {
  const bad = []
  for (const f of files) {
    if (rel(f) === 'utils/authStorage.js') continue
    const s = stripComments(fs.readFileSync(f, 'utf8'))
    if (/localStorage\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*'(token|currentUser)'/.test(s)) bad.push(rel(f))
  }
  assert.deepEqual(bad, [], '以下文件绕过了 authStorage 直读裸键：\n' + bad.join('\n'))
})

test('约定：模板静态 ref=\"x\" 在 script 里有 ref 声明（防转换后绑定悬空）', () => {
  const bad = []
  for (const f of files) {
    if (!f.endsWith('.vue')) continue
    const s = fs.readFileSync(f, 'utf8')
    const tpl = (s.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''
    const script = stripComments(scriptOf(s))
    const names = new Set()
    for (const m of tpl.matchAll(/\sref="([A-Za-z_$][\w$]*)"/g)) names.add(m[1])
    for (const n of names) {
      // 直接声明：const x = ref(...)/computed(...)/useTemplateRef(...)
      // 解构声明：const { x, ... } = useXxx()（composable 返回的 ref）
      const declared =
        new RegExp('(?:const|let|var)\\s+' + n + '\\s*=\\s*(ref\\(|shallowRef\\(|useTemplateRef\\(|computed\\()').test(script) ||
        new RegExp('(?:const|let|var)\\s*\\{[^}]*\\b' + n + '\\b[^}]*\\}\\s*=').test(script)
      if (!declared) bad.push(`${rel(f)}: ref="${n}" 无 script 侧声明`)
    }
  }
  assert.deepEqual(bad, [], '以下模板 ref 缺声明（会被静默忽略，绑定悬空）：\n' + bad.join('\n'))
})
