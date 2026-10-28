// =========================================================================
// undo.records.js —— 撤销系统·记录与回退
// （原 routes/undo.js 按职责拆分而来，纯代码搬运，行为不变）
//   撤销记录的入库/读取、单条 undo/redo（flip）、AI 批次回退
// =========================================================================

const { db } = require('../../db')
const { executors } = require('./undo.executors')

const MAX_PER_KEY = 50

// parse payload 安全包裹
function getRecord(id) {
  const rec = db.prepare('SELECT * FROM undo_history WHERE id = ?').get(id)
  if (!rec) return null
  rec.payload = JSON.parse(rec.payload || '{}')
  return rec
}

// 新增一条可撤销记录（undo侧）
// origin：来源标记。空=老师手动编辑；非空=AI 助手一次更改的批次标识（同批次整批回退）
function pushRecord(key, type, label, payload, origin) {
  const ts = new Date().toISOString()
  // 新增动作使该 key 的 redo 侧失效
  db.prepare('DELETE FROM undo_history WHERE key = ? AND dir = 0').run(key)
  const info = db.prepare(
    'INSERT INTO undo_history (key, type, label, payload, dir, origin, ts) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).run(key, type, label, JSON.stringify(payload), origin || '', ts)
  // 每 key 上限，删最旧
  const over = db.prepare(
    'SELECT id FROM undo_history WHERE key = ? ORDER BY id DESC LIMIT -1 OFFSET ?'
  ).all(key, MAX_PER_KEY)
  for (const r of over) db.prepare('DELETE FROM undo_history WHERE id = ?').run(r.id)
  return info.lastInsertRowid
}

// 执行 undo/redo 并切换 dir（执行器可能含异步文件操作，故为 async）
async function flip(id, fromDir, toDir, mode) {
  const rec = getRecord(id)
  if (!rec) return { error: '记录不存在' }
  if (rec.dir !== fromDir) return { error: mode === 'undo' ? '该条已无可撤销' : '该条已无可重做' }
  const ex = executors[rec.type]
  if (!ex) return { error: `不支持的记录类型: ${rec.type}` }
  const validation = ex.validate ? ex.validate(rec.payload) : null
  if (validation) return { error: validation }
  // 先 CAS 抢占方向，再执行副作用：原先「执行成功后才切 dir」在 UPDATE 失败时会允许同向重放。
  // 执行失败则把 dir 改回去，记录仍可重试；极端崩溃只会少一次可撤销，不会重复执行。
  const claim = db.prepare('UPDATE undo_history SET dir = ? WHERE id = ? AND dir = ?').run(toDir, id, fromDir)
  if (claim.changes !== 1) {
    return { error: mode === 'undo' ? '该条已无可撤销' : '该条已无可重做' }
  }
  try {
    await ex[mode](rec.payload)
  } catch (err) {
    try {
      db.prepare('UPDATE undo_history SET dir = ? WHERE id = ? AND dir = ?').run(fromDir, id, toDir)
    } catch (rollbackErr) {
      // 回滚失败只可能是库不可写；保留日志，至少不要掩盖原始执行错误
      console.error('[undo] 执行失败后回滚 dir 失败:', rollbackErr.message)
    }
    throw err
  }
  // 展示文案按当前操作方向生成，而非存库的方向
  const label = ex.describe ? ex.describe(rec.payload, mode) : rec.label
  // 结构化变更结果（供前端本地增量应用）；生成失败一律兜底为全量重载，绝不影响撤销本身
  let change
  try {
    change = ex.change ? ex.change(rec.payload, mode) : { type: 'full_reload' }
  } catch {
    change = { type: 'full_reload' }
  }
  return { ok: true, label, change }
}

// 回退某一批次（origin 相同）的全部记录。origin 为 AI 一次更改的批次标识。
async function undoOriginBatch(origin) {
  const rows = db.prepare('SELECT id FROM undo_history WHERE dir = 1 AND origin = ? ORDER BY id DESC').all(origin)
  const labels = []
  for (const r of rows) {
    const res = await flip(r.id, 1, 0, 'undo')
    if (res.error) return { ok: false, error: res.error, count: labels.length, labels }
    if (res.label) labels.push(res.label)
  }
  return { ok: true, count: labels.length, labels }
}

// 撤销「AI 助手」此前做出的最近一次数据更改（同一批次整批回退）。
//   key 可选：限定只撤销该资源（表名 / 分组名）上的最近一次 AI 更改。
//   只处理 origin 非空的记录，不会误撤销老师手动编辑产生的撤销记录。
//   返回 { ok, count, labels } 或 { ok:false, error }。供 AI 工具 undo_change 复用。
async function undoAiChange(key) {
  let sql = "SELECT origin FROM undo_history WHERE dir = 1 AND origin <> ''"
  const params = []
  if (key) { sql += ' AND key = ?'; params.push(String(key)) }
  sql += ' ORDER BY id DESC LIMIT 1'
  const last = db.prepare(sql).get(...params)
  if (!last) {
    return { ok: false, error: key ? `没有可撤销的、你此前对「${key}」做出的更改` : '你此前没有可撤销的更改' }
  }
  return undoOriginBatch(last.origin)
}

// 列出 AI 助手此前的可撤销更改，按「批次」分组（同一 origin 为一次更改），最新在前。
//   step 从 1 起：1 = 最近一次更改。返回 [{ step, label, count, keys, ts, id, origin }]。
//   供 AI 工具 list_changes 复用，让模型看到撤销栈（不再是盲退）。
function listAiChanges(limit) {
  const rows = db.prepare("SELECT id, key, label, origin, ts FROM undo_history WHERE dir = 1 AND origin <> '' ORDER BY id DESC").all()
  const batches = []
  const map = new Map()
  for (const r of rows) {
    let b = map.get(r.origin)
    if (!b) { b = { origin: r.origin, labels: [], keys: [], ids: [], ts: r.ts }; map.set(r.origin, b); batches.push(b) }
    b.labels.push(r.label || '')
    if (!b.keys.includes(r.key)) b.keys.push(r.key)
    b.ids.push(r.id)
  }
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 30)
  return batches.slice(0, lim).map((b, i) => ({
    step: i + 1,
    label: b.labels.filter(Boolean).join('；') || '（无描述）',
    count: b.labels.length,
    keys: b.keys,
    ts: b.ts,
    id: Math.max(...b.ids),
    origin: b.origin,
  }))
}

// 回退最近 N 批 AI 更改（最新在前逐批回退）：steps=1 即只回退最近一次更改。
//   返回 { ok, count, labels, batches } 或 { ok:false, error }。供 AI 工具 undo_change（steps）复用。
async function undoAiChanges(steps) {
  const n = Math.min(Math.max(Number(steps) || 1, 1), 20)
  const batches = listAiChanges(n)
  if (!batches.length) return { ok: false, error: '你此前没有可撤销的更改' }
  const labels = []
  let undone = 0
  for (const b of batches) {
    const res = await undoOriginBatch(b.origin)
    if (res.error) return { ok: false, error: res.error, count: labels.length, labels }
    labels.push(...res.labels)
    undone++
  }
  return { ok: true, count: labels.length, labels, batches: undone }
}

module.exports = {
  getRecord,
  pushRecord,
  flip,
  undoOriginBatch,
  undoAiChange,
  listAiChanges,
  undoAiChanges,
}
