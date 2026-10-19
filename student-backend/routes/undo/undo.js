// =========================================================================
// undo.js —— 撤销系统·路由入口
// （原 routes/undo.js 拆分后的主文件，纯代码搬运，行为不变）
//   实现按职责搬运到 undo.helpers.js / undo.executors.js / undo.records.js，
//   本文件仅定义路由并挂载 AI 复用接口，导出 router（与原文件一致）。
// =========================================================================

const express = require('express')
const { db } = require('../../db')
const { executors } = require('./undo.executors')
const {
  pushRecord, flip, undoAiChange, undoAiChanges, listAiChanges,
} = require('./undo.records')

const router = express.Router()

// 按 key 分组返回（含每组计数与记录）
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM undo_history ORDER BY id ASC').all()
  const groups = []
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.key)) {
      map.set(r.key, { key: r.key, records: [] })
      groups.push(map.get(r.key))
    }
    map.get(r.key).records.push({
      id: r.id,
      type: r.type,
      label: r.label,
      dir: r.dir,
      ts: r.ts,
      payload: JSON.parse(r.payload || '{}')
    })
  }
  res.json({ groups })
})

// 新增记录
router.post('/', (req, res) => {
  const { key, type, label, payload, origin } = req.body || {}
  if (!key || !type) return res.status(400).json({ error: '缺少参数' })
  if (!(type in executors)) return res.status(400).json({ error: `不支持的记录类型: ${type}` })
  const id = pushRecord(key, type, label || '', payload || {}, origin || '')
  res.json({ id })
})

// 查询某 key 的撤销/重做可用态（供标题栏按钮显示禁用态与提示文案）
router.get('/table/:key/status', (req, res) => {
  const key = req.params.key
  const u = db.prepare('SELECT label FROM undo_history WHERE key = ? AND dir = 1 ORDER BY id DESC LIMIT 1').get(key)
  const r = db.prepare('SELECT label FROM undo_history WHERE key = ? AND dir = 0 ORDER BY id DESC LIMIT 1').get(key)
  res.json({ canUndo: !!u, canRedo: !!r, undoLabel: u?.label || '', redoLabel: r?.label || '' })
})

// 按 key 撤销最近一条（dir 1 -> 0），供 Ctrl+Z 使用
router.post('/table/:key/undo', async (req, res) => {
  const rec = db.prepare('SELECT id FROM undo_history WHERE key = ? AND dir = 1 ORDER BY id DESC LIMIT 1').get(req.params.key)
  if (!rec) return res.json({ ok: false, error: '当前表没有可撤销的记录' })
  const r = await flip(rec.id, 1, 0, 'undo')
  if (r.error) return res.status(400).json({ error: r.error })
  res.json({ ok: true, label: r.label, change: r.change })
})

// 按 key 重做最近一条（dir 0 -> 1），供 Ctrl+Shift+Z / Ctrl+Y 使用
router.post('/table/:key/redo', async (req, res) => {
  const rec = db.prepare('SELECT id FROM undo_history WHERE key = ? AND dir = 0 ORDER BY id DESC LIMIT 1').get(req.params.key)
  if (!rec) return res.json({ ok: false, error: '当前表没有可重做的记录' })
  const r = await flip(rec.id, 0, 1, 'redo')
  if (r.error) return res.status(400).json({ error: r.error })
  res.json({ ok: true, label: r.label, change: r.change })
})

// 撤销某条（dir 1 -> 0）
router.post('/:id/undo', async (req, res) => {
  const id = Number(req.params.id)
  const r = await flip(id, 1, 0, 'undo')
  if (r.error) return res.status(400).json({ error: r.error })
  res.json({ ok: true, label: r.label, change: r.change })
})

// 重做某条（dir 0 -> 1）
router.post('/:id/redo', async (req, res) => {
  const id = Number(req.params.id)
  const r = await flip(id, 0, 1, 'redo')
  if (r.error) return res.status(400).json({ error: r.error })
  res.json({ ok: true, label: r.label, change: r.change })
})

// 删除单条
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  db.prepare('DELETE FROM undo_history WHERE id = ?').run(id)
  res.json({ ok: true })
})

// 清空某 key（?key=all 则清空全部）
router.delete('/', (req, res) => {
  const { key } = req.query
  if (key === 'all') db.prepare('DELETE FROM undo_history').run()
  else if (key) db.prepare('DELETE FROM undo_history WHERE key = ?').run(key)
  else return res.status(400).json({ error: '缺少 key' })
  res.json({ ok: true })
})

// 供 AI 工具（undo_change / list_changes）复用：撤销 AI 助手自己此前的更改
router.undoAiChange = undoAiChange
router.undoAiChanges = undoAiChanges
router.listAiChanges = listAiChanges

module.exports = router
