import { ref, computed } from 'vue'
import axios from 'axios'
import { recordGridCellUndo, recordGridSnapshotUndo } from './useUndo.js'
import { useNotification } from './useNotification.js'
import { createSerialSaver } from '../utils/serialSaver.js'
import { createRowReuseCache } from '../utils/rowReuse.js'

// ==================== 座位网格几何辅助（纯函数，座位表与权重表共用） ====================
export function generateColHeaders(cols, mode, showAisle) {
  const headers = []
  if (!showAisle) { for (let i = 0; i < cols; i++) headers.push(`列${i + 1}`); return headers }
  if (mode === 'single') {
    for (let i = 0; i < cols; i++) { headers.push(`列${i + 1}`); if (i < cols - 1) headers.push('走廊') }
  } else {
    for (let i = 0; i < cols; i++) { headers.push(`列${i + 1}`); if ((i + 1) % 2 === 0 && i < cols - 1) headers.push('走廊') }
  }
  return headers
}

export function getDisplayColCount(cols, mode, showAisle) {
  if (!showAisle) return cols
  if (mode === 'single') return cols + (cols - 1)
  else return cols + Math.floor((cols - 1) / 2)
}

export function isAisleCol(displayIdx, cols, mode, showAisle) {
  if (!showAisle) return false
  const totalDisplay = getDisplayColCount(cols, mode, showAisle)
  if (mode === 'single') return displayIdx % 2 === 1
  else return displayIdx >= 2 && (displayIdx - 2) % 3 === 0 && displayIdx < totalDisplay
}

// 构造与座位表同构的显示行（讲台行 + 走廊列 + 数据格）。
// valueAt(rowIdx, realCol) 返回 { course, extra? }；extra 会并入数据格属性（如 _studentId）。
export function buildSeatLikeRows(rows, cols, mode, showAisle, valueAt) {
  const displayCols = getDisplayColCount(cols, mode, showAisle)
  const result = []
  result.push({ _rowKey: 'podium', label: '讲  台', _isPodium: true, _isSeparator: false, _mergeCells: false, _isReadonly: true, cells: [] })
  for (let r = 0; r < rows; r++) {
    const rowCells = []
    let realCol = 0
    for (let d = 0; d < displayCols; d++) {
      if (isAisleCol(d, cols, mode, showAisle)) {
        if (r === 0) {
          rowCells.push({ course: '走廊', _isAisle: true, _aisleRowSpan: rows, _isAisleHidden: false })
        } else {
          rowCells.push({ course: '', _isAisle: false, _isAisleHidden: true })
        }
      } else {
        const v = valueAt(r, realCol) || {}
        rowCells.push({ course: v.course, _isAisle: false, _isAisleHidden: false, ...(v.extra || {}) })
        realCol++
      }
    }
    result.push({ _rowKey: `row_${r}`, label: `第${r + 1}行`, cells: rowCells, _isReadonly: false, _lessonIdx: r, _periodRowSpan: 0, periodLabel: '' })
  }
  return result
}

export function useSeatGrid(apiBase, options = {}) {
  // undo.{key, table}：开启撤销记录；cellBase 为单格更新接口（如 /api/seats/master/cell）
  const { getStudentName = () => '', getStudentId = () => null, undo = null, cellBase = null } = options

  const loaded = ref(false)
  // 加载失败标志：原来失败只 console.error，loaded 一直是 false →
  // 表格永远停在「判定中」占位，看起来像卡住了。提到外面让表格能显示告警 + 重试。
  const loadError = ref(false)
  const rows = ref(6)
  const cols = ref(7)
  const seats = ref([])
  const mode = ref('single')
  const showAisle = ref(true)
  const settings = ref({})
  const settingsVisible = ref(false)
  const currentEditExcludeIds = ref([])
  // 行对象复用缓存：编辑一格时只重建真正变化的那一行，避免整表重画
  const reuseRows = createRowReuseCache()

  // ==================== Computed ====================
  const colHeaders = computed(() => generateColHeaders(cols.value, mode.value, showAisle.value))

  const displayRows = computed(() => reuseRows(buildSeatLikeRows(rows.value, cols.value, mode.value, showAisle.value, (r, c) => {
    const seatVal = seats.value[r]?.[c]
    let displayName = ''
    if (seatVal === null || seatVal === undefined) {
      displayName = ''
    } else if (typeof seatVal === 'number') {
      displayName = getStudentName(seatVal) || ''
    } else {
      displayName = seatVal
    }
    return { course: displayName, extra: { _studentId: seatVal } }
  })))

  const exportFields = computed(() => {
    const fields = [{ name: '行号' }]
    colHeaders.value.forEach(h => fields.push({ name: h }))
    return fields
  })

  const exportRows = computed(() => {
    const headers = colHeaders.value
    const rows = displayRows.value
    return rows.map(row => {
      if (row._isPodium) return { '行号': '讲台', _isPodium: true, label: '讲  台' }
      const obj = { '行号': row.label }
      row.cells.forEach((cell, idx) => {
        const headerName = headers[idx] || `列${idx+1}`
        if (cell._isAisle || cell._isAisleHidden) {
          obj[headerName] = '走廊'
          obj._aisleCell = true
        } else {
          obj[headerName] = cell.course || ''
        }
      })
      return obj
    })
  })

  // ==================== 核心方法 ====================
  function syncCellsToSeats(newRows) {
    const newSeats = []
    for (let r = 0; r < newRows.length; r++) {
      const row = newRows[r]
      if (row._isPodium) continue
      const seatRow = []
      for (let d = 0; d < row.cells.length; d++) {
        if (isAisleCol(d, cols.value, mode.value, showAisle.value)) continue
        const cell = row.cells[d]
        const name = cell?.course?.trim() || ''
        // 候选框里明确点选的学生：直接用它的 id（同名正式/临时也能区分）。
        // 手输的名字没有 _studentId，退回按姓名解析；仍解析不到就暂存姓名（等名字同步后下次保存再转 id）。
        const pickedId = Number.isInteger(cell?._studentId) ? cell._studentId : null
        const studentId = pickedId != null ? pickedId : getStudentId(name)
        if (studentId != null) {
          seatRow.push(studentId)
        } else if (name === '') {
          seatRow.push(null)
        } else {
          seatRow.push(name)
        }
      }
      newSeats.push(seatRow)
    }
    seats.value = newSeats
  }

  async function load() {
    try {
      const res = await axios.get(apiBase)
      rows.value = res.data.rows
      cols.value = res.data.cols
      seats.value = res.data.seats || []
      mode.value = res.data.mode || 'single'
      settings.value = res.data.settings || {}
      showAisle.value = settings.value.showAisle !== false
      loaded.value = true
      loadError.value = false
    } catch (e) { console.error(e); loadError.value = true }
  }

  // 串行保存器：每次编辑都 PUT 整块座位，连续操作会并发发出多个 PUT —— 后端按到达顺序写库，
  // 先发的可能后到，库里最后留下的是**更旧**的状态。串行器保证同一时刻只有一个在途，
  // 在途期间的改动合并成一轮、用最新 seats 再存一次。
  const saver = createSerialSaver(() => axios.put(apiBase, {
    rows: rows.value, cols: cols.value, seats: seats.value,
    mode: mode.value, settings: { showAisle: showAisle.value },
  }))

  async function save() {
    const ok = await saver.request()
    if (!ok) {
      console.error('[seat] 保存失败', saver.error)
      // 原来只 console.error：用户看不到任何反馈，以为已经存上了。
      // 文案固定，靠 useNotification 的同文案合并避免连续编辑时刷屏。
      useNotification().error('座位保存失败，改动未保存')
    }
    return ok
  }

  // 单格更新：有 cellBase（单格接口）则只提单格，否则回退到整块 save
  async function saveSingleCell(row, col, value) {
    if (cellBase) {
      try {
        await axios.patch(cellBase, { row, col, value })
        return true
      } catch (e) {
        console.error(e)
        useNotification().error('座位保存失败，改动未保存')
      }
      return false
    }
    await save()
    return true
  }

  async function onCellsUpdate(newRows) {
    // 计算新座位矩阵并逐格对比旧值，只对发生变化的格子做单格提交 + 撤销记录
    const prev = seats.value.map(r => [...r])
    syncCellsToSeats(newRows)
    const next = seats.value
    const changed = []
    const maxR = Math.max(prev.length, next.length)
    for (let r = 0; r < maxR; r++) {
      const pr = prev[r] || []
      const nr = next[r] || []
      const maxC = Math.max(pr.length, nr.length)
      for (let c = 0; c < maxC; c++) {
        if (pr[c] !== nr[c]) changed.push([r, c])
      }
    }
    if (cellBase && changed.length) {
      // 串行提交每个格子，避免并发 PATCH 到达顺序乱序导致数据覆盖。
      // 撤销记录必须在**该格保存成功之后**再登记：原实现先登记后保存，
      // 保存失败时按 Ctrl+Z 会「撤销」一个根本没落库的改动（B12-06）。
      ;(async () => {
        for (const [r, c] of changed) {
          const ok = await saveSingleCell(r, c, next[r]?.[c] ?? null)
          if (!ok) {
            // 保存失败：以库里的真实数据为准回滚界面，并停止后续格子（避免半新半旧）
            await load()
            return
          }
          if (undo) recordGridCellUndo(undo.key, undo.table, r, c, prev[r]?.[c] ?? null, next[r]?.[c] ?? null)
        }
      })()
    } else {
      const ok = await save()
      if (!ok) {
        await load() // 整块保存失败：回滚到库中真实数据
        return
      }
      if (undo) {
        for (const [r, c] of changed) recordGridCellUndo(undo.key, undo.table, r, c, prev[r]?.[c] ?? null, next[r]?.[c] ?? null)
      }
    }
  }

  async function onSwapRows(fromIdx, toIdx) {
    if (fromIdx === 0 || toIdx === 0) return
    if (fromIdx === toIdx) return
    const seatFrom = fromIdx - 1, seatTo = toIdx - 1
    if (seatFrom < 0 || seatTo < 0 || seatFrom >= seats.value.length || seatTo >= seats.value.length) return
    const prev = seats.value.map(r => [...r])
    const s = [...seats.value]
    // 移动语义：取出源行后插入目标位置，中间行顺移（与拖动时的让位预览一致）
    const [moved] = s.splice(seatFrom, 1)
    s.splice(seatTo, 0, moved)
    seats.value = s
    // 与 onCellsUpdate 统一：保存成功后才登记撤销；失败以库中数据回滚。
    const ok = await save()
    if (!ok) { await load(); return }
    if (undo) recordGridSnapshotUndo(undo.key, undo.table, prev, s)
  }

  async function onSwapColumns(fromDisplayIdx, toDisplayIdx) {
    const map = []
    let real = 0
    const total = getDisplayColCount(cols.value, mode.value, showAisle.value)
    for (let d = 0; d < total; d++) {
      if (!isAisleCol(d, cols.value, mode.value, showAisle.value)) map[d] = real++
      else map[d] = -1
    }
    const from = map[fromDisplayIdx], to = map[toDisplayIdx]
    if (from === -1 || to === -1) return
    const prev = seats.value.map(r => [...r])
    // 移动语义：源列取出后插入目标位置，中间列的数据顺移（表头固定不动）
    const newSeats = seats.value.map(r => {
      const nr = [...r]
      const [moved] = nr.splice(from, 1)
      nr.splice(to, 0, moved)
      return nr
    })
    seats.value = newSeats
    // 与 onCellsUpdate 统一：保存成功后才登记撤销；失败以库中数据回滚。
    const ok = await save()
    if (!ok) { await load(); return }
    if (undo) recordGridSnapshotUndo(undo.key, undo.table, prev, newSeats)
  }

  function onCellDblClick({ rowIdx, colIdx: displayColIdx }) {
    const row = displayRows.value[rowIdx]
    if (!row || row._isReadonly || row._isPodium) return
    const cell = row.cells[displayColIdx]
    if (cell._isAisle || cell._isAisleHidden) return
    const seatRowIdx = rowIdx - 1
    if (seatRowIdx < 0 || seatRowIdx >= seats.value.length) return
    let realCol = 0
    for (let d = 0; d < displayColIdx; d++) {
      if (!isAisleCol(d, cols.value, mode.value, showAisle.value)) realCol++
    }
    const occupied = new Set()
    seats.value.forEach((r, ri) => {
      r.forEach((id, ci) => {
        if (id && !(ri === seatRowIdx && ci === realCol)) occupied.add(id)
      })
    })
    currentEditExcludeIds.value = Array.from(occupied)
  }

  async function saveSettings({ rows: newRows, cols: newCols, mode: newMode, showAisle: newShowAisle }) {
    rows.value = newRows
    cols.value = newCols
    mode.value = newMode
    showAisle.value = newShowAisle
    const newSeats = []
    for (let r = 0; r < newRows; r++) {
      const row = seats.value[r] ? [...seats.value[r]].slice(0, newCols) : []
      while (row.length < newCols) row.push(null)
      newSeats.push(row)
    }
    seats.value = newSeats
    settingsVisible.value = false
    await save()
  }

  // 整块替换座位并保存。
  // 失败时本地已经是新数据、库里还是旧的 —— 重新 load 一次把界面拉回真实状态，
  // 并把 ok 返回给调用方：否则调用方会无条件弹「导入成功」，用户以为存上了。
  async function saveSeats(newSeats) {
    seats.value = newSeats
    const ok = await save()
    if (!ok) {
      try { await load() } catch (_) { /* 回滚也失败时保留 save 已给出的失败提示 */ }
    }
    return ok
  }

  return {
    loaded, loadError, rows, cols, seats, mode, showAisle, settings, settingsVisible, currentEditExcludeIds,
    colHeaders, displayRows, exportFields, exportRows,
    load, save, saveSeats, onCellsUpdate, onSwapRows, onSwapColumns, onCellDblClick, saveSettings,
    generateColHeaders, getDisplayColCount, isAisleCol
  }
}
