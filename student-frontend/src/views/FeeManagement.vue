<template>
  <div>
    <div class="w-full bg-gradient-to-r from-blue-80 to-blue-100 shadow-md rounded-xl mb-6  px-6 py-5 ">
      <h1 class="text-2xl font-bold text-gray-800">💰 班费管理</h1>
    </div>

    <!-- 看板 -->
    <div class="grid grid-cols-3 gap-4 mb-6">
      <div class="bg-green-100 rounded-lg p-4">
        <div class="text-sm text-gray-600">当前余额</div>
        <div class="text-2xl font-bold text-green-800">{{ balance }} 元</div>
      </div>
      <div class="bg-blue-100 rounded-lg p-4">
        <div class="text-sm text-gray-600">本月收入</div>
        <div class="text-2xl font-bold text-blue-800">{{ monthlyIncome }} 元</div>
      </div>
      <div class="bg-red-100 rounded-lg p-4">
        <div class="text-sm text-gray-600">本月支出</div>
        <div class="text-2xl font-bold text-red-800">{{ monthlyExpense }} 元</div>
      </div>
    </div>

    <!-- 工具栏按钮 -->
    <div class="mb-4 flex items-center gap-3">
      <button @click="addNewRowAtBottom" class="bg-green-500 hover:bg-green-600 text-white px-5 py-2 rounded">
        ＋ 添加记录
      </button>
      <button @click="fetchRecords" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded flex items-center gap-1" title="刷新表格">
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

    <!-- 收据管理弹窗 -->
    <div v-if="receiptDialog.visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001] pointer-events-auto" @click.self="closeReceiptDialog">
      <div class="bg-white p-5 rounded-lg min-w-[400px] max-w-xl">
        <h3 class="text-lg font-bold mb-3">管理收据</h3>
        <div class="flex flex-wrap gap-2 mb-4">
          <div v-for="(img, idx) in receiptDialog.images" :key="idx" class="relative group w-20 h-20 border rounded overflow-hidden">
            <img
              :src="getFullUrl(img)"
              @click="previewImage(img)"
              class="w-full h-full object-cover cursor-pointer"
              @error="$event.target.style.display='none'; $event.target.nextElementSibling.style.display='flex'"
            />
            <div class="w-full h-full items-center justify-center bg-gray-200 text-gray-400 text-xs" style="display:none;">
              加载失败
            </div>
            <button
              @click.stop="removeReceiptImage(idx)"
              class="absolute top-0 right-0 bg-red-500 text-white text-xs rounded-bl px-1 opacity-0 group-hover:opacity-100 transition"
            >×</button>
          </div>
          <div v-if="receiptDialog.images.length === 0" class="text-gray-400 text-sm">暂无收据图片</div>
        </div>
        <div class="flex items-center gap-2 mb-4">
          <input
            type="file"
            multiple
            accept="image/*"
            @change="handleReceiptFilesUpload"
            class="text-sm"
          />
          <span class="text-sm text-gray-500">可多选图片</span>
        </div>
        <div class="text-right">
          <button @click="saveReceiptImages" class="bg-blue-500 text-white border-none px-4 py-1.5 rounded mr-2 cursor-pointer">确定</button>
          <button @click="closeReceiptDialog" class="bg-gray-300 border-none px-4 py-1.5 rounded cursor-pointer">取消</button>
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

<script>
import axios from 'axios';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ContextMenu from '../components/ContextMenu.vue';
import SearchBar from '../components/SearchBar.vue';
import DynamicTable from '../components/DynamicTable.vue';
import ExportExcel from '../components/ExportExcel.vue';
import ImportExcel from '../components/ImportExcel.vue';
import DeduplicateDialog from '../components/DeduplicateDialog.vue';

const API_BASE = '/api';
const DEFAULT_FIELDS = [
  { name: 'id', type: '整数' },
  { name: 'position', type: '整数' },
  { name: '收支编码', type: '文字' },
  { name: '收支类型', type: '文字', control: 'select', options: ['收入', '支出'] },
  { name: '收支金额', type: '小数' },
  { name: '收支时间', type: '日期' },
  { name: '备注', type: '文字' },
  { name: '收据', type: '文字' }
];

export default {
  name: 'FeeManagement',
  components: { ConfirmDialog, ContextMenu, SearchBar, DynamicTable, ExportExcel, ImportExcel, DeduplicateDialog },
  data() {
    return {
      feeRecords: [],
      fields: [...DEFAULT_FIELDS],
      newRow: null,
      editingCell: null,
      contextMenu: { visible: false, x: 0, y: 0, items: [] },
      dialog: { visible: false, message: '', type: 'alert', showCancel: false },
      columnForm: { name: '', dataType: '文字', after: '', error: '' },
      renameOldName: '',   // 重命名时暂存旧列名
      sortField: '',
      sortOrder: 'asc',
      searchField: null,
      searchKeyword: '',
      dialogCallback: null,
      receiptDialog: {
        visible: false,
        row: null,
        isNew: false,
        images: [],
      },
      previewImageUrl: null,
      clipboard: null,
      selectedRowKeys: [],
      selectedCount: 0,
      importDialogVisible: false,
      dedupeDialogVisible: false,
    };
  },
  computed: {
    balance() {
      return this.feeRecords.reduce((sum, r) => sum + (parseFloat(r['收支金额']) || 0), 0).toFixed(2);
    },
    monthlyIncome() {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      return this.feeRecords
        .filter(r => {
          const time = r['收支时间'];
          if (!time) return false;
          const [y, m] = time.split('-').map(Number);
          return y === year && m === month;
        })
        .reduce((sum, r) => {
          const amount = parseFloat(r['收支金额']) || 0;
          return sum + (amount > 0 ? amount : 0);
        }, 0)
        .toFixed(2);
    },
    monthlyExpense() {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      return this.feeRecords
        .filter(r => {
          const time = r['收支时间'];
          if (!time) return false;
          const [y, m] = time.split('-').map(Number);
          return y === year && m === month;
        })
        .reduce((sum, r) => {
          const amount = parseFloat(r['收支金额']) || 0;
          return sum + (amount < 0 ? Math.abs(amount) : 0);
        }, 0)
        .toFixed(2);
    },
    tableElement() {
      return this.$refs.dynamicTable?.$el || null;
    },
    displayRows() {
      let filtered = this.feeRecords;
      if (this.searchField && this.searchKeyword) {
        const kw = this.searchKeyword.toLowerCase();
        filtered = this.feeRecords.filter(s => {
          const val = s[this.searchField];
          return val != null && String(val).toLowerCase().includes(kw);
        });
      }
      if (this.sortField) {
        const field = this.sortField;
        filtered = [...filtered].sort((a, b) => {
          let va = a[field], vb = b[field];
          if (va == null) va = '';
          if (vb == null) vb = '';
          if (field === '收支金额' || field === 'id' || field === 'position') {
            return (Number(va) - Number(vb)) * (this.sortOrder === 'asc' ? 1 : -1);
          }
          return String(va).localeCompare(String(vb), 'zh') * (this.sortOrder === 'asc' ? 1 : -1);
        });
      }
      const list = filtered.map((s, idx) => ({
        ...s,
        _isNew: false,
        _rowKey: s.id,
        _displayIndex: idx + 1,
      }));
      if (!this.newRow) return list;
      const insertAt = this.newRow.atPosition;
      let insertIdx;
      if (insertAt === null || insertAt === undefined) {
        insertIdx = list.length;
      } else {
        insertIdx = list.findIndex(s => s.position >= insertAt);
        if (insertIdx === -1) insertIdx = list.length;
      }
      list.splice(insertIdx, 0, this.newRow);
      return list;
    },
    visibleFields() {
      return this.fields.filter(f => f.name !== 'id' && f.name !== 'position');
    },
    allBusinessFields() {
      return this.fields.filter(f => f.name !== 'id' && f.name !== 'position');
    },
  },
  methods: {
    // ============= 弹窗 =============
    showAlert(msg, cb) { this.dialog = { visible: true, message: msg, type: 'alert', showCancel: false }; this.dialogCallback = cb; },
    showConfirm(msg, onConfirm, onCancel) { this.dialog = { visible: true, message: msg, type: 'confirm', showCancel: true }; this.dialogCallback = { confirm: onConfirm, cancel: onCancel }; },
    onDialogConfirm() {
      this.dialog.visible = false;
      if (this.dialog.type === 'columnAdd') this.confirmAddColumn();
      else if (this.dialog.type === 'columnRename') this.confirmRenameColumn();
      else if (typeof this.dialogCallback === 'function') this.dialogCallback();
      else if (this.dialogCallback?.confirm) this.dialogCallback.confirm();
    },
    onDialogCancel() {
      this.dialog.visible = false;
      if (this.dialogCallback?.cancel) this.dialogCallback.cancel();
    },

    // ============= 数据加载 =============
    async fetchRecords() {
      try {
        const res = await axios.get(`${API_BASE}/fee-records?_t=${Date.now()}`);
        const result = res.data;
        if (Array.isArray(result.data)) {
          this.feeRecords = result.data;
          if (result.fields && result.fields.length > 0) {
            this.fields = result.fields.map(f => {
              const defaultField = DEFAULT_FIELDS.find(df => df.name === f.name);
              return { ...f, ...defaultField };
            });
          }
        }
        if (!this.fields || this.fields.length === 0) {
          this.fields = [...DEFAULT_FIELDS];
        }
      } catch (err) {
        console.error(err);
        if (!this.feeRecords.length) this.showAlert('无法加载数据');
      }
    },
    startEditCell(row, field) { this.editingCell = { rowKey: row._rowKey, field: field.name }; },
    async saveCell(row, field) {
      if (!this.editingCell) return;
      if (field.name === '收支金额' && !this.validateValue(row[field.name], '小数')) {
        this.showAlert('金额格式错误');
        return;
      }
      try {
        await axios.put(`${API_BASE}/fee-records/${row.id}`, { [field.name]: row[field.name] });
        await this.fetchRecords();
      } catch { this.showAlert('修改失败'); }
      this.editingCell = null;
    },
    validateValue(val, type) {
      if (val === null || val === undefined || val === '') return true;
      if (type === '整数') return /^-?\d+$/.test(String(val));
      if (type === '小数') return /^-?\d+(\.\d+)?$/.test(String(val));
      if (type === '日期') return !isNaN(Date.parse(val));
      return true;
    },

    // ============= 行操作 =============
    addNewRowAtBottom() { if (!this.newRow) this.createNewRow(null); },
    insertRowAbove(target) { if (!this.newRow) this.createNewRow(target.position); },
    insertRowBelow(target) { if (!this.newRow) this.createNewRow(target.position + 1); },
    createNewRow(atPosition) {
      if (this.newRow) return;
      const empty = {};
      this.fields.forEach(f => { if (f.name !== 'id' && f.name !== 'position') empty[f.name] = ''; });
      this.newRow = { ...empty, atPosition, _isNew: true, _rowKey: 'new' };
    },
    cancelNewRow() { this.newRow = null; },
    async saveNewRow() {
      if (!this.newRow) return;
      if (!this.newRow['收支编码']?.trim()) { this.showAlert('收支编码不能为空'); return; }
      const data = {};
      for (const f of this.fields) {
        if (f.name === 'id' || f.name === 'position') continue;
        data[f.name] = this.newRow[f.name] || '';
      }
      if (this.newRow.atPosition != null) data.atPosition = this.newRow.atPosition;
      try {
        await axios.post(`${API_BASE}/fee-records`, data);
        this.newRow = null;
        await this.fetchRecords();
      } catch (err) {
        this.showAlert('添加失败：' + (err.response?.data?.error || err.message));
      }
    },
    async moveRow(row, direction) {
      try { await axios.post(`${API_BASE}/fee-records/move`, { id: row.id, direction }); await this.fetchRecords(); }
      catch (err) { this.showAlert(err.response?.data?.error || '移动失败'); }
    },

    // ============= 列操作 =============
    deleteColumn(field) {
      if (field.name === 'id' || field.name === 'position') return this.showAlert('不能删除保留字段');
      this.showConfirm(`确定删除字段“${field.name}”吗？`, async () => {
        try { await axios.delete(`${API_BASE}/fee-records/columns/${field.name}`); await this.fetchRecords(); }
        catch (err) { this.showAlert(err.response?.data?.error || '删除失败'); }
      });
    },
    startAddColumn(position, field) {
      this.columnForm = { name: '', dataType: '文字', after: '', error: '' };
      const idx = this.fields.findIndex(f => f.name === field.name);
      if (position === 'left') {
        if (idx === 0) this.columnForm.after = 'first';
        else this.columnForm.after = this.fields[idx - 1].name;
      } else { this.columnForm.after = field.name; }
      this.dialog = { visible: true, type: 'columnAdd', showCancel: true, message: '' };
    },
    async confirmAddColumn() {
      if (!this.columnForm.name || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(this.columnForm.name)) {
        this.columnForm.error = '列名不合法'; return;
      }
      try {
        await axios.post(`${API_BASE}/fee-records/add-column`, { columnName: this.columnForm.name, dataType: this.columnForm.dataType, after: this.columnForm.after });
        this.dialog.visible = false; await this.fetchRecords();
      } catch (err) { this.columnForm.error = err.response?.data?.error || '添加失败'; }
    },

    // ---- 新增：重命名列 ----
    startRenameColumn(field) {
      this.renameOldName = field.name;
      this.columnForm = { name: field.name, dataType: '', after: '', error: '' };
      this.dialog = { visible: true, type: 'columnRename', showCancel: true, message: `请输入新列名（当前：${field.name}）` };
    },
    async confirmRenameColumn() {
      const newName = this.columnForm.name.trim();
      if (!newName || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(newName)) {
        this.showAlert('列名不合法');
        return;
      }
      try {
        await axios.post(`${API_BASE}/fee-records/rename-column`, {
          oldName: this.renameOldName,
          newName
        });
        this.showAlert(`列名已改为“${newName}”`);
        await this.fetchRecords();
      } catch (err) {
        this.showAlert(err.response?.data?.error || '重命名失败');
      } finally {
        this.renameOldName = '';
      }
    },

    // ============= 排序 / 搜索 =============
    toggleSort(field) {
      if (this.sortField === field) this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      else { this.sortField = field; this.sortOrder = 'asc'; }
      this.saveCurrentOrder();
    },
    openSearch(field) { this.searchField = field; this.searchKeyword = ''; },
    closeSearch() { this.searchField = null; this.searchKeyword = ''; },

    // ============= 右键菜单 =============
    openContextMenu(event, type, payload) {
      event.preventDefault();
      this.contextMenu = { visible: false, x: 0, y: 0, items: [] };
      const items = [];
      if (type === 'header') {
        const field = payload;
        if (field.name !== 'id' && field.name !== 'position') {
          items.push({ label: '修改列名', action: () => this.startRenameColumn(field) });
          items.push({ label: '在左侧插入列', action: () => this.startAddColumn('left', field) });
          items.push({ label: '在右侧插入列', action: () => this.startAddColumn('right', field) });
          items.push({ label: '删除本列', action: () => this.deleteColumn(field) });
        }
      } else if (type === 'row') {
        items.push({ label: '上移', action: () => this.moveRow(payload, 'up') });
        items.push({ label: '下移', action: () => this.moveRow(payload, 'down') });

        if (this.clipboard && this.clipboard.ids.length > 0) {
          const pasteCount = this.clipboard.ids.length;
          items.push({ label: `📋 粘贴到上方 (${pasteCount})`, action: () => this.pasteRows('above', payload) });
          items.push({ label: `📋 粘贴到下方 (${pasteCount})`, action: () => this.pasteRows('below', payload) });
        }

        items.push({ label: '在上面插入行', action: () => this.insertRowAbove(payload) });
        items.push({ label: '在下面插入行', action: () => this.insertRowBelow(payload) });

        const cutCount = this.selectedCount > 1 ? this.selectedCount : 1;
        items.push({ label: `✂️ 剪切 (${cutCount})`, action: () => this.cutRows(payload) });

        const delCount = this.selectedCount > 1 ? this.selectedCount : 1;
        items.push({ label: `🗑️ 删除 (${delCount})`, action: () => this.deleteRows(payload) });
      } else if (type === 'newRow') {
        items.push({ label: '取消新行', action: () => { this.newRow = null; } });
      }
      if (items.length) {
        this.contextMenu = { visible: true, x: event.clientX, y: event.clientY, items };
      }
    },
    onUpdateNewRow(fieldName, value) { if (this.newRow) this.newRow[fieldName] = value; },

    // ============= 剪切 / 粘贴 / 删除 =============
    cutRows(targetRow) {
      if (this.selectedCount > 1) {
        this.cutSelectedRows();
      } else {
        const row = targetRow;
        if (!row || row._isNew) return;
        this.clipboard = { rows: [row], ids: [row.id] };
        this.feeRecords = this.feeRecords.filter(r => r.id !== row.id);
        this.$refs.dynamicTable.clearSelection();
        this.selectedCount = 0;
      }
    },
    cutSelectedRows() {
      const selectedKeys = this.$refs.dynamicTable?.selectedRowKeys;
      if (!selectedKeys || selectedKeys.length === 0) return;
      const cutRows = this.feeRecords.filter(r => selectedKeys.includes(r.id));
      this.clipboard = { rows: cutRows, ids: cutRows.map(r => r.id) };
      this.feeRecords = this.feeRecords.filter(r => !selectedKeys.includes(r.id));
      this.$refs.dynamicTable.clearSelection();
      this.selectedCount = 0;
    },
    deleteRows(targetRow) {
      if (this.selectedCount > 1) {
        this.onBatchDelete();
      } else {
        const row = targetRow;
        if (!row || row._isNew) return;
        this.showConfirm('确定删除该记录吗？', async () => {
          try {
            await axios.delete(`${API_BASE}/fee-records/${row.id}`);
            await this.fetchRecords();
            this.selectedCount = 0;
          } catch (err) { this.showAlert('删除失败'); }
        });
      }
    },
    async onBatchDelete() {
      const selectedKeys = this.$refs.dynamicTable?.selectedRowKeys;
      if (!selectedKeys || selectedKeys.length === 0) return;
      const selectedIds = this.feeRecords.filter(r => selectedKeys.includes(r.id)).map(r => r.id);
      this.showConfirm(`确定删除选中的 ${selectedIds.length} 条记录吗？`, async () => {
        try {
          for (const id of selectedIds) { await axios.delete(`${API_BASE}/fee-records/${id}`); }
          await this.fetchRecords();
          this.$refs.dynamicTable.clearSelection();
          this.selectedCount = 0;
        } catch (err) { this.showAlert('删除失败'); }
      });
    },
    pasteRows(position, targetRow) {
      if (!this.clipboard || this.clipboard.ids.length === 0) return;
      const { rows } = this.clipboard;
      const targetIndex = this.feeRecords.findIndex(r => r.id === targetRow.id);
      if (targetIndex === -1) return;
      const insertIdx = position === 'above' ? targetIndex : targetIndex + 1;
      this.feeRecords.splice(insertIdx, 0, ...rows);
      const newIds = this.feeRecords.map(r => r.id);
      axios.post(`${API_BASE}/fee-records/reorder`, { ids: newIds }).catch(() => {
        this.showAlert('粘贴失败'); this.fetchRecords();
      });
      this.clipboard = null;
    },
    onMoveSelectedRows({ selectedKeys, oldIndex, newIndex, isDownward }) {
      const records = [...this.feeRecords];
      const selectedRows = selectedKeys.map(key => records.find(r => r.id === key || r._rowKey === key)).filter(r => r && !r._isNew);
      if (selectedRows.length === 0) return;
      const selectedIds = selectedRows.map(r => r.id);
      const otherRows = records.filter(r => !selectedIds.includes(r.id));
      const rowsBefore = records.slice(0, newIndex).filter(r => !selectedIds.includes(r.id)).length;
      const insertIdx = isDownward ? rowsBefore + 1 : rowsBefore;
      otherRows.splice(insertIdx, 0, ...selectedRows);
      this.feeRecords = otherRows;
      const ids = otherRows.map(r => r.id);
      axios.post(`${API_BASE}/fee-records/reorder`, { ids }).catch(() => {
        this.showAlert('移动失败'); this.fetchRecords();
      });
    },

    // ============= 收据管理 =============
    handleManageReceipt({ row, isNew }) {
      let images = [];
      try { images = JSON.parse(row['收据'] || '[]'); } catch { images = []; }
      this.receiptDialog = { visible: true, row, isNew, images: [...images] };
    },
    closeReceiptDialog() { this.receiptDialog.visible = false; },
    removeReceiptImage(index) {
      this.showConfirm('确定删除该图片吗？', () => { this.receiptDialog.images.splice(index, 1); });
    },
    async handleReceiptFilesUpload(event) {
      const files = event.target.files;
      if (!files.length) return;
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) formData.append('receipts', files[i]);
      try {
        const res = await axios.post(`${API_BASE}/fee-records/upload-receipt`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        this.receiptDialog.images.push(...res.data.urls);
      } catch (err) { this.showAlert('图片上传失败'); }
    },
    async saveReceiptImages() {
      const imagesJson = JSON.stringify(this.receiptDialog.images);
      if (this.receiptDialog.isNew && this.newRow) {
        this.newRow['收据'] = imagesJson;
        this.closeReceiptDialog();
        return;
      }
      if (!this.receiptDialog.row) return;
      try {
        await axios.put(`${API_BASE}/fee-records/${this.receiptDialog.row.id}`, { '收据': imagesJson });
        this.receiptDialog.row['收据'] = imagesJson;
        this.closeReceiptDialog();
      } catch (err) { this.showAlert('保存收据失败'); }
    },
    getFullUrl(img) {
      if (!img) return '';
      if (img.startsWith('http')) return img;
      return `${API_BASE}${img}`;
    },
    previewImage(img) { this.previewImageUrl = img; },

    onExportFinish() {
      this.$root.toast?.show('导出成功', 'success');
    },

    // ============= 行/列拖拽 =============
    async onSwapRows(fromIndex, toIndex) {
      const records = [...this.feeRecords];
      const [moved] = records.splice(fromIndex, 1);
      records.splice(toIndex, 0, moved);
      this.feeRecords = records;
      const ids = records.map(r => r.id);
      try { await axios.post(`${API_BASE}/fee-records/reorder`, { ids }); }
      catch (err) { this.showAlert('排序更新失败'); await this.fetchRecords(); }
    },
    async onSwapColumns(fromIndex, toIndex) {
      const visibleFields = this.visibleFields;
      const moved = visibleFields[fromIndex];
      const reordered = [...visibleFields];
      reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      let targetName = null, position = 'first';
      if (toIndex > 0) { targetName = reordered[toIndex - 1]?.name; position = 'after'; }
      if (position === 'after' && targetName === moved.name) return;
      const originalFields = [...this.fields];
      this.fields = reordered;
      try {
        await axios.post(`${API_BASE}/fee-records/move-column`, { columnName: moved.name, targetColumnName: position === 'first' ? null : targetName, position });
        await this.fetchRecords();
      } catch (err) { this.fields = originalFields; this.showAlert('列移动失败'); }
    },
    onSelectionChange({ count, keys }) {
      this.selectedCount = count;
      this.selectedRowKeys = keys;
    },

    deleteRecord(id) {
      if (this.selectedCount > 1) {
        this.onBatchDelete();
      } else {
        this.showConfirm('确定删除该记录吗？', async () => {
          try {
            await axios.delete(`${API_BASE}/fee-records/${id}`);
            await this.fetchRecords();
            this.selectedCount = 0;
          } catch (err) { this.showAlert('删除失败'); }
        });
      }
    },
    saveCurrentOrder() {
      const rows = this.displayRows.filter(r => !r._isNew);
      const ids = rows.map(r => r.id);
      if (ids.length > 0) axios.post(`${API_BASE}/fee-records/reorder`, { ids }).catch(() => {});
    },

    async onImportData({ fields, rows }) {
      this.importDialogVisible = false;
      try {
        const res = await axios.post(`${API_BASE}/fee-records/import`, { fields, rows });
        this.showAlert(res.data.message);
        await this.fetchRecords();
      } catch (err) {
        this.showAlert(err.response?.data?.error || '导入失败');
      }
    },
    async onDeleteDuplicates(ids) {
      if (!ids || ids.length === 0) return;
      this.showConfirm(`确定删除选中的 ${ids.length} 条重复记录吗？`, async () => {
        try {
          for (const id of ids) {
            await axios.delete(`${API_BASE}/fee-records/${id}`);
          }
          await this.fetchRecords();
          this.dedupeDialogVisible = false;
          this.showAlert('已成功删除所选重复数据');
        } catch (err) {
          this.showAlert('删除重复数据失败');
        }
      });
    },
  },
  mounted() {
    this.fetchRecords();
    document.addEventListener('click', () => { this.contextMenu.visible = false; });
  },
  beforeUnmount() {
    document.removeEventListener('click', () => { this.contextMenu.visible = false; });
  },
};
</script>