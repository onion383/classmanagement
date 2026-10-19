// 数据层结构回归测试：验证「物理表合并 + 只读视图」的最终形态。
// 覆盖：合并表存在、旧逻辑名退化为视图、播种行数、JSON payload → 视图列映射、
//       二次 initSchema 幂等且不丢数据、slotStore 的逻辑名映射。
// 运行：npm run test:units
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')

// slotStore 会连带 require ../db（需要主密钥），故先注入测试环境变量
const tmpDir = path.join(os.tmpdir(), 'schema-unit-' + process.pid)
process.env.DB_MASTER_KEY = process.env.DB_MASTER_KEY || 'unit-test-master-key'
process.env.DATA_DIR = process.env.DATA_DIR || tmpDir

const ROOT = path.resolve(__dirname, '../..')
// better-sqlite3 装在 student-backend 下，用其 package.json 作为解析基准
const backendRequire = createRequire(path.join(ROOT, 'student-backend/package.json'))
const Database = backendRequire('better-sqlite3-multiple-ciphers')

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

test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {} })
