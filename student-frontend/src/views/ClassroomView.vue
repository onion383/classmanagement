<template>
  <div>
    <div class="w-full bg-gradient-to-r from-blue-80 to-blue-100 shadow-md rounded-xl mb-6  px-6 py-5 ">
      <h1 class="text-2xl font-bold text-gray-800">📚 班级管理</h1>
    </div>

    <!-- 工具栏按钮 -->
    <div class="mb-4 flex items-center gap-3">
      <button @click="addNewRowAtBottom" class="bg-green-500 hover:bg-green-600 text-white px-5 py-2 rounded">
        ＋ 添加学生
      </button>
      <button @click="fetchStudents" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded flex items-center gap-1" title="刷新表格">
        🔄 刷新
      </button>
      <button
        @click="onBatchDelete"
        :disabled="selectedCount === 0"
        class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
      >
        🗑️ 批量删除 ({{ selectedCount }})
      </button>
      <button @click="importDialogVisible = true" class="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded">
        📥 从 Excel 导入
      </button>
      <button
        @click="$refs.exportDialog.open()"
        class="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded"
      >
        📥 导出 Excel
      </button>
      <button @click="dedupeDialogVisible = true" class="bg-pink-500 hover:bg-pink-600 text-white px-4 py-2 rounded">
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
      ref="exportDialog"
      :rows="students"
      :fields="visibleFields"
      :selectedRowKeys="selectedRowKeys"
      :tableElement="tableElement"
      defaultFilename="学生信息"
      @export-finish="onExportFinish"
    />
    <ImportExcel
      :visible="importDialogVisible"
      :existingFields="visibleFields"
      :requiredFields="['姓名']"
      @import-data="onImportData"
      @cancel="importDialogVisible = false"
    />
    <DeduplicateDialog
      :visible="dedupeDialogVisible"
      :rows="students"
      :fields="allBusinessFields"
      @delete-rows="onDeleteDuplicates"
      @cancel="dedupeDialogVisible = false"
    />
   </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import axios from 'axios'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ContextMenu from '../components/ContextMenu.vue'
import SearchBar from '../components/SearchBar.vue'
import DynamicTable from '../components/DynamicTable.vue'
import ExportExcel from '../components/ExportExcel.vue'
import ImportExcel from '../components/ImportExcel.vue'
import DeduplicateDialog from '../components/DeduplicateDialog.vue'
import { useTableCRUD } from '../composables/useTableCRUD.js'

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
  protectedColumns: ['学号', '姓名']
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

const fetchStudents = fetchRows

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
