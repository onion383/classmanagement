<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed z-50"
      :style="{ left: position.x + 'px', top: position.y + 'px', width: '180px' }"
      @mousedown.stop
    >
      <div class="bg-white border border-blue-400 shadow-lg rounded p-1">
        <input
          ref="inputRef"
          v-model="inputText"
          class="w-full border px-2 py-1 text-sm rounded"
          placeholder="输入姓名..."
          @keydown.down.prevent="highlightNext"
          @keydown.up.prevent="highlightPrev"
          @keydown.enter.prevent="selectHighlighted"
          @keydown.escape="cancel"
          @input="onInput"
          @blur="handleBlur"
        />
        <ul
          v-if="filteredStudents.length > 0"
          class="max-h-32 overflow-auto border-t mt-1 bg-white"
        >
          <li
            v-for="(student, idx) in filteredStudents"
            :key="student.id"
            :class="[
              'px-2 py-1 text-sm cursor-pointer hover:bg-blue-100',
              { 'bg-blue-200': idx === highlightIndex }
            ]"
            @mousedown.prevent="selectStudent(student)"
            @mouseenter="highlightIndex = idx"
          >
            {{ student.姓名 }}
          </li>
        </ul>
        <div v-else class="text-xs text-gray-400 p-2">无匹配学生</div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import axios from 'axios';

export default {
  name: 'InlineStudentEditor',
  props: {
    visible: Boolean,
    position: {
      type: Object,
      default: () => ({ x: 0, y: 0 })
    },
    excludeIds: {
      type: Array,
      default: () => []
    }
  },
  emits: ['select', 'cancel'],
  data() {
    return {
      inputText: '',
      allStudents: [],
      highlightIndex: 0,
      isSelecting: false   // 辅助标记，防止失焦时误关
    };
  },
  computed: {
    filteredStudents() {
      const list = this.allStudents.filter(s => !this.excludeIds.includes(s.id));
      if (!this.inputText.trim()) return list;
      const kw = this.inputText.trim().toLowerCase();
      return list.filter(s => s.姓名.toLowerCase().includes(kw));
    }
  },
  watch: {
    visible(val) {
      if (val) {
        this.fetchStudents();
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
    async fetchStudents() {
      try {
        const res = await axios.get('/api/students');
        this.allStudents = res.data.data || res.data;
      } catch (e) {
        console.error(e);
      }
    },
    onInput() {
      this.highlightIndex = 0;
    },
    highlightNext() {
      if (this.highlightIndex < this.filteredStudents.length - 1) {
        this.highlightIndex++;
      }
    },
    highlightPrev() {
      if (this.highlightIndex > 0) {
        this.highlightIndex--;
      }
    },
    selectHighlighted() {
      if (this.filteredStudents.length > 0) {
        this.selectStudent(this.filteredStudents[this.highlightIndex]);
      } else {
        // 没有候选列表时，如果输入内容不为空，直接提交输入内容
        if (this.inputText.trim()) {
          this.$emit('select', { id: null, 姓名: this.inputText.trim() });
          this.close();
        } else {
          this.cancel();
        }
      }
    },
    selectStudent(student) {
      // 标记正在选择，失焦时不关闭
      this.isSelecting = true;
      this.$emit('select', student);
      this.close();
      // 重置标记
      this.$nextTick(() => { this.isSelecting = false; });
    },
    cancel() {
      this.$emit('cancel');
      this.close();
    },
    close() {
      // 父组件只需设置 visible 为 false，组件会自行清理
      // 这里不需要做额外操作，由父组件控制
    },
    handleBlur() {
      // 如果正在选择，不处理失焦（因为选择会由 mousedown.prevent 保持焦点，然后选择完关闭）
      if (this.isSelecting) return;
      // 延迟一点点，确保选择操作优先
      setTimeout(() => {
        if (!this.isSelecting) {
          this.cancel();
        }
      }, 150);
    }
  }
};
</script>