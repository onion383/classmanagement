<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">📚 班级管理系统</h1>

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
  </div>
</template>

<script>
import axios from 'axios';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ContextMenu from '../components/ContextMenu.vue';
import SearchBar from '../components/SearchBar.vue';
import DynamicTable from '../components/DynamicTable.vue';

const API_BASE = '/api';
const DEFAULT_FIELDS = [
  { name: 'id', type: '整数' },
  { name: 'position', type: '整数' },
  { name: '学号', type: '文字' },
  { name: '年级', type: '文字' },
  { name: '班级', type: '文字' },
  { name: '姓名', type: '文字' },
  { name: '年龄', type: '整数' },
  { name: '备注', type: '文字' }
];

export default {
  name: 'ClassroomView',
  components: { ConfirmDialog, ContextMenu, SearchBar, DynamicTable },
  data() {
    return {
      students: [],
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
      selectedCount: 0,
      clipboard: null,
    };
  },
  computed: {
    displayRows() {
      let filtered = this.students;
      if (this.searchField && this.searchKeyword) {
        const kw = this.searchKeyword.toLowerCase();
        filtered = this.students.filter(s => {
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
          if (!isNaN(va) && !isNaN(vb)) {
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
  },
  methods: {
    showAlert(msg, cb) {
      this.dialog = { visible: true, message: msg, type: 'alert', showCancel: false };
      this.dialogCallback = cb;
    },
    showConfirm(msg, onConfirm, onCancel) {
      this.dialog = { visible: true, message: msg, type: 'confirm', showCancel: true };
      this.dialogCallback = { confirm: onConfirm, cancel: onCancel };
    },
    onDialogConfirm() {
      this.dialog.visible = false;
      if (this.dialog.type === 'columnAdd') {
        this.confirmAddColumn();
      } else if (typeof this.dialogCallback === 'function') this.dialogCallback();
      else if (this.dialogCallback?.confirm) this.dialogCallback.confirm();
    },
    onDialogCancel() {
      this.dialog.visible = false;
      if (this.dialogCallback?.cancel) this.dialogCallback.cancel();
    },

    async fetchStudents() {
      try {
        const res = await axios.get(`${API_BASE}/students?_t=${Date.now()}`);
        const result = res.data;
        if (Array.isArray(result.data)) {
          this.students = result.data;
          if (result.fields?.length) this.fields = result.fields;
        } else if (Array.isArray(result)) {
          this.students = result;
          if (result.length > 0) this.fields = Object.keys(result[0]).map(k => ({ name: k, type: '文字' }));
        }
        if (!this.fields?.length) this.fields = [...DEFAULT_FIELDS];
      } catch (err) {
        console.error(err);
        if (!this.students.length) this.showAlert('无法加载数据');
      }
    },
    startEditCell(row, field) {
      this.editingCell = { rowKey: row._rowKey, field: field.name };
    },
    async saveCell(row, field) {
      if (!this.editingCell) return;
      if (!this.validateValue(row[field.name], field.type)) {
        this.showAlert('输入格式错误');
        return;
      }
      try {
        await axios.put(`${API_BASE}/students/${row.id}`, { [field.name]: row[field.name] });
      } catch { this.showAlert('修改失败'); }
      this.editingCell = null;
    },
    validateValue(val, type) {
      if (val === null || val === undefined || val === '') return true;
      if (type === '整数') return /^-?\d+$/.test(String(val));
      if (type === '小数') return /^-?\d+(\.\d+)?$/.test(String(val));
      return true;
    },

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
      if (!this.newRow['姓名']?.trim()) { this.showAlert('姓名不能为空'); return; }
      const data = {};
      this.fields.forEach(f => { if (f.name !== 'id' && f.name !== 'position') data[f.name] = this.newRow[f.name] || ''; });
      if (this.newRow.atPosition != null) data.atPosition = this.newRow.atPosition;
      try {
        await axios.post(`${API_BASE}/students`, data);
        this.newRow = null;
        await this.fetchStudents();
      } catch (err) {
        this.showAlert('添加失败：' + (err.response?.data?.error || err.message));
      }
    },
    async moveRow(row, direction) {
      try { await axios.post(`${API_BASE}/students/move-row`, { id: row.id, direction }); await this.fetchStudents(); }
      catch (err) { this.showAlert(err.response?.data?.error || '移动失败'); }
    },

    deleteColumn(field) {
      if (field.name === 'id' || field.name === 'position') return this.showAlert('不能删除保留字段');
      if (field.name === '学号' || field.name === '姓名') return this.showAlert('该字段受保护，无法删除');
      this.showConfirm(`确定删除字段“${field.name}”吗？`, async () => {
        try { await axios.delete(`${API_BASE}/students/columns/${field.name}`); await this.fetchStudents(); }
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
        await axios.post(`${API_BASE}/students/add-column`, { columnName: this.columnForm.name, dataType: this.columnForm.dataType, after: this.columnForm.after });
        this.dialog.visible = false; await this.fetchStudents();
      } catch (err) { this.columnForm.error = err.response?.data?.error || '添加失败'; }
    },

    toggleSort(field) {
      if (this.sortField === field) this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      else { this.sortField = field; this.sortOrder = 'asc'; }
      this.saveCurrentOrder();
    },
    openSearch(field) { this.searchField = field; this.searchKeyword = ''; },
    closeSearch() { this.searchField = null; this.searchKeyword = ''; },

    // ============= 右键菜单（最终版） =============
    openContextMenu(event, type, payload) {
      event.preventDefault();
      this.contextMenu = { visible: false, x: 0, y: 0, items: [] };
      const items = [];
      if (type === 'header') {
        const field = payload;
        if (field.name !== 'id' && field.name !== 'position') {
          items.push({ label: '在左侧插入列', action: () => this.startAddColumn('left', field) });
          items.push({ label: '在右侧插入列', action: () => this.startAddColumn('right', field) });
          if (field.name === '学号' || field.name === '姓名') {
            items.push({ label: '删除本列（受保护）', action: () => this.showAlert('“' + field.name + '”是核心字段，删除可能导致系统异常，禁止删除。') });
          } else {
            items.push({ label: '删除本列', action: () => this.deleteColumn(field) });
          }
        }
      } else if (type === 'row') {
        // 上移、下移
        items.push({ label: '上移', action: () => this.moveRow(payload, 'up') });
        items.push({ label: '下移', action: () => this.moveRow(payload, 'down') });



        // 粘贴（如果剪贴板有内容）
        if (this.clipboard && this.clipboard.ids.length > 0) {
          const pasteCount = this.clipboard.ids.length;
          items.push({ label: `📋 粘贴到上方 (${pasteCount})`, action: () => this.pasteRows('above', payload) });
          items.push({ label: `📋 粘贴到下方 (${pasteCount})`, action: () => this.pasteRows('below', payload) });
        }
        

        // 插入行
        items.push({ label: '在上面插入行', action: () => this.insertRowAbove(payload) });
        items.push({ label: '在下面插入行', action: () => this.insertRowBelow(payload) });

        // 剪切（根据选中数量显示）
        const cutCount = this.selectedCount > 1 ? this.selectedCount : 1;
        items.push({ label: `✂️ 剪切 (${cutCount})`, action: () => this.cutRows(payload) });

        // 删除（根据选中数量显示）
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

    // 剪切逻辑：若有多选则剪切所有选中行，否则剪切右键所在行
    cutRows(targetRow) {
      if (this.selectedCount > 1) {
        this.cutSelectedRows(); // 多选剪切
      } else {
        // 单行剪切
        const row = targetRow;
        if (!row || row._isNew) return;
        this.clipboard = { rows: [row], ids: [row.id] };
        this.students = this.students.filter(s => s.id !== row.id);
        this.$refs.dynamicTable.clearSelection();
        this.selectedCount = 0;
      }
    },
    cutSelectedRows() {
      const selectedKeys = this.$refs.dynamicTable?.selectedRowKeys;
      if (!selectedKeys || selectedKeys.length === 0) return;
      const cutRows = this.students.filter(s => selectedKeys.includes(s.id));
      this.clipboard = { rows: cutRows, ids: cutRows.map(s => s.id) };
      this.students = this.students.filter(s => !selectedKeys.includes(s.id));
      this.$refs.dynamicTable.clearSelection();
      this.selectedCount = 0;
    },

    // 删除逻辑：若有多选则删除所有选中行，否则删除右键所在行
    deleteRows(targetRow) {
      if (this.selectedCount > 1) {
        this.onBatchDelete(); // 多选删除
      } else {
        // 单行删除
        const row = targetRow;
        if (!row || row._isNew) return;
        this.showConfirm('确定删除该学生吗？', async () => {
          try {
            await axios.delete(`${API_BASE}/students/${row.id}`);
            await this.fetchStudents();
            this.selectedCount = 0;
          } catch (err) {
            this.showAlert('删除失败');
          }
        });
      }
    },
    async onBatchDelete() {
      const selectedKeys = this.$refs.dynamicTable?.selectedRowKeys;
      if (!selectedKeys || selectedKeys.length === 0) return;
      const selectedIds = this.students.filter(s => selectedKeys.includes(s.id)).map(s => s.id);
      this.showConfirm(`确定删除选中的 ${selectedIds.length} 个学生吗？`, async () => {
        try {
          for (const id of selectedIds) { await axios.delete(`${API_BASE}/students/${id}`); }
          await this.fetchStudents();
          this.$refs.dynamicTable.clearSelection();
          this.selectedCount = 0;
        } catch (err) { this.showAlert('删除失败'); }
      });
    },

    onMoveSelectedRows({ selectedKeys, oldIndex, newIndex, isDownward }) {
      const students = [...this.students];
      const selectedRows = selectedKeys.map(key => students.find(s => s.id === key || s._rowKey === key)).filter(r => r && !r._isNew);
      if (selectedRows.length === 0) return;
      const selectedIds = selectedRows.map(r => r.id);
      const otherRows = students.filter(s => !selectedIds.includes(s.id));
      const rowsBefore = students.slice(0, newIndex).filter(s => !selectedIds.includes(s.id)).length;
      const insertIdx = isDownward ? rowsBefore + 1 : rowsBefore;
      otherRows.splice(insertIdx, 0, ...selectedRows);
      this.students = otherRows;
      const ids = otherRows.map(s => s.id);
      axios.post(`${API_BASE}/students/reorder`, { ids }).catch(() => { this.showAlert('移动失败'); this.fetchStudents(); });
    },

    pasteRows(position, targetRow) {
      if (!this.clipboard || this.clipboard.ids.length === 0) return;
      const { rows } = this.clipboard;
      const targetIndex = this.students.findIndex(s => s.id === targetRow.id);
      if (targetIndex === -1) return;
      const insertIdx = position === 'above' ? targetIndex : targetIndex + 1;
      this.students.splice(insertIdx, 0, ...rows);
      const newIds = this.students.map(s => s.id);
      axios.post(`${API_BASE}/students/reorder`, { ids: newIds }).catch(() => { this.showAlert('粘贴失败'); this.fetchStudents(); });
      this.clipboard = null;
    },

    // 以下两个方法保留，可用于其他功能
    insertRowsAbove(target, number) {
      for (let i = 0; i < number; i++) this.createNewRow(target.position);
    },
    insertRowsBelow(target, number) {
      for (let i = number - 1; i >= 0; i--) this.createNewRow(target.position + 1 + i);
    },

    async onSwapRows(fromIndex, toIndex) {
      const students = [...this.students];
      const [moved] = students.splice(fromIndex, 1);
      students.splice(toIndex, 0, moved);
      this.students = students;
      const ids = students.map(s => s.id);
      try { await axios.post(`${API_BASE}/students/reorder`, { ids }); }
      catch (err) { this.showAlert('排序更新失败'); await this.fetchStudents(); }
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
        await axios.post(`${API_BASE}/students/move-column`, { columnName: moved.name, targetColumnName: position === 'first' ? null : targetName, position });
        await this.fetchStudents();
      } catch (err) {
        this.fields = originalFields;
        this.showAlert('列移动失败');
      }
    },

    onSelectionChange(count) { this.selectedCount = count; },

    saveCurrentOrder() {
      const rows = this.displayRows.filter(r => !r._isNew);
      const ids = rows.map(r => r.id);
      if (ids.length > 0) axios.post(`${API_BASE}/students/reorder`, { ids }).catch(() => {});
    },
  },
  mounted() {
    this.fetchStudents();
    document.addEventListener('click', () => { this.contextMenu.visible = false; });
  },
  beforeUnmount() {
    document.removeEventListener('click', () => { this.contextMenu.visible = false; });
  },
};
</script>