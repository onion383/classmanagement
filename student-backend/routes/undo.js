const express = require('express')
const { db } = require('../db')
const { moveToTrash, restoreToOriginal, deleteThumb } = require('../albumOps')
const router = express.Router()

const MAX_PER_KEY = 50

// 允许记录的动态表名（防注入）
const ALLOWED_TABLES = ['students', 'fee_records', 'leave_records', 'score_records', 'group_members', 'groups', 'group_dimensions', 'activities', 'countdowns']

// 网格型数据：整块 JSON 存于单列，撤销按单格或整块处理。
// 表名固定，杜绝注入。列名到具体网格列一一对应。
const GRID_SOURCES = {
  seat_layout: 'seats',
  seat_template: 'seats',
  seat_weight: 'weights',
  schedule: 'cells',
  master_schedule: 'cells',
  duty_layout: 'cells',
  duty_template: 'cells'
}
// 读取网格某列的完整 JSON
function readGridArray(table, column) {
  const row = db.prepare(`SELECT "${column}" FROM "${table}" WHERE id = 1`).get()
  if (!row) return []
  try { return JSON.parse(row[column]) } catch { return [] }
}
// 整体覆盖网格某列：原样 JSON 序列化。
// 座位/课表是二维数组，值日表是 {项目:{星期:[人名]}} 对象，统一原样存储，不做强转。
function writeGridArray(table, column, value) {
  db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE id = 1`).run(JSON.stringify(value))
}
// 单元格展示文案：value 可能是纯值（座位 id/姓名、人名），也可能是课表 {course} 对象，
// 统一取可读文本；null/undefined 视为「空」。
function cellText(v) {
  if (v == null) return '空'
  if (typeof v === 'object') return v.course || '空'
  return String(v)
}
// ===== 动态表行级操作辅助（表名受 ALLOWED_TABLES 白名单约束，杜绝注入）=====
function tableCols(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
}
function rowKeys(table, row) {
  const cols = new Set(tableCols(table))
  return Object.keys(row || {}).filter(k => cols.has(k))
}
// 插入一条完整记录（显式带 id，便于删除后再恢复保留引用关系）
function insertRow(table, row) {
  const keys = rowKeys(table, row)
  if (!keys.length) return
  const cols = keys.map(k => `"${k}"`).join(',')
  const ph = keys.map(() => '?').join(',')
  db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${ph})`).run(...keys.map(k => row[k]))
}
function deleteRowById(table, id) {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
}
function updateRowById(table, id, row) {
  const keys = rowKeys(table, row).filter(k => k !== 'id')
  if (!keys.length) return
  const set = keys.map(k => `"${k}" = ?`).join(', ')
  db.prepare(`UPDATE ${table} SET ${set} WHERE id = ?`).run(...keys.map(k => row[k]), id)
}
// 记录显示名：取姓名/小组名/活动主题/倒计时名称，否则回退 #id
function rowName(row, id) {
  return row ? (row.姓名 || row.group_name || row.主题 || row.名称 || `#${row.id ?? id}`) : `#${id}`
}

// 相册排序：按给定 id 顺序整块重写 sort_order（1 起）。相册删除后 id 可能不再存在，跳过即可。
function applyAlbumOrder(ids) {
  const upd = db.prepare('UPDATE albums SET sort_order = ? WHERE id = ?')
  ;(ids || []).forEach((id, i) => upd.run(i + 1, Number(id)))
}
// 分组结构：整块重建某维度下的组与成员。
// snapshot = [{ id, name, gender, sort_order, members: [{ id, member_name, remark, sort_order }] }]
// 先按维度清理现有组与成员，再按快照显式 id 重建（保留引用关系与内部排序）。
function applyGroupSnapshot(dimId, groups) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE dimension_id = ?)').run(dimId)
    db.prepare('DELETE FROM groups WHERE dimension_id = ?').run(dimId)
    const insG = db.prepare('INSERT INTO groups (id, dimension_id, name, gender, sort_order) VALUES (?, ?, ?, ?, ?)')
    const insM = db.prepare('INSERT INTO group_members (id, group_id, member_name, remark, sort_order) VALUES (?, ?, ?, ?, ?)')
    for (const g of groups || []) {
      insG.run(g.id, dimId, g.name ?? '', g.gender ?? null, g.sort_order)
      for (const m of g.members || []) {
        insM.run(m.id, g.id, m.member_name ?? '', m.remark ?? '', m.sort_order)
      }
    }
  })
  tx()
}

// ===================== 命令执行器 =====================
// 指令描述存库，执行逻辑在此注册。重启后读记录仍可执行。
// payload 各动作字段在下方 executors 定义。
const executors = {
  // 单元格编辑：payload { table, rowId, field, oldValue, newValue }
  cell_update: {
    validate({ table, rowId, field }) {
      if (!ALLOWED_TABLES.includes(table) || !Number.isInteger(rowId)) return '参数不完整'
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
      if (!cols.includes(field)) return '字段无效'
      return null
    },
    undo({ table, rowId, field, oldValue }) {
      db.prepare(`UPDATE "${table}" SET "${field}" = ? WHERE id = ?`).run(oldValue, rowId)
    },
    redo({ table, rowId, field, newValue }) {
      db.prepare(`UPDATE "${table}" SET "${field}" = ? WHERE id = ?`).run(newValue, rowId)
    },
    // 生成展示文案：撤销时反向（new→old），重做时正向（old→new）
    describe({ field, oldValue, newValue }, mode) {
      const old = oldValue == null ? '' : oldValue
      const new_ = newValue == null ? '' : newValue
      return mode === 'undo' ? `${field}：「${new_}」→「${old}」` : `${field}：「${old}」→「${new_}」`
    },
    change(p, mode) {
      return { type: 'cell_update', table: p.table, rowId: p.rowId, field: p.field, value: mode === 'undo' ? p.oldValue : p.newValue }
    }
  },

  // 添加一条动态表记录：payload { table, row }（row 为添加后的完整记录，须含 id）
  row_insert: {
    validate({ table, row }) {
      if (!ALLOWED_TABLES.includes(table)) return '表无效'
      if (!row || !Number.isInteger(row.id)) return '参数不完整'
      return null
    },
    undo({ table, row }) { deleteRowById(table, row.id) },
    redo({ table, row }) { insertRow(table, row) },
    describe(p, mode) {
      const name = rowName(p.row)
      return mode === 'undo' ? `撤销添加：${name}` : `重新添加：${name}`
    },
    change(p, mode) {
      return mode === 'undo'
        ? { type: 'row_remove', table: p.table, rowId: p.row.id }
        : { type: 'row_upsert', table: p.table, row: p.row }
    }
  },

  // 编辑动态表记录：payload { table, rowId, oldRow, newRow }
  row_update: {
    validate({ table, rowId }) {
      if (!ALLOWED_TABLES.includes(table) || !Number.isInteger(rowId)) return '参数不完整'
      return null
    },
    undo({ table, rowId, oldRow }) { updateRowById(table, rowId, oldRow) },
    redo({ table, rowId, newRow }) { updateRowById(table, rowId, newRow) },
    describe(p, mode) {
      const name = rowName(p.newRow || p.oldRow, p.rowId)
      return mode === 'undo' ? `撤销编辑：${name}` : `重新编辑：${name}`
    },
    change(p, mode) {
      return { type: 'row_upsert', table: p.table, row: mode === 'undo' ? p.oldRow : p.newRow }
    }
  },

  // 删除动态表记录：payload { table, row }（row 为删除前的完整记录）
  row_delete: {
    validate({ table, row }) {
      if (!ALLOWED_TABLES.includes(table)) return '表无效'
      if (!row || !Number.isInteger(row.id)) return '参数不完整'
      return null
    },
    undo({ table, row }) { insertRow(table, row) },
    redo({ table, row }) { deleteRowById(table, row.id) },
    describe(p, mode) {
      const name = rowName(p.row)
      return mode === 'undo' ? `恢复记录：${name}` : `删除记录：${name}`
    },
    change(p, mode) {
      return mode === 'undo'
        ? { type: 'row_upsert', table: p.table, row: p.row }
        : { type: 'row_remove', table: p.table, rowId: p.row.id }
    }
  },

  // 单格编辑（网格 JSON 列）：payload { table, row, col, oldValue, newValue }
  grid_cell: {
    validate({ table, row, col }) {
      if (!(table in GRID_SOURCES)) return '网格表无效'
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return '参数不完整'
      return null
    },
    apply({ table, row, col, value }) {
      const arr = readGridArray(table, GRID_SOURCES[table])
      if (!arr[row]) arr[row] = []
      arr[row][col] = value == null ? null : value
      writeGridArray(table, GRID_SOURCES[table], arr)
    },
    undo(p) { this.apply({ ...p, value: p.oldValue }) },
    redo(p) { this.apply({ ...p, value: p.newValue }) },
    describe(p, mode) {
      if (p.label) return p.label
      const old = cellText(p.oldValue)
      const new_ = cellText(p.newValue)
      return mode === 'undo' ? `格子(${p.row + 1},${p.col + 1})：「${new_}」→「${old}」` : `格子(${p.row + 1},${p.col + 1})：「${old}」→「${new_}」`
    },
    change(p, mode) {
      return { type: 'grid_cell', table: p.table, row: p.row, col: p.col, value: mode === 'undo' ? p.oldValue : p.newValue }
    }
  },

  // 整块覆盖（网络 JSON 列，用于整行/列换位等批量操作）：
  // payload { table, oldValue, newValue }（oldValue/newValue 为整个 JSON 数组）
  grid_snapshot: {
    validate({ table }) {
      if (!(table in GRID_SOURCES)) return '网格表无效'
      return null
    },
    undo({ table, oldValue }) { writeGridArray(table, GRID_SOURCES[table], oldValue) },
    redo({ table, newValue }) { writeGridArray(table, GRID_SOURCES[table], newValue) },
    describe(p, mode) {
      if (p.label) return p.label
      const dim = (b) => Array.isArray(b) ? `${b.length} 行` : (b && typeof b === 'object' ? `${Object.keys(b).length} 项` : '')
      const old = dim(p.oldValue), new_ = dim(p.newValue)
      return mode === 'undo' ? `整块：${new_} → ${old}` : `整块：${old} → ${new_}`
    },
    change(p, mode) {
      return { type: 'grid_snapshot', table: p.table, value: mode === 'undo' ? p.oldValue : p.newValue }
    }
  },

  // 相册排序整块覆盖：payload { oldOrder, newOrder }，均为相册 id 的有序数组。
  album_order: {
    validate({ oldOrder, newOrder }) {
      if (!Array.isArray(oldOrder) || !Array.isArray(newOrder)) return '参数不完整'
      return null
    },
    undo({ oldOrder }) { applyAlbumOrder(oldOrder) },
    redo({ newOrder }) { applyAlbumOrder(newOrder) },
    describe(p, mode) {
      const order = (mode === 'undo' ? p.oldOrder : p.newOrder) || []
      const nameStmt = db.prepare('SELECT name FROM albums WHERE id = ?')
      const names = order.map(id => { const r = nameStmt.get(id); return r ? r.name : `#${id}` })
      return mode === 'undo' ? `相册排序恢复：${names.join('、')}` : `相册排序：${names.join('、')}`
    },
    change(p, mode) {
      return { type: 'album_order', order: mode === 'undo' ? p.oldOrder : p.newOrder }
    }
  },

  // 分组结构整块重建：payload { dimId, oldValue, newValue }，两值均为该维度的组+成员快照数组。
  // 覆盖增删小组、增删成员、成员拖拽排序、智能分组、小组数量增减等结构性操作。
  group_snapshot: {
    validate({ dimId, oldValue }) {
      if (!Number.isInteger(dimId) || !Array.isArray(oldValue)) return '参数不完整'
      return null
    },
    undo({ dimId, oldValue }) { applyGroupSnapshot(dimId, oldValue) },
    redo({ dimId, newValue }) { applyGroupSnapshot(dimId, newValue) },
    describe(p, mode) {
      const count = (s) => (s || []).length + '/' + (s || []).reduce((n, g) => n + ((g.members || []).length), 0)
      const old = count(p.oldValue), new_ = count(p.newValue)
      return mode === 'undo' ? `分组结构：${new_} → ${old}` : `分组结构：${old} → ${new_}`
    },
    change(p, mode) {
      return { type: 'group_snapshot', dimId: p.dimId, snapshot: mode === 'undo' ? p.oldValue : p.newValue }
    }
  },

  // 删除照片（移入应用内回收站）：payload { photo }。undo=从回收站搬回+还原索引；redo=再次移入回收站+删索引。
  photo_trash: {
    validate({ photo }) {
      if (!photo || !Number.isInteger(photo.id) || !photo.file_path) return '参数不完整'
      return null
    },
    async undo({ photo }) {
      await restoreToOriginal(photo)
      db.prepare('INSERT INTO album_photos (id, album_id, file_path, file_name, file_size, mtime, photo_date, thumb_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(photo.id, photo.album_id || 0, photo.file_path, photo.file_name || '', photo.file_size || 0, photo.mtime || '', photo.photo_date || '', '')
    },
    async redo({ photo }) {
      await moveToTrash(photo)
      await deleteThumb(photo).catch(() => {})
      db.prepare('DELETE FROM album_photos WHERE id = ?').run(photo.id)
    },
    describe(p, mode) {
      const name = p.photo ? (p.photo.file_name || `#${p.photo.id}`) : ''
      return mode === 'undo' ? `恢复照片：${name}` : `删除照片：${name}`
    },
    change() { return { type: 'full_reload' } }
  },

  // 删除相册（仅删索引+缩略图，源文件留在磁盘）：payload { album, photos }。
  // undo=还原相册+照片索引（缩略图由 /thumb 按需重建）；redo=再次删除缩略图+索引。
  album_delete: {
    validate({ album, photos }) {
      if (!album || !Number.isInteger(album.id) || !Array.isArray(photos)) return '参数不完整'
      return null
    },
    async undo({ album, photos }) {
      db.prepare('INSERT INTO albums (id, name, folder_path, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(album.id, album.name || '', album.folder_path || '', album.sort_order || 0, album.created_at || '', album.updated_at || '')
      const ins = db.prepare('INSERT INTO album_photos (id, album_id, file_path, file_name, file_size, mtime, photo_date, thumb_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      for (const ph of photos || []) {
        ins.run(ph.id, album.id, ph.file_path || '', ph.file_name || '', ph.file_size || 0, ph.mtime || '', ph.photo_date || '', '')
      }
    },
    async redo({ album, photos }) {
      for (const ph of photos || []) await deleteThumb(ph).catch(() => {})
      db.prepare('DELETE FROM album_photos WHERE album_id = ?').run(album.id)
      db.prepare('DELETE FROM albums WHERE id = ?').run(album.id)
    },
    describe(p, mode) {
      const name = p.album ? (p.album.name || `#${p.album.id}`) : ''
      const c = (p.photos || []).length
      return mode === 'undo' ? `恢复相册：${name}（${c} 项）` : `删除相册：${name}（${c} 项）`
    },
    change() { return { type: 'full_reload' } }
  },

  // 添加相册（触发后台扫描建索引）：payload { album }。undo=撤销添加（删索引+缩略图+停扫描）；redo=重新添加相册。
  // redo 不自动重扫（照片已被 undo 清掉，缩略图按需重建），用户可点「刷新」重扫。
  album_add: {
    validate({ album }) {
      if (!album || !Number.isInteger(album.id)) return '参数不完整'
      return null
    },
    async undo({ album }) {
      const photos = db.prepare('SELECT id, file_name FROM album_photos WHERE album_id = ?').all(album.id)
      for (const ph of photos) await deleteThumb(ph).catch(() => {})
      db.prepare('DELETE FROM album_photos WHERE album_id = ?').run(album.id)
      db.prepare('DELETE FROM albums WHERE id = ?').run(album.id)
      const albumRouter = require('./album')
      if (albumRouter && albumRouter.cancelScan) albumRouter.cancelScan(album.id)
    },
    redo({ album }) {
      db.prepare('INSERT INTO albums (id, name, folder_path, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(album.id, album.name || '', album.folder_path || '', album.sort_order || 0, album.created_at || '', album.updated_at || '')
      // 重做=重新加入文件夹，触发该相册的增量扫描（由前端轮询逐步显示）
      const albumRouter = require('./album')
      if (albumRouter && albumRouter.startScan) albumRouter.startScan(album.id)
    },
    describe(p, mode) {
      const name = p.album ? (p.album.name || `#${p.album.id}`) : ''
      return mode === 'undo' ? `撤销添加相册：${name}` : `重新添加相册：${name}`
    },
    change() { return { type: 'full_reload' } }
  }
}

// parse payload 安全包裹
function getRecord(id) {
  const rec = db.prepare('SELECT * FROM undo_history WHERE id = ?').get(id)
  if (!rec) return null
  rec.payload = JSON.parse(rec.payload || '{}')
  return rec
}

// 新增一条可撤销记录（undo侧）
function pushRecord(key, type, label, payload) {
  const ts = new Date().toISOString()
  // 新增动作使该 key 的 redo 侧失效
  db.prepare('DELETE FROM undo_history WHERE key = ? AND dir = 0').run(key)
  const info = db.prepare(
    'INSERT INTO undo_history (key, type, label, payload, dir, ts) VALUES (?, ?, ?, ?, 1, ?)'
  ).run(key, type, label, JSON.stringify(payload), ts)
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
  await ex[mode](rec.payload)
  db.prepare('UPDATE undo_history SET dir = ? WHERE id = ?').run(toDir, id)
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
  const { key, type, label, payload } = req.body || {}
  if (!key || !type) return res.status(400).json({ error: '缺少参数' })
  if (!(type in executors)) return res.status(400).json({ error: `不支持的记录类型: ${type}` })
  const id = pushRecord(key, type, label || '', payload || {})
  res.json({ id })
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

module.exports = router