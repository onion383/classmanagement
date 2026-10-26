/**
 * PDF 导出链路的内存泄漏体检
 *
 * 模拟真实导出：「每份字体子集化 → 交给 jsPDF 生成 PDF → 丢弃」，连做 20 次，
 * 每 5 次记录一次内存。判据：
 *   · external（V8 持有的外部内存）必须平稳 —— 它是泄漏最灵敏的指标；
 *   · rss 允许有波动（backing store 不即时 munmap），但不应单调上升到几十 MB。
 *
 * 关注点：每次导出都会新建一个 65MB 线性内存的 wasm 实例，以及一个 jsPDF 文档对象。
 * 若实例没被回收，20 次就是 +1.3GB，一眼能看出来。
 *
 * 跑法：node --expose-gc testjs/pdf-leak-probe.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { subsetWithExports } from '../../student-frontend/src/utils/hbSubset.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')
const require = createRequire(import.meta.url)
const { jsPDF } = require(path.join(ROOT, 'student-frontend/node_modules/jspdf/dist/jspdf.node.min.js'))
const autoTableMod = require(path.join(ROOT, 'student-frontend/node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.js'))
const autoTable = autoTableMod.default || autoTableMod.autoTable

const WASM = path.join(ROOT, 'student-frontend/src/wasm/hb-subset.wasm')
const FULL = path.join(ROOT, 'student-frontend/public/NotoSansSC-6.ttf')

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`
const mem = () => {
  const m = process.memoryUsage()
  return `rss ${mb(m.rss)}  external ${mb(m.external)}  heapUsed ${mb(m.heapUsed)}`
}
const settle = async () => {
  global.gc()
  global.gc()
  await new Promise((r) => setTimeout(r, 50))
}

const HEAD = ['姓名', '学号', '性别', '语文', '数学', '英语', '总分', '备注']
const SURNAME = '王李张刘陈杨黄赵周吴徐孙马朱胡林郭何高罗'
const GIVEN = '伟芳娜敏静丽强磊洋艳勇军杰娟涛明超秀霞平刚桂英华玉兰春小志建国文玥喆'
const makeBody = (n) => Array.from({ length: n }, (_, i) => [
  SURNAME[i % SURNAME.length] + GIVEN[(i * 7) % GIVEN.length] + GIVEN[(i * 13 + 5) % GIVEN.length],
  `2024${String(i).padStart(3, '0')}`, i % 2 ? '男' : '女',
  90 + (i % 11), 85 + (i % 13), 88 + (i % 9), 263 + (i % 30), i % 5 ? '正常' : '体育特长生'
])

// 编译产物缓存（对应 hbSubset.js 的 loadModule），实例每次新建、用完即弃
const wasmModule = await WebAssembly.compile(fs.readFileSync(WASM))
const fullTtf = fs.readFileSync(FULL)
const body = makeBody(50)
const text = HEAD.join('') + body.flat().join('') + '班级学生名单'

function exportOnce(i) {
  // 1) 子集化：新实例，函数返回即不可达
  const instance = new WebAssembly.Instance(wasmModule)
  instance.exports._initialize()
  const sub = subsetWithExports(instance.exports, fullTtf, text)
  // 2) 生成 PDF 后丢弃
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.addFileToVFS('f.ttf', Buffer.from(sub).toString('base64'))
  doc.addFont('f.ttf', 'F', 'normal')
  doc.addFont('f.ttf', 'F', 'bold')
  doc.setFontSize(16)
  doc.setFont('F', 'normal')
  doc.text(`导出 ${i}`, doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' })
  autoTable(doc, { head: [HEAD], body, startY: 22, theme: 'grid', styles: { font: 'F', fontSize: 9 } })
  return doc.output('arraybuffer').byteLength
}

console.log('起点                ', mem())
await settle()

const marks = []
for (let i = 1; i <= 20; i++) {
  exportOnce(i)
  if (i % 5 === 0) {
    await settle()
    const m = process.memoryUsage()
    marks.push({ i, external: m.external, rss: m.rss })
    console.log(`第 ${String(i).padStart(2)} 次导出后      `, mem())
  }
}

const first = marks[0]
const last = marks[marks.length - 1]
console.log(`\nexternal 变化: ${mb(first.external)} → ${mb(last.external)}（${((last.external - first.external) / 1024 / 1024).toFixed(1)}MB）`)
console.log(`rss 变化:      ${mb(first.rss)} → ${mb(last.rss)}（${((last.rss - first.rss) / 1024 / 1024).toFixed(1)}MB）`)
console.log(last.external - first.external < 8 * 1024 * 1024 ? '判定: 未见泄漏（external 平稳）' : '判定: 可疑增长，需复查')
