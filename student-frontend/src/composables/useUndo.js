import { onMounted, onUnmounted, onActivated, onDeactivated, reactive, watch } from 'vue'
import { pushUndo, undoStatus, applyUndo } from '../api/undo'
import { useNotification } from './useNotification.js'

// 登记撤销失败时的弱提示（B09-14/15/16）。
// 调用处原先统一 `.catch(() => {})`：操作本身已经完成，但撤销列表里没有这一条，
// 用户按 Ctrl+Z 才发现「撤不回去」。这里留日志并明确告知「本次无法撤销」。
export function warnUndoFailed(label) {
  const text = label ? `「${label}」已完成，但本次无法撤销` : '操作已完成，但本次无法撤销'
  console.warn('[undo] 登记撤销失败：', label || '')
  try { useNotification().warning(text) } catch (_) { /* 通知不可用时仅保留日志 */ }
}

// ==================== 记录一条单元格编辑撤销 ====================
// 供非 useTableCRUD 页面复用。
// key = 后端 undo 分组的表 key（须在 undo.js ALLOWED_TABLES 内）
export function recordCellUndo(key, rowId, fieldName, oldVal, newVal) {
  try {
    pushUndo({
      key,
      type: 'cell_update',
      label: `${fieldName}：「${oldVal == null ? '' : oldVal}」→「${newVal == null ? '' : newVal}」`,
      payload: { table: key, rowId, field: fieldName, oldValue: oldVal, newValue: newVal }
    }).then(() => refreshUndoStatus(true)).catch(() => {})
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
    pushUndo({ key, type: 'grid_cell', label: text, payload }).then(() => refreshUndoStatus(true)).catch(() => {})
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
    pushUndo({ key, type: 'grid_snapshot', label: label || '整块变更', payload }).then(() => refreshUndoStatus(true)).catch(() => {})
  } catch {
    /* 撤销记录失败不影响主流程 */
  }
}

// ==================== 记录一条动态表 增/改/删 撤销 ====================
// row 为完整记录对象（须含 id 及所有可回填列字段）。
// 返回 Promise<撤销记录 id | null>：调用方拿到 id 后可以 undoById(id) 精确撤销这一条，
// 不必走 performUndo 的「当前激活表」上下文（用户删完立刻切页面时，那个上下文已经换表了）。
// 不接返回值的既有调用方行为不变。
function pushRow(type, key, row) {
  try {
    return pushUndo({ key, type, label: row ? `${row.姓名 || row.group_name || row.主题 || row.名称 || `#${row.id}`}` : '', payload: { table: key, row } })
      .then(res => {
        refreshUndoStatus(true)
        return (res && res.data && res.data.id) || null
      })
      .catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}
// 添加加分/记录：undo=删除该行，redo=重新插入
export function recordRowInsert(key, row) {
  pushRow('row_insert', key, row)
}
// 删除加分/记录：undo=恢复该行，redo=再次删除。
// 返回 Promise<撤销记录 id | null>，供「撤销」提示条直接按 id 撤销（见 pushRow 说明）。
export function recordRowDelete(key, row) {
  return pushRow('row_delete', key, row)
}
// 编辑加分/记录（整条替换）：payload { rowId, oldRow, newRow }
export function recordRowUpdate(key, oldRow, newRow) {
  const payload = { table: key, rowId: newRow ? newRow.id : oldRow.id, oldRow, newRow }
  try {
    const name = (newRow || oldRow)?.姓名 || (newRow || oldRow)?.group_name || (newRow || oldRow)?.主题 || (newRow || oldRow)?.名称 || `#${payload.rowId}`
    pushUndo({ key, type: 'row_update', label: `${name}`, payload }).then(() => refreshUndoStatus(true)).catch(() => {})
  } catch {
    /* 撤销记录失败不影响主流程 */
  }
}

// ==================== 全局撤销/重做状态（供标题栏按钮读取）====================
// 与快捷键共用同一套「当前激活页」上下文：一次只作用于最近激活的那张表。
export const undoState = reactive({
  key: null,        // 当前激活页的表 key；null 表示该页不支持撤销
  canUndo: false,
  canRedo: false,
  undoLabel: '',
  redoLabel: '',
  busy: false,      // 正在执行撤销/重做，防连点
})

// 当前激活页上下文：{ pageId, resolveKey, onAfterUndo, onAfterRedo }
let activeCtx = null
let pageCounter = 0

// 状态查询节流：同 key 在 400ms 内不重复请求（force=true 时忽略），并将过期结果丢弃
let _lastProbe = { key: '', at: 0 }
let _probeSeq = 0

// 拉取当前激活页的撤销可用态。force=true 用于「执行后/写入后/切换页」等必须即时更新的场景。
export function refreshUndoStatus(force = false) {
  const key = activeCtx ? activeCtx.resolveKey() : null
  undoState.key = key || null
  if (!key) {
    undoState.canUndo = false
    undoState.canRedo = false
    undoState.undoLabel = ''
    undoState.redoLabel = ''
    return
  }
  const now = Date.now()
  if (!force && _lastProbe.key === key && now - _lastProbe.at < 400) return
  _lastProbe = { key, at: now }
  const seq = ++_probeSeq
  undoStatus(key)
    .then(({ data }) => {
      // 过期或已切页的结果直接丢弃，避免旧 key 的状态覆盖新 key
      if (seq !== _probeSeq || undoState.key !== key) return
      undoState.canUndo = !!data.canUndo
      undoState.canRedo = !!data.canRedo
      undoState.undoLabel = data.undoLabel || ''
      undoState.redoLabel = data.redoLabel || ''
    })
    .catch(() => { /* 静默：状态查询失败不打断用户 */ })
}

// 执行撤销/重做：供标题栏按钮与快捷键共用。redo=false 撤销，redo=true 重做。
export function performUndo(redo = false) {
  const ctx = activeCtx
  if (!ctx || undoState.busy) return Promise.resolve(false)
  const key = ctx.resolveKey()
  if (!key) return Promise.resolve(false)
  undoState.busy = true
  return applyUndo(key, redo)
    .then(({ data }) => {
      if (data.ok) {
        if (redo) { if (ctx.onAfterRedo) ctx.onAfterRedo(data.label, data.change) }
        else if (ctx.onAfterUndo) ctx.onAfterUndo(data.label, data.change)
        refreshUndoStatus(true)
        return true
      }
      return false
    })
    .catch(() => false)
    .finally(() => { undoState.busy = false })
}

// ==================== 全局撤销/重做快捷键 ====================
// 全局 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y。每次只作用于"当前页面/当前激活的那张表"，
// 避免多表互相干扰：多个页面同时挂载时，只有最近注册（focus 激活）的那个生效。
// key 可为字符串（表 key），也可为返回字符串的函数（单个页面含多张表时按需动态切换，如班级活动/倒计时）。
export function useUndoShortcut(key, options = {}) {
  const { onAfterUndo, onAfterRedo } = options
  // 数值型"页面身份"，避免两张同页表共享一个字符串 key 时互相覆盖激活态
  const myId = ++pageCounter
  const resolveKey = () => (typeof key === 'function' ? key() : key)

  function onKeydown(e) {
    if (!activeCtx || activeCtx.pageId !== myId) return
    // 仅在表格/页面上生效，避免与输入框内原生 Ctrl+Z / 弹窗内操作冲突
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    if (!e.ctrlKey && !e.metaKey) return
    const k = e.key.toLowerCase()
    // Ctrl+Z 撤销；Ctrl+Shift+Z 或 Ctrl+Y 重做
    if (k !== 'z' && k !== 'y') return
    const redo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)
    e.preventDefault()
    performUndo(redo)
  }

  // 路由视图外层被 <KeepAlive> 包裹：切换页面不会触发 onUnmounted/onMounted。
  // 因此用 onActivated/onDeactivated 来维护「当前激活视图」的正确性（KeepAlive 也会在首次挂载时触发一次 onActivated），
  // onMounted 仅负责注册全局 keydown 监听，onUnmounted 负责移除。
  const setActive = () => {
    activeCtx = { pageId: myId, resolveKey, onAfterUndo, onAfterRedo }
    refreshUndoStatus(true)
  }
  const clearActive = () => {
    if (activeCtx && activeCtx.pageId === myId) {
      activeCtx = null
      refreshUndoStatus(true)
    }
  }

  // 页内动态 key（如活动/倒计时 tab 切换）：key 变化时刷新可用态
  watch(resolveKey, () => { if (activeCtx && activeCtx.pageId === myId) refreshUndoStatus(true) })

  onMounted(() => { setActive(); window.addEventListener('keydown', onKeydown) })
  onActivated(setActive)
  onDeactivated(clearActive)
  onUnmounted(() => { clearActive(); window.removeEventListener('keydown', onKeydown) })

  return { undoCombo: onKeydown }
}