// =========================================================================
// undo.executors.js —— 撤销系统·命令执行器
// （原 routes/undo.js 按职责拆分而来，纯代码搬运，行为不变）
//   指令描述存库，执行逻辑在此注册。重启后读记录仍可执行。
// =========================================================================

const { db } = require('../../db')
const dbManager = require('../../dbManager/dbManager')
const { moveToTrash, restoreToOriginal, deleteThumb } = require('../../albumOps')
const {
  readGridArray, writeGridArray, cellText,
  insertRow, deleteRowById, updateRowById, writeDocCols, rowName,
  applyAlbumOrder, applyGroupSnapshot,
} = require('./undo.helpers')

// 允许记录的动态表名（防注入）。含 cadre_members：跨表批量写入（propose_batch）可能写入职务成员，需可撤销。
const ALLOWED_TABLES = ['students', 'fee_records', 'leave_records', 'score_records', 'group_members', 'groups', 'group_dimensions', 'activities', 'countdowns', 'cadres', 'cadre_members']

// 「整块 JSON 列」表：数据以整块 JSON 存于单列（座位 seats / 权重 weights / 课表 cells…），
// 撤销时按「整块列值」整体还原。表名固定，杜绝注入。
const DOC_TABLES = ['schedule', 'master_schedule', 'seat_layout', 'seat_template', 'seat_weight', 'duty_settings', 'duty_layout', 'duty_template', 'duty_weight', 'widget_settings']

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

  // 整块写入「非行式」表（座位/权重/课表/值日/模板等）：
  // payload { table, id, before, after, label }，before/after 为「列名 → 整块列值」。
  // 覆盖一列或多列；对象/数组列按 JSON 文本落库。undo 写回 before，redo 写回 after。
  doc_update: {
    validate({ table, id, before }) {
      if (!DOC_TABLES.includes(table) || !Number.isInteger(id)) return '参数不完整'
      if (!before || typeof before !== 'object') return '参数不完整'
      return null
    },
    undo({ table, id, before }) { writeDocCols(table, id, before) },
    redo({ table, id, after }) { writeDocCols(table, id, after) },
    describe(p, mode) {
      if (p.label) return p.label
      const cols = Object.keys(p.before || {}).join('、')
      return mode === 'undo' ? `整块还原：${cols}` : `整块写入：${cols}`
    },
    change() { return { type: 'full_reload' } }
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
      db.prepare('INSERT INTO album_photos (id, album_id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(photo.id, photo.album_id || 0, photo.file_path, photo.file_name || '', photo.file_size || 0, photo.mtime || '', photo.photo_date || '', photo.exif_date || '', photo.date_src || '', '')
    },
    async redo({ photo }) {
      await moveToTrash(photo)
      await deleteThumb(photo, dbManager.currentSlug()).catch(() => {})
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
      const ins = db.prepare('INSERT INTO album_photos (id, album_id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      for (const ph of photos || []) {
        ins.run(ph.id, album.id, ph.file_path || '', ph.file_name || '', ph.file_size || 0, ph.mtime || '', ph.photo_date || '', ph.exif_date || '', ph.date_src || '', '')
      }
    },
    async redo({ album, photos }) {
      const slug = dbManager.currentSlug();
      for (const ph of photos || []) await deleteThumb(ph, slug).catch(() => {})
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
      const slug = dbManager.currentSlug();
      for (const ph of photos) await deleteThumb(ph, slug).catch(() => {})
      db.prepare('DELETE FROM album_photos WHERE album_id = ?').run(album.id)
      db.prepare('DELETE FROM albums WHERE id = ?').run(album.id)
      const albumRouter = require('../album')
      if (albumRouter && albumRouter.cancelScan) albumRouter.cancelScan(album.id)
    },
    redo({ album }) {
      // kind 必须一起还原：虚拟相册没有文件夹，重做时不能去扫路径（会白跑一轮扫描）
      const kind = album.kind === 'virtual' ? 'virtual' : 'folder'
      db.prepare('INSERT INTO albums (id, name, folder_path, kind, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(album.id, album.name || '', album.folder_path || '', kind, album.sort_order || 0, album.created_at || '', album.updated_at || '')
      if (kind === 'virtual') return
      // 重做=重新加入文件夹，触发该相册的增量扫描（由前端轮询逐步显示）
      const albumRouter = require('../album')
      if (albumRouter && albumRouter.startScan) albumRouter.startScan(album.id)
    },
    describe(p, mode) {
      const name = p.album ? (p.album.name || `#${p.album.id}`) : ''
      return mode === 'undo' ? `撤销添加相册：${name}` : `重新添加相册：${name}`
    },
    change() { return { type: 'full_reload' } }
  },

  // 移动照片索引到另一个相册：payload { target_album_id, target_album_name, records }。
  // records 每项记录来源行与本次动作（inserted=目标侧新增；source_removed=来源是虚拟相册、索引已被搬走）。
  // undo=删掉目标侧新增的索引 + 还原被搬走的来源索引；redo=再做一遍。全程只动 album_photos，不碰文件。
  album_photo_move: {
    validate({ target_album_id, records }) {
      if (!Number.isInteger(target_album_id) || !Array.isArray(records)) return '参数不完整'
      return null
    },
    async undo({ target_album_id, records }) {
      const delTarget = db.prepare('DELETE FROM album_photos WHERE album_id = ? AND file_path = ?')
      const ins = db.prepare('INSERT OR IGNORE INTO album_photos (id, album_id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      for (const r of records || []) {
        if (!r || !r.file_path) continue
        // 只删本次真正插入的行；移动前目标相册里就有的同一文件不能删
        if (r.inserted) delTarget.run(target_album_id, r.file_path)
        // 来源行被搬走的，按原 id 还原（缩略图交给 /thumb 按需重建）
        if (r.source_removed && Number.isInteger(r.source_photo_id)) {
          ins.run(r.source_photo_id, r.source_album_id, r.file_path, r.file_name || '', r.file_size || 0, r.mtime || '', r.photo_date || '', r.exif_date || '', r.date_src || '', '')
        }
      }
    },
    async redo({ target_album_id, records }) {
      // thumb_path 置空：redo 插回目标侧的是新行（无 id / 无缩略图缓存），
      // 缩略图由 /thumb 按需生成。末尾那个 '' 就是 thumb_path 的实参 ——
      // 少传一个会直接抛「Too few parameter values were provided」。
      const ins = db.prepare('INSERT OR IGNORE INTO album_photos (album_id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const del = db.prepare('DELETE FROM album_photos WHERE id = ?')
      for (const r of records || []) {
        if (!r || !r.file_path) continue
        if (r.inserted) ins.run(target_album_id, r.file_path, r.file_name || '', r.file_size || 0, r.mtime || '', r.photo_date || '', r.exif_date || '', r.date_src || '', '')
        if (r.source_removed && Number.isInteger(r.source_photo_id)) del.run(r.source_photo_id)
      }
    },
    describe(p, mode) {
      const name = p.target_album_name ? `「${p.target_album_name}」` : ''
      const count = (p.records || []).length
      return mode === 'undo' ? `撤销移动照片索引${name}（${count} 张）` : `移动照片索引${name}（${count} 张）`
    },
    change() { return { type: 'full_reload' } }
  }
}

module.exports = { executors, ALLOWED_TABLES, DOC_TABLES, GRID_SOURCES }
