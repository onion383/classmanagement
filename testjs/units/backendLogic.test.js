// businessRules.js / utils/sql.js：加载这两个模块会拉起 dbManager（需要主密钥），
// 故先注入测试用的环境变量与临时数据目录，再 require。这里只覆盖不依赖真实连接的纯逻辑
// （请假时间窗校验、SQL 时间戳），不追求覆盖率。
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const test = require('node:test')
const assert = require('node:assert/strict')

const tmpDir = path.join(os.tmpdir(), 'bjt-unit-' + process.pid)
process.env.DB_MASTER_KEY = process.env.DB_MASTER_KEY || 'unit-test-master-key'
process.env.DATA_DIR = process.env.DATA_DIR || tmpDir

const { assertLeaveWindow } = require('../../student-backend/services/businessRules')
const { now } = require('../../student-backend/utils/sql')

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
  const s = now()
  assert.match(s, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  assert.equal(s, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`)
})

test.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {} })
