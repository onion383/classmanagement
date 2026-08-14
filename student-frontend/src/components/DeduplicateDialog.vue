<template>
  <!-- 重复筛选组件 -->
  <Transition name="dialog">
  <div
    v-if="visible"
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]"
    @click.self="cancel"
  >
    <div class="bg-surface p-5 rounded-lg w-[900px] max-h-[85vh] flex flex-col shadow-card dialog-card">
      <h3 class="text-lg font-bold mb-3">管理重复数据</h3>

      <template v-if="flatRows.length > 0">
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm text-text-secondary">
            共发现 {{ totalDuplicateRows }} 行重复数据（涉及 {{ groupedRows.length }} 组），
            每组将自动保留至少一行。
          </p>
          <button
            @click="toggleAllSelect"
            class="text-sm text-info hover:underline"
          >
            {{ isAllSelected ? '取消全选' : '全选可删除行' }}
          </button>
        </div>

        <div class="flex-1 overflow-auto border border-border rounded">
          <DynamicTable
            ref="dupTable"
            :fields="localFields"
            :rows="flatRows"
            :hideSelectAll="true"
            :sortField="sortField"
            :sortOrder="sortOrder"
            @toggleSort="toggleSort"
            @swapColumns="onSwapColumns"
            @selectionChange="onSelectionChangeFromTable"
            @contextmenu="(e) => e.preventDefault()"
            @search="() => {}"
            @saveNewRow="() => {}"
            @cancelNewRow="() => {}"
            @startEdit="() => {}"
            @saveCell="() => {}"
            @moveRow="() => {}"
            @deleteRow="() => {}"
            @addNewRowAtBottom="() => {}"
            @updateNewRow="() => {}"
            @manageReceipt="() => {}"
            @swapRows="() => {}"
            @moveSelectedRows="() => {}"
          />
        </div>
        <div class="flex justify-between items-center mt-4">
          <span class="text-sm text-text-secondary">已选择 {{ selectedCount }} 行</span>
          <div class="flex gap-2">
            <button @click="cancel" class="bg-surface-hover px-4 py-1.5 rounded text-text">取消</button>
            <button
              @click="confirmDelete"
              :disabled="selectedCount === 0"
              class="bg-danger text-text-inverse px-4 py-1.5 rounded"
            >
              删除选中行
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="text-center py-8 text-text-muted">
          ✅ 没有发现重复数据。
        </div>
        <div class="flex justify-center mt-4">
          <button @click="cancel" class="bg-surface-hover px-4 py-1.5 rounded text-text">关闭</button>
        </div>
      </template>
    </div>
  </div>
  </Transition>
</template>

<script>
import DynamicTable from './DynamicTable.vue';
import '../styles/dialog-transition.css'

export default {
  name: 'DeduplicateDialog',
  components: { DynamicTable },
  props: {
    visible: Boolean,
    // 修复 1：去掉 required，提供默认空数组
    rows: {
      type: Array,
      default: () => []
    },
    fields: {
      type: Array,
      default: () => []
    }
  },
  emits: ['delete-rows', 'cancel'],
  data() {
    return {
      localFields: [],
      sortField: '',
      sortOrder: 'asc',
      selectedRowKeys: [],
      updatingFromTable: false
    };
  },
  computed: {
    safeFields() {
      if (!this.fields) return [];
      return this.fields.filter(f => f.name !== 'id' && f.name !== 'position');
    },
    mappedRows() {
      if (!this.rows) return [];
      return this.rows.map(r => ({ ...r, _rowKey: r.id, _isNew: false }));
    },
    groupedRows() {
      const fields = this.safeFields;
      if (!fields.length || !this.mappedRows.length) return [];

      const map = new Map();
      for (const row of this.mappedRows) {
        const key = fields.map(f => row[f.name] ?? '').join('|||');
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
      }

      const groups = [];
      for (const group of map.values()) {
        if (group.length > 1) groups.push(group);
      }
      groups.sort((a, b) => a[0].id - b[0].id);
      return groups;
    },
    flatRows() {
      const rows = [];
      for (let gIdx = 0; gIdx < this.groupedRows.length; gIdx++) {
        const group = this.groupedRows[gIdx];
        rows.push(...group);
        if (gIdx < this.groupedRows.length - 1) {
          rows.push({
            _rowKey: `sep_${gIdx}`,
            _isSeparator: true,
            _isNew: false,
            ...Object.fromEntries(this.safeFields.map(f => [f.name, ''])),
            _displayIndex: 0
          });
        }
      }
      return rows;
    },
    totalDuplicateRows() {
      return this.groupedRows.reduce((sum, g) => sum + g.length, 0);
    },
    deletableIds() {
      const ids = [];
      for (const group of this.groupedRows) {
        for (let i = 1; i < group.length; i++) {
          ids.push(group[i].id);
        }
      }
      return ids;
    },
    isAllSelected() {
      const allDeletable = this.deletableIds;
      return allDeletable.length > 0 && allDeletable.every(id => this.selectedRowKeys.includes(id));
    },
    selectedCount() {
      return this.selectedRowKeys.length;
    }
  },
  watch: {
    visible(val) {
      if (val) {
        this.localFields = this.fields.filter(f => f.name !== 'id' && f.name !== 'position');
        this.sortField = '';
        this.sortOrder = 'asc';
        this.selectedRowKeys = [];
      }
    }
  },
  methods: {
    toggleAllSelect() {
      if (this.isAllSelected) {
        this.selectedRowKeys = [];
      } else {
        this.selectedRowKeys = [...this.deletableIds];
      }
      this.syncTableSelection();
    },
    onSelectionChangeFromTable({ keys }) {
      if (this.updatingFromTable) return;
      const validKeys = keys.filter(k => !String(k).startsWith('sep_'));
      const finalKeys = new Set(validKeys);
      for (const group of this.groupedRows) {
        const groupIds = group.map(r => r.id);
        const selectedInGroup = groupIds.filter(id => finalKeys.has(id));
        if (selectedInGroup.length === group.length) {
          finalKeys.delete(group[0].id);
        }
      }
      const newSelected = Array.from(finalKeys);
      if (JSON.stringify(newSelected) !== JSON.stringify(this.selectedRowKeys)) {
        this.updatingFromTable = true;
        this.selectedRowKeys = newSelected;
        this.$nextTick(() => {
          this.syncTableSelection();
          this.updatingFromTable = false;
        });
      }
    },
    syncTableSelection() {
      const table = this.$refs.dupTable;
      if (!table) return;
      table.selectedRowKeys = [...this.selectedRowKeys];
    },
    onSwapColumns(fromIndex, toIndex) {
      const arr = [...this.localFields];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      this.localFields = arr;
    },
    toggleSort(field) {
      if (this.sortField === field) {
        this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortField = field;
        this.sortOrder = 'asc';
      }
    },
    confirmDelete() {
      const deletable = new Set(this.deletableIds);
      const idsToDelete = this.selectedRowKeys.filter(id => deletable.has(id));
      if (idsToDelete.length === 0) return;
      this.$emit('delete-rows', idsToDelete);
    },
    cancel() {
      this.$emit('cancel');
    }
  }
};
</script>