<template>
  <div>
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-6 py-5 border border-border">
      <h1 class="text-2xl font-bold text-text">📚 班级管理</h1>
    </div>

    <!-- 工具栏按钮 -->
    <div class="mb-4 flex items-center gap-3">
      <button @click="addNewRowAtBottom" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded">
        ＋ 添加学生
      </button>
      <button @click="refreshStudents" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1" title="刷新表格">
        🔄 刷新
      </button>
      <button
        @click="onBatchDelete"
        :disabled="selectedCount === 0"
        class="bg-danger hover:bg-danger-hover text-text-inverse px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
      >
        🗑️ 批量删除 ({{ selectedCount }})
      </button>
      <button @click="importDialogVisible = true" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded">
        📥 从 Excel 导入
      </button>
      <button
        @click="exportDialogVisible = true"
        class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded"
      >
        📥 导出 Excel
      </button>
      <button @click="dedupeDialogVisible = true" class="bg-danger hover:bg-danger-hover text-text-inverse px-4 py-2 rounded">
        🔍 去除重复数据
      </button>
    </div>

    <SearchBar
      :searchField="searchField"
      :keyword="searchKeyword"
      @update:keyword="searchKeyword = $event"
      @close="closeSearch"
    />

    <ConfirmDialog
      v-if="dialogMounted"
      :visible="dialog.visible"
      :message="dialog.message"
      :type="dialog.type"
      :showCancel="dialog.showCancel"
      v-model:columnName="columnForm.name"
      v-model:columnType="columnForm.dataType"
      :errorMsg="columnForm.error"
      @confirm="onDialogConfirm"
      @cancel="onDialogCancel"
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
      :newRow="newRow"
      :sortField="sortField"
      :sortOrder="sortOrder"
      :editingCell="editingCell"
      @contextmenu="openContextMenu"
      @search="openSearch"
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
   </div>
</template>

<script setup>
import { ref, computed, watch, defineAsyncComponent } from 'vue'
import axios from 'axios'
import SearchBar from '../components/base/SearchBar.vue'
import DynamicTable from '../components/tables/DynamicTable.vue'
import { useTableCRUD } from '../composables/useTableCRUD.js'
import { useUndoShortcut } from '../composables/useUndo.js'
import { useNotification } from '../composables/useNotification.js'

// 弹窗类组件懒加载：打开时才加载对应 chunk
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))
const ContextMenu = defineAsyncComponent(() => import('../components/base/ContextMenu.vue'))
const ExportExcel = defineAsyncComponent(() => import('../components/import-export/ExportExcel.vue'))
const ImportExcel = defineAsyncComponent(() => import('../components/import-export/ImportExcel.vue'))
const DeduplicateDialog = defineAsyncComponent(() => import('../components/dialogs/DeduplicateDialog.vue'))

const exportDialogVisible = ref(false)

// 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，
// 让组件内部 <Transition> 能播放关闭的缩小淡出动画（懒加载不砍动画）
const exportMounted = ref(false)
const importMounted = ref(false)
const dedupeMounted = ref(false)
const dialogMounted = ref(false)
const contextMenuMounted = ref(false)

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

// 为了兼容原有模板，创建别名
const students = table.rows
const {
  fields, newRow, editingCell, contextMenu, dialog, columnForm,
  sortField, sortOrder, searchField, searchKeyword,
  selectedCount, selectedRowKeys,
  importDialogVisible, dedupeDialogVisible,
  displayRows, visibleFields, allBusinessFields,
  fetchRows, showAlert, showConfirm, onDialogConfirm, onDialogCancel,
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
watch(() => dialog.value.visible, v => { if (v) dialogMounted.value = true })
watch(() => contextMenu.value.visible, v => { if (v) contextMenuMounted.value = true })

const fetchStudents = fetchRows
const { success: notifySuccess } = useNotification()

// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销、重做本页学生表
useUndoShortcut('students', {
  onAfterUndo: (label) => { fetchRows(); notifySuccess(label ? `已撤销：${label}` : '已撤销') },
  onAfterRedo: (label) => { fetchRows(); notifySuccess(label ? `已重做：${label}` : '已重做') }
})

async function refreshStudents() {
  try {
    await fetchStudents()
    notifySuccess('已刷新学生数据')
  } catch (e) { /* 错误已在 fetchRows 内部处理 */ }
}

const tableElement = computed(() => {
  return dynamicTable.value?.$el || null
})

function deleteStudent(id) {
  if (selectedCount.value > 1) {
    onBatchDelete()
  } else {
    showConfirm('确定删除该学生吗？', async () => {
      try {
        await axios.delete(`${API_BASE}/students/${id}`)
        await fetchStudents()
        selectedCount.value = 0
        selectedRowKeys.value = []
      } catch (err) {
        showAlert('删除失败')
      }
    })
  }
}

function onExportFinish() {
  // 保持与原有事件兼容
}
</script>

<style scoped>
/* 可根据需要添加样式 */
</style>
