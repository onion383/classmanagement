/**
 * 动态字体子集：Node 侧验证
 *
 * 验证三件事：
 *   1. `utils/hbSubset.js` 的移植版（去掉 subset-font 的 Node-only wasm 加载）能产出可用子集；
 *   2. 产出的子集喂给 jsPDF 后，PDF 体积/耗时符合探针预期；
 *   3. `utils/pdfFont.js` 的 collectPdfText 是否把「实际绘制字符」收集齐 —— 漏一个字就是 PDF 里一块空白。
 *      子集会另存到 testjs/tmp/subset-out.ttf，由 font-subset-verify.py 用 fontTools 逐字核对 cmap。
 *
 * 跑法：node testjs/pdf-subset-verify.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { subsetWithExports } from '../../student-frontend/src/utils/hbSubset.js'
import { collectPdfText } from '../../student-frontend/src/utils/pdfFont.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')
const require = createRequire(import.meta.url)
const jsPDF = require(path.join(ROOT, 'student-frontend/node_modules/jspdf/dist/jspdf.node.min.js')).jsPDF
const autoTableMod = require(path.join(ROOT, 'student-frontend/node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.js'))
const autoTable = autoTableMod.default || autoTableMod.autoTable

const WASM = path.join(ROOT, 'student-frontend/src/wasm/hb-subset.wasm')
const FULL = path.join(ROOT, 'student-frontend/public/NotoSansSC-6.ttf')
const OUT = path.join(ROOT, 'testjs/tmp/subset-out.ttf')

const HEAD = ['姓名', '学号', '性别', '语文', '数学', '英语', '总分', '备注']
const SURNAME = '王李张刘陈杨黄赵周吴徐孙马朱胡林郭何高罗'
const GIVEN = '伟芳娜敏静丽强磊洋艳勇军杰娟涛明超秀霞平刚桂英华玉兰春小志建国文玥喆昇犇燚'
const makeBody = (n) => Array.from({ length: n }, (_, i) => [
  SURNAME[i % SURNAME.length] + GIVEN[(i * 7) % GIVEN.length] + GIVEN[(i * 13 + 5) % GIVEN.length],
  `2024${String(i).padStart(3, '0')}`, i % 2 ? '男' : '女',
  90 + (i % 11), 85 + (i % 13), 88 + (i % 9), 263 + (i % 30), i % 5 ? '正常' : '体育特长生'
])

const ms = (t) => `${t.toFixed(1)}ms`
const kb = (n) => `${(n / 1024).toFixed(0)}KB`

function buildPdf(body, ttfBuf) {
  const t0 = performance.now()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.addFileToVFS('NotoSansSC.ttf', Buffer.from(ttfBuf).toString('base64'))
  doc.addFont('NotoSansSC.ttf', 'NotoSansSC', 'normal')
  doc.addFont('NotoSansSC.ttf', 'NotoSansSC', 'bold')
  doc.setFontSize(16)
  doc.setFont('NotoSansSC', 'normal')
  doc.text('班级学生名单', doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' })
  autoTable(doc, { head: [HEAD], body, startY: 22, theme: 'grid', styles: { font: 'NotoSansSC', fontSize: 9 } })
  const bytes = doc.output('arraybuffer')
  return { size: bytes.byteLength, total: performance.now() - t0 }
}

console.log('=== 初始化 wasm（对应浏览器首次导出的一次性成本）===')
const t0 = performance.now()
const { instance } = await WebAssembly.instantiate(fs.readFileSync(WASM))
instance.exports._initialize()
const hb = instance.exports
console.log(`wasm ${kb(fs.statSync(WASM).size)}  初始化 ${ms(performance.now() - t0)}`)

const fullTtf = fs.readFileSync(FULL)
const body = makeBody(50)

// wasm 线性内存只增不减，这块是「导出过 PDF 之后」的常驻成本，必须有个数
console.log(`wasm 线性内存: 初始化后 ${kb(hb.memory.buffer.byteLength)}`)

// 模拟两个真实调用点的文本收集方式
const textExportFormats = collectPdfText('班级学生名单', '学生名单', HEAD, body)
const rowsLike = [
  ...body.map((cells) => ({ cells })),
  { _isPodium: true, label: '讲台' },
  { type: 'globalRest', label: '午休', time: '12:00-13:30' },
]
const textExcel = collectPdfText('课表.pdf', HEAD.map((n) => ({ name: n })), rowsLike)

console.log('\n=== 子集化 ===')
for (const [tag, text] of [['exportFormats 路径', textExportFormats], ['ExportExcel 路径', textExcel]]) {
  const uniq = new Set(text).size
  const s0 = performance.now()
  const sub = await subsetWithExports(hb, fullTtf, text)
  const s1 = performance.now()
  console.log(`${tag}: 文本 ${text.length} 字符 / ${uniq} 不重复 → 子集 ${kb(sub.byteLength)}  ${ms(s1 - s0)}`)
}

// 用 exportFormats 路径的文本生成最终子集，落盘给 Python 校验
const sub = await subsetWithExports(hb, fullTtf, textExportFormats)
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, Buffer.from(sub))
// 两条调用路径的文本不同，各存一份子集 + 一份「必须被覆盖的字符」，交给 Python 端逐字核对 cmap
const subExcel = await subsetWithExports(hb, fullTtf, textExcel)
fs.writeFileSync(path.join(path.dirname(OUT), 'subset-out-excel.ttf'), Buffer.from(subExcel))
fs.writeFileSync(path.join(path.dirname(OUT), 'subset-text.txt'), textExportFormats, 'utf8')
fs.writeFileSync(path.join(path.dirname(OUT), 'subset-text-excel.txt'), textExcel, 'utf8')

console.log('\n=== 导出 PDF（50 行 × 8 列）===')
const runs = []
for (let i = 0; i < 3; i++) runs.push(buildPdf(body, sub))
const med = runs.map((r) => r.total).sort((a, b) => a - b)[1]
console.log(`子集方案: ${ms(med)}  PDF ${kb(runs[0].size)}`)

// 对照：全量字体
const runsFull = []
for (let i = 0; i < 2; i++) runsFull.push(buildPdf(body, fullTtf))
console.log(`全量对照: ${ms(runsFull.map((r) => r.total).sort((a, b) => a - b)[0])}  PDF ${kb(runsFull[0].size)}`)

console.log('\n=== 生僻字是否被子集保住 ===')
for (const ch of ['张', '龘', '玥', '喆', '犇', '燚']) {
  const one = await subsetWithExports(hb, fullTtf, ch)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.addFileToVFS('f.ttf', Buffer.from(one).toString('base64'))
  doc.addFont('f.ttf', 'F', 'normal')
  doc.setFont('F', 'normal')
  doc.setFontSize(40)
  doc.text(ch, 20, 40)
  console.log(`  「${ch}」子集 ${one.byteLength}B → PDF ${kb(doc.output('arraybuffer').byteLength)}`)
}

console.log('\n子集已写入', OUT, '（交给 font-subset-verify.py 逐字核对 cmap）')
console.log(`wasm 线性内存: 跑完子集后 ${kb(hb.memory.buffer.byteLength)}（只增不减，属导出后的常驻成本）`)
