import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import axios from 'axios'
import { useNotification } from './useNotification'

export function useTableCRUD(apiBase, defaultFields, options = {}) {
  const { error: notifyError } = useNotification()
  const {
    requiredField = null,
    protectedColumns = [],
    enableRenameColumn = false,
    customValidate = null,
    undoTableKey = null
  } = options

  // ==================== 状态 ====================
  const rows = ref([])
  const fields = ref([...defaultFields])
  // 撤销专用：最近一次加载的全表快照，作为单元格"旧值"来源
  const rowsSnapshot = ref([])
  const newRow = ref(null)
  const editingCell = ref(null)
  const contextMenu = ref({ visible: false, x: 0, y: 0, items: [] })
  const dialog = ref({ visible: false, message: '', type: 'alert', showCancel: false })
  const columnForm = ref({ name: '', dataType: '文字', after: '', error: '' })
  const renameOldName = ref('')
  const sortField = ref('')
  const sortOrder = ref('asc')
  const searchField = ref(null)
  const searchKeyword = ref('')
  // 防抖后的搜索词：避免每敲一个键就触发全表 filter+sort+重建数组造成卡顿
  const searchKeywordDebounced = ref('')
  let searchTimer = null
  watch(searchKeyword, (v) => {
    clearTimeout(searchTimer)
    if (v === '') { searchKeywordDebounced.value = ''; return }
    searchTimer = setTimeout(() => { searchKeywordDebounced.value = v }, 150)
  })
  const dialogCallback = ref(null)
  const selectedCount = ref(0)
  const clipboard = ref(null)
  const selectedRowKeys = ref([])
  const importDialogVisible = ref(false)
  const dedupeDialogVisible = ref(false)

  // ==================== Computed ====================
  const displayRows = computed(() => {
    let filtered = rows.value
    if (searchField.value && searchKeywordDebounced.value) {
      const kw = searchKeywordDebounced.value.toLowerCase()
      filtered = rows.value.filter(s => {
        const val = s[searchField.value]
        return val != null && String(val).toLowerCase().includes(kw)
      })
    }
    if (sortField.value) {
      const field = sortField.value
      filtered = [...filtered].sort((a, b) => {
        let va = a[field], vb = b[field]
        if (va == null) va = ''
        if (vb == null) vb = ''
        if (!isNaN(va) && !isNaN(vb) && String(va) !== '' && String(vb) !== '') {
          return (Number(va) - Number(vb)) * (sortOrder.value === 'asc' ? 1 : -1)
        }
        return String(va).localeCompare(String(vb), 'zh') * (sortOrder.value === 'asc' ? 1 : -1)
      })
    }
    const list = filtered.map((s, idx) => ({
      ...s,
      _isNew: false,
      _rowKey: s.id,
      _displayIndex: idx + 1,
    }))
    if (!newRow.value) return list
    const insertAt = newRow.value.atPosition
    let insertIdx
    if (insertAt === null || insertAt === undefined) {
      insertIdx = list.length
    } else {
      insertIdx = list.findIndex(s => s.position >= insertAt)
      if (insertIdx === -1) insertIdx = list.length
    }
    list.splice(insertIdx, 0, newRow.value)
    return list
  })

  const visibleFields = computed(() => {
    return fields.value.filter(f => f.name !== 'id' && f.name !== 'position')
  })

  const allBusinessFields = computed(() => {
    return fields.value.filter(f => f.name !== 'id' && f.name !== 'position')
  })

  // ==================== 弹窗 ====================
  function showAlert(msg, cb) {
    dialog.value = { visible: true, message: msg, type: 'alert', showCancel: false }
    dialogCallback.value = cb
  }

  function showConfirm(msg, onConfirm, onCancel) {
    dialog.value = { visible: true, message: msg, type: 'confirm', showCancel: true }
    dialogCallback.value = { confirm: onConfirm, cancel: onCancel }
  }

  function onDialogConfirm() {
    dialog.value.visible = false
    if (dialog.value.type === 'columnAdd') confirmAddColumn()
    else if (dialog.value.type === 'columnRename') confirmRenameColumn()
    else if (typeof dialogCallback.value === 'function') dialogCallback.value()
    else if (dialogCallback.value?.confirm) dialogCallback.value.confirm()
  }

  function onDialogCancel() {
    dialog.value.visible = false
    if (dialogCallback.value?.cancel) dialogCallback.value.cancel()
  }

  // ==================== 数据加载 ====================
  async function fetchRows() {
    try {
      const res = await axios.get(`${apiBase}?_t=${Date.now()}`)
      const result = res.data
      if (Array.isArray(result.data)) {
        rows.value = result.data
        // 撤销用快照：独立浅拷贝，避免被后续 v-model 编辑污染
        rowsSnapshot.value = result.data.map(r => ({ ...r }))
        if (result.fields && result.fields.length > 0) {
          fields.value = result.fields.map(f => {
            const defaultField = defaultFields.find(df => df.name === f.name)
            return { ...f, ...defaultField }
          })
        }
      }
      if (!fields.value || fields.value.length === 0) {
        fields.value = [...defaultFields]
      }
    } catch (err) {
      console.error(err)
      if (!rows.value.length) showAlert('无法加载数据')
    }
  }

  function startEditCell(row, field) {
    editingCell.value = { rowKey: row._rowKey, field: field.name }
  }

  async function saveCell(row, field) {
    if (!editingCell.value) return
    const val = row[field.name]
    if (customValidate && !customValidate(val, field)) {
      showAlert('输入格式错误')
      return
    }
    if (!validateValue(val, field.type)) {
      showAlert('输入格式错误')
      return
    }
    // 旧值来源：编辑前的行快照
    const snap = rowsSnapshot.value.find(r => r.id === row.id)
    const oldVal = snap ? snap[field.name] : undefined
    try {
      await axios.put(`${apiBase}/${row.id}`, { [field.name]: val })
      await fetchRows()
      // 值确实发生变化才记录撤销
      if (undoTableKey && oldVal !== val) {
        recordUndo(row.id, field.name, oldVal, val)
      }
    } catch {
      showAlert('修改失败')
    }
    editingCell.value = null
  }

  // 记录一条持久化撤销（单元格编辑）
  function recordUndo(rowId, fieldName, oldVal, newVal) {
    try {
      axios.post('/api/undo', {
        key: undoTableKey,
        type: 'cell_update',
        label: `${fieldName}：「${oldVal == null ? '' : oldVal}」→「${newVal == null ? '' : newVal}」`,
        payload: { table: undoTableKey, rowId, field: fieldName, oldValue: oldVal, newValue: newVal }
      }).catch(() => {})
    } catch {
      /* 撤销记录失败不影响主流程 */
    }
  }

  function validateValue(val, type) {
    if (val === null || val === undefined || val === '') return true
    if (type === '整数') return /^-?\d+$/.test(String(val))
    if (type === '小数') return /^-?\d+(\.\d+)?$/.test(String(val))
    if (type === '日期') return !isNaN(Date.parse(val))
    return true
  }

  // ==================== 行操作 ====================
  function addNewRowAtBottom() {
    if (!newRow.value) createNewRow(null)
  }

  function insertRowAbove(target) {
    if (!newRow.value) createNewRow(target.position)
  }

  function insertRowBelow(target) {
    if (!newRow.value) createNewRow(target.position + 1)
  }

  function createNewRow(atPosition) {
    if (newRow.value) return
    const empty = {}
    fields.value.forEach(f => { if (f.name !== 'id' && f.name !== 'position') empty[f.name] = '' })
    newRow.value = { ...empty, atPosition, _isNew: true, _rowKey: 'new' }
  }

  function cancelNewRow() {
    newRow.value = null
  }

  async function saveNewRow() {
    if (!newRow.value) return
    if (requiredField && !newRow.value[requiredField]?.trim()) {
      notifyError(`${requiredField}不能为空`)
      return
    }
    const data = {}
    for (const f of fields.value) {
      if (f.name === 'id' || f.name === 'position') continue
      data[f.name] = newRow.value[f.name] || ''
    }
    if (newRow.value.atPosition != null) data.atPosition = newRow.value.atPosition
    try {
      await axios.post(apiBase, data)
      newRow.value = null
      await fetchRows()
    } catch (err) {
      showAlert('添加失败：' + (err.response?.data?.error || err.message))
    }
  }

  async function moveRow(row, direction) {
    try {
      await axios.post(`${apiBase}/move-row`, { id: row.id, direction })
      await fetchRows()
    } catch (err) {
      notifyError(err.response?.data?.error || '移动失败')
    }
  }

  // ==================== 列操作 ====================
  function deleteColumn(field) {
    if (field.name === 'id' || field.name === 'position') return showAlert('不能删除保留字段')
    if (protectedColumns.includes(field.name)) return showAlert('该字段受保护，无法删除')
    showConfirm(`确定删除字段"${field.name}"吗？`, async () => {
      try {
        await axios.delete(`${apiBase}/columns/${field.name}`)
        await fetchRows()
      } catch (err) {
        showAlert(err.response?.data?.error || '删除失败')
      }
    })
  }

  function startAddColumn(position, field) {
    columnForm.value = { name: '', dataType: '文字', after: '', error: '' }
    const idx = fields.value.findIndex(f => f.name === field.name)
    if (position === 'left') {
      if (idx === 0) columnForm.value.after = 'first'
      else columnForm.value.after = fields.value[idx - 1].name
    } else {
      columnForm.value.after = field.name
    }
    dialog.value = { visible: true, type: 'columnAdd', showCancel: true, message: '' }
  }

  async function confirmAddColumn() {
    if (!columnForm.value.name || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(columnForm.value.name)) {
      columnForm.value.error = '列名不合法'
      return
    }
    try {
      await axios.post(`${apiBase}/add-column`, {
        columnName: columnForm.value.name,
        dataType: columnForm.value.dataType,
        after: columnForm.value.after
      })
      dialog.value.visible = false
      await fetchRows()
    } catch (err) {
      columnForm.value.error = err.response?.data?.error || '添加失败'
    }
  }

  function startRenameColumn(field) {
    renameOldName.value = field.name
    columnForm.value = { name: field.name, dataType: '', after: '', error: '' }
    dialog.value = { visible: true, type: 'columnRename', showCancel: true, message: `请输入新列名（当前：${field.name}）` }
  }

  async function confirmRenameColumn() {
    const newName = columnForm.value.name.trim()
    if (!newName || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(newName)) {
      showAlert('列名不合法')
      return
    }
    try {
      await axios.post(`${apiBase}/rename-column`, {
        oldName: renameOldName.value,
        newName
      })
      showAlert(`列名已改为"${newName}"`)
      await fetchRows()
    } catch (err) {
      showAlert(err.response?.data?.error || '重命名失败')
    } finally {
      renameOldName.value = ''
    }
  }

  // ==================== 排序 / 搜索 ====================
  function toggleSort(field) {
    if (sortField.value === field) sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    else { sortField.value = field; sortOrder.value = 'asc' }
    saveCurrentOrder()
  }

  function openSearch(field) {
    searchField.value = field
    searchKeyword.value = ''
  }

  function closeSearch() {
    searchField.value = null
    searchKeyword.value = ''
  }

  // ==================== 右键菜单 ====================
  function openContextMenu(event, type, payload) {
    event.preventDefault()
    contextMenu.value = { visible: false, x: 0, y: 0, items: [] }
    const items = []
    if (type === 'header') {
      const field = payload
      if (field.name !== 'id' && field.name !== 'position') {
        if (enableRenameColumn) {
          items.push({ label: '修改列名', action: () => startRenameColumn(field) })
        }
        items.push({ label: '在左侧插入列', action: () => startAddColumn('left', field) })
        items.push({ label: '在右侧插入列', action: () => startAddColumn('right', field) })
        if (protectedColumns.includes(field.name)) {
          items.push({ label: '删除本列（受保护）', action: () => showAlert(`"${field.name}"是核心字段，禁止删除。`) })
        } else {
          items.push({ label: '删除本列', action: () => deleteColumn(field) })
        }
      }
    } else if (type === 'row') {
      items.push({ label: '上移', action: () => moveRow(payload, 'up') })
      items.push({ label: '下移', action: () => moveRow(payload, 'down') })

      if (clipboard.value && clipboard.value.ids.length > 0) {
        const pasteCount = clipboard.value.ids.length
        items.push({ label: `📋 粘贴到上方 (${pasteCount})`, action: () => pasteRows('above', payload) })
        items.push({ label: `📋 粘贴到下方 (${pasteCount})`, action: () => pasteRows('below', payload) })
      }

      items.push({ label: '在上面插入行', action: () => insertRowAbove(payload) })
      items.push({ label: '在下面插入行', action: () => insertRowBelow(payload) })

      const cutCount = selectedCount.value > 1 ? selectedCount.value : 1
      items.push({ label: `✂️ 剪切 (${cutCount})`, action: () => cutRows(payload) })

      const delCount = selectedCount.value > 1 ? selectedCount.value : 1
      items.push({ label: `🗑️ 删除 (${delCount})`, action: () => deleteRows(payload) })
    } else if (type === 'newRow') {
      items.push({ label: '取消新行', action: () => { newRow.value = null } })
    }
    if (items.length) {
      contextMenu.value = { visible: true, x: event.clientX, y: event.clientY, items }
    }
  }

  function onUpdateNewRow(fieldName, value) {
    if (newRow.value) newRow.value[fieldName] = value
  }

  // ==================== 剪切 / 粘贴 / 删除 ====================
  function cutRows(targetRow) {
    if (selectedCount.value > 1) {
      cutSelectedRows()
    } else {
      const row = targetRow
      if (!row || row._isNew) return
      clipboard.value = { rows: [row], ids: [row.id] }
      rows.value = rows.value.filter(s => s.id !== row.id)
      selectedCount.value = 0
      selectedRowKeys.value = []
    }
  }

  function cutSelectedRows() {
    const keys = selectedRowKeys.value
    if (!keys || keys.length === 0) return
    const cutRowsData = rows.value.filter(s => keys.includes(s.id))
    clipboard.value = { rows: cutRowsData, ids: cutRowsData.map(s => s.id) }
    rows.value = rows.value.filter(s => !keys.includes(s.id))
    selectedCount.value = 0
    selectedRowKeys.value = []
  }

  function deleteRows(targetRow) {
    if (selectedCount.value > 1) {
      onBatchDelete()
    } else {
      const row = targetRow
      if (!row || row._isNew) return
      showConfirm('确定删除该记录吗？', async () => {
        try {
          await axios.delete(`${apiBase}/${row.id}`)
          await fetchRows()
          selectedCount.value = 0
          selectedRowKeys.value = []
        } catch (err) {
          showAlert('删除失败')
        }
      })
    }
  }

  async function onBatchDelete() {
    const keys = selectedRowKeys.value
    if (!keys || keys.length === 0) return
    const selectedIds = rows.value.filter(s => keys.includes(s.id)).map(s => s.id)
    showConfirm(`确定删除选中的 ${selectedIds.length} 条记录吗？`, async () => {
      try {
        // 并行删除所有选中行，逐个收集结果（不再静默吞错）
        const results = await Promise.all(selectedIds.map(async id => {
          try {
            await axios.delete(`${apiBase}/${id}`)
            return { ok: true }
          } catch (err) {
            return { ok: false, msg: err.response?.data?.error || '删除失败' }
          }
        }))
        await fetchRows()
        selectedCount.value = 0
        selectedRowKeys.value = []
        // 有失败时区分原因：只要存在「至少保留一个学生」保护导致的失败，就优先给明确提示条
        const fails = results.filter(r => !r.ok)
        if (fails.some(f => /保留.{0,2}一个学生/.test(f.msg || ''))) {
          notifyError('至少需要保留一个学生')
        } else if (fails.length) {
          notifyError('部分记录删除失败，请重试')
        }
      } catch (err) {
        showAlert('删除失败')
      }
    })
  }

  function pasteRows(position, targetRow) {
    if (!clipboard.value || clipboard.value.ids.length === 0) return
    const { rows: clipRows } = clipboard.value
    const targetIndex = rows.value.findIndex(r => r.id === targetRow.id)
    if (targetIndex === -1) return
    const insertIdx = position === 'above' ? targetIndex : targetIndex + 1
    rows.value.splice(insertIdx, 0, ...clipRows)
    const newIds = rows.value.map(r => r.id)
    axios.post(`${apiBase}/reorder`, { ids: newIds }).catch(() => {
      showAlert('粘贴失败')
      fetchRows()
    })
    clipboard.value = null
  }

  function onMoveSelectedRows({ selectedKeys, oldIndex, newIndex, isDownward }) {
    const records = [...rows.value]
    const selectedRows = selectedKeys.map(key => records.find(r => r.id === key || r._rowKey === key)).filter(r => r && !r._isNew)
    if (selectedRows.length === 0) return
    const selectedIds = selectedRows.map(r => r.id)
    const otherRows = records.filter(r => !selectedIds.includes(r.id))
    const rowsBefore = records.slice(0, newIndex).filter(r => !selectedIds.includes(r.id)).length
    const insertIdx = isDownward ? rowsBefore + 1 : rowsBefore
    otherRows.splice(insertIdx, 0, ...selectedRows)
    rows.value = otherRows
    const ids = otherRows.map(r => r.id)
    axios.post(`${apiBase}/reorder`, { ids }).catch(() => {
      showAlert('移动失败')
      fetchRows()
    })
  }

  // ==================== 导入 / 导出 / 去重 ====================
  async function onImportData({ fields, rows: importRows }) {
    importDialogVisible.value = false
    try {
      const res = await axios.post(`${apiBase}/import`, { fields, rows: importRows })
      notifySuccess(res.data.message)
      await fetchRows()
    } catch (err) {
      notifyError(err.response?.data?.error || '导入失败')
    }
  }

  async function onDeleteDuplicates(ids) {
    if (!ids || ids.length === 0) return
    showConfirm(`确定删除选中的 ${ids.length} 条重复记录吗？`, async () => {
      try {
        for (const id of ids) {
          await axios.delete(`${apiBase}/${id}`)
        }
        await fetchRows()
        dedupeDialogVisible.value = false
        showAlert('已成功删除所选重复数据')
      } catch (err) {
        showAlert('删除重复数据失败')
      }
    })
  }

  // ==================== 行/列拖拽 ====================
  async function onSwapRows(fromIndex, toIndex) {
    const records = [...rows.value]
    const [moved] = records.splice(fromIndex, 1)
    records.splice(toIndex, 0, moved)
    rows.value = records
    const ids = records.map(r => r.id)
    try {
      await axios.post(`${apiBase}/reorder`, { ids })
    } catch (err) {
      showAlert('排序更新失败')
      await fetchRows()
    }
  }

  async function onSwapColumns(fromIndex, toIndex) {
    const vFields = visibleFields.value
    const moved = vFields[fromIndex]
    const reordered = [...vFields]
    reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    let targetName = null, position = 'first'
    if (toIndex > 0) {
      targetName = reordered[toIndex - 1]?.name
      position = 'after'
    }
    if (position === 'after' && targetName === moved.name) return
    const originalFields = [...fields.value]
    fields.value = reordered
    try {
      await axios.post(`${apiBase}/move-column`, {
        columnName: moved.name,
        targetColumnName: position === 'first' ? null : targetName,
        position
      })
      // 移动列不改变行数据，不需要重新拉取，避免行的 FLIP 交换动画被误触发
    } catch (err) {
      fields.value = originalFields
      showAlert('列移动失败')
    }
  }

  function onSelectionChange({ count, keys }) {
    selectedCount.value = count
    selectedRowKeys.value = keys
  }

  function deleteRowById(id) {
    if (selectedCount.value > 1) {
      onBatchDelete()
    } else {
      showConfirm('确定删除该记录吗？', async () => {
        try {
          await axios.delete(`${apiBase}/${id}`)
          await fetchRows()
          selectedCount.value = 0
          selectedRowKeys.value = []
        } catch (err) {
          showAlert('删除失败')
        }
      })
    }
  }

  function saveCurrentOrder() {
    const display = displayRows.value.filter(r => !r._isNew)
    const ids = display.map(r => r.id)
    if (ids.length > 0) axios.post(`${apiBase}/reorder`, { ids }).catch(() => {})
  }

  // ==================== 事件监听（修复内存泄漏） ====================
  const hideContextMenu = () => {
    contextMenu.value.visible = false
  }

  onMounted(() => {
    fetchRows()
    document.addEventListener('click', hideContextMenu)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', hideContextMenu)
    clearTimeout(searchTimer)
  })

  return {
    rows, fields, newRow, editingCell,
    contextMenu, dialog, columnForm, renameOldName,
    sortField, sortOrder, searchField, searchKeyword,
    dialogCallback, selectedCount, clipboard, selectedRowKeys,
    importDialogVisible, dedupeDialogVisible,
    displayRows, visibleFields, allBusinessFields,
    fetchRows, showAlert, showConfirm, onDialogConfirm, onDialogCancel,
    startEditCell, saveCell, validateValue,
    addNewRowAtBottom, insertRowAbove, insertRowBelow, createNewRow, cancelNewRow, saveNewRow,
    moveRow, deleteColumn, startAddColumn, confirmAddColumn,
    startRenameColumn, confirmRenameColumn,
    toggleSort, openSearch, closeSearch, openContextMenu,
    onUpdateNewRow, cutRows, cutSelectedRows, deleteRows, onBatchDelete,
    pasteRows, onMoveSelectedRows, onSwapRows, onSwapColumns,
    onSelectionChange, onImportData, onDeleteDuplicates,
    saveCurrentOrder, deleteRowById
  }
}
