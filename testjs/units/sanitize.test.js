// sanitize.js：入库前清洗/校验纯函数单元测试（node:test，无第三方依赖）
// 运行：npm run test:units
const test = require('node:test')
const assert = require('node:assert/strict')
const s = require('../../student-backend/services/sanitize')

test('cleanText：换行归一、去零宽/控制字符、trim、超长截断', () => {
  assert.equal(s.cleanText('  a\r\nb  '), 'a\nb')          // \r\n → \n 且去首尾空白
  assert.equal(s.cleanText('a\u200bb'), 'ab')               // 去零宽字符
  assert.equal(s.cleanText('a\u0000b'), 'ab')               // 去控制字符
  assert.equal(s.cleanText('x'.repeat(s.MAX_TEXT_LEN + 10)).length, s.MAX_TEXT_LEN)
})

test('normBool：true/1 → 1，false/0 → 0，非法报错', () => {
  assert.equal(s.normBool(true), 1)
  assert.equal(s.normBool('1'), 1)
  assert.equal(s.normBool('true'), 1)
  assert.equal(s.normBool(false), 0)
  assert.equal(s.normBool('0'), 0)
  assert.equal(s.normBool(''), 0)
  assert.equal(s.normBool(null), 0)
  assert.throws(() => s.normBool('maybe', 'x'))
})

test('normNumber：空 → null，非法报错，可转数字则归一', () => {
  assert.equal(s.normNumber('', 'x'), null)
  assert.equal(s.normNumber(null, 'x'), null)
  assert.equal(s.normNumber('3.5', 'x'), 3.5)
  assert.throws(() => s.normNumber('abc', 'x'))
})

test('strictDate：合法日期归一 YYYY-MM-DD，非法/越界年份拒绝', () => {
  assert.equal(s.strictDate('2026/1/5', 'd'), '2026-01-05')
  assert.equal(s.strictDate('2026-1-5 9:08', 'd'), '2026-01-05 09:08')
  assert.equal(s.strictDate('', 'd'), null)
  assert.throws(() => s.strictDate('2026-2-30', 'd'))   // 不存在的日期
  assert.throws(() => s.strictDate('1999-1-1', 'd'))    // 年份越界
  assert.throws(() => s.strictDate('not-a-date', 'd'))
})

test('cleanPath：允许盘符前缀，拒绝「..」与非法字符', () => {
  assert.equal(s.cleanPath('C:\\a\\b', 'p'), 'C:\\a\\b')
  assert.equal(s.cleanPath('', 'p'), null)
  assert.throws(() => s.cleanPath('../etc', 'p'))
  assert.throws(() => s.cleanPath('a<b', 'p'))
})

test('sanitizeField：命中列级规则（枚举 / 数值范围与精度 / 布尔）', () => {
  assert.equal(s.sanitizeField('收入', 'fee_records', '收支类型'), '收入')
  assert.throws(() => s.sanitizeField('转账', 'fee_records', '收支类型'))
  assert.equal(s.sanitizeField('12.345', 'fee_records', '收支金额'), 12.35) // decimals=2
  assert.throws(() => s.sanitizeField('-1', 'fee_records', '收支金额'))     // min=0
  assert.equal(s.sanitizeField('1', 'countdowns', '包含这一天'), 1)
  assert.equal(s.sanitizeField(true, 'countdowns', '包含这一天'), 1)
})

test('normalizeSeats：二维数组原样通过；扁平对象数组规范化为二维', () => {
  assert.deepEqual(s.normalizeSeats([[1, '张三'], [null, 2]]), [[1, '张三'], [null, 2]])
  assert.deepEqual(
    s.normalizeSeats([{ row: 1, col: 2, student_id: 5 }, { row: 2, col: 1, name: '李四' }]),
    [[null, 5], ['李四', null]],
  )
  assert.throws(() => s.normalizeSeats([{ row: 0, col: 1, student_id: 1 }]))
})
