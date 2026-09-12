<template>
  <!-- 快照菜单栏：周切换 + 下拉选择 + 操作按钮，统一收在同一条毛玻璃栏里 -->
  <div class="week-bar bg-surface">
    <button
      @click="goPrev"
      :disabled="!hasPrev"
      class="px-3 py-1 rounded bg-surface-hover hover:bg-border disabled:opacity-40 text-text whitespace-nowrap"
    >
      ◀ 上一周
    </button>
    <div class="week-date">{{ formatWeek(currentWeek) }}</div>
    <button
      @click="goNext"
      :disabled="!hasNext"
      class="px-3 py-1 rounded bg-surface-hover hover:bg-border disabled:opacity-40 text-text whitespace-nowrap"
    >
      下一周 ▶
    </button>
    <div class="w-56">
      <AppSelect
        v-if="weeks.length > 0"
        compact
        class="week-select"
        :model-value="currentWeek"
        @change="$emit('update:currentWeek', $event)"
        :options="weekOptions"
      />
    </div>
    <!-- 操作区插槽：使用方把「保存快照 / 删除快照」等按钮放进同一条栏 -->
    <slot name="actions" />
  </div>
</template>

<script>
import AppSelect from './AppSelect.vue'

export default {
  name: 'WeekSwitcher',
  components: { AppSelect },
  props: {
    currentWeek: { type: String, required: true },
    weeks: { type: Array, default: () => [] }
  },
  emits: ['update:currentWeek'],
  computed: {
    weekOptions() {
      return this.weeks.map(w => ({ value: w.week_start, label: this.formatWeek(w.week_start) }));
    },
    hasPrev() {
      const idx = this.weeks.findIndex(w => w.week_start === this.currentWeek);
      return idx > 0;
    },
    hasNext() {
      const idx = this.weeks.findIndex(w => w.week_start === this.currentWeek);
      return idx !== -1 && idx < this.weeks.length - 1;
    }
  },
  methods: {
    goPrev() {
      const idx = this.weeks.findIndex(w => w.week_start === this.currentWeek);
      if (idx > 0) this.$emit('update:currentWeek', this.weeks[idx - 1].week_start);
    },
    goNext() {
      const idx = this.weeks.findIndex(w => w.week_start === this.currentWeek);
      if (idx !== -1 && idx < this.weeks.length - 1) {
        this.$emit('update:currentWeek', this.weeks[idx + 1].week_start);
      }
    },
    formatWeek(weekStart) {
      if (!weekStart) return '';
      const date = new Date(weekStart);
      const end = new Date(date);
      end.setDate(end.getDate() + 6);
      return `${date.toISOString().slice(0, 10)} ~ ${end.toISOString().slice(0, 10)}`;
    }
  }
};
</script>

<style scoped>
/* 毛玻璃栏：底色走主题 surface（毛玻璃主题下即白色磨砂），圆角与同页表格容器一致 */
.week-bar {
  box-sizing: border-box;
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 16px;
  /* 保留原来 py-4 的上下留白，避免与上方表格/下方按钮贴在一起 */
  margin: 16px 0;
  border-radius: 16px;
  border: 1px solid var(--color-border, #e5e7eb);
}
/* 中间的时间单独框起来，作为这条栏的视觉中心 */
.week-date {
  padding: 4px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border, #e5e7eb);
  background: var(--color-surface-hover, #f3f4f6);
  color: var(--color-text, #111827);
  font-weight: 600;
  letter-spacing: 0.5px;
  white-space: nowrap;
}
/* 周下拉框：选中值居中（箭头绝对定位到右侧，否则会把文字挤偏左） */
.week-select :deep(.av-select__trigger) {
  position: relative;
}
.week-select :deep(.av-select__value) {
  flex: 1;
  text-align: center;
  /* 左右留出箭头的位置，文字过长时不会压到箭头，且居中不会偏移 */
  padding: 0 16px;
}
.week-select :deep(.av-select__arrow) {
  position: absolute;
  right: 9px;
  top: 50%;
  margin-top: -7px; /* 图标 14px，用负 margin 居中；避免用 transform 与展开时的旋转冲突 */
}
</style>
