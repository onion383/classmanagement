// 恢复密钥：纯函数单元测试（node:test，无第三方依赖）
// 运行：npm run test:units
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizePhrase, formatPhrase, deriveRestoreHash, safeEqualHash, pickPhrase,
} = require('../../student-backend/services/recoveryKey')

test('normalizePhrase 只保留汉字（去掉序号/空格/标点）', () => {
  assert.equal(normalizePhrase('1.山  2.水, 3.风'), '山水风')
  assert.equal(normalizePhrase('  山水风  '), '山水风')
  assert.equal(normalizePhrase('abc123'), '')
})

test('formatPhrase 按「1.字  2.字」输出，与 normalize 结果对应', () => {
  assert.equal(formatPhrase('山水风'), '1.山  2.水  3.风')
  // 抄写时混入序号与空格也应还原成同一串
  assert.equal(formatPhrase('1.山 2.水'), '1.山  2.水')
})

test('deriveRestoreHash 稳定、64 位 hex，且不同短语不同哈希', () => {
  const h1 = deriveRestoreHash('山水风')
  const h2 = deriveRestoreHash('山水风')
  assert.match(h1, /^[0-9a-f]{64}$/)
  assert.equal(h1, h2)
  assert.notEqual(h1, deriveRestoreHash('山水雨'))
})

test('safeEqualHash 常数时间比较：仅字符串相等才 true', () => {
  const h = deriveRestoreHash('山水风')
  assert.equal(safeEqualHash(h, h), true)
  assert.equal(safeEqualHash(h, h.slice(0, -1) + '0'), false)
  assert.equal(safeEqualHash(h, null), false)
  assert.equal(safeEqualHash(undefined, h), false)
})

test('pickPhrase 生成 12 个汉字', () => {
  const p = pickPhrase()
  assert.equal(p.length, 12)
  assert.match(p, /^[\u4e00-\u9fa5]{12}$/)
})
