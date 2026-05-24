<template>
  <div
    class="table-scroll-wrapper"
    :class="{ 'overflow-y-auto': enableVerticalScroll }"
    :style="enableVerticalScroll ? { maxHeight: '400px' } : {}"
  >
    <table class="w-full border-collapse mt-0">
      <thead class="sticky top-0 z-10">
        <tr ref="theadRow">
          <!-- 全选复选框（可通过 hideSelectAll 隐藏，但列始终存在） -->
          <th
            key="col-checkbox"
            class="bg-green-500 text-white border border-gray-300 px-1 py-1 text-center w-8 col-static"
          >
            <input
              v-if="!hideSelectAll"
              type="checkbox"
              :checked="isAllSelected"
              :indeterminate.prop="isIndeterminate"
              @change="toggleAllSelect"
              :disabled="!!editingCell"
              class="cursor-pointer"
            />
          </th>

          <!-- 数据列（可拖拽） -->
          <th
            v-for="(field, colIndex) in fields"
            :key="field.name"
            :draggable="!editingCell"
            @dragstart="onColDragStart($event, colIndex)"
            @dragover.prevent="onColDragOver($event, colIndex)"
            @dragleave="onColDragLeave($event, colIndex)"
            @drop="onColDrop($event, colIndex)"
            @dragend="onColDragEnd"
            @contextmenu.prevent="$emit('contextmenu', $event, 'header', field)"
            :class="[
              'bg-green-500 text-white border border-gray-300 px-2 py-1 text-center cursor-context-menu select-none',
              { 'opacity-30': colDragIndex === colIndex },
              colDropIndicatorClass(colIndex)
            ]"
            class="col-header"
          >
            <div class="flex items-center justify-center gap-1">
              <span class="drag-handle cursor-grab text-gray-300 hover:text-white select-none">⠿</span>
              <span @click.stop="$emit('search', field.name)" class="cursor-pointer">
                {{ field.name === 'id' ? 'ID' : field.name }}
              </span>
              <span class="flex flex-col text-xs cursor-pointer" @click.stop="$emit('toggleSort', field.name)">
                <span :class="sortField === field.name && sortOrder === 'asc' ? 'text-yellow-300' : 'text-gray-300'">▲</span>
                <span :class="sortField === field.name && sortOrder === 'desc' ? 'text-yellow-300' : 'text-gray-300'">▼</span>
              </span>
            </div>
          </th>

          <!-- 操作列（固定） -->
          <th
            key="col-op"
            class="bg-green-500 text-white border border-gray-300 px-2 py-1 text-center col-op"
          >
            操作
          </th>
        </tr>
      </thead>

      <tbody ref="tbodyRef">
        <TransitionGroup name="row-flip" tag="">
          <tr
            v-for="(row, rowIndex) in rows"
            :key="row._rowKey"
            :draggable="!row._isNew && !editingCell && !hasNewRow && !row._isSeparator"
            @dragstart="onRowDragStart($event, row, rowIndex)"
            @dragover.prevent="onRowDragOver($event, rowIndex)"
            @dragleave="onRowDragLeave($event, rowIndex)"
            @drop="onRowDrop($event, rowIndex)"
            @dragend="onRowDragEnd"
            @contextmenu.prevent="$emit('contextmenu', $event, row._isNew ? 'newRow' : 'row', row)"
            :class="[
              'data-drag-item',
              { 'opacity-30': dragIndex === rowIndex },
              rowDropIndicatorClass(rowIndex),
              { 'bg-gray-100': isRowSelected(row._rowKey) && !editingCell },
              row._isSeparator ? 'h-4 bg-gray-200' : ''
            ]"
            class="transition-all duration-200 ease-in-out"
          >
            <!-- 分隔行：只显示一个跨列的空单元格 -->
            <td v-if="row._isSeparator" :colspan="(fields ? fields.length : 0) + 2"></td>

            <!-- 普通行 -->
            <template v-else>
              <!-- 复选框 -->
              <td class="border border-gray-300 px-1 text-center align-middle w-8" @click.stop>
                <input
                  type="checkbox"
                  :checked="isRowSelected(row._rowKey)"
                  @change="toggleRowSelect(row._rowKey)"
                  :disabled="!!editingCell"
                  class="cursor-pointer"
                />
              </td>

              <!-- 数据列 -->
              <td
                v-for="(field, fieldIndex) in fields"
                :key="field.name"
                class="border border-gray-300 px-2 py-1 text-center relative pl-6"
                :class="{
                  'cell-active':
                    !isEditing(row, field.name) &&
                    activeCell &&
                    activeCell.rowKey === row._rowKey &&
                    activeCell.field === field.name
                }"
                @click="onCellClick(row, field)"
              >
                <!-- 拖拽手柄（仅在非去重模式或允许移动时显示） -->
                <span
                  v-if="fieldIndex === 0 && !hideMoveButtons"
                  class="absolute left-1 top-1/2 -translate-y-1/2 drag-handle cursor-grab select-none text-gray-400 hover:text-gray-600"
                  @mousedown.stop
                >⠿</span>

                <template v-if="field.name === 'id'">{{ row._isNew ? '自动' : row.id }}</template>
                <template v-else-if="field.name === 'position'">{{ row._isNew ? '-' : row._displayIndex }}</template>
                <template v-else-if="field.name === '收据'">
                  <button @click="$emit('manageReceipt', { row, isNew: row._isNew })" class="bg-purple-500 text-white border-none py-1 px-2 rounded text-xs cursor-pointer">管理收据{{ row._isNew ? '' : ' (' + getReceiptCount(row) + ')' }}</button>
                </template>
                <template v-else-if="field.control === 'select'">
                  <select
                    v-if="row._isNew || isEditing(row, field.name)"
                    v-model="row[field.name]"
                    @change="row._isNew ? $emit('updateNewRow', field.name, $event.target.value) : $emit('saveCell', row, field)"
                    @blur="row._isNew ? null : $emit('saveCell', row, field)"
                    class="w-full min-h-[24px] leading-6 px-1 py-0.5 border border-gray-300 bg-white focus:outline-none focus:border-green-400"
                  >
                    <option value=""></option>
                    <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
                  </select>
                  <span v-else @dblclick="$emit('startEdit', row, field)" class="block w-full min-h-[24px] leading-6 px-1 cursor-default">{{ row[field.name] || '' }}</span>
                </template>
                <template v-else-if="field.type === '日期' || field.control === 'datepicker'">
                  <input type="date" v-if="row._isNew || isEditing(row, field.name)" v-model="row[field.name]" @blur="row._isNew ? null : $emit('saveCell', row, field)" class="w-full min-h-[24px] leading-6 px-1 py-0.5 border border-transparent bg-yellow-50 focus:outline-none focus:border-green-400 box-border" />
                  <span v-else @dblclick="$emit('startEdit', row, field)" class="block w-full min-h-[24px] leading-6 px-1 cursor-default">{{ row[field.name] || '' }}</span>
                </template>
                <template v-else>
                  <input
                    v-if="row._isNew || isEditing(row, field.name)"
                    v-model="row[field.name]"
                    @blur="row._isNew ? null : $emit('saveCell', row, field)"
                    @keyup.enter="row._isNew ? null : $emit('saveCell', row, field)"
                    class="w-full min-h-[24px] leading-6 px-1 py-0.5 border border-transparent bg-yellow-50 focus:outline-none focus:border-green-400 box-border"
                    :placeholder="field.name"
                    :ref="row._isNew ? 'newRowInput' : 'editInput-' + row._rowKey + '-' + field.name"
                  />
                  <span v-else @dblclick="$emit('startEdit', row, field)" class="block w-full min-h-[24px] leading-6 px-1 cursor-default">{{ row[field.name] != null ? row[field.name] : '' }}</span>
                </template>
              </td>

              <!-- 操作列 -->
              <td class="border border-gray-300 px-2 py-1 text-center whitespace-nowrap">
                <template v-if="row._isNew">
                  <button @click="$emit('saveNewRow')" class="bg-blue-500 text-white border-none py-0.5 px-2 mr-1 cursor-pointer rounded">保存</button>
                  <button @click="$emit('cancelNewRow')" class="bg-gray-400 text-white border-none py-0.5 px-2 cursor-pointer rounded">取消</button>
                </template>
                <template v-else>
                  <!-- 上移 / 下移（仅在非去重模式显示） -->
                  <button
                    v-if="!hideMoveButtons"
                    @click="$emit('moveRow', row, 'up')"
                    class="bg-gray-400 text-white border-none py-0.5 px-1.5 mr-0.5 cursor-pointer rounded"
                    title="上移"
                  >↑</button>
                  <button
                    v-if="!hideMoveButtons"
                    @click="$emit('moveRow', row, 'down')"
                    class="bg-gray-400 text-white border-none py-0.5 px-1.5 mr-0.5 cursor-pointer rounded"
                    title="下移"
                  >↓</button>
                  <!-- 删除按钮始终保留 -->
                  <button @click="$emit('deleteRow', row.id)" class="bg-red-500 text-white border-none py-0.5 px-2 cursor-pointer rounded">删除</button>
                </template>
              </td>
            </template>
          </tr>
        </TransitionGroup>

        <tr v-if="!hasNewRow" class="bg-gray-50 cursor-pointer" @click="$emit('addNewRowAtBottom')">
          <td :colspan="(fields ? fields.length : 0) + 2" class="text-center py-2 text-green-500 font-medium">
            ＋ 点击添加一行
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script>
export default {
  name: 'DynamicTable',
  props: {
    fields: { type: Array, required: true },
    rows: { type: Array, required: true },
    newRow: { type: Object, default: null },
    sortField: { type: String, default: '' },
    sortOrder: { type: String, default: 'asc' },
    editingCell: { type: Object, default: null },
    maxRows: { type: Number, default: 10 },
    hideSelectAll: { type: Boolean, default: false },
    hideMoveButtons: { type: Boolean, default: false }   // 新增：控制移动按钮和拖拽手柄的显示
  },
  emits: [
    'contextmenu', 'search', 'toggleSort', 'saveNewRow', 'cancelNewRow',
    'startEdit', 'saveCell', 'moveRow', 'deleteRow', 'addNewRowAtBottom',
    'updateNewRow', 'manageReceipt', 'swapRows', 'swapColumns', 'moveSelectedRows',
    'selectionChange',
  ],
  data() {
    return {
      activeCell: null,
      selectedRowKeys: [],
      dragIndex: null,
      dragOverIndex: null,
      colDragIndex: null,
      colDragOverIndex: null,
      _dragGhost: null,
      _colDragGhost: null,
    };
  },
  computed: {
    hasNewRow() { return this.rows && this.rows.some(r => r._isNew); },
    enableVerticalScroll() { return (this.rows || []).length > this.maxRows; },
    isAllSelected() {
      const normalRows = (this.rows || []).filter(r => !r._isSeparator);
      return normalRows.length > 0 && normalRows.every(r => this.selectedRowKeys.includes(r._rowKey));
    },
    isIndeterminate() {
      const normalRows = (this.rows || []).filter(r => !r._isSeparator);
      const s = this.selectedRowKeys.length;
      return s > 0 && s < normalRows.length;
    },
  },
  watch: {
    'rows.length'() { this.$nextTick(() => this.focusOnNewRow()); },
    editingCell: {
      handler(newVal) {
        if (newVal) {
          this.$nextTick(() => {
            const key = 'editInput-' + newVal.rowKey + '-' + newVal.field;
            const inputs = this.$refs[key];
            if (inputs && inputs[0]) inputs[0].focus();
          });
          document.addEventListener('click', this.handleClickOutside);
        } else {
          document.removeEventListener('click', this.handleClickOutside);
        }
      },
      immediate: true,
    },
    rows: {
      handler(newVal) {
        this.selectedRowKeys = this.selectedRowKeys.filter(key => newVal.some(r => r._rowKey === key));
      },
      immediate: true,
    },
    selectedRowKeys: {
      handler() {
        this.$emit('selectionChange', {
          count: this.selectedRowKeys.length,
          keys: [...this.selectedRowKeys]
        });
      },
      deep: true,
      immediate: true,
    },
  },
  mounted() {
    this.focusOnNewRow();
  },
  beforeUnmount() {
    document.removeEventListener('click', this.handleClickOutside);
    if (this._dragGhost) this._dragGhost.remove();
    if (this._colDragGhost) this._colDragGhost.remove();
  },
  methods: {
    rowDropIndicatorClass(rowIndex) {
      if (this.dragIndex === null || this.dragOverIndex === null) return '';
      if (rowIndex !== this.dragOverIndex) return '';
      if (this.dragOverIndex > this.dragIndex) {
        return 'border-b-2 border-blue-500';
      }
      return 'border-t-2 border-blue-500';
    },
    colDropIndicatorClass(colIndex) {
      if (this.colDragIndex === null || this.colDragOverIndex === null) return '';
      if (colIndex !== this.colDragOverIndex) return '';
      if (this.colDragOverIndex > this.colDragIndex) {
        return 'border-r-2 border-blue-500';
      }
      return 'border-l-2 border-blue-500';
    },

    onRowDragStart(event, row, index) {
      if (row._isNew || row._isSeparator) { event.preventDefault(); return; }
      if (this.selectedRowKeys.length > 1 && !this.selectedRowKeys.includes(row._rowKey)) {
        event.preventDefault();
        return;
      }
      this.dragIndex = index;
      event.dataTransfer.effectAllowed = 'move';
      if (this.selectedRowKeys.length > 1) {
        const selectedRows = this.rows.filter(r => this.selectedRowKeys.includes(r._rowKey) && !r._isNew && !r._isSeparator);
        const ghost = document.createElement('div');
        ghost.style.cssText = 'position:absolute;top:-9999px;padding:8px 12px;background:rgba(219,234,254,0.95);border:2px solid #3b82f6;border-radius:8px;color:#1e3a8a;font-weight:bold;font-size:14px;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
        const names = selectedRows.slice(0, 2).map(r => r['姓名'] || r['收支编码'] || '项目');
        let text = names.join('、');
        if (selectedRows.length > 2) text += ` 等${selectedRows.length}项`;
        ghost.textContent = `🚚 ${text}`;
        document.body.appendChild(ghost);
        event.dataTransfer.setDragImage(ghost, 0, 0);
        this._dragGhost = ghost;
      } else {
        event.dataTransfer.setDragImage(event.target, event.target.offsetWidth / 2, 12);
      }
    },
    onRowDragOver(event, index) {
      event.dataTransfer.dropEffect = 'move';
      this.dragOverIndex = index;
    },
    onRowDragLeave(event, index) {
      if (this.dragOverIndex === index) this.dragOverIndex = null;
    },
    onRowDrop(event, targetIndex) {
      if (this.dragIndex === null || this.dragIndex === targetIndex) {
        this.dragIndex = null; this.dragOverIndex = null; return;
      }
      const movedRow = this.rows[this.dragIndex];
      if (this.selectedRowKeys.length > 1 && this.selectedRowKeys.includes(movedRow._rowKey)) {
        const selectedKeys = this.selectedRowKeys.filter(key => this.rows.some(r => r._rowKey === key && !r._isSeparator));
        this.$emit('moveSelectedRows', { selectedKeys, oldIndex: this.dragIndex, newIndex: targetIndex, isDownward: targetIndex > this.dragIndex });
      } else {
        this.$emit('swapRows', this.dragIndex, targetIndex);
      }
      this.dragIndex = null;
      this.dragOverIndex = null;
    },
    onRowDragEnd() {
      this.dragIndex = null;
      this.dragOverIndex = null;
      if (this._dragGhost) { this._dragGhost.remove(); this._dragGhost = null; }
    },

    onColDragStart(event, colIndex) {
      this.colDragIndex = colIndex;
      event.dataTransfer.effectAllowed = 'move';
      const field = this.fields[colIndex];
      const ghost = document.createElement('div');
      ghost.style.cssText = 'position:absolute;top:-9999px;padding:4px 12px;background:rgba(0,150,136,0.9);border:1px solid #009688;border-radius:4px;color:white;font-weight:bold;font-size:14px;z-index:10000;';
      ghost.textContent = field.name;
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 0, 0);
      this._colDragGhost = ghost;
    },
    onColDragOver(event, colIndex) {
      event.dataTransfer.dropEffect = 'move';
      this.colDragOverIndex = colIndex;
    },
    onColDragLeave(event, colIndex) {
      if (this.colDragOverIndex === colIndex) this.colDragOverIndex = null;
    },
    onColDrop(event, targetIndex) {
      if (this.colDragIndex === null || this.colDragIndex === targetIndex) {
        this.colDragIndex = null; this.colDragOverIndex = null; return;
      }
      this.$emit('swapColumns', this.colDragIndex, targetIndex);
      this.colDragIndex = null;
      this.colDragOverIndex = null;
    },
    onColDragEnd() {
      this.colDragIndex = null;
      this.colDragOverIndex = null;
      if (this._colDragGhost) { this._colDragGhost.remove(); this._colDragGhost = null; }
    },

    isEditing(row, fieldName) { return this.editingCell?.rowKey === row._rowKey && this.editingCell?.field === fieldName; },
    onCellClick(row, field) { if (!this.isEditing(row, field.name)) this.activeCell = { rowKey: row._rowKey, field: field.name }; },
    handleClickOutside(event) {
      if (!this.editingCell) return;
      if (!this.$el.contains(event.target)) { this.emitSaveAndClear(); return; }
      const editingInput = this.$el.querySelector('input:focus, select:focus');
      if (!editingInput || !editingInput.contains(event.target)) this.emitSaveAndClear();
    },
    emitSaveAndClear() {
      if (!this.editingCell) return;
      const row = this.rows.find(r => r._rowKey === this.editingCell.rowKey);
      const field = this.fields.find(f => f.name === this.editingCell.field);
      if (row && field) this.$emit('saveCell', row, field);
    },
    isRowSelected(rowKey) { return this.selectedRowKeys.includes(rowKey); },
    toggleRowSelect(rowKey) {
      const idx = this.selectedRowKeys.indexOf(rowKey);
      idx === -1 ? this.selectedRowKeys.push(rowKey) : this.selectedRowKeys.splice(idx, 1);
    },
    toggleAllSelect() {
      const normalRows = (this.rows || []).filter(r => !r._isSeparator && !r._isNew);
      this.isAllSelected
        ? (this.selectedRowKeys = [])
        : (this.selectedRowKeys = normalRows.map(r => r._rowKey));
    },
    clearSelection() { this.selectedRowKeys = []; },
    getReceiptCount(row) { try { return JSON.parse(row['收据'] || '[]').length; } catch { return 0; } },
    focusOnNewRow() {
      this.$nextTick(() => {
        const input = this.$el.querySelector('.data-drag-item input:not([type="date"]):not([type="file"])');
        if (input) input.focus();
      });
    },
  },
};
</script>

<style scoped>
.drag-handle { font-size: 14px; line-height: 1; user-select: none; opacity: 0.6; }
.drag-handle:hover { opacity: 1; }
th .drag-handle { color: rgba(255,255,255,0.7); }
th:hover .drag-handle { color: white; }
.cell-input { padding: 2px 4px; line-height: 1.5; min-height: 24px; box-sizing: border-box; border: 1px solid transparent; background-color: #fffde7; outline: none; transition: border-color 0.1s; }
.cell-input:focus { border-color: #4CAF50; }
.cell-text { padding: 2px 4px; line-height: 1.5; min-height: 24px; box-sizing: border-box; }
.cell-active { outline: 2px solid #2563eb; outline-offset: -2px; background-color: rgba(37,99,235,0.05); }
.row-flip-move { transition: transform 0.25s ease; }
.row-flip-enter-active, .row-flip-leave-active { transition: all 0.25s ease; }
.row-flip-enter-from, .row-flip-leave-to { opacity: 0; transform: translateX(-20px); }
tr { transition: background-color 0.15s ease; }
</style>