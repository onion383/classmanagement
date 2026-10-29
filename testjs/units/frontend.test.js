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

// =========================================================================
// csvCell：CSV 公式注入与引号转义（B11-03）
// =========================================================================
const loadCsvCell = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/csvCell.js')).href)
const loadImportSheet = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/importSheet.js')).href)
const loadFileName = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/fileName.js')).href)
const loadAlbumIndexBuilder = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/components/import-export/ExportAlbumIndex.builder.js')).href)

test('csvCell：= + - @ 开头的值前置单引号，阻断公式注入', async () => {
  const { csvCell } = await loadCsvCell()
  assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)")
  assert.equal(csvCell('+1'), "'+1")
  assert.equal(csvCell('-1'), "'-1")
  assert.equal(csvCell('@cmd'), "'@cmd")
  assert.equal(csvCell('\tcmd'), "'\tcmd")
  // 前导空白 + 公式字符：Excel/WPS 仍可能按公式求值，必须一并前置单引号
  assert.equal(csvCell(' =SUM(A1:A9)'), "' =SUM(A1:A9)")
  assert.equal(csvCell('\t@cmd'), "'\t@cmd")
  assert.equal(csvCell('\r-1'), "\"'\r-1\"")
  // 非公式起始字符不动
  assert.equal(csvCell('  hello'), '  hello')
  assert.equal(csvCell('张三'), '张三')
  assert.equal(csvCell(0), '0')
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(undefined), '')
})

test('csvCell：逗号/引号/换行仍按 CSV 规则加引号，注入防护在引号内也生效', async () => {
  const { csvCell } = await loadCsvCell()
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"')
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`)
})

// =========================================================================
// importSheet：表头保留原始列下标（B11-01）
// =========================================================================
test('parseSheet：中间列空表头不会让右侧列左移（原实现会串列）', async () => {
  const { parseSheet } = await loadImportSheet()
  const data = [
    ['姓名', '', '学号'],
    ['张三', '忽略', '1001'],
  ]
  const parsed = parseSheet(data)
  assert.deepEqual(parsed.fields, ['姓名', '学号'])
  assert.deepEqual(parsed.rows, [{ 姓名: '张三', 学号: '1001' }])
  // 关键断言：学号取的是第 2 列，而不是过滤后的第 1 列
  assert.deepEqual(parsed.columns.map((c) => c.index), [0, 2])
})

test('parseSheet：标题行被跳过，空行被忽略，必填缺失行计入 skipped', async () => {
  const { parseSheet } = await loadImportSheet()
  const data = [
    ['收支记录表'],
    ['收支编码', '姓名'],
    ['A1', '张三'],
    ['', '李四'],
    [],
    ['A2', '王五'],
  ]
  const parsed = parseSheet(data, ['收支编码'])
  assert.equal(parsed.headerRowIndex, 1)
  assert.deepEqual(parsed.fields, ['收支编码', '姓名'])
  assert.deepEqual(parsed.rows, [{ 收支编码: 'A1', 姓名: '张三' }, { 收支编码: 'A2', 姓名: '王五' }])
  assert.equal(parsed.skipped, 1)
})

test('parseSheet：同名表头加序号后缀，两列数据都保留', async () => {
  const { parseSheet } = await loadImportSheet()
  const data = [
    ['姓名', '备注', '备注'],
    ['张三', 'A', 'B'],
  ]
  const parsed = parseSheet(data)
  // 后缀是 `_2` 而不是 ` (2)`：这些 name 会原样作为列名 POST 给后端，
  // 而 assertValidColumn 的白名单 /^[a-zA-Z0-9_一-龥]+$/ 不接受空格与括号，
  // 用 ` (2)` 会让含同名表头的 Excel 整体导入失败。改回括号前请先看 importSheet.js 里的注释。
  assert.deepEqual(parsed.fields, ['姓名', '备注', '备注_2'])
  assert.deepEqual(parsed.rows, [{ 姓名: '张三', 备注: 'A', '备注_2': 'B' }])
})

// =========================================================================
// fileName：导出/保存文件名清洗（B11-10）
// =========================================================================
test('sanitizeFileName：替换 Windows 非法字符并去掉末尾点/空格', async () => {
  const { sanitizeFileName } = await loadFileName()
  assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j.csv'), 'a_b_c_d_e_f_g_h_i_j.csv')
  assert.equal(sanitizeFileName('导出.csv '), '导出.csv')
  assert.equal(sanitizeFileName('导出.'), '导出')
  assert.equal(sanitizeFileName('  '), '导出文件')
  assert.equal(sanitizeFileName('', '空白名'), '空白名')
  assert.equal(sanitizeFileName(null), '导出文件')
})

test('sanitizeFileName：超长文件名截断到 120 字符', async () => {
  const { sanitizeFileName } = await loadFileName()
  assert.equal(sanitizeFileName('名'.repeat(300)).length, 120)
})

test('sanitizeFileName：目录穿越片段被压平成纯文件名（不含路径分隔符）', async () => {
  const { sanitizeFileName } = await loadFileName()
  // 返回值会作为保存对话框的建议文件名，不能把 ../ 或盘符路径原样带出去
  assert.equal(sanitizeFileName('../x'), '.._x')
  assert.equal(sanitizeFileName('../../etc/passwd'), '.._.._etc_passwd')
  assert.equal(sanitizeFileName('C:\\Windows\\evil.exe'), 'C__Windows_evil.exe')
  assert.equal(sanitizeFileName('..'), '导出文件') // 只有点，去尾点后为空 → 兜底
  assert.equal(sanitizeFileName('a\u0000b'), 'a_b')  // 控制字符一并替换
  for (const bad of ['../x', '../../etc/passwd', 'C:\\Windows\\evil.exe', 'a\u0000b', '..\\..\\x']) {
    const out = sanitizeFileName(bad)
    assert.equal(/[\\/]/.test(out), false, `「${bad}」清洗后仍含路径分隔符：${out}`)
    assert.equal(out.includes('..' + path.sep), false, `「${bad}」清洗后仍含上跳目录：${out}`)
  }
})

// =========================================================================
// localDateStr：本地日期键（B07-03 / B11-11）
// =========================================================================
const loadDateTime = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/dateTime.js')).href)

test('localDateStr：按本地时区取日期，凌晨不会被 UTC 拉回前一天', async () => {
  const { localDateStr, formatDate } = await loadDateTime()
  // 本地 00:30：toISOString 在东八区会得到前一天，localDateStr 必须留在当天
  const early = new Date(2026, 0, 1, 0, 30)
  assert.equal(localDateStr(early), '2026-01-01')
  assert.equal(localDateStr(early), formatDate(early))
  assert.equal(localDateStr(new Date(2026, 9, 28, 23, 59)), '2026-10-28')
  // 不传参时用当前时间
  assert.equal(localDateStr(), formatDate(new Date()))
})

test('localDateStr：非法日期返回空串，不产出 NaN-NaN-NaN', async () => {
  const { localDateStr } = await loadDateTime()
  assert.equal(localDateStr(new Date('not a date')), '')
  assert.equal(localDateStr('2026-13-45'), '')
})

// =========================================================================
// decodeJwtPayload：base64url 解析（P1-11 / B12-01）
// =========================================================================
const loadJwt = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/jwt.js')).href)

test('decodeJwtPayload：base64url 的 -/_ 与无 padding 都能解，中文用户名不乱码', async () => {
  const { decodeJwtPayload } = await loadJwt()
  const payload = { userId: 1, username: '班主任', exp: 1900000000, role: 'teacher' }
  const seg = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  assert.ok(/[-_]/.test(seg), '用例必须覆盖 base64url 的特殊字符')
  assert.equal(seg.includes('='), false, 'JWT 段本就不带 padding')
  assert.deepEqual(decodeJwtPayload(`header.${seg}.sig`), payload)
})

test('decodeJwtPayload：缺段/非法内容返回 null，不抛错', async () => {
  const { decodeJwtPayload } = await loadJwt()
  assert.equal(decodeJwtPayload(''), null)
  assert.equal(decodeJwtPayload('abc'), null)
  assert.equal(decodeJwtPayload(null), null)
  assert.equal(decodeJwtPayload('a.!!!.c'), null)
})

// =========================================================================
// createSerialSaver：串行保存（P1-09 / B07-01 / B07-02）
// =========================================================================
const loadSerialSaver = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/serialSaver.js')).href)

test('createSerialSaver：在途期间的多次请求合并，不并发发请求', async () => {
  const { createSerialSaver } = await loadSerialSaver()
  let calls = 0
  let release
  const saver = createSerialSaver(async () => {
    calls++
    if (calls === 1) await new Promise((r) => { release = r })
  })
  const p1 = saver.request()
  assert.equal(saver.busy, true)
  const p2 = saver.request()
  const p3 = saver.request()
  assert.equal(calls, 1, '同一时刻只能有一个保存在途')
  release()
  assert.deepEqual(await Promise.all([p1, p2, p3]), [true, true, true])
  assert.equal(calls, 2, '三轮请求应合并为「首轮 + 结束后一次」')
  assert.equal(saver.busy, false)
})

test('createSerialSaver：失败返回 false 并记录错误，恢复后可再次保存', async () => {
  const { createSerialSaver } = await loadSerialSaver()
  let failing = true
  let calls = 0
  const saver = createSerialSaver(async () => {
    calls++
    if (failing) throw new Error('boom')
  })
  assert.equal(await saver.request(), false)
  assert.equal(saver.error.message, 'boom')
  failing = false
  assert.equal(await saver.request(), true)
  assert.equal(saver.error, null)
  assert.equal(calls, 2)
})

// =========================================================================
// fairFill：权重公平分配（P1-12 / B09-02）
// =========================================================================
const loadDutyPipeline = () => import(pathToFileURL(path.join(
  __dirname, '../../student-frontend/src/components/dialogs/DutyArrangementDialog/DutyArrangementDialog.pipeline.js'
)).href)

function fairCtx(overrides) {
  // ctx 契约：状态为 ref（.value 访问），跨模块方法经 Object.assign 回填
  return {
    studentNames: { value: [] },
    weights: { value: {} },
    ledger: { value: {} },
    satisfaction: { value: {} },
    ...overrides,
  }
}

test('fairFill：学生名单为空时返回全空槽位，不因取模 0 崩溃', async () => {
  const { useDutyArrangementPipeline } = await loadDutyPipeline()
  const ctx = fairCtx()
  const m = useDutyArrangementPipeline(ctx, [])
  Object.assign(ctx, m)
  const slots = [{ item: '扫地', day: '周一', k: 0 }, { item: '拖地', day: '周二', k: 0 }]
  assert.deepEqual(m.fairFill(slots), ['', ''])
})

test('fairFill：名单非空时按账本降序轮询，槽位不足则循环使用学生', async () => {
  const { useDutyArrangementPipeline } = await loadDutyPipeline()
  const ctx = fairCtx({ studentNames: { value: ['甲', '乙'] }, ledger: { value: { 甲: 5, 乙: 1 } } })
  const m = useDutyArrangementPipeline(ctx, [])
  Object.assign(ctx, m)
  const slots = [
    { item: '扫地', day: '周一', k: 0 },
    { item: '拖地', day: '周一', k: 0 },
    { item: '擦窗', day: '周二', k: 0 },
  ]
  assert.deepEqual(m.fairFill(slots), ['甲', '乙', '甲'])
})

// =========================================================================
// dirOf：相册索引的目录列（B11-12）
// =========================================================================
test('dirOf：根目录与盘符根不被整条路径吞掉', async () => {
  const { dirOf } = await loadAlbumIndexBuilder()
  assert.equal(dirOf('/a.jpg'), '/')
  assert.equal(dirOf('C:\\a.jpg'), 'C:\\')
  assert.equal(dirOf('C:/photos/a.jpg'), 'C:/photos')
  assert.equal(dirOf('D:\\photos\\sub\\a.jpg'), 'D:\\photos\\sub')
  assert.equal(dirOf('a.jpg'), '')
})

// =========================================================================
// normalizeAsk / _isSingleUnpicked：畸形 ask_user 结构防御（B11-07）
// =========================================================================
const loadAiMessages = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/composables/ai/aiMessages.js')).href)
const loadAiComposerAsk = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/components/ai/AiComposer/AiComposer.ask.js')).href)

test('normalizeAsk：缺 questions/options 时补成数组，不抛错', async () => {
  const { normalizeAsk } = await loadAiMessages()
  assert.deepEqual(normalizeAsk({ answered: false }).questions, [])
  assert.deepEqual(normalizeAsk({ questions: [{ question: '选哪个' }] }).questions[0].options, [])
  assert.deepEqual(normalizeAsk({ questions: [{ question: 'a', options: ['x'] }] }).questions[0].options, ['x'])
  assert.equal(normalizeAsk(null), null)
})

test('_isSingleUnpicked：缺 options 的题按「无选项」处理，不抛 TypeError', async () => {
  const { _isSingleUnpicked } = await loadAiComposerAsk()
  assert.equal(_isSingleUnpicked(null), false)
  assert.equal(_isSingleUnpicked({ multiple: false }), false)
  assert.equal(_isSingleUnpicked({ multiple: false, options: [] }), false)
  assert.equal(_isSingleUnpicked({ multiple: false, options: ['a'] }), true)
  assert.equal(_isSingleUnpicked({ multiple: false, options: ['a'], picked: 'a' }), false)
})


// =========================================================================
// useSeq：异步竞态序号守卫
// 迁移自 5 处手写的 `let xxxSeq = 0`，这里锁住语义，防止以后被改成
// 「共享计数器」（会导致两个组件互相作废对方请求）。
// =========================================================================
const loadSeq = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/composables/useSeq.js')).href)

test('useSeq：take 递增，isLatest 只认最新号', async () => {
  const { useSeq } = await loadSeq()
  const seq = useSeq()
  const a = seq.take()
  const b = seq.take()
  assert.equal(a, 1)
  assert.equal(b, 2)
  assert.equal(seq.isLatest(a), false, '旧号必须被判为过期')
  assert.equal(seq.isLatest(b), true)
})

test('useSeq：current 读当前号但不递增（同一批请求的第二阶段沿用）', async () => {
  const { useSeq } = await loadSeq()
  const seq = useSeq()
  const a = seq.take()
  assert.equal(seq.current(), a)
  assert.equal(seq.current(), a, 'current 不能改变序号')
  assert.equal(seq.isLatest(a), true)
})

test('useSeq：invalidate 作废所有在途请求', async () => {
  const { useSeq } = await loadSeq()
  const seq = useSeq()
  const a = seq.take()
  seq.invalidate()
  assert.equal(seq.isLatest(a), false, 'invalidate 后旧号必须失效')
  const b = seq.take()
  assert.equal(seq.isLatest(b), true)
  assert.equal(seq.isLatest(a), false)
})

test('useSeq：两次调用互不干扰（不能是模块级共享计数器）', async () => {
  const { useSeq } = await loadSeq()
  const one = useSeq()
  const two = useSeq()
  const a = one.take()
  const b = two.take()
  assert.equal(a, 1)
  assert.equal(b, 1, '两个实例各自从 1 开始')
  one.take()
  assert.equal(one.isLatest(a), false)
  assert.equal(two.isLatest(b), true, '另一个实例的号不受影响')
})

// =========================================================================
// reportError：错误上报的分级与文案口径
// 锁住三件事：① log/silent 不打扰用户 ② 技术性后端消息不外露 ③ 动作名优先
// =========================================================================
const loadReportError = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/reportError.js')).href)
const loadNotif = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/composables/useNotification.js')).href)

// 读通知列表并把定时器清掉：error 级默认挂 5 秒 setTimeout，不清会让测试进程空等
async function withNotifications(fn) {
  const { useNotification } = await loadNotif()
  const list = useNotification().notifications
  list.splice(0).forEach((n) => clearTimeout(n.timer))
  try {
    return await fn(list)
  } finally {
    list.splice(0).forEach((n) => clearTimeout(n.timer))
  }
}

const httpErr = (msg) => ({ response: { data: { error: msg } } })

test('reportError：user 档弹提示，无后端消息时用「动作+结果」', async () => {
  const { reportError } = await loadReportError()
  await withNotifications((list) => {
    reportError(new Error('boom'), { action: '保存', hint: '改动未保存' })
    assert.equal(list.length, 1)
    assert.equal(list[0].message, '保存失败，改动未保存')
  })
})

test('reportError：log / silent 档不弹给用户', async () => {
  const { reportError } = await loadReportError()
  await withNotifications((list) => {
    assert.equal(reportError(new Error('x'), { level: 'log' }), false)
    assert.equal(reportError(new Error('y'), { level: 'silent' }), false)
    assert.equal(list.length, 0, '日志档与静默档都不该产生通知')
  })
})

test('reportError：后端可读消息会拼进文案', async () => {
  const { reportError } = await loadReportError()
  await withNotifications((list) => {
    reportError(httpErr('该用户名已被占用'), { action: '改名' })
    assert.equal(list[0].message, '改名失败：该用户名已被占用')
  })
})

test('reportError：技术性后端消息被过滤成通用文案', async () => {
  const { reportError } = await loadReportError()
  await withNotifications((list) => {
    reportError(httpErr('SQLITE_CONSTRAINT: UNIQUE constraint failed: users.username'), { action: '写入' })
    assert.equal(list[0].message, '写入失败，请重试', '不该把 SQL 报错摆给用户')
    reportError(httpErr('Cannot read properties of undefined (reading "id")'), { action: '读取' })
    assert.equal(list[1].message, '读取失败，请重试')
  })
})

test('reportError：无 action 时退化为通用文案；脏输入不抛', async () => {
  const { reportError } = await loadReportError()
  await withNotifications((list) => {
    reportError(null)
    assert.equal(list[0].message, '操作失败，请重试')
    // 后两次没有 action 也没有后端消息 → 文案同上，被 useNotification 按「同文案合并」归并。
    // 这正好也锁住了合并机制：连续失败不会刷出三条一样的提示。
    reportError('纯字符串错误')
    reportError({})
    assert.equal(list.length, 1, '同文案应合并成一条')
    assert.equal(list[0].count, 3, '合并后计数应为 3')
  })
})
