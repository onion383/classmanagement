<template>
  <div class="min-w-0">
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="students" /> 学生管理</h1>
    </div>

    <!-- 学生信息 / 班干部管理 Tab 切换 -->
    <Tabs :tabs="tabsList" v-model="activeTab" class="mb-4" />

    <!-- 班干部管理 -->
    <CadreManage v-if="activeTab === 'cadres'" />

    <!-- 学生信息 -->
    <template v-else>
    <!-- 工具栏按钮 -->
    <div class="mb-4 flex flex-wrap items-center gap-3 opbar">
      <button @click="openAddDialog" v-preload="loadAddStudentDialog" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded">
        ＋ 添加学生
      </button>
      <button @click="searchPanelOpen = !searchPanelOpen" class="btn-search px-4 py-2 rounded flex items-center gap-1.5" title="搜索">
        <IconGlyph name="search" :size="14" tint="current" /> 搜索
      </button>
      <button @click="refreshStudents" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1 btn-refresh" title="刷新表格">
        <IconGlyph name="refresh" :size="14" tint="current" /> 刷新
      </button>
      <button
        @click="onBatchDelete"
        :disabled="selectedCount === 0"
        class="bg-danger hover:bg-danger-hover text-text-inverse px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
      >
        <IconGlyph name="trash" :size="14" tint="current" /> 批量删除 ({{ selectedCount }})
      </button>
      <button @click="importDialogVisible = true" v-preload="loadImportExcel" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1.5">
        <IconGlyph name="download" :size="14" tint="current" /> 从 Excel 导入
      </button>
      <button
        @click="openExport"
        v-preload="loadExportExcel"
        class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"
      >
        <IconGlyph name="download" :size="14" tint="current" /> 导出 Excel
      </button>
      <button @click="dedupeDialogVisible = true" v-preload="loadDeduplicateDialog" class="bg-danger hover:bg-danger-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1.5">
        <IconGlyph name="search" :size="14" tint="current" /> 去除重复数据
      </button>
    </div>

    <SearchBar
      :fields="searchableFields"
      :visible="searchPanelOpen"
      :searchField="searchField"
      :keyword="searchKeyword"
      @update:keyword="searchKeyword = $event"
      @update:searchField="onPickSearchField"
      @close="onCloseSearch"
    />

    <ConfirmDialog
      v-if="dialogMounted"
      :visible="dialog.visible"
      :message="dialog.message"
      :type="dialog.type"
      :showCancel="dialog.showCancel"
      :extraText="dialog.extraText"
      v-model:columnName="columnForm.name"
      v-model:columnType="columnForm.dataType"
      :errorMsg="columnForm.error"
      @confirm="onDialogConfirm"
      @cancel="onDialogCancel"
      @extra="onDialogExtra"
    />

    <ContextMenu
      v-if="contextMenuMounted"
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.items"
    />

    <DynamicTable
      ref="dynamicTable"
      :fields="visibleFields"
      :rows="displayRows"
      :displayIndexes="displayIndexes"
      :newRow="newRow"
      :protectedColumns="['学号', '姓名']"
      :sortField="sortField"
      :sortOrder="sortOrder"
      :editingCell="editingCell"
      :search-active="searchActive"
      @contextmenu="openContextMenu"
      @search="onOpenStructuralSearch"
      @toggleSort="toggleSort"
      @saveNewRow="saveNewRow"
      @cancelNewRow="cancelNewRow"
      @startEdit="startEditCell"
      @saveCell="saveCell"
      @moveRow="moveRow"
      @deleteRow="deleteStudent"
      @addNewRowAtBottom="addNewRowAtBottom"
      @updateNewRow="onUpdateNewRow"
      @swapRows="onSwapRows"
      @swapColumns="onSwapColumns"
      @selectionChange="onSelectionChange"
      @moveSelectedRows="onMoveSelectedRows"
    />

    <ExportExcel
      v-if="exportMounted"
      :is-visible="exportDialogVisible"
      @update:is-visible="exportDialogVisible = $event"
      :rows="students"
      :fields="visibleFields"
      :selectedRowKeys="selectedRowKeys"
      :tableElement="tableElement"
      defaultFilename="学生信息"
      @export-finish="onExportFinish"
    />
    <ImportExcel
      v-if="importMounted"
      :visible="importDialogVisible"
      :existingFields="visibleFields"
      :requiredFields="['姓名']"
      @import-data="onImportData"
      @cancel="importDialogVisible = false"
    />
    <DeduplicateDialog
      v-if="dedupeMounted"
      :visible="dedupeDialogVisible"
      :rows="students"
      :fields="allBusinessFields"
      @delete-rows="onDeleteDuplicates"
      @cancel="dedupeDialogVisible = false"
    />
    <AddStudentDialog
      v-if="addMounted"
      :visible="addDialogVisible"
      :fields="visibleFields"
      :required-field="'姓名'"
      @confirm="onAddStudent"
      @cancel="addDialogVisible = false"
    />
    </template>
   </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onActivated, getCurrentInstance, defineAsyncComponent } from 'vue'
import axios from 'axios'
import SearchBar from '../components/base/SearchBar.vue'
import DynamicTable from '../components/tables/DynamicTable/DynamicTable.vue'
import Tabs from '../components/base/Tabs.vue'
import { useTableCRUD } from '../composables/useTableCRUD.js'
import { useUndoShortcut } from '../composables/useUndo.js'
import { useNotification } from '../composables/useNotification.js'
import { applyRouteRowFocus } from '../composables/useRowFocus.js'

// 学生信息 / 班干部管理 Tab
const tabsList = [
  { value: 'students', label: '学生信息' },
  { value: 'cadres', label: '班干部管理' }
]
const activeTab = ref('students')

// 弹窗类组件懒加载：打开时才加载对应 chunk
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))
const ContextMenu = defineAsyncComponent(() => import('../components/base/ContextMenu.vue'))
const loadExportExcel = () => import('../components/import-export/ExportExcel/ExportExcel.vue')
const ExportExcel = defineAsyncComponent(loadExportExcel)
const loadImportExcel = () => import('../components/import-export/ImportExcel.vue')
const ImportExcel = defineAsyncComponent(loadImportExcel)
const loadDeduplicateDialog = () => import('../components/dialogs/DeduplicateDialog.vue')
const DeduplicateDialog = defineAsyncComponent(loadDeduplicateDialog)
const loadAddStudentDialog = () => import('../components/dialogs/AddStudentDialog.vue')
const AddStudentDialog = defineAsyncComponent(loadAddStudentDialog)

// 班干部管理：切到该 Tab 时才下载其代码 chunk 并实例化（v-if 控制挂载）
const CadreManage = defineAsyncComponent(() => import('../components/CadreManage.vue'))

const exportDialogVisible = ref(false)
const addDialogVisible = ref(false)

// 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，
// 让组件内部 <Transition> 能播放关闭的缩小淡出动画（懒加载不砍动画）
const exportMounted = ref(false)
const importMounted = ref(false)
const dedupeMounted = ref(false)
const dialogMounted = ref(false)
const contextMenuMounted = ref(false)
const addMounted = ref(false)

const API_BASE = '/api'
const DEFAULT_FIELDS = [
  { name: 'id', type: '整数' },
  { name: 'position', type: '整数' },
  { name: '学号', type: '文字' },
  { name: '年级', type: '文字' },
  { name: '班级', type: '文字' },
  { name: '姓名', type: '文字' },
  { name: '年龄', type: '整数' },
  { name: '备注', type: '文字' }
]

const dynamicTable = ref(null)

const table = useTableCRUD(`${API_BASE}/students`, DEFAULT_FIELDS, {
  requiredField: '姓名',
  protectedColumns: ['学号', '姓名'],
  undoTableKey: 'students'
})

// 跨页定位：标题栏全局搜索点「学生」结果跳转 /students?focus=<id> 时，
// 先切回「学生信息」页签，再滚动到目标行并高亮闪动
const inst = getCurrentInstance()
const applyFocus = () => applyRouteRowFocus(inst.proxy, {
  parse: (key) => { activeTab.value = 'students'; return key }
})
onMounted(applyFocus)
onActivated(applyFocus)
watch(() => inst.proxy.$route.query.focus, applyFocus)

// 为了兼容原有模板，创建别名
const students = table.rows
const {
  fields, newRow, editingCell, contextMenu, dialog, columnForm,
  sortField, sortOrder, searchField, searchKeyword,
  selectedCount, selectedRowKeys,
  importDialogVisible, dedupeDialogVisible,
  displayRows, displayIndexes, visibleFields, allBusinessFields,
  fetchRows, applyUndoChange, showAlert, showConfirm, onDialogConfirm, onDialogCancel, onDialogExtra,
  startEditCell, saveCell, validateValue,
  addNewRowAtBottom, insertRowAbove, insertRowBelow, createNewRow, cancelNewRow, saveNewRow,
  moveRow, deleteColumn, startAddColumn, confirmAddColumn,
  toggleSort, openSearch, closeSearch, openContextMenu,
  onUpdateNewRow, cutRows, cutSelectedRows, deleteRows, onBatchDelete,
  pasteRows, onMoveSelectedRows, onSwapRows, onSwapColumns,
  onSelectionChange, onImportData, onDeleteDuplicates,
  saveCurrentOrder, deleteRowById
} = table

// 弹窗首次打开时置 mounted=true（保活），此后保持挂载，关闭仅降 visible 以播放退出动画
watch(() => exportDialogVisible.value, v => { if (v) exportMounted.value = true })
watch(() => importDialogVisible.value, v => { if (v) importMounted.value = true })
watch(() => dedupeDialogVisible.value, v => { if (v) dedupeMounted.value = true })
watch(() => addDialogVisible.value, v => { if (v) addMounted.value = true })
watch(() => dialog.value.visible, v => { if (v) dialogMounted.value = true })
watch(() => contextMenu.value.visible, v => { if (v) contextMenuMounted.value = true })

const fetchStudents = fetchRows
const { success: notifySuccess, error: notifyError } = useNotification()

// 搜索面板显隐（点工具「搜索」按钮弹出；表头🔍 触发的列搜索也用同一面板）
const searchPanelOpen = ref(false)
// 面板「取消」：关闭面板并清空搜索条件
const onCloseSearch = () => {
  searchPanelOpen.value = false
  closeSearch()
}
// 面板「下拉选列」/表头🔍 触发：切换搜索列并弹出面板
const onPickSearchField = name => {
  searchPanelOpen.value = true
  openSearch(name)
}
const onOpenStructuralSearch = onPickSearchField

// 工具栏搜索下拉的可选列：剔除 id / position 等结构性字段，仅保留业务字段
const searchableFields = computed(() =>
  visibleFields.value.filter(f => !['id', 'position'].includes(f.name))
)
// 搜索过滤进行中：表格行进入/离开采用上下级联动画。
// 用「已选搜索列」判断而非关键字非空：清空关键字/恢复全表时同样保持级联，避免回退成水平滑动
const searchActive = computed(() => !!searchField.value)

// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销、重做本页学生表
useUndoShortcut('students', {
  onAfterUndo: (label, change) => { if (!applyUndoChange(change)) fetchRows(); notifySuccess(label ? `已撤销：${label}` : '已撤销') },
  onAfterRedo: (label, change) => { if (!applyUndoChange(change)) fetchRows(); notifySuccess(label ? `已重做：${label}` : '已重做') }
})

async function refreshStudents() {
  try {
    await fetchStudents()
    notifySuccess('已刷新学生数据')
  } catch (e) { /* 错误已在 fetchRows 内部处理 */ }
}

function openAddDialog() {
  // 打开弹窗前，若存在未保存的内联新行先取消，避免两套新增状态并存
  if (newRow.value) newRow.value = null
  addDialogVisible.value = true
}

async function onAddStudent(data) {
  try {
    await axios.post(`${API_BASE}/students`, data)
    addDialogVisible.value = false
    await fetchStudents()
    notifySuccess('已添加学生')
  } catch (err) {
    notifyError(err.response?.data?.error || '添加失败')
  }
}

const tableElement = computed(() => {
  return dynamicTable.value?.$el || null
})

async function deleteStudent(id) {
  if (selectedCount.value > 1) {
    onBatchDelete()
    return
  }
  // 删前先问后端：该生被哪些记录引用（请假/加分/座位/值日），据结果决定提示与处理方式
  let rel = { leave: 0, score: 0, seat: 0, duty: 0, total: 0 }
  try {
    const res = await axios.get(`${API_BASE}/students/${id}/relations`)
    rel = res.data || rel
  } catch (_) { /* 预览失败按“无关联”处理，不阻断删除 */ }

  const finish = async () => {
    await fetchStudents()
    selectedCount.value = 0
    selectedRowKeys.value = []
  }

  if (!rel.total) {
    showConfirm('确定删除该学生吗？', async () => {
      try {
        await axios.delete(`${API_BASE}/students/${id}`)
        await finish()
        notifySuccess('已删除学生')
      } catch (err) {
        showAlert(err.response?.data?.error || '删除失败')
      }
    })
    return
  }

  const student = students.value.find(s => s.id === id)
  const parts = []
  if (rel.leave) parts.push(`${rel.leave} 条请假记录`)
  if (rel.score) parts.push(`${rel.score} 条加减分记录`)
  if (rel.seat) parts.push(`${rel.seat} 个座位`)
  if (rel.duty) parts.push(`${rel.duty} 个值日岗位`)
  const who = student ? `「${student['姓名']}」` : '该学生'
  const msg = `${who}还有 ${parts.join('、')}。\n\n「一并删除」会同时删除这些关联记录；\n「仅删学生」保留它们（可能成为指向不存在学生的孤儿数据）；\n「取消」不做任何操作。`

  showConfirm(msg, async () => {
    try {
      await axios.post(`${API_BASE}/students/${id}/delete-with-relations`, {
        relations: { leave: true, score: true, seat: true, duty: true }
      })
      await finish()
      notifySuccess('已删除学生及关联记录')
    } catch (err) {
      showAlert(err.response?.data?.error || '删除失败')
    }
  }, null, {
    extraText: '仅删学生',
    onExtra: async () => {
      try {
        await axios.delete(`${API_BASE}/students/${id}`)
        await finish()
        notifySuccess('已删除学生（保留关联记录）')
      } catch (err) {
        showAlert(err.response?.data?.error || '删除失败')
      }
    }
  })
}

function onExportFinish() {
  // 保持与原有事件兼容
}

// 导出学生信息：无数据时直接提示，不弹导出选项弹窗
function openExport() {
  if (students.value.length === 0) return useNotification().info('暂无学生数据可导出')
  exportDialogVisible.value = true
}
</script>

<style scoped>
/* 可根据需要添加样式 */
</style>
