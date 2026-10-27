// =========================================================================
// frontend.test.js —— 前端纯函数单元测试（合并自 chartHit / chartSpec / heatColor / pdfText / tableSearch）
// 运行：npm run test:units
// 说明：前端是 ESM 模块，统一用 pathToFileURL + 动态 import() 加载。
// =========================================================================
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const loadChartHit = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/chartHit.js')).href)
const loadChartSpec = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/composables/ai/aiMarkdown.js')).href)
const loadHeatColor = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/heatColor.js')).href)
const loadPdfFont = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/pdfFont.js')).href)
const loadTableSearch = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/tableSearch.js')).href)

// =========================================================================
// chartHit：AI 图表命中算法
// 覆盖「鼠标靠近自动选中最近的数据」（分带 / 饼图极角 / 图例行）。
// =========================================================================

// ===== 分带命中（柱状图 / 折线图）=====
// 绘图区 x0=36 x1=348，4 列 → 每列宽 78，列中心 75 / 153 / 231 / 309

test('hitBand 命中所在列', async () => {
  const { hitBand } = await loadChartHit()
  assert.equal(hitBand(75, 4, 36, 348), 0)
  assert.equal(hitBand(153, 4, 36, 348), 1)
  assert.equal(hitBand(231, 4, 36, 348), 2)
  assert.equal(hitBand(309, 4, 36, 348), 3)
})

test('hitBand 取最近列而非要求精确命中', async () => {
  const { hitBand } = await loadChartHit()
  // 偏左 20 仍算第 0 列（75 最近），偏右 20 仍算第 1 列（153 最近）
  assert.equal(hitBand(55, 4, 36, 348), 0)
  assert.equal(hitBand(133, 4, 36, 348), 1)
  assert.equal(hitBand(174, 4, 36, 348), 1)
  assert.equal(hitBand(194, 4, 36, 348), 2)
})

test('hitBand 越界返回 -1', async () => {
  const { hitBand } = await loadChartHit()
  // 明显在绘图区之外（离最近列中心超过 3/4 带宽）
  assert.equal(hitBand(10, 4, 36, 348), -1)
  assert.equal(hitBand(380, 4, 36, 348), -1)
})

test('hitBand 边界与空数据', async () => {
  const { hitBand } = await loadChartHit()
  assert.equal(hitBand(36, 4, 36, 348), 0)
  assert.equal(hitBand(348, 4, 36, 348), 3)
  assert.equal(hitBand(100, 0, 36, 348), -1)
  assert.equal(hitBand(100, 4, 348, 36), -1)
})

test('hitBand 单列时绘图区内都命中', async () => {
  const { hitBand } = await loadChartHit()
  assert.equal(hitBand(192, 1, 36, 348), 0)
  assert.equal(hitBand(40, 1, 36, 348), 0)
})

// ===== 横向柱状图行命中 =====
// 绘图区 y0=42 y1=210，4 行 → 每行高 42，行中心 63 / 105 / 147 / 189

test('hitRow 命中所在行', async () => {
  const { hitRow } = await loadChartHit()
  assert.equal(hitRow(63, 4, 42, 210), 0)
  assert.equal(hitRow(105, 4, 42, 210), 1)
  assert.equal(hitRow(147, 4, 42, 210), 2)
  assert.equal(hitRow(189, 4, 42, 210), 3)
})

test('hitRow 取最近行并支持容差', async () => {
  const { hitRow } = await loadChartHit()
  assert.equal(hitRow(50, 4, 42, 210), 0)
  assert.equal(hitRow(90, 4, 42, 210), 1)
  assert.equal(hitRow(190, 4, 42, 210), 3)
  // 明显超出绘图区（离最近行中心超过 3/4 行高）
  assert.equal(hitRow(25, 4, 42, 210), -1)
  assert.equal(hitRow(230, 4, 42, 210), -1)
})

test('hitRow 边界与空数据', async () => {
  const { hitRow } = await loadChartHit()
  assert.equal(hitRow(42, 4, 42, 210), 0)
  assert.equal(hitRow(210, 4, 42, 210), 3)
  assert.equal(hitRow(100, 0, 42, 210), -1)
  assert.equal(hitRow(100, 4, 210, 42), -1)
})

// ===== 饼图极角命中 =====

// 四等分：从正上方开始顺时针
const QUARTERS = [
  { i: 0, frac: 0.25 },
  { i: 1, frac: 0.25 },
  { i: 2, frac: 0.25 },
  { i: 3, frac: 0.25 },
]

test('hitPieSlice 正上方命中第一块', async () => {
  const { hitPieSlice } = await loadChartHit()
  assert.equal(hitPieSlice(110, 60, QUARTERS, 110, 118, 64), 0)
})

test('hitPieSlice 右方命中第二块', async () => {
  const { hitPieSlice } = await loadChartHit()
  assert.equal(hitPieSlice(170, 118, QUARTERS, 110, 118, 64), 1)
})

test('hitPieSlice 下方命中第三块', async () => {
  const { hitPieSlice } = await loadChartHit()
  assert.equal(hitPieSlice(110, 176, QUARTERS, 110, 118, 64), 2)
})

test('hitPieSlice 左方命中第四块', async () => {
  const { hitPieSlice } = await loadChartHit()
  assert.equal(hitPieSlice(50, 118, QUARTERS, 110, 118, 64), 3)
})

test('hitPieSlice 半径外不命中', async () => {
  const { hitPieSlice } = await loadChartHit()
  assert.equal(hitPieSlice(110, 0, QUARTERS, 110, 118, 64), -1)
  assert.equal(hitPieSlice(300, 118, QUARTERS, 110, 118, 64), -1)
})

test('hitPieSlice 外弹余量内仍能命中（径向外弹不改变极角）', async () => {
  const { hitPieSlice } = await loadChartHit()
  // 扇区 0 沿中线向上外弹 9，扇区外沿随之抬到 y=45（半径 73）
  // 用 tol=12 时仍应命中扇区 0
  assert.equal(hitPieSlice(110, 45, QUARTERS, 110, 118, 64, 12), 0)
})

test('hitPieSlice 跳过占比为 0 的扇区', async () => {
  const { hitPieSlice } = await loadChartHit()
  const withZero = [{ i: 0, frac: 0 }, { i: 1, frac: 0.5 }, { i: 2, frac: 0.5 }]
  // 上半圈归到第 1 块
  assert.equal(hitPieSlice(110, 60, withZero, 110, 118, 64), 1)
})

test('hitPieSlice 单项占满时命中唯一扇区', async () => {
  const { hitPieSlice } = await loadChartHit()
  const full = [{ i: 0, frac: 1 }]
  assert.equal(hitPieSlice(110, 60, full, 110, 118, 64), 0)
  assert.equal(hitPieSlice(170, 118, full, 110, 118, 64), 0)
})

// ===== 图例行命中 =====

test('hitLegendRow 命中对应行', async () => {
  const { hitLegendRow } = await loadChartHit()
  const rows = [52, 70, 88]
  assert.equal(hitLegendRow(200, 52, rows, 196), 0)
  assert.equal(hitLegendRow(260, 70, rows, 196), 1)
  assert.equal(hitLegendRow(200, 88, rows, 196), 2)
})

test('hitLegendRow 色块左侧 6px 内也算命中、左侧之外不命中', async () => {
  const { hitLegendRow } = await loadChartHit()
  const rows = [52]
  assert.equal(hitLegendRow(191, 52, rows, 196), 0)
  assert.equal(hitLegendRow(180, 52, rows, 196), -1)
})

test('hitLegendRow 行间取最近行', async () => {
  const { hitLegendRow } = await loadChartHit()
  const rows = [52, 70]
  // 61 距两行都是 9，取上面那行（先到先得）
  assert.equal(hitLegendRow(200, 61, rows, 196), 0)
  // 62 距下行更近
  assert.equal(hitLegendRow(200, 64, rows, 196), 1)
})

test('hitLegendRow 远离所有行不命中', async () => {
  const { hitLegendRow } = await loadChartHit()
  const rows = [52, 70]
  assert.equal(hitLegendRow(200, 160, rows, 196), -1)
})

// =========================================================================
// chartSpec：AI 图表数据解析（类型白名单、12 项上限、饼图 Top N + 「其他」）
// =========================================================================
const spec = (obj) => JSON.stringify(obj)

test('parseChartSpec 支持横向柱状图 barh', async () => {
  const { parseChartSpec } = await loadChartSpec()
  const data = parseChartSpec(spec({ type: 'barh', labels: ['张三', '李四'], values: [3, 1] }))
  assert.equal(data.type, 'barh')
  assert.deepEqual(data.labels, ['张三', '李四'])
  assert.deepEqual(data.values, [3, 1])
})

test('parseChartSpec 未知类型回退为 bar', async () => {
  const { parseChartSpec } = await loadChartSpec()
  const data = parseChartSpec(spec({ type: 'radar', labels: ['A'], values: [1] }))
  assert.equal(data.type, 'bar')
})

test('parseChartSpec 饼图不超过 6 项时保持原顺序', async () => {
  const { parseChartSpec } = await loadChartSpec()
  const data = parseChartSpec(spec({
    type: 'pie',
    labels: ['A', 'B', 'C', 'D', 'E', 'F'],
    values: [1, 2, 3, 4, 5, 6],
  }))
  assert.deepEqual(data.labels, ['A', 'B', 'C', 'D', 'E', 'F'])
  assert.deepEqual(data.values, [1, 2, 3, 4, 5, 6])
})

test('parseChartSpec 饼图超过 6 项时取前 5 + 其他', async () => {
  const { parseChartSpec } = await loadChartSpec()
  const data = parseChartSpec(spec({
    type: 'pie',
    labels: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    values: [8, 7, 6, 5, 4, 3, 2, 1],
  }))
  assert.deepEqual(data.labels, ['A', 'B', 'C', 'D', 'E', '其他'])
  assert.deepEqual(data.values, [8, 7, 6, 5, 4, 6])
})

test('parseChartSpec 饼图已有「其他」时并入同一个桶', async () => {
  const { parseChartSpec } = await loadChartSpec()
  const data = parseChartSpec(spec({
    type: 'pie',
    labels: ['A', 'B', 'C', 'D', 'E', 'F', '其他'],
    values: [1, 2, 3, 4, 5, 6, 7],
  }))
  assert.deepEqual(data.labels, ['F', 'E', 'D', 'C', 'B', '其他'])
  assert.deepEqual(data.values, [6, 5, 4, 3, 2, 8])
})

test('parseChartSpec 非饼图保留最多 12 项且不聚合', async () => {
  const { parseChartSpec } = await loadChartSpec()
  const labels = Array.from({ length: 15 }, (_, i) => `第${i + 1}项`)
  const values = Array.from({ length: 15 }, (_, i) => i + 1)
  const data = parseChartSpec(spec({ type: 'barh', labels, values }))
  assert.equal(data.labels.length, 12)
  assert.deepEqual(data.labels, labels.slice(0, 12))
  assert.deepEqual(data.values, values.slice(0, 12))
})

test('parseChartSpec labels/values 长度不一致或为空时按短的一边截断', async () => {
  const { parseChartSpec } = await loadChartSpec()
  const data = parseChartSpec(spec({ type: 'bar', labels: ['A', 'B', 'C'], values: [1, 2] }))
  assert.deepEqual(data.labels, ['A', 'B'])
  assert.deepEqual(data.values, [1, 2])
  assert.equal(parseChartSpec(spec({ type: 'bar', labels: [], values: [] })), null)
  assert.equal(parseChartSpec('not json'), null)
})

// =========================================================================
// heatColor：热力配色（权重表 / 座位指数共用）
// =========================================================================
test('weightHeatRgb 端点与钳制', async () => {
  const { weightHeatRgb } = await loadHeatColor()
  assert.deepEqual(weightHeatRgb(0), [239, 246, 255])   // 浅蓝
  assert.deepEqual(weightHeatRgb(1), [30, 58, 138])     // 深蓝
  assert.deepEqual(weightHeatRgb(-1), [239, 246, 255])  // 越界按 0 处理
  assert.deepEqual(weightHeatRgb(2), [30, 58, 138])     // 越界按 1 处理
})

test('weightHeatRgb 中间值单调变深', async () => {
  const { weightHeatRgb } = await loadHeatColor()
  const mid = weightHeatRgb(0.5)
  assert.ok(mid[0] < 239 && mid[0] > 30)
  assert.ok(mid[2] < 255 && mid[2] > 138)
})

test('weightHeatFg 浅底用深字、深底用白字', async () => {
  const { weightHeatFg } = await loadHeatColor()
  assert.equal(weightHeatFg(0), '#1E293B')
  assert.equal(weightHeatFg(1), '#FFFFFF')
})

// =========================================================================
// pdfText：PDF 文本收集
// 为什么专门测这个：collectPdfText 曾经用裸递归，遇到 `row.self = row` 这类自引用会 RangeError，
// 而它处在调用点的 try 内 → 异常被吞 → 字体没加载 → 退回 helvetica → 整份 PDF 中文静默乱码。
// =========================================================================

test('collectPdfText 收集嵌套表格里的字符串与数字', async () => {
  const { collectPdfText } = await loadPdfFont()
  const rows = [{ name: '张三', score: 95 }, { name: '李四', score: true }]
  const text = collectPdfText(rows, { title: '成绩单' })
  assert.ok(text.includes('张三'))
  assert.ok(text.includes('李四'))
  assert.ok(text.includes('成绩单'))
  assert.ok(text.includes('95'))
  assert.ok(text.includes('true'))
})

test('collectPdfText 只取值，不把对象键名算进文本', async () => {
  const { collectPdfText } = await loadPdfFont()
  const text = collectPdfText({ nameColumnHeader: '甲' })
  assert.ok(text.includes('甲'))
  assert.ok(!text.includes('nameColumnHeader'))
})

test('collectPdfText 忽略 null / undefined / 函数', async () => {
  const { collectPdfText } = await loadPdfFont()
  assert.doesNotThrow(() => collectPdfText(null, undefined, { a: null }, () => {}))
})

test('collectPdfText 遇自引用环不爆栈', async () => {
  const { collectPdfText } = await loadPdfFont()
  const row = { name: '王五' }
  row.self = row // 曾经的 RangeError 源头
  let text
  assert.doesNotThrow(() => { text = collectPdfText([row]) })
  assert.ok(text.includes('王五'))
})

test('collectPdfText 超深嵌套被深度上限截断，不爆栈', async () => {
  const { collectPdfText } = await loadPdfFont()
  let deep = { leaf: '深层文字' }
  for (let i = 0; i < 200; i++) deep = { child: deep }
  assert.doesNotThrow(() => collectPdfText(deep))
  // MAX_DEPTH=32，200 层早已截断，最底层的文字不应出现在子集里
  assert.ok(!collectPdfText(deep).includes('深层文字'))
})

test('collectPdfText 结果含兜底字符（PDF 内固定词的字形覆盖）', async () => {
  const { collectPdfText } = await loadPdfFont()
  const empty = collectPdfText('')
  assert.ok(empty.length > 0, '空入参也应返回兜底字符，否则固定词会出现空白色块')
  assert.equal(collectPdfText('甲'), '甲' + empty, '兜底字符应稳定附在末尾')
})

// =========================================================================
// tableSearch：表格关键字搜索（过滤 + 「搜索无结果」判定）
// =========================================================================
const ROWS = [
  { 姓名: '张三', 年级: '高一' },
  { 姓名: '李四', 年级: '高二' },
  { 姓名: '王五', 年级: '高一' },
]

test('filterRowsByKeyword：未选列或关键字为空时不过滤', async () => {
  const { filterRowsByKeyword } = await loadTableSearch()
  assert.equal(filterRowsByKeyword(ROWS, null, '张').length, 3)   // 没选列
  assert.equal(filterRowsByKeyword(ROWS, '姓名', '').length, 3)    // 关键字空
})

test('filterRowsByKeyword：子串匹配且忽略大小写', async () => {
  const { filterRowsByKeyword } = await loadTableSearch()
  assert.deepEqual(filterRowsByKeyword(ROWS, '姓名', '张').map(r => r.姓名), ['张三'])
  assert.deepEqual(filterRowsByKeyword(ROWS, '姓名', '五').map(r => r.姓名), ['王五'])
  const en = [{ name: 'Alice' }, { name: 'bob' }]
  assert.deepEqual(filterRowsByKeyword(en, 'name', 'ali').map(r => r.name), ['Alice'])
})

test('filterRowsByKeyword：单元格为 null/undefined 不匹配', async () => {
  const { filterRowsByKeyword } = await loadTableSearch()
  const rows = [{ a: 'x' }, { a: null }, { a: undefined }, { a: '' }]
  assert.deepEqual(filterRowsByKeyword(rows, 'a', 'x').map(r => r.a), ['x'])
})

test('isSearchNoResult：有数据但被筛光 → true', async () => {
  const { isSearchNoResult } = await loadTableSearch()
  assert.equal(isSearchNoResult(ROWS, [], '姓名', '查无此人'), true)
})

test('isSearchNoResult：搜到东西 → false', async () => {
  const { isSearchNoResult } = await loadTableSearch()
  assert.equal(isSearchNoResult(ROWS, [ROWS[0]], '姓名', '张'), false)
})

test('isSearchNoResult：表里本来就没数据 → false（该说「还没有数据」而不是「暂无搜索结果」）', async () => {
  const { isSearchNoResult } = await loadTableSearch()
  assert.equal(isSearchNoResult([], [], '姓名', '张'), false)
})

test('isSearchNoResult：没在搜（无列/无关键字）→ false', async () => {
  const { isSearchNoResult } = await loadTableSearch()
  assert.equal(isSearchNoResult(ROWS, [], null, '张'), false)
  assert.equal(isSearchNoResult(ROWS, [], '姓名', ''), false)
})

test('过滤与判定口径一致：同一组输入下不出现「提示无结果但表里有行」', async () => {
  const { filterRowsByKeyword, isSearchNoResult } = await loadTableSearch()
  const cases = [
    ['姓名', '张'], ['姓名', '不存在'], ['年级', '高一'], ['年级', '高三'], ['姓名', '五'],
  ]
  for (const [field, kw] of cases) {
    const filtered = filterRowsByKeyword(ROWS, field, kw)
    const noResult = isSearchNoResult(ROWS, filtered, field, kw)
    assert.equal(noResult, filtered.length === 0, `field=${field} kw=${kw}`)
  }
})
