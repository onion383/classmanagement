// 组件级 Vapor 适配度扫描：逐个 .vue 统计与 Vapor 限制相关的特征，输出 markdown 表格。
// 判定依据（Vue 3.6 Vapor Mode 的限制）：
//   - 依赖 VNode 或组件实例代理的特性不可用：Options API / globalProperties / getCurrentInstance /
//     @vue:xxx 元素生命周期 / v-memo / 模板 ref 的 $el/$props/$attrs/$slots/$refs
//   - 第三方 VDOM 组件（@lucide/vue）在 Vapor 组件里必须走 interop
//   - render 函数 / JSX 组件天然是 VDOM，不能加 vapor
// 用法：node component-vapor-audit.mjs
import fs from 'node:fs'
import path from 'node:path'

const srcRoot = path.resolve('student-frontend/src')

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

const count = (text, re) => (text.match(re) || []).length

const rows = []
for (const file of walk(srcRoot)) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(srcRoot, file).split(path.sep).join('/')
  const tplMatch = src.match(/<template>([\s\S]*)<\/template>/)
  const tpl = tplMatch ? tplMatch[1] : ''
  const script = src.replace(/<template>[\s\S]*<\/template>/, '')

  const elCount = count(tpl, /<[a-zA-Z][\w-]*/g)
  const row = {
    file: rel,
    lines: src.split('\n').length,
    nodes: elCount,
    vfor: count(tpl, /v-for=/g),
    teleport: count(tpl, /<Teleport/g),
    transition: count(tpl, /<Transition(G|G\s|>|\s)/g),
    keepalive: count(tpl, /<KeepAlive/g),
    suspense: count(tpl, /<Suspense/g),
    // 直接 import @lucide/vue（IconGlyph 是统一封装，单独标注）
    lucide: /from '@lucide\/vue'/.test(src) ? 1 : 0,
    iconGlyph: count(tpl, /<IconGlyph/g),
    renderFn: /render\s*\(\s*\)\s*\{|render:\s*\(/.test(script) ? 1 : 0,
    slots: count(script + tpl, /\$slots/g),
    dynComp: count(tpl, /<component\b/g),
    vhtml: count(tpl, /v-html/g),
    compVModel: count(tpl, /<[A-Z][\w]*[^>]*v-model/g),
    stopMods: count(tpl, /\.stop\b|\.self\b/g),
    // 区分读/写：只有「写 DOM」才与 Vapor 的 DOM 所有权冲突。
    // 读（量尺寸、querySelector 判包含关系）两种模式下都没差别。
    domRead: count(script, /querySelector|getElementById|getBoundingClientRect|offsetWidth|offsetHeight|clientWidth|clientHeight/g),
    domWrite: count(script, /\.style\.[a-zA-Z]+\s*=|appendChild|insertBefore|removeChild|\.innerHTML\s*=|\.scrollTop\s*[+\-]?=/g),
    sortable: /sortablejs|new Sortable/.test(script) ? 1 : 0,
    expose: count(script, /defineExpose/g),
    emits: count(script, /defineEmits/g),
    asyncComp: count(script, /defineAsyncComponent/g),
  }
  rows.push(row)
}

// 分级：vapor 适配度
function grade(r) {
  const blockers = []
  if (r.renderFn) blockers.push('render函数')
  if (r.sortable) blockers.push('sortablejs')
  if (r.slots > 0) blockers.push('$slots')
  if (r.lucide) blockers.push('lucide直连')
  if (r.expose) blockers.push('defineExpose')
  if (r.domWrite > 0) blockers.push(`写DOM×${r.domWrite}`)
  // 重度写 DOM（拖拽、自绘、独立窗口）保持 VDOM
  if (r.renderFn || r.sortable || r.domWrite >= 5) return { level: 'C', why: blockers.slice(0, 2).join('/') }
  if (r.teleport > 0 && r.transition > 0) return { level: 'B', why: 'Teleport+Transition' }
  if (blockers.length) return { level: 'B', why: blockers.slice(0, 2).join('/') }
  if (r.teleport > 0 || r.transition > 0) return { level: 'B', why: 'Teleport/Transition' }
  return { level: 'A', why: '无阻塞项' }
}

for (const r of rows) Object.assign(r, grade(r))

// 按等级、再按渲染规模排序
const order = { A: 0, B: 1, C: 2 }
rows.sort((a, b) => order[a.level] - order[b.level] || b.nodes - a.nodes)

const head = '| 等级 | 组件 | 行数 | 元素 | v-for | Teleport | Transition | 图标 | render | $slots | 写DOM | 说明 |'
const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|'
const lines = rows.map((r) => {
  const icon = r.iconGlyph ? `IconGlyph×${r.iconGlyph}` : r.lucide ? 'lucide直连' : '-'
  return `| ${r.level} | ${r.file} | ${r.lines} | ${r.nodes} | ${r.vfor} | ${r.teleport} | ${r.transition} | ${icon} | ${r.renderFn ? 'Y' : ''} | ${r.slots || ''} | ${r.domWrite || ''} | ${r.why} |`
})

console.log([head, sep, ...lines].join('\n'))
console.log('')
const stat = { A: 0, B: 0, C: 0 }
for (const r of rows) stat[r.level]++
console.log(`统计：A=${stat.A} B=${stat.B} C=${stat.C} 合计=${rows.length}`)
