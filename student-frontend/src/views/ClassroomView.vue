<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">📚 班级管理系统</h1>

    <div class="mb-4">
      <button @click="addNewRowAtBottom" class="bg-green-500 hover:bg-green-600 text-white px-5 py-2 rounded">
        ＋ 添加学生
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
      @deleteRow="deleteStudent"
      @addNewRowAtBottom="addNewRowAtBottom"
      @updateNewRow="onUpdateNewRow"
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

const API_BASE = 'https://localhost:3000';   // 如果实际使用 HTTP，请改为 http://localhost:3000
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
      } else if (this.dialog.type === 'alert' || this.dialog.type === 'confirm') {
        if (typeof this.dialogCallback === 'function') this.dialogCallback();
        else if (this.dialogCallback?.confirm) this.dialogCallback.confirm();
      }
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
      this.newRow = { ...empty, atPosition };
    },
    cancelNewRow() { this.newRow = null; },
    async saveNewRow() {
      if (!this.newRow) return;
      if (!this.newRow['姓名']?.trim()) {
        this.showAlert('姓名不能为空');
        return;
      }
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
    async deleteStudent(id) {
      this.showConfirm('确定删除吗？', async () => {
        try {
          await axios.delete(`${API_BASE}/students/${id}`);
          await this.fetchStudents();
        } catch (err) {
          this.showAlert(err.response?.data?.error || '删除失败');
        }
      });
    },
    async moveRow(row, direction) {
      try {
        await axios.post(`${API_BASE}/students/move-row`, { id: row.id, direction });
        await this.fetchStudents();
      } catch (err) {
        this.showAlert(err.response?.data?.error || '移动失败');
      }
    },
    deleteColumn(field) {
      if (field.name === 'id' || field.name === 'position') return this.showAlert('不能删除保留字段');
      if (field.name === '学号' || field.name === '姓名') return this.showAlert('该字段受保护，无法删除');
      this.showConfirm(`确定删除字段“${field.name}”吗？`, async () => {
        try {
          await axios.delete(`${API_BASE}/students/columns/${field.name}`);
          await this.fetchStudents();
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
        await axios.post(`${API_BASE}/students/add-column`, {
          columnName: this.columnForm.name,
          dataType: this.columnForm.dataType,
          after: this.columnForm.after,
        });
        this.dialog.visible = false;
        await this.fetchStudents();
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
        const field = payload;
        if (field.name !== 'id' && field.name !== 'position') {
          items.push({ label: '在左侧插入列', action: () => this.startAddColumn('left', field) });
          items.push({ label: '在右侧插入列', action: () => this.startAddColumn('right', field) });
          if (field.name === '学号' || field.name === '姓名') {
            items.push({
              label: '删除本列（受保护）',
              action: () => this.showAlert('“' + field.name + '”是核心字段，删除可能导致系统异常，禁止删除。')
            });
          } else {
            items.push({ label: '删除本列', action: () => this.deleteColumn(field) });
          }
        }
      } else if (type === 'row') {
        items.push({ label: '在上面插入行', action: () => this.insertRowAbove(payload) });
        items.push({ label: '在下面插入行', action: () => this.insertRowBelow(payload) });
        items.push({ label: '上移', action: () => this.moveRow(payload, 'up') });
        items.push({ label: '下移', action: () => this.moveRow(payload, 'down') });
        items.push({ label: '删除', action: () => this.deleteStudent(payload.id) });
      } else if (type === 'newRow') {
        items.push({ label: '取消新行', action: () => { this.newRow = null; } });
      }
      if (items.length) {
        this.contextMenu = { visible: true, x: event.clientX, y: event.clientY, items };
      }
    },
    onUpdateNewRow(fieldName, value) {
      if (this.newRow) {
        this.newRow[fieldName] = value;
      }
    },

    async onSwapRows(fromIndex, toIndex) {
      const students = [...this.students];
      const [moved] = students.splice(fromIndex, 1);
      students.splice(toIndex, 0, moved);
      this.students = students;
      const ids = students.map(s => s.id);
      try {
        await axios.post(`${API_BASE}/students/reorder`, { ids });
      } catch (err) {
        this.showAlert('排序更新失败');
        await this.fetchStudents();
      }
    },
    async onSwapColumns(fromIndex, toIndex) {
      const visibleFields = this.visibleFields;   // 班级页面的可见字段，不含 id、position
      const moved = visibleFields[fromIndex];

      // 计算目标列
      let targetName = null;
      let position = 'first';
      if (toIndex > 0) {
        targetName = visibleFields[toIndex - 1]?.name;
        position = 'after';
      }

      if (position === 'after' && targetName === moved.name) return;

      try {
        await axios.post(`${API_BASE}/students/move-column`, {
          columnName: moved.name,
          targetColumnName: position === 'first' ? null : targetName,
          position
        });
        // 成功：乐观更新 fields，让 UI 立刻变化
        const reordered = [...visibleFields];
        reordered.splice(fromIndex, 1);
        reordered.splice(toIndex, 0, moved);
        this.fields = reordered;
      } catch (err) {
      console.error('列移动失败:', err);
      this.showAlert('列移动失败');   // ← 添加这一行

        // 失败时不做乐观更新，静默恢复，可弹窗提示（可选）
      } finally {
        // 最后从后端拉取最新数据，确保数据库与前端彻底一致
        await this.fetchStudents();
      }
    },
    saveCurrentOrder() {
      const rows = this.displayRows.filter(r => !r._isNew);
      const ids = rows.map(r => r.id);
      if (ids.length > 0) {
        axios.post(`${API_BASE}/students/reorder`, { ids }).catch(err => {
          console.error('自动保存排序顺序失败:', err);
        });
      }
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