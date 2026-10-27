// =========================================================================
// backend.test.js —— 后端数据层 / 纯逻辑单元测试
//   · schema：物理表合并 + 只读视图的最终形态
//   · sanitize：入库前清洗/校验纯函数
//   · recoveryKey：恢复密钥归一化/哈希/常数时间比较
//   · backendLogic：请假时间窗校验与 SQL 时间戳格式
// 运行：npm run test:units
// =========================================================================
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')

// slotStore / businessRules 会连带 require ../db（需要主密钥），故先注入测试环境变量
const tmpDir = path.join(os.tmpdir(), 'backend-unit-' + process.pid)
process.env.DB_MASTER_KEY = process.env.DB_MASTER_KEY || 'unit-test-master-key'
process.env.DATA_DIR = process.env.DATA_DIR || tmpDir

const ROOT = path.resolve(__dirname, '../..')
// better-sqlite3 装在 student-backend 下，用其 package.json 作为解析基准
const backendRequire = createRequire(path.join(ROOT, 'student-backend/package.json'))
const Database = backendRequire('better-sqlite3-multiple-ciphers')

// ---- schema ----
const { initSchema } = require('../../student-backend/schema/schema')
const store = require('../../student-backend/services/slotStore')

const MERGED_TABLES = ['schedule_slots', 'duty_slots', 'seat_slots', 'domain_history']
const LOGICAL_VIEWS = [
  'schedule', 'master_schedule',
  'duty_settings', 'duty_layout', 'duty_template', 'duty_weight', 'duty_draft',
  'seat_layout', 'seat_template', 'seat_weight', 'seat_draft',
  'schedule_history', 'duty_history', 'seat_history',
]
const DROPPED_TABLES = [
  'schedule', 'master_schedule', 'schedule_settings', 'schedule_history',
  'duty_settings', 'duty_layout', 'duty_template', 'duty_weight', 'duty_draft', 'duty_history',
  'seat_layout', 'seat_template', 'seat_weight', 'seat_draft', 'seat_history',
]

function fresh() {
  const conn = new Database(':memory:')
  initSchema(conn)
  return conn
}

function objects(conn) {
  const rows = conn.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view')").all()
  return {
    tables: new Set(rows.filter((r) => r.type === 'table').map((r) => r.name)),
    views: new Set(rows.filter((r) => r.type === 'view').map((r) => r.name)),
  }
}

const count = (conn, sql) => conn.prepare(sql).get().c

// ---- sanitize ----
const s = require('../../student-backend/services/sanitize')

// ---- recoveryKey ----
const {
  normalizePhrase, formatPhrase, deriveRestoreHash, safeEqualHash, pickPhrase,
} = require('../../student-backend/services/recoveryKey')

// ---- businessRules / utils/sql ----
const { assertLeaveWindow } = require('../../student-backend/services/businessRules')
const { now } = require('../../student-backend/utils/sql')

// =========================================================================
// schema
// =========================================================================
test('建表：四个合并表存在，旧单例表全部退化为只读视图', () => {
  const conn = fresh()
  const { tables, views } = objects(conn)
  MERGED_TABLES.forEach((t) => assert.ok(tables.has(t), `缺少合并表 ${t}`))
  LOGICAL_VIEWS.forEach((v) => assert.ok(views.has(v), `缺少逻辑视图 ${v}`))
  DROPPED_TABLES.forEach((t) => assert.ok(!tables.has(t), `旧表 ${t} 仍以物理表存在`))
  conn.close()
})

test('播种：槽位行数与默认配置正确', () => {
  const conn = fresh()
  assert.equal(count(conn, 'SELECT COUNT(*) c FROM schedule_slots'), 2)
  assert.equal(count(conn, 'SELECT COUNT(*) c FROM duty_slots'), 5)
  assert.equal(count(conn, 'SELECT COUNT(*) c FROM seat_slots'), 4)
  // 学期播种恰好一条当前学期
  assert.equal(count(conn, 'SELECT COUNT(*) c FROM semesters'), 1)
  assert.equal(count(conn, "SELECT COUNT(*) c FROM semesters WHERE is_current = 1"), 1)

  // 逻辑名读取（经视图）应拿到默认值
  const duty = conn.prepare('SELECT days, items FROM duty_settings').get()
  assert.equal(JSON.parse(duty.days).length, 5)
  assert.equal(JSON.parse(duty.items).length, 3)

  const seat = conn.prepare('SELECT mode, rows, cols FROM seat_layout').get()
  assert.deepEqual({ ...seat }, { mode: 'single', rows: 6, cols: 7 })

  const draft = conn.prepare('SELECT saved_at FROM duty_draft').get()
  assert.equal(draft.saved_at, '') // 无草稿
  conn.close()
})

test('写入走物理表、读取走视图；视图本身不可写', () => {
  const conn = fresh()
  const cells = JSON.stringify([[{ course: '数学' }]])
  conn.prepare("UPDATE schedule_slots SET cells = ? WHERE kind = 'current'").run(cells)

  assert.equal(conn.prepare('SELECT cells FROM schedule').get().cells, cells)
  // master 与 current 互不影响
  assert.equal(conn.prepare('SELECT cells FROM master_schedule').get().cells, '[]')

  // 只读视图：直接 UPDATE 必须被 SQLite 拒绝，确保写路径只能走 slotStore
  assert.throws(() => conn.prepare("UPDATE schedule SET cells = '[]'").run(), /view/i)
  conn.close()
})

test('domain_history：payload JSON 正确映射到三域历史视图', () => {
  const conn = fresh()
  const seatPayload = {
    mode: 'single', rows: 2, cols: 2,
    seats: [[1, null], [null, 2]],
    aisleCols: [], groupsConfig: [], settings: { showAisle: false },
  }
  conn.prepare('INSERT INTO domain_history (domain, week_start, snap_date, mode, payload) VALUES (?,?,?,?,?)')
    .run('seat', '2026-10-19', '2026-10-20', 'single', JSON.stringify(seatPayload))

  const seat = conn.prepare('SELECT * FROM seat_history WHERE snap_date = ?').get('2026-10-20')
  assert.equal(seat.week_start, '2026-10-19')
  assert.equal(seat.mode, 'single')
  assert.equal(seat.rows, 2)
  assert.deepEqual(JSON.parse(seat.seats), [[1, null], [null, 2]])
  assert.deepEqual(JSON.parse(seat.aisle_cols), [])
  assert.deepEqual(JSON.parse(seat.settings), { showAisle: false })

  conn.prepare('INSERT INTO domain_history (domain, week_start, snap_date, mode, payload) VALUES (?,?,?,?,?)')
    .run('duty', '2026-10-19', '2026-10-19', 'daily', JSON.stringify({ cells: { 扫地: { 周一: ['张三'] } }, settings: {} }))
  const duty = conn.prepare('SELECT cells FROM duty_history WHERE mode = ?').get('daily')
  assert.deepEqual(JSON.parse(duty.cells), { 扫地: { 周一: ['张三'] } })

  conn.prepare('INSERT INTO domain_history (domain, week_start, snap_date, mode, payload) VALUES (?,?,?,?,?)')
    .run('schedule', '2026-10-19', '', '', JSON.stringify({ cells: [[{ course: '语文' }]], settings: { days: ['周一'] } }))
  const sched = conn.prepare('SELECT cells, settings FROM schedule_history WHERE week_start = ?').get('2026-10-19')
  assert.deepEqual(JSON.parse(sched.cells), [[{ course: '语文' }]])
  assert.deepEqual(JSON.parse(sched.settings), { days: ['周一'] })
  conn.close()
})

test('initSchema 幂等：二次执行不重复播种、不丢已有数据', () => {
  const conn = fresh()
  const cells = JSON.stringify([[{ course: '语文' }]])
  conn.prepare("UPDATE schedule_slots SET cells = ? WHERE kind = 'current'").run(cells)

  initSchema(conn)

  assert.equal(count(conn, 'SELECT COUNT(*) c FROM schedule_slots'), 2)
  assert.equal(count(conn, 'SELECT COUNT(*) c FROM duty_slots'), 5)
  assert.equal(count(conn, 'SELECT COUNT(*) c FROM seat_slots'), 4)
  assert.equal(count(conn, 'SELECT COUNT(*) c FROM semesters'), 1)
  assert.equal(conn.prepare('SELECT cells FROM schedule').get().cells, cells)
  // 视图仍然可用
  assert.equal(conn.prepare('SELECT COUNT(*) c FROM duty_layout').get().c, 1)
  conn.close()
})

test('slotStore：逻辑名映射与可写列白名单', () => {
  assert.equal(store.isDoc('duty_layout'), true)
  assert.equal(store.isDoc('seat_weight'), true)
  assert.equal(store.isDoc('students'), false) // 动态表不归 slotStore 管

  assert.deepEqual(store.columnsOf('schedule').sort(), ['cells', 'settings'])
  assert.deepEqual(
    store.columnsOf('seat_layout').sort(),
    ['aisle_cols', 'cols', 'groups_config', 'mode', 'rows', 'seats', 'settings'],
  )
  assert.deepEqual(store.columnsOf('duty_draft').sort(), ['cells', 'conditions', 'saved_at', 'settings'])
  assert.deepEqual(store.columnsOf('duty_weight').sort(), ['settings', 'weights'])
})

// =========================================================================
// sanitize
// =========================================================================
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

test('sanitizeField：课表/座位/值日等逻辑表名规则仍然生效', () => {
  // 这些逻辑表已物理合并为槽位表，但 COLUMN_RULES 仍以逻辑名索引
  assert.doesNotThrow(() => s.sanitizeField([[{ course: '语文' }]], 'schedule', 'cells'))
  assert.throws(() => s.sanitizeField('not-json', 'schedule', 'cells'))

  assert.doesNotThrow(() => s.sanitizeField([[1, '张三'], [null, 2]], 'seat_layout', 'seats'))
  assert.throws(() => s.sanitizeField([1, 2, 3], 'seat_layout', 'seats'))

  assert.doesNotThrow(() => s.sanitizeField({ 扫地: { 周一: ['张三'] } }, 'duty_layout', 'cells'))
  assert.throws(() => s.sanitizeField('[]', 'duty_layout', 'cells')) // 值日 cells 必须是对象

  assert.doesNotThrow(() => s.sanitizeField({ days: ['周一'], items: [] }, 'duty_weight', 'weights'))
  assert.throws(() => s.sanitizeField([], 'duty_weight', 'weights'))
})

test('normalizeSeats：二维数组原样通过；扁平对象数组规范化为二维', () => {
  assert.deepEqual(s.normalizeSeats([[1, '张三'], [null, 2]]), [[1, '张三'], [null, 2]])
  assert.deepEqual(
    s.normalizeSeats([{ row: 1, col: 2, student_id: 5 }, { row: 2, col: 1, name: '李四' }]),
    [[null, 5], ['李四', null]],
  )
  assert.throws(() => s.normalizeSeats([{ row: 0, col: 1, student_id: 1 }]))
})

// =========================================================================
// recoveryKey
// =========================================================================
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

// =========================================================================
// businessRules / utils/sql
// =========================================================================
test('assertLeaveWindow：结束时间必须晚于开始时间', () => {
  assert.doesNotThrow(() => assertLeaveWindow('2026-10-17 08:00', '2026-10-17 12:00'))
  assert.doesNotThrow(() => assertLeaveWindow('2026-10-17', '2026-10-18')) // 仅日期按 00:00:00 比较
  assert.throws(() => assertLeaveWindow('2026-10-17 12:00', '2026-10-17 08:00'))
  assert.throws(() => assertLeaveWindow('2026-10-17 08:00', '2026-10-17 08:00'))
  // 任一缺失则不校验
  assert.doesNotThrow(() => assertLeaveWindow('', '2026-10-17'))
  assert.doesNotThrow(() => assertLeaveWindow('2026-10-17', ''))
})

test('now：输出 YYYY-MM-DD HH:mm 本地时间', () => {
  const str = now()
  assert.match(str, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  assert.equal(str, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`)
})

test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {} })
