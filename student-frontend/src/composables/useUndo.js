import { onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import axios from 'axios'

// ==================== 记录一条单元格编辑撤销 ====================
// 供非 useTableCRUD 页面复用。
// key = 后端 undo 分组的表 key（须在 undo.js ALLOWED_TABLES 内）
export function recordCellUndo(key, rowId, fieldName, oldVal, newVal) {
  try {
    axios.post('/api/undo', {
      key,
      type: 'cell_update',
      label: `${fieldName}：「${oldVal == null ? '' : oldVal}」→「${newVal == null ? '' : newVal}」`,
      payload: { table: key, rowId, field: fieldName, oldValue: oldVal, newValue: newVal }
    }).catch(() => {})
  } catch {
    /* 撤销记录失败不影响主流程 */
  }
}

// 单元格展示文案：纯值或课表 {course} 对象都取可读文本
export function cellText(v) {
  if (v == null) return ''
  if (typeof v === 'object') return v.course || ''
  return v
}

// ==================== 记录一条网格单格编辑撤销 ====================
// table 必须是后端 GRID_SOURCES 中的表名，row/col 为格子坐标（从 0 开始）。
// label：可选，传入则优先后端反馈展示（用于值日等需要自定义文案的场景）
export function recordGridCellUndo(key, table, row, col, oldVal, newVal, label) {
  const payload = { table, row, col, oldValue: oldVal, newValue: newVal }
  if (label) payload.label = label
  const text = label || `格子(${row + 1},${col + 1})：「${cellText(oldVal)}」→「${cellText(newVal)}」`
  try {
    axios.post('/api/undo', { key, type: 'grid_cell', label: text, payload }).catch(() => {})
  } catch {
    /* 撤销记录失败不影响主流程 */
  }
}

// ==================== 记录一条网格整块覆盖撤销 ====================
// 用于整行/整列换位等批量操作，oldArr/newArr 为整个网格（数组或对象）快照。
// label：可选，传递时用于通知条展示详细文案（默认「整块变更」，后端有兜底维度文案）
export function recordGridSnapshotUndo(key, table, oldArr, newArr, label) {
  const payload = { table, oldValue: oldArr, newValue: newArr }
  if (label) payload.label = label
  try {
    axios.post('/api/undo', { key, type: 'grid_snapshot', label: label || '整块变更', payload }).catch(() => {})
  } catch {
    /* 撤销记录失败不影响主流程 */
  }
}

// ==================== 记录一条动态表 增/改/删 撤销 ====================
// row 为完整记录对象（须含 id 及所有可回填列字段）。
function pushRow(type, key, row) {
  try {
    axios.post('/api/undo', { key, type, label: row ? `${row.姓名 || row.group_name || row.主题 || row.名称 || `#${row.id}`}` : '', payload: { table: key, row } }).catch(() => {})
  } catch {
    /* 撤销记录失败不影响主流程 */
  }
}
// 添加加分/记录：undo=删除该行，redo=重新插入
export function recordRowInsert(key, row) {
  pushRow('row_insert', key, row)
}
// 删除加分/记录：undo=恢复该行，redo=再次删除
export function recordRowDelete(key, row) {
  pushRow('row_delete', key, row)
}
// 编辑加分/记录（整条替换）：payload { rowId, oldRow, newRow }
export function recordRowUpdate(key, oldRow, newRow) {
  const payload = { table: key, rowId: newRow ? newRow.id : oldRow.id, oldRow, newRow }
  try {
    const name = (newRow || oldRow)?.姓名 || (newRow || oldRow)?.group_name || (newRow || oldRow)?.主题 || (newRow || oldRow)?.名称 || `#${payload.rowId}`
    axios.post('/api/undo', { key, type: 'row_update', label: `${name}`, payload }).catch(() => {})
  } catch {
    /* 撤销记录失败不影响主流程 */
  }
}

// ==================== 全局撤销/重做快捷键 ====================
// 全局 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y。每次只作用于"当前页面/当前激活的那张表"，
// 避免多表互相干扰：多个页面同时挂载时，只有最近注册（focus 激活）的那个生效。
// key 可为字符串（表 key），也可为返回字符串的函数（单个页面含多张表时按需动态切换，如班级活动/倒计时）。
let activePageId = null
let pageCounter = 0

export function useUndoShortcut(key, options = {}) {
  const { onAfterUndo, onAfterRedo } = options
  // 数值型"页面身份"，避免两张同页表共享一个字符串 key 时互相覆盖激活态
  const myId = ++pageCounter
  const resolveKey = () => (typeof key === 'function' ? key() : key)

  function makeHandler(postfix) {
    return async (e) => {
      if (activePageId !== myId) return
      // 仅在表格/页面上生效，避免与输入框内原生 Ctrl+Z / 弹窗内操作冲突
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (!e.ctrlKey && !e.metaKey) return
      const k = e.key.toLowerCase()
      // Ctrl+Z 撤销；Ctrl+Shift+Z 或 Ctrl+Y 重做
      if (k !== 'z' && k !== 'y') return
      const redo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)
      e.preventDefault()
      try {
        const { data } = await axios.post(`/api/undo/table/${resolveKey()}/${redo ? 'redo' : 'undo'}`)
        if (data.ok) {
          if (redo) { if (onAfterRedo) onAfterRedo(data.label) }
          else if (onAfterUndo) onAfterUndo(data.label)
          return true
        }
      } catch {
        /* 静默：撤销失败不打断用户 */
      }
      return false
    }
  }

  const onKeydown = makeHandler()

  // 路由视图外层被 <KeepAlive> 包裹：切换页面不会触发 onUnmounted/onMounted。
  // 因此用 onActivated/onDeactivated 来维护「当前激活视图」的正确性（KeepAlive 也会在首次挂载时触发一次 onActivated），
  // onMounted 仅负责注册全局 keydown 监听，onUnmounted 负责移除。
  const setActive = () => { activePageId = myId }
  const clearActive = () => { if (activePageId === myId) activePageId = null }

  onMounted(() => { setActive(); window.addEventListener('keydown', onKeydown) })
  onActivated(setActive)
  onDeactivated(clearActive)
  onUnmounted(() => { clearActive(); window.removeEventListener('keydown', onKeydown) })

  return { undoCombo: onKeydown }
}