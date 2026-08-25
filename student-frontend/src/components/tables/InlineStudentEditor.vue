<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed z-[10002]"
      :style="{ left: position.x + 'px', top: position.y + 'px', width: '180px' }"
      @mousedown.stop
    >
      <div class="bg-white border border-blue-400 shadow-lg rounded p-1">
        <input
          ref="inputRef"
          v-model="inputText"
          class="w-full border px-2 py-1 text-sm rounded"
          :placeholder="placeholder"
          @keydown.down.prevent="highlightNext"
          @keydown.up.prevent="highlightPrev"
          @keydown.enter.prevent="selectHighlighted"
          @keydown.escape="cancel"
          @input="onInput"
          @blur="handleBlur"
        />
        <ul
          v-if="filteredItems.length > 0"
          class="max-h-32 overflow-auto border-t mt-1 bg-white"
        >
          <li
            v-for="(item, idx) in filteredItems"
            :key="itemKey(item)"
            :class="[
              'px-2 py-1 text-sm cursor-pointer hover:bg-blue-100',
              { 'bg-blue-200': idx === highlightIndex }
            ]"
            @mousedown.prevent="selectItem(item)"
            @mouseenter="highlightIndex = idx"
          >
            {{ itemLabel(item) }}
          </li>
        </ul>
        <div v-else-if="inputText.trim()" class="text-xs text-gray-400 p-2">无匹配项</div>
      </div>
    </div>
  </Teleport>
</template>

<script>
export default {
  name: 'InlineStudentEditor',
  props: {
    visible: Boolean,
    position: {
      type: Object,
      default: () => ({ x: 0, y: 0 })
    },
    // 候选列表，每项可以是 { id, label, value } 或 { id, 姓名 }（旧格式兼容）
    items: {
      type: Array,
      default: () => []
    },
    // 显示字段名，默认 'label'，兼容旧学生数据可传 '姓名'
    labelField: {
      type: String,
      default: 'label'
    },
    // 取值字段名，默认取 labelField
    valueField: {
      type: String,
      default: ''
    },
    // 唯一标识字段名，默认 'id'
    keyField: {
      type: String,
      default: 'id'
    },
    // 已排除的 id 列表
    excludeIds: {
      type: Array,
      default: () => []
    },
    placeholder: {
      type: String,
      default: '输入...'
    },
    // 是否允许自由输入（没有候选时按回车提交输入文本）
    allowFreeInput: {
      type: Boolean,
      default: true
    }
  },
  emits: ['select', 'cancel'],
  data() {
    return {
      inputText: '',
      highlightIndex: 0,
      isSelecting: false
    };
  },
  computed: {
    filteredItems() {
      const list = this.items.filter(item => !this.excludeIds.includes(this.itemKey(item)));
      const text = this.inputText.trim();
      if (!text) return list;
      const kw = text.toLowerCase();
      return list.filter(item => String(this.itemLabel(item)).toLowerCase().includes(kw));
    }
  },
  watch: {
    visible(val) {
      if (val) {
        this.inputText = '';
        this.highlightIndex = 0;
        this.isSelecting = false;
        this.$nextTick(() => {
          this.$refs.inputRef?.focus();
        });
      }
    },
    inputText() {
      this.highlightIndex = 0;
    }
  },
  methods: {
    itemLabel(item) {
      if (!item) return '';
      // 兼容旧格式 { id, 姓名 }
      if (this.labelField === 'label' && item.姓名 !== undefined) return item.姓名;
      return item[this.labelField] ?? item.姓名 ?? '';
    },
    itemValue(item) {
      const field = this.valueField || this.labelField;
      if (field === 'label' && item.姓名 !== undefined) return item.姓名;
      return item[field] ?? item.姓名 ?? '';
    },
    itemKey(item) {
      return item[this.keyField] ?? item.id ?? '';
    },
    onInput() {
      this.highlightIndex = 0;
    },
    highlightNext() {
      if (this.highlightIndex < this.filteredItems.length - 1) {
        this.highlightIndex++;
      }
    },
    highlightPrev() {
      if (this.highlightIndex > 0) {
        this.highlightIndex--;
      }
    },
    selectHighlighted() {
      if (this.filteredItems.length > 0) {
        this.selectItem(this.filteredItems[this.highlightIndex]);
      } else if (this.allowFreeInput && this.inputText.trim()) {
        this.$emit('select', { id: null, label: this.inputText.trim(), value: this.inputText.trim() });
      } else {
        this.cancel();
      }
    },
    selectItem(item) {
      this.isSelecting = true;
      this.$emit('select', {
        id: this.itemKey(item),
        label: this.itemLabel(item),
        value: this.itemValue(item),
        raw: item
      });
      this.$nextTick(() => { this.isSelecting = false; });
    },
    cancel() {
      this.$emit('cancel');
    },
    handleBlur() {
      if (this.isSelecting) return;
      setTimeout(() => {
        if (!this.isSelecting) this.cancel();
      }, 150);
    }
  }
};
</script>
