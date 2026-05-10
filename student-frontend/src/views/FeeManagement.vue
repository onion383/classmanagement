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
    />
  </div>
</template>

<script>
import axios from 'axios';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ContextMenu from '../components/ContextMenu.vue';
import SearchBar from '../components/SearchBar.vue';
import DynamicTable from '../components/DynamicTable.vue';

const API_BASE = 'http://localhost:3000';
const DEFAULT_FIELDS = [
  { name: 'id', type: '整数' },
  { name: 'position', type: '整数' },
  { name: '收支编码', type: '文字' },
  { name: '收支类型', type: '文字' },
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
    };
  },
  computed: {
    // 余额 = 所有收支金额的代数和
    balance() {
      return this.feeRecords.reduce((sum, r) => sum + (parseFloat(r['收支金额']) || 0), 0).toFixed(2);
    },
    // 本月收入 = 本月正金额之和
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
    // 本月支出 = 本月负金额绝对值之和
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
          if (result.fields?.length) this.fields = result.fields;
        }
        if (!this.fields?.length) this.fields = [...DEFAULT_FIELDS];
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
      this.fields.forEach(f => { if (f.name !== 'id' && f.name !== 'position') data[f.name] = this.newRow[f.name] || ''; });
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