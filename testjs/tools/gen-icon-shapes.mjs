// 从 @lucide/vue 提取 IconGlyph 用到的图标形状，生成可直接内联渲染的数据。
// 为什么不用 lucide 组件：它是 VDOM 组件，每个图标实例都是一个 interop 边界，
// 内联成普通 SVG 元素后，图标层不再依赖任何组件运行时。
//
// 用法：node testjs/tmp/gen-icon-shapes.mjs [--write]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve('student-frontend')
const sfcFile = path.join(root, 'src/components/base/IconGlyph.vue')
const outFile = path.join(root, 'src/components/base/IconGlyph.shapes.js')
const write = process.argv.includes('--write')

const sfc = fs.readFileSync(sfcFile, 'utf8')

// 1) 解析 MAP：key → lucide 原始组件名（MAP 里的 `lucide: 'Xxx'` 是唯一映射来源）
const mapBody = sfc.slice(sfc.indexOf('const MAP = {'), sfc.indexOf('\n}', sfc.indexOf('const MAP = {')))
const entries = [...mapBody.matchAll(/(\w+):\s*\{\s*lucide:\s*'(\w+)'/g)].map((m) => ({ key: m[1], comp: m[2] }))
if (!entries.length) {
  console.error('未能从 IconGlyph.vue 的 MAP 解析到 `lucide:` 字段，脚本无法确定图标来源')
  process.exit(1)
}

const lucide = await import(pathToFileURL(path.join(root, 'node_modules/@lucide/vue/dist/esm/lucide-vue.mjs')).href)
const vue = await import(pathToFileURL(path.join(root, 'node_modules/vue/index.mjs')).href)
const { renderToString } = await import(pathToFileURL(path.join(root, 'node_modules/vue/server-renderer/index.mjs')).href)

const SHAPE_TAGS = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']
const PLURAL = { path: 'paths', circle: 'circles', rect: 'rects', line: 'lines', polyline: 'polylines', polygon: 'polygons', ellipse: 'ellipses' }

function parseInner(html) {
  const inner = html.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
  const out = {}
  for (const tag of SHAPE_TAGS) out[PLURAL[tag]] = []
  let unknown = 0
  for (const m of inner.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g)) {
    const tag = m[1]
    const attrs = {}
    for (const a of m[2].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    if (!SHAPE_TAGS.includes(tag)) { unknown++; continue }
    out[PLURAL[tag]].push(attrs)
  }
  return { ...out, unknown }
}

// 规范化比对：按 tag+属性排序后比较集合。
// 不比较顺序——模板渲染按 tag 分组（path → circle → rect → line），会改变原顺序；
// lucide 图标全为 stroke 不填充、且统一 currentColor + 同 stroke-width，元素先后不影响观感。
function canon(shapes) {
  const items = []
  for (const tag of SHAPE_TAGS) {
    for (const attrs of shapes[PLURAL[tag]]) {
      items.push(`${tag}|${JSON.stringify(Object.entries(attrs).sort())}`)
    }
  }
  return items.sort().join('\n')
}
function canonFromHtml(inner) {
  const items = []
  for (const m of inner.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g)) {
    const attrs = {}
    for (const a of m[2].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    items.push(`${m[1]}|${JSON.stringify(Object.entries(attrs).sort())}`)
  }
  return items.sort().join('\n')
}

const shapes = {}
const problems = []
const missing = []

for (const e of entries) {
  const comp = lucide[e.comp]
  if (!comp) { missing.push(`${e.key}(lucide=${e.comp})`); continue }
  const app = vue.createSSRApp({ render: () => vue.h(comp, { size: 24, 'stroke-width': 2 }) })
  const html = await renderToString(app)
  const parsed = parseInner(html)
  const { unknown, ...shapeData } = parsed
  if (unknown) problems.push(`${e.key}: 含 ${unknown} 个未支持的子元素类型`)
  const inner = html.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
  if (canon(shapeData) !== canonFromHtml(inner)) problems.push(`${e.key}: 元素集合与原渲染不一致`)
  shapes[e.key] = shapeData
}

const total = Object.values(shapes).reduce(
  (n, s) => n + s.paths.length + s.circles.length + s.rects.length + s.lines.length + s.polylines.length + s.polygons.length + s.ellipses.length,
  0
)
console.log(`图标 ${Object.keys(shapes).length} 个，子元素合计 ${total} 个`)
console.log(`缺失图标：${missing.length ? missing.join('、') : '无'}`)
console.log(`一致性问题：${problems.length ? '\n  ' + problems.join('\n  ') : '无（全部通过重建比对）'}`)

if (write && !problems.length) {
  const lines = []
  lines.push('// 自动生成，勿手改：由 testjs/tmp/gen-icon-shapes.mjs 从 @lucide/vue 提取。')
  lines.push('// 用途：IconGlyph 内联渲染图标形状，避免每个图标都实例化一个 VDOM 组件。')
  lines.push('// 结构：{ [图标key]: { paths/circles/rects/lines/polylines/polygons/ellipses: [属性对象] } }')
  lines.push('export const ICON_SHAPES = {')
  for (const [key, s] of Object.entries(shapes)) {
    const groups = []
    for (const tag of SHAPE_TAGS) {
      const arr = s[PLURAL[tag]]
      if (!arr.length) continue
      const items = arr.map((a) => `{ ${Object.entries(a).map(([k, v]) => `${k}: '${v.replace(/'/g, "\\'")}'`).join(', ')} }`)
      groups.push(`      ${PLURAL[tag]}: [${items.join(', ')}],`)
    }
    lines.push(`  ${key}: {`)
    lines.push(...groups)
    lines.push('  },')
  }
  lines.push('}')
  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8')
  console.log(`\n已写入 ${path.relative(root, outFile)}（${(fs.statSync(outFile).size / 1024).toFixed(1)} KB）`)
} else {
  console.log(write ? '\n有问题，未写入' : '\n（dry-run，加 --write 写入）')
}
