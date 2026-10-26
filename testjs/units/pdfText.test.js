// PDF 文本收集：纯函数单元测试
// 运行：npm run test:units
//
// 为什么专门测这个：collectPdfText 曾经用裸递归，遇到 `row.self = row` 这类自引用会 RangeError，
// 而它处在调用点的 try 内 → 异常被吞 → 字体没加载 → 退回 helvetica → 整份 PDF 中文静默乱码。
// 不是崩溃、不报错，是最难发现的那类事故。现有实现靠 MAX_DEPTH / MAX_NODES 两条保险丝兜住，
// 这里锁住其行为，避免以后有人「优化」掉保险丝。
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const load = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/pdfFont.js')).href)

test('collectPdfText 收集嵌套表格里的字符串与数字', async () => {
  const { collectPdfText } = await load()
  const rows = [{ name: '张三', score: 95 }, { name: '李四', score: true }]
  const text = collectPdfText(rows, { title: '成绩单' })
  assert.ok(text.includes('张三'))
  assert.ok(text.includes('李四'))
  assert.ok(text.includes('成绩单'))
  assert.ok(text.includes('95'))
  assert.ok(text.includes('true'))
})

test('collectPdfText 只取值，不把对象键名算进文本', async () => {
  const { collectPdfText } = await load()
  const text = collectPdfText({ nameColumnHeader: '甲' })
  assert.ok(text.includes('甲'))
  assert.ok(!text.includes('nameColumnHeader'))
})

test('collectPdfText 忽略 null / undefined / 函数', async () => {
  const { collectPdfText } = await load()
  assert.doesNotThrow(() => collectPdfText(null, undefined, { a: null }, () => {}))
})

test('collectPdfText 遇自引用环不爆栈', async () => {
  const { collectPdfText } = await load()
  const row = { name: '王五' }
  row.self = row // 曾经的 RangeError 源头
  let text
  assert.doesNotThrow(() => { text = collectPdfText([row]) })
  assert.ok(text.includes('王五'))
})

test('collectPdfText 超深嵌套被深度上限截断，不爆栈', async () => {
  const { collectPdfText } = await load()
  let deep = { leaf: '深层文字' }
  for (let i = 0; i < 200; i++) deep = { child: deep }
  assert.doesNotThrow(() => collectPdfText(deep))
  // MAX_DEPTH=32，200 层早已截断，最底层的文字不应出现在子集里
  assert.ok(!collectPdfText(deep).includes('深层文字'))
})

test('collectPdfText 结果含兜底字符（PDF 内固定词的字形覆盖）', async () => {
  const { collectPdfText } = await load()
  const empty = collectPdfText('')
  assert.ok(empty.length > 0, '空入参也应返回兜底字符，否则固定词会出现空白色块')
  assert.equal(collectPdfText('甲'), '甲' + empty, '兜底字符应稳定附在末尾')
})
