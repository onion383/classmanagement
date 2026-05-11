<template>
  <table class="w-full border-collapse mt-2">
    <thead>
      <tr ref="theadRow">
        <th
          v-for="(field, colIndex) in fields"
          :key="field.name"
          @contextmenu.prevent="$emit('contextmenu', $event, 'header', field)"
          class="bg-green-500 text-white border border-gray-300 px-2 py-1 text-center cursor-context-menu select-none"
        >
          <div class="flex items-center justify-center gap-1">
            <!-- 列拖拽手柄 -->
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
        <th class="bg-green-500 text-white border border-gray-300 px-2 py-1 text-center col-op">操作</th>
      </tr>
    </thead>
    <tbody ref="tbodyRef">
      <tr
        v-for="(row, rowIndex) in rows"
        :key="row._rowKey"
        :class="[
          'data-drag-item',
          {
            'opacity-50': draggedRowIndex === rowIndex,
            'bg-blue-50': dragOverRowIndex === rowIndex && dragOverRowIndex !== draggedRowIndex
          }
        ]"
        :draggable="!row._isNew"
        @dragstart="row._isNew ? null : onRowDragStart($event, rowIndex)"
        @dragover.prevent="row._isNew ? null : onRowDragOver($event, rowIndex)"
        @drop="row._isNew ? null : onRowDrop($event, rowIndex)"
        @dragend="row._isNew ? null : onRowDragEnd()"
        @contextmenu.prevent="$emit('contextmenu', $event, row._isNew ? 'newRow' : 'row', row)"
        class="transition-all duration-150 ease-in-out"
      >
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
          <!-- 行拖拽手柄（只在第一列显示） -->
          <span
            v-if="fieldIndex === 0"
            class="absolute left-1 top-1/2 -translate-y-1/2 drag-handle cursor-grab select-none text-gray-400 hover:text-gray-600"
            @mousedown.stop
          >⠿</span>

          <!-- ID 列 -->
          <template v-if="field.name === 'id'">{{ row._isNew ? '自动' : row.id }}</template>
          <!-- position 列（序号） -->
          <template v-else-if="field.name === 'position'">{{ row._isNew ? '-' : row._displayIndex }}</template>
          <!-- 收据按钮 -->
          <template v-else-if="field.name === '收据'">
            <button
              @click="$emit('manageReceipt', { row, isNew: row._isNew })"
              class="bg-purple-500 text-white border-none py-1 px-2 rounded text-xs cursor-pointer"
            >
              管理收据{{ row._isNew ? '' : ' (' + getReceiptCount(row) + ')' }}
            </button>
          </template>
          <!-- 下拉选择器 -->
          <template v-else-if="field.control === 'select'">
            <!-- 新行：始终显示下拉框，选择后通过 updateNewRow 同步到父组件的 newRow -->
            <select
              v-if="row._isNew || isEditing(row, field.name)"
              :value="row[field.name]"
              @change="
                row._isNew
                  ? $emit('updateNewRow', field.name, $event.target.value)
                  : (
                    row[field.name] = $event.target.value,
                    $emit('saveCell', row, field)
                  )
              "
              @blur="row._isNew ? null : $emit('saveCell', row, field)"
              class="w-full min-h-[24px] leading-6 px-1 py-0.5 border border-gray-300 bg-white focus:outline-none focus:border-green-400"
            >
              <option value=""></option>
              <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
            <!-- 已有行：非编辑状态显示文本，双击进入编辑 -->
            <span
              v-else
              @dblclick="$emit('startEdit', row, field)"
              class="block w-full min-h-[24px] leading-6 px-1 cursor-default"
            >{{ row[field.name] || '' }}</span>
          </template>
          <!-- 日期选择器 -->
          <template v-else-if="field.type === '日期' || field.control === 'datepicker'">
            <input
              type="date"
              v-if="row._isNew || isEditing(row, field.name)"
              :value="row[field.name]"
              @input="
                row._isNew
                  ? $emit('updateNewRow', field.name, $event.target.value)
                  : (row[field.name] = $event.target.value)
              "
              @blur="row._isNew ? null : $emit('saveCell', row, field)"
              class="w-full min-h-[24px] leading-6 px-1 py-0.5 border border-transparent bg-yellow-50 focus:outline-none focus:border-green-400 box-border"
            />
            <span
              v-else
              @dblclick="$emit('startEdit', row, field)"
              class="block w-full min-h-[24px] leading-6 px-1 cursor-default"
            >{{ row[field.name] || '' }}</span>
          </template>
          <!-- 默认文本输入 -->
          <template v-else>
            <input
              v-if="row._isNew || isEditing(row, field.name)"
              :value="row[field.name]"
              @input="
                row._isNew
                  ? $emit('updateNewRow', field.name, $event.target.value)
                  : (row[field.name] = $event.target.value)
              "
              @blur="row._isNew ? null : $emit('saveCell', row, field)"
              @keyup.enter="row._isNew ? null : $emit('saveCell', row, field)"
              class="w-full min-h-[24px] leading-6 px-1 py-0.5 border border-transparent bg-yellow-50 focus:outline-none focus:border-green-400 box-border"
              :placeholder="field.name"
            />
            <span
              v-else
              @dblclick="$emit('startEdit', row, field)"
              class="block w-full min-h-[24px] leading-6 px-1 cursor-default"
            >{{ row[field.name] != null ? row[field.name] : '' }}</span>
          </template>
        </td>
        <!-- 操作按钮 -->
        <td class="border border-gray-300 px-2 py-1 text-center whitespace-nowrap">
          <template v-if="row._isNew">
            <button @click="$emit('saveNewRow')" class="bg-blue-500 text-white border-none py-0.5 px-2 mr-1 cursor-pointer rounded">保存</button>
            <button @click="$emit('cancelNewRow')" class="bg-gray-400 text-white border-none py-0.5 px-2 cursor-pointer rounded">取消</button>
          </template>
          <template v-else>
            <button @click="$emit('moveRow', row, 'up')" class="bg-gray-400 text-white border-none py-0.5 px-1.5 mr-0.5 cursor-pointer rounded" title="上移">↑</button>
            <button @click="$emit('moveRow', row, 'down')" class="bg-gray-400 text-white border-none py-0.5 px-1.5 mr-0.5 cursor-pointer rounded" title="下移">↓</button>
            <button @click="$emit('deleteRow', row.id)" class="bg-red-500 text-white border-none py-0.5 px-2 cursor-pointer rounded">删除</button>
          </template>
        </td>
      </tr>

      <!-- 底部添加提示（仅当没有任何新行时显示） -->
      <tr v-if="!hasNewRow" class="bg-gray-50 cursor-pointer" @click="$emit('addNewRowAtBottom')">
        <td :colspan="fields.length + 1" class="text-center py-2 text-green-500 font-medium">
          ＋ 点击添加一行
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script>
import { Sortable } from 'sortablejs'

export default {
  name: 'DynamicTable',
  props: {
    fields: Array,
    rows: Array,
    newRow: Object, // 保留但不再用于单独渲染
    sortField: String,
    sortOrder: String,
    editingCell: Object,
  },
  emits: [
    'contextmenu', 'search', 'toggleSort',
    'saveNewRow', 'cancelNewRow',
    'startEdit', 'saveCell',
    'moveRow', 'deleteRow', 'addNewRowAtBottom',
    'updateNewRow', 'manageReceipt',
    'swapRows', 'swapColumns',
  ],
  data() {
    return {
      rowSortable: null,
      colSortable: null,
      activeCell: null,              // { rowKey, field }
      draggedRowIndex: null,
      dragOverRowIndex: null,
    }
  },
  computed: {
    hasNewRow() {
      return this.rows && this.rows.some(r => r._isNew)
    }
  },
  watch: {
    'rows.length'() {
      this.$nextTick(() => {
        this.initRowSortable()
        this.focusOnNewRow()
      })
    },
    'fields.length'() {
      this.$nextTick(() => this.initColSortable())
    },
  },
  mounted() {
    this.$nextTick(() => {
      this.initRowSortable()
      this.initColSortable()
      this.focusOnNewRow()
    })
  },
  beforeUnmount() {
    if (this.rowSortable) this.rowSortable.destroy()
    if (this.colSortable) this.colSortable.destroy()
  },
  methods: {
    // ========== Sortable 初始化 ==========
    initRowSortable() {
      const tbody = this.$refs.tbodyRef
      if (!tbody) return
      if (this.rowSortable) this.rowSortable.destroy()

      this.rowSortable = new Sortable(tbody, {
        animation: 200,
        easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        handle: '.drag-handle',
        draggable: '.data-drag-item',
        filter: '.data-drag-item[data-isnew="true"]', // 新行不可拖拽（未设置该属性，但可用其他方式过滤）
        onStart: (evt) => {
          // 如果拖拽的是新行，阻止
          const row = this.rows[evt.oldIndex]
          if (row && row._isNew) {
            evt.preventDefault()
          }
        },
        onEnd: (evt) => {
          const oldIndex = evt.oldIndex
          const newIndex = evt.newIndex
          if (oldIndex !== newIndex) {
            // 注意：因为新行被过滤掉后，索引会偏移？不会，因为新行不可拖拽，但可能存在于列表中，evt.oldIndex 是拖拽元素在原始列表中的索引（包括不可拖拽元素）
            // 稳妥起见，我们根据实际数据找到行列索引，直接 emit
            this.$emit('swapRows', oldIndex, newIndex)
          }
        },
      })
    },

    initColSortable() {
      const theadRow = this.$refs.theadRow
      if (!theadRow) return
      if (this.colSortable) this.colSortable.destroy()

      this.colSortable = new Sortable(theadRow, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        handle: '.drag-handle',
        direction: 'horizontal',
        draggable: 'th',
        filter: '.col-op',           // 只禁止操作列
        onMove: (evt) => {
          if (
            evt.dragged.classList.contains('col-op') ||
            evt.related.classList.contains('col-op')
          ) return false
          return true
        },
        onEnd: (evt) => {
          const oldIndex = evt.oldIndex
          const newIndex = evt.newIndex
          if (oldIndex === newIndex) return

          // 🔧 关键：把被拖拽的列马上放回原位，不让 SortableJS 真正移动表头
          const parent = evt.item.parentNode
          const children = Array.from(parent.children)
          if (evt.item && children[oldIndex]) {
            parent.insertBefore(evt.item, children[oldIndex])
          }

          // 然后通知父组件发送 API 请求
          this.$nextTick(() => {
            this.$emit('swapColumns', oldIndex, newIndex)
          })
        },
      })
    },
    // ========== 编辑状态与格子点击 ==========
    isEditing(row, fieldName) {
      if (!this.editingCell) return false
      return this.editingCell.rowKey === row._rowKey && this.editingCell.field === fieldName
    },
    onCellClick(row, field) {
      // 如果正在编辑该单元格，不改变激活状态
      if (this.isEditing(row, field.name)) return
      this.activeCell = { rowKey: row._rowKey, field: field.name }
    },

    // 获取收据图片数量
    getReceiptCount(row) {
      try {
        const arr = JSON.parse(row['收据'] || '[]')
        return Array.isArray(arr) ? arr.length : 0
      } catch { return 0 }
    },

    // 新行自动聚焦
    focusOnNewRow() {
      this.$nextTick(() => {
        const newRowInput = this.$el.querySelector('.data-drag-item input:not([type="date"]):not([type="file"])')
        if (newRowInput) newRowInput.focus()
      })
    },

    // 原生拖拽事件（已弃用，占位防报错）
    onRowDragStart() {},
    onRowDragOver() {},
    onRowDrop() {},
    onRowDragEnd() {},
  },
}
</script>

<style scoped>
/* 手柄样式 */
.drag-handle {
  font-size: 14px;
  line-height: 1;
  user-select: none;
  opacity: 0.6;
}
.drag-handle:hover {
  opacity: 1;
}
th .drag-handle {
  color: rgba(255, 255, 255, 0.7);
}
th:hover .drag-handle {
  color: white;
}

/* 统一输入框/文本尺寸，避免撑大列 */
.cell-text, .cell-input {
  padding: 2px 4px;
  line-height: 1.5;
  min-height: 24px;
  box-sizing: border-box;
}

/* 输入框默认透明边框，聚焦时出现绿色 */
.cell-input {
  border: 1px solid transparent;
  background-color: #fffde7;
  outline: none;
  transition: border-color 0.1s;
}
.cell-input:focus {
  border-color: #4CAF50;
}

/* 单击单元格蓝色外框 */
.cell-active {
  outline: 2px solid #2563eb;
  outline-offset: -2px;
  background-color: rgba(37, 99, 235, 0.05);
}

/* Sortable 拖拽虚影、拖拽中样式 */
.sortable-ghost {
  opacity: 0.4;
  background-color: #c6f6d5;
  border: 2px dashed #38a169;
}
.sortable-drag {
  opacity: 0.9;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* 行过渡动画 */
tr {
  transition: background-color 0.15s ease;
}
</style>