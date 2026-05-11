<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">💰 班费管理</h1>

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

    <div class="mb-4">
      <button @click="addNewRowAtBottom" class="bg-green-500 hover:bg-green-600 text-white px-5 py-2 rounded">
        ＋ 添加记录
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
    />
  </div>
</template>

<script>
import axios from 'axios';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ContextMenu from '../components/ContextMenu.vue';
import SearchBar from '../components/SearchBar.vue';
import DynamicTable from '../components/DynamicTable.vue';

const API_BASE = 'https://localhost:3000';   // 根据实际协议调整
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
  components: { ConfirmDialog, ContextMenu, SearchBar, DynamicTable },
  data() {
    return {
      feeRecords: [],
      fields: [...DEFAULT_FIELDS],
      newRow: null,
      editingCell: null,
      contextMenu: { visible: false, x: 0, y: 0, items: [] },
      dialog: { visible: false, message: '', type: 'alert', showCancel: false },
      columnForm: { name: '', dataType: '文字', after: '', error: '' },
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
      if (insertAt === null || insertAt === undefined) {
        return [...list, { ...this.newRow, _isNew: true, _rowKey: 'new' }];
      }
      const insertIdx = list.findIndex(s => s.position >= insertAt);
      if (insertIdx === -1) {
        return [...list, { ...this.newRow, _isNew: true, _rowKey: 'new' }];
      }
      return [
        ...list.slice(0, insertIdx),
        { ...this.newRow, _isNew: true, _rowKey: 'new' },
        ...list.slice(insertIdx),
      ];
    },
    visibleFields() {
      return this.fields.filter(f => f.name !== 'id' && f.name !== 'position');
    },
  },
  methods: {
    showAlert(msg, cb) { this.dialog = { visible: true, message: msg, type: 'alert', showCancel: false }; this.dialogCallback = cb; },
    showConfirm(msg, onConfirm, onCancel) { this.dialog = { visible: true, message: msg, type: 'confirm', showCancel: true }; this.dialogCallback = { confirm: onConfirm, cancel: onCancel }; },
    onDialogConfirm() {
      this.dialog.visible = false;
      if (this.dialog.type === 'columnAdd') this.confirmAddColumn();
      else if (typeof this.dialogCallback === 'function') this.dialogCallback();
      else if (this.dialogCallback?.confirm) this.dialogCallback.confirm();
    },
    onDialogCancel() {
      this.dialog.visible = false;
      if (this.dialogCallback?.cancel) this.dialogCallback.cancel();
    },

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

    addNewRowAtBottom() { if (!this.newRow) this.createNewRow(null); },
    insertRowAbove(target) { if (!this.newRow) this.createNewRow(target.position); },
    insertRowBelow(target) { if (!this.newRow) this.createNewRow(target.position + 1); },
    createNewRow(atPosition) {
      if (this.newRow) return;
      const empty = {};
      this.fields.forEach(f => { if (f.name !== 'id' && f.name !== 'position') empty[f.name] = ''; });
      this.newRow = { ...empty, atPosition };
    },
    cancelNewRow() { this.newRow = null; },
    async saveNewRow() {
      if (!this.newRow) return;
      if (!this.newRow['收支编码']?.trim()) {
        this.showAlert('收支编码不能为空');
        return;
      }
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
    async deleteRecord(id) {
      this.showConfirm('确定删除吗？', async () => {
        try {
          await axios.delete(`${API_BASE}/fee-records/${id}`);
          await this.fetchRecords();
        } catch (err) {
          this.showAlert(err.response?.data?.error || '删除失败');
        }
      });
    },
    async moveRow(row, direction) {
      try {
        await axios.post(`${API_BASE}/fee-records/move`, { id: row.id, direction });
        await this.fetchRecords();
      } catch (err) {
        this.showAlert(err.response?.data?.error || '移动失败');
      }
    },

    deleteColumn(field) {
      if (field.name === 'id' || field.name === 'position') return this.showAlert('不能删除保留字段');
      this.showConfirm(`确定删除字段“${field.name}”吗？`, async () => {
        try {
          await axios.delete(`${API_BASE}/fee-records/columns/${field.name}`);
          await this.fetchRecords();
        } catch (err) {
          this.showAlert(err.response?.data?.error || '删除失败');
        }
      });
    },
    startAddColumn(position, field) {
      this.columnForm = { name: '', dataType: '文字', after: '', error: '' };
      const idx = this.fields.findIndex(f => f.name === field.name);
      if (position === 'left') {
        if (idx === 0) this.columnForm.after = 'first';
        else this.columnForm.after = this.fields[idx - 1].name;
      } else {
        this.columnForm.after = field.name;
      }
      this.dialog = { visible: true, type: 'columnAdd', showCancel: true, message: '' };
    },
    async confirmAddColumn() {
      if (!this.columnForm.name || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(this.columnForm.name)) {
        this.columnForm.error = '列名不合法';
        return;
      }
      try {
        await axios.post(`${API_BASE}/fee-records/add-column`, {
          columnName: this.columnForm.name,
          dataType: this.columnForm.dataType,
          after: this.columnForm.after,
        });
        this.dialog.visible = false;
        await this.fetchRecords();
      } catch (err) {
        this.columnForm.error = err.response?.data?.error || '添加失败';
      }
    },
    toggleSort(field) {
      if (this.sortField === field) this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      else { this.sortField = field; this.sortOrder = 'asc'; }
      this.saveCurrentOrder();
    },
    openSearch(field) { this.searchField = field; this.searchKeyword = ''; },
    closeSearch() { this.searchField = null; this.searchKeyword = ''; },

    openContextMenu(event, type, payload) {
      event.preventDefault();
      this.contextMenu = { visible: false, x: 0, y: 0, items: [] };
      const items = [];
      if (type === 'header') {
        if (payload.name !== 'id' && payload.name !== 'position') {
          items.push({ label: '在左侧插入列', action: () => this.startAddColumn('left', payload) });
          items.push({ label: '在右侧插入列', action: () => this.startAddColumn('right', payload) });
          items.push({ label: '删除本列', action: () => this.deleteColumn(payload) });
        }
      } else if (type === 'row') {
        items.push({ label: '在上面插入行', action: () => this.insertRowAbove(payload) });
        items.push({ label: '在下面插入行', action: () => this.insertRowBelow(payload) });
        items.push({ label: '上移', action: () => this.moveRow(payload, 'up') });
        items.push({ label: '下移', action: () => this.moveRow(payload, 'down') });
        items.push({ label: '删除', action: () => this.deleteRecord(payload.id) });
      } else if (type === 'newRow') {
        items.push({ label: '取消新行', action: () => { this.newRow = null; } });
      }
      if (items.length) this.contextMenu = { visible: true, x: event.clientX, y: event.clientY, items };
    },
    onUpdateNewRow(fieldName, value) {
      if (this.newRow) this.newRow[fieldName] = value;
    },

    handleManageReceipt({ row, isNew }) {
      let images = [];
      try {
        const parsed = JSON.parse(row['收据'] || '[]');
        if (Array.isArray(parsed)) images = parsed;
      } catch { images = []; }
      this.receiptDialog = {
        visible: true,
        row: row,
        isNew: isNew,
        images: [...images],
      };
    },
    closeReceiptDialog() { this.receiptDialog.visible = false; },
    removeReceiptImage(index) {
      this.showConfirm('确定删除该图片吗？', () => {
        this.receiptDialog.images.splice(index, 1);
      });
    },
    async handleReceiptFilesUpload(event) {
      const files = event.target.files;
      if (!files.length) return;
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('receipts', files[i]);
      }
      try {
        const res = await axios.post(`${API_BASE}/fee-records/upload-receipt`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        this.receiptDialog.images.push(...res.data.urls);
      } catch (err) {
        this.showAlert('图片上传失败');
      }
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
        await axios.put(`${API_BASE}/fee-records/${this.receiptDialog.row.id}`, {
          '收据': imagesJson
        });
        this.receiptDialog.row['收据'] = imagesJson;
        this.closeReceiptDialog();
      } catch (err) {
        this.showAlert('保存收据失败');
      }
    },

    getFullUrl(img) {
      if (!img) return '';
      if (img.startsWith('http')) return img;
      return `${API_BASE}${img}`;
    },
    previewImage(img) {
      this.previewImageUrl = img;
    },

    async onSwapRows(fromIndex, toIndex) {
      const records = [...this.feeRecords];
      const [moved] = records.splice(fromIndex, 1);
      records.splice(toIndex, 0, moved);
      this.feeRecords = records;
      const ids = records.map(r => r.id);
      try {
        await axios.post(`${API_BASE}/fee-records/reorder`, { ids });
      } catch (err) {
        this.showAlert('排序更新失败');
        await this.fetchRecords();
      }
    },

    async onSwapColumns(fromIndex, toIndex) {
      const visibleFields = this.visibleFields;
      const moved = visibleFields[fromIndex];

      let targetName = null;
      let position = 'first';
      if (toIndex > 0) {
        targetName = visibleFields[toIndex - 1]?.name;
        position = 'after';
      }

      if (position === 'after' && targetName === moved.name) return;

      try {
        await axios.post(`${API_BASE}/fee-records/move-column`, {
          columnName: moved.name,
          targetColumnName: position === 'first' ? null : targetName,
          position
        });
      } catch (err) {
        this.showAlert('列移动失败');
      } finally {
        await this.fetchRecords();
      }
    },

    saveCurrentOrder() {
      const rows = this.displayRows.filter(r => !r._isNew);
      const ids = rows.map(r => r.id);
      if (ids.length > 0) {
        axios.post(`${API_BASE}/fee-records/reorder`, { ids }).catch(err => {
          console.error('自动保存排序顺序失败:', err);
        });
      }
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