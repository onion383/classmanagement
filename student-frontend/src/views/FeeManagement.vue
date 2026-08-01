<template>
  <div>
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-6 py-5 border border-border">
      <h1 class="text-2xl font-bold text-text">💰 班费管理</h1>
    </div>

    <!-- 看板 -->
    <div class="grid grid-cols-3 gap-4 mb-6">
      <div class="bg-success/10 rounded-lg p-4">
        <div class="text-sm text-text-secondary">当前余额</div>
        <div class="text-2xl font-bold text-success">{{ balance }} 元</div>
      </div>
      <div class="bg-info/10 rounded-lg p-4">
        <div class="text-sm text-text-secondary">本月收入</div>
        <div class="text-2xl font-bold text-info">{{ monthlyIncome }} 元</div>
      </div>
      <div class="bg-danger/10 rounded-lg p-4">
        <div class="text-sm text-text-secondary">本月支出</div>
        <div class="text-2xl font-bold text-danger">{{ monthlyExpense }} 元</div>
      </div>
    </div>

    <!-- 工具栏按钮 -->
    <div class="mb-4 flex items-center gap-3">
      <button @click="addNewRowAtBottom" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded">
        ＋ 添加记录
      </button>
      <button @click="fetchRecords" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1" title="刷新表格">
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
        @click="$refs.exportDialog.open()"
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

    <!-- 收据管理弹窗 -->
    <div v-if="receiptDialog.visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001] pointer-events-auto" @click.self="closeReceiptDialog">
      <div class="bg-surface p-5 rounded-lg min-w-[400px] max-w-xl">
        <h3 class="text-lg font-bold mb-3">管理收据</h3>
        <div class="flex flex-wrap gap-2 mb-4">
          <div v-for="(img, idx) in receiptDialog.images" :key="idx" class="relative group w-20 h-20 border rounded overflow-hidden">
            <img
              :src="getFullUrl(img)"
              @click="previewImage(img)"
              class="w-full h-full object-cover cursor-pointer"
              @error="$event.target.style.display='none'; $event.target.nextElementSibling.style.display='flex'"
            />
            <div class="w-full h-full items-center justify-center bg-border text-text-muted text-xs" style="display:none;">
              加载失败
            </div>
            <button
              @click.stop="removeReceiptImage(idx)"
              class="absolute top-0 right-0 bg-danger text-text-inverse text-xs rounded-bl px-1 opacity-0 group-hover:opacity-100 transition"
            >×</button>
          </div>
          <div v-if="receiptDialog.images.length === 0" class="text-text-muted text-sm">暂无收据图片</div>
        </div>
        <div class="flex items-center gap-2 mb-4">
          <input
            type="file"
            multiple
            accept="image/*"
            @change="handleReceiptFilesUpload"
            class="text-sm"
          />
          <span class="text-sm text-text-muted">可多选图片</span>
        </div>
        <div class="text-right">
          <button @click="saveReceiptImages" class="bg-info text-text-inverse border-none px-4 py-1.5 rounded mr-2 cursor-pointer">确定</button>
          <button @click="closeReceiptDialog" class="bg-surface-hover border-none px-4 py-1.5 rounded cursor-pointer">取消</button>
        </div>
      </div>
    </div>

    <!-- 全屏图片预览 -->
    <div
      v-if="previewImageUrl"
      class="fixed inset-0 bg-black/80 z-[10002] flex items-center justify-center cursor-pointer"
      @click="previewImageUrl = null"
    >
      <img :src="getFullUrl(previewImageUrl)" class="max-w-[90vw] max-h-[90vh] object-contain" />
    </div>

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
      @deleteRow="deleteRecord"
      @addNewRowAtBottom="addNewRowAtBottom"
      @updateNewRow="onUpdateNewRow"
      @manageReceipt="handleManageReceipt"
      @swapRows="onSwapRows"
      @swapColumns="onSwapColumns"
      @selectionChange="onSelectionChange"
      @moveSelectedRows="onMoveSelectedRows"
    />
    <ExportExcel
      ref="exportDialog"
      :rows="feeRecords"
      :fields="visibleFields"
      :selectedRowKeys="selectedRowKeys"
      :tableElement="tableElement"
      defaultFilename="班费记录"
      @export-finish="onExportFinish"
    />
    <ImportExcel
      :visible="importDialogVisible"
      :existingFields="visibleFields"
      :requiredFields="['收支编码']"
      @import-data="onImportData"
      @cancel="importDialogVisible = false"
    />
    <DeduplicateDialog
      :visible="dedupeDialogVisible"
      :rows="feeRecords"
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
  { name: '收支编码', type: '文字' },
  { name: '收支类型', type: '文字', control: 'select', options: ['收入', '支出'] },
  { name: '收支金额', type: '小数' },
  { name: '收支时间', type: '日期' },
  { name: '备注', type: '文字' },
  { name: '收据', type: '文字' }
]

const dynamicTable = ref(null)

// 班费特有的金额校验
function customValidate(val, field) {
  if (field.name === '收支金额') {
    if (val === null || val === undefined || val === '') return true
    return /^-?\d+(\.\d+)?$/.test(String(val))
  }
  return true
}

const table = useTableCRUD(`${API_BASE}/fee-records`, DEFAULT_FIELDS, {
  requiredField: '收支编码',
  customValidate
})

const feeRecords = table.rows
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
  startRenameColumn, confirmRenameColumn,
  toggleSort, openSearch, closeSearch, openContextMenu,
  onUpdateNewRow, cutRows, cutSelectedRows, deleteRows, onBatchDelete,
  pasteRows, onMoveSelectedRows, onSwapRows, onSwapColumns,
  onSelectionChange, onImportData, onDeleteDuplicates,
  saveCurrentOrder, deleteRowById
} = table

const fetchRecords = fetchRows

// ==================== 看板统计 ====================
const balance = computed(() => {
  return feeRecords.value.reduce((sum, r) => sum + (parseFloat(r['收支金额']) || 0), 0).toFixed(2)
})

const monthlyIncome = computed(() => {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return feeRecords.value
    .filter(r => {
      const time = r['收支时间']
      if (!time) return false
      const [y, m] = time.split('-').map(Number)
      return y === year && m === month
    })
    .reduce((sum, r) => {
      const amount = parseFloat(r['收支金额']) || 0
      return sum + (amount > 0 ? amount : 0)
    }, 0)
    .toFixed(2)
})

const monthlyExpense = computed(() => {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return feeRecords.value
    .filter(r => {
      const time = r['收支时间']
      if (!time) return false
      const [y, m] = time.split('-').map(Number)
      return y === year && m === month
    })
    .reduce((sum, r) => {
      const amount = parseFloat(r['收支金额']) || 0
      return sum + (amount < 0 ? Math.abs(amount) : 0)
    }, 0)
    .toFixed(2)
})

// ==================== 表格元素引用 ====================
const tableElement = computed(() => {
  return dynamicTable.value?.$el || null
})

// ==================== 删除记录 ====================
function deleteRecord(id) {
  if (selectedCount.value > 1) {
    onBatchDelete()
  } else {
    showConfirm('确定删除该记录吗？', async () => {
      try {
        await axios.delete(`${API_BASE}/fee-records/${id}`)
        await fetchRecords()
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

// ==================== 收据管理 ====================
const receiptDialog = ref({
  visible: false,
  row: null,
  isNew: false,
  images: []
})
const previewImageUrl = ref(null)

function handleManageReceipt({ row, isNew }) {
  let images = []
  try { images = JSON.parse(row['收据'] || '[]') } catch { images = [] }
  receiptDialog.value = { visible: true, row, isNew, images: [...images] }
}

function closeReceiptDialog() {
  receiptDialog.value.visible = false
}

function removeReceiptImage(index) {
  showConfirm('确定删除该图片吗？', () => {
    receiptDialog.value.images.splice(index, 1)
  })
}

async function handleReceiptFilesUpload(event) {
  const files = event.target.files
  if (!files.length) return
  const formData = new FormData()
  for (let i = 0; i < files.length; i++) formData.append('receipts', files[i])
  try {
    const res = await axios.post(`${API_BASE}/fee-records/upload-receipt`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    receiptDialog.value.images.push(...res.data.urls)
  } catch (err) { showAlert('图片上传失败') }
}

async function saveReceiptImages() {
  const imagesJson = JSON.stringify(receiptDialog.value.images)
  if (receiptDialog.value.isNew && newRow.value) {
    newRow.value['收据'] = imagesJson
    closeReceiptDialog()
    return
  }
  if (!receiptDialog.value.row) return
  try {
    await axios.put(`${API_BASE}/fee-records/${receiptDialog.value.row.id}`, { '收据': imagesJson })
    receiptDialog.value.row['收据'] = imagesJson
    closeReceiptDialog()
  } catch (err) { showAlert('保存收据失败') }
}

function getFullUrl(img) {
  if (!img) return ''
  if (img.startsWith('http')) return img
  return `${API_BASE}${img}`
}

function previewImage(img) {
  previewImageUrl.value = img
}
</script>
