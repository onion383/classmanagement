<template>
  <!-- 重复筛选组件 -->
  <DialogShell :visible="visible" :z-index="10001" overlay-class="bg-black/50" @overlay="cancel">
    <div class="bg-surface p-5 rounded-lg w-[900px] max-h-[85vh] flex flex-col shadow-card dialog-card">
      <h3 class="text-lg font-bold mb-3">管理重复数据</h3>

      <template v-if="flatRows.length > 0">
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm text-text">
            共发现 {{ totalDuplicateRows }} 行重复数据（涉及 {{ groupedRows.length }} 组），
            每组将自动保留至少一行。
          </p>
          <button
            @click="toggleAllSelect"
            class="dup-link-btn"
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
            hideEditButton
            emptyActionText=""
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
          <span class="text-sm text-text">已选择 {{ selectedCount }} 行</span>
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
        <div class="text-center py-8 text-text-muted font-semibold">
          ✅ 没有发现重复数据。
        </div>
        <div class="flex justify-center mt-4">
          <button @click="cancel" class="bg-surface-hover px-4 py-1.5 rounded text-text">关闭</button>
        </div>
      </template>
    </div>
  </DialogShell>
</template>

<script setup>
import DynamicTable from '../tables/DynamicTable/DynamicTable.vue';
import { ref, computed, watch, nextTick } from 'vue'
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'

defineOptions({ name: 'DeduplicateDialog' })

const props = defineProps({
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
})
const emit = defineEmits(['delete-rows', 'cancel'])

const localFields = ref([]);
const sortField = ref('');
const sortOrder = ref('asc');
const selectedRowKeys = ref([]);
const updatingFromTable = ref(false);
const dupTable = ref(null);

const safeFields = computed(() => {
  if (!props.fields) return [];
  return props.fields.filter(f => f.name !== 'id' && f.name !== 'position');
})
const mappedRows = computed(() => {
  if (!props.rows) return [];
  return props.rows.map(r => ({ ...r, _rowKey: r.id, _isNew: false }));
})
const groupedRows = computed(() => {
  const fields = safeFields.value;
  if (!fields.length || !mappedRows.value.length) return [];

  const map = new Map();
  for (const row of mappedRows.value) {
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
})
const flatRows = computed(() => {
  const rows = [];
  for (let gIdx = 0; gIdx < groupedRows.value.length; gIdx++) {
    const group = groupedRows.value[gIdx];
    rows.push(...group);
    if (gIdx < groupedRows.value.length - 1) {
      rows.push({
        _rowKey: `sep_${gIdx}`,
        _isSeparator: true,
        _isNew: false,
        ...Object.fromEntries(safeFields.value.map(f => [f.name, ''])),
        _displayIndex: 0
      });
    }
  }
  return rows;
})
const totalDuplicateRows = computed(() => {
  return groupedRows.value.reduce((sum, g) => sum + g.length, 0);
})
const deletableIds = computed(() => {
  const ids = [];
  for (const group of groupedRows.value) {
    for (let i = 1; i < group.length; i++) {
      ids.push(group[i].id);
    }
  }
  return ids;
})
const isAllSelected = computed(() => {
  const allDeletable = deletableIds.value;
  return allDeletable.length > 0 && allDeletable.every(id => selectedRowKeys.value.includes(id));
})
const selectedCount = computed(() => {
  return selectedRowKeys.value.length;
})

watch(() => props.visible, (val) => {
  if (val) {
    localFields.value = props.fields.filter(f => f.name !== 'id' && f.name !== 'position');
    sortField.value = '';
    sortOrder.value = 'asc';
    selectedRowKeys.value = [];
  }
})

function toggleAllSelect() {
  if (isAllSelected.value) {
    selectedRowKeys.value = [];
  } else {
    selectedRowKeys.value = [...deletableIds.value];
  }
  syncTableSelection();
}
function onSelectionChangeFromTable({ keys }) {
  if (updatingFromTable.value) return;
  const validKeys = keys.filter(k => !String(k).startsWith('sep_'));
  const finalKeys = new Set(validKeys);
  for (const group of groupedRows.value) {
    const groupIds = group.map(r => r.id);
    const selectedInGroup = groupIds.filter(id => finalKeys.has(id));
    if (selectedInGroup.length === group.length) {
      finalKeys.delete(group[0].id);
    }
  }
  const newSelected = Array.from(finalKeys);
  if (JSON.stringify(newSelected) !== JSON.stringify(selectedRowKeys.value)) {
    updatingFromTable.value = true;
    selectedRowKeys.value = newSelected;
    nextTick(() => {
      syncTableSelection();
      updatingFromTable.value = false;
    });
  }
}
function syncTableSelection() {
  const table = dupTable.value;
  if (!table) return;
  table.selectedRowKeys = [...selectedRowKeys.value];
}
function onSwapColumns(fromIndex, toIndex) {
  const arr = [...localFields.value];
  const [moved] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, moved);
  localFields.value = arr;
}
// order 可显式指定方向（表头筛选面板的升序/降序按钮）；不传则沿用翻转语义
function toggleSort(field, order) {
  if (order === 'asc' || order === 'desc') {
    sortField.value = field;
    sortOrder.value = order;
  } else if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortOrder.value = 'asc';
  }
}
function confirmDelete() {
  const deletable = new Set(deletableIds.value);
  const idsToDelete = selectedRowKeys.value.filter(id => deletable.has(id));
  if (idsToDelete.length === 0) return;
  emit('delete-rows', idsToDelete);
}
function cancel() {
  emit('cancel');
}
</script>

<style scoped>
/* 「全选可删除行」链接按钮：带毛玻璃边框的轻按钮，统一各主题观感 */
.dup-link-btn {
  font-size: 14px;
  color: var(--color-info, #2563eb);
  padding: 5px 12px;
  border: 1px solid var(--color-info, #2563eb);
  border-radius: var(--radius-control);
  background: transparent;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s, box-shadow 0.2s;
}
.dup-link-btn:hover {
  color: var(--color-info, #2563eb);
  background: color-mix(in srgb, var(--color-info, #2563eb) 12%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--color-info, #2563eb) 20%, transparent);
}
.dup-link-btn:active {
  transform: translateY(1px);
}
</style>