<template>
  <div>
    <!-- 最多显示 maxVisible 行，超出部分在卡片内滚动 -->
    <div v-if="rows.length" class="space-y-2.5 overflow-y-auto pr-1" :style="{ maxHeight: listMaxHeight }">
      <div v-for="row in rows" :key="rowKeyFor(row)" class="flex items-center gap-3">
        <span class="w-20 text-sm text-text truncate text-right shrink-0">{{ row[nameKey] }}</span>
        <div class="flex-1 h-5 bg-surface-hover rounded overflow-hidden">
          <div class="h-full rounded stat-bar" :class="barClassFor(row) || 'stat-bar-default'" :style="{ width: barWidthFor(row) + '%' }"></div>
        </div>
        <span class="w-14 text-sm font-bold text-right shrink-0" :class="valueClassFor(row)">{{ valueTextFor(row) }}</span>
      </div>
    </div>
    <div v-else class="text-center text-text-muted py-8 text-sm">{{ emptyText }}</div>
  </div>
</template>

<script setup>
// 通用横向条状图：同时生长动画、夜间低浓度蓝、默认显示 5 行可滚动
import { computed } from 'vue'

defineOptions({ name: 'StatBarList' })
const props = defineProps({
  rows: { type: Array, default: () => [] },
  nameKey: { type: String, default: 'name' },
  valueKey: { type: String, default: 'value' },
  // (row) => 0-100 的条长百分比
  barWidth: { type: Function, required: true },
  // (row) => 颜色 class；不传时用主题蓝（夜间自动降低蓝色浓度）
  barClass: { type: [Function, String], default: null },
  // (row) => 右侧数值文案；默认取 valueKey
  valueText: { type: Function, default: null },
  valueClass: { type: [Function, String], default: 'text-text' },
  // (row) => 唯一 key；默认取 nameKey
  rowKey: { type: Function, default: null },
  emptyText: { type: String, default: '暂无数据' },
  maxVisible: { type: Number, default: 5 }
})

// 每行 20px + 行间距 10px：正好显示 maxVisible 行
const listMaxHeight = computed(() => {
  return props.maxVisible > 0 ? (props.maxVisible * 30 - 10) + 'px' : null
})

function barWidthFor(row) {
  return props.barWidth(row)
}
function barClassFor(row) {
  return typeof props.barClass === 'function' ? props.barClass(row) : props.barClass
}
function valueClassFor(row) {
  return typeof props.valueClass === 'function' ? props.valueClass(row) : props.valueClass
}
function valueTextFor(row) {
  return props.valueText ? props.valueText(row) : row[props.valueKey]
}
function rowKeyFor(row) {
  return props.rowKey ? props.rowKey(row) : row[props.nameKey]
}
</script>

<style scoped>
/* 所有条同时从左往右非线性生长 */
.stat-bar {
  transform-origin: left center;
  animation: stat-bar-grow 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes stat-bar-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
/* 日间主题蓝；夜间把主题蓝与深灰蓝混合，降低蓝色浓度 */
.stat-bar-default {
  background-color: var(--color-primary, #3b82f6);
}
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="glass2"]) .stat-bar-default {
  background-color: color-mix(in srgb, var(--color-primary, #3b82f6) 40%, #475569);
}
</style>
