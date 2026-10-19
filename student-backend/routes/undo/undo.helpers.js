// =========================================================================
// undo.helpers.js —— 撤销系统·辅助函数
// （原 routes/undo.js 按职责拆分而来，纯代码搬运，行为不变）
//   网格 JSON 读写、动态表行级操作、整块写入、相册排序、分组快照
// =========================================================================

const { db } = require('../../db')

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
// 整块写入「非行式」表：按给定列整体覆盖某行（对象/数组列按 JSON 文本落库）。
// obj 为「列名 → 列值」，仅写入该表真实列（不含 id）。
function writeDocCols(table, id, obj) {
  const keys = rowKeys(table, obj).filter(k => k !== 'id')
  if (!keys.length) return
  const set = keys.map(k => `"${k}" = ?`).join(', ')
  const params = keys.map(k => {
    const v = obj[k]
    if (v != null && typeof v === 'object') return JSON.stringify(v)
    // 布尔按 1/0 落库，避免 INTEGER 列（如 toolbox_enabled / auto_apply）被写入文本
    if (typeof v === 'boolean') return v ? 1 : 0
    return v
  })
  db.prepare(`UPDATE ${table} SET ${set} WHERE id = ?`).run(...params, id)
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

module.exports = {
  readGridArray,
  writeGridArray,
  cellText,
  tableCols,
  rowKeys,
  insertRow,
  deleteRowById,
  updateRowById,
  writeDocCols,
  rowName,
  applyAlbumOrder,
  applyGroupSnapshot,
}
