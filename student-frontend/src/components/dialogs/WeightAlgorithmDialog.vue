<template>
  <DialogShell :visible="visible" :z-index="50" overlay-class="bg-black/30">
    <div class="bg-surface rounded-lg p-6 w-[36rem] max-w-[92vw] max-h-[88vh] shadow-card dialog-card flex flex-col overflow-hidden">
      <h3 class="text-lg font-bold mb-4 flex-shrink-0">中心权重算法</h3>

      <!-- 中心区域：一个位置 / 矩形区域，权重均为 1 -->
      <div class="border border-border rounded-lg p-4 mb-4 flex-shrink-0">
        <div class="flex items-center gap-4 mb-3">
          <span class="text-sm font-medium text-text w-24 flex-shrink-0">中心区域</span>
          <AppSelect v-model="centerType" :options="centerTypeOptions" class="w-40" />
        </div>

        <div v-if="centerType === 'point'" class="flex items-center gap-4">
          <span class="text-sm text-text-muted w-24 flex-shrink-0">中心位置</span>
          <label class="text-sm text-text-secondary">行
            <input type="number" min="1" :max="rows" v-model.number="pointRow" class="ml-1 w-16 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
          </label>
          <label class="text-sm text-text-secondary">列
            <input type="number" min="1" :max="cols" v-model.number="pointCol" class="ml-1 w-16 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
          </label>
        </div>

        <div v-else class="flex items-center gap-4 flex-wrap">
          <span class="text-sm text-text-muted w-24 flex-shrink-0">行列范围</span>
          <label class="text-sm text-text-secondary">行
            <input type="number" min="1" :max="rows" v-model.number="rowStart" class="ml-1 w-16 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
            <span class="mx-1">~</span>
            <input type="number" min="1" :max="rows" v-model.number="rowEnd" class="w-16 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
          </label>
          <label class="text-sm text-text-secondary">列
            <input type="number" min="1" :max="cols" v-model.number="colStart" class="ml-1 w-16 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
            <span class="mx-1">~</span>
            <input type="number" min="1" :max="cols" v-model.number="colEnd" class="w-16 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
          </label>
        </div>
      </div>

      <!-- 递减速率（含最小值）：子标题在毛玻璃外，毛玻璃内只放输入区；内部两列排布 上/左、下/右、最小值 -->
      <p class="text-sm font-medium text-text mb-1 flex-shrink-0">递减速率（每跨一格减少的权重，0–1 小数）</p>
      <p class="text-xs text-text-muted mb-3 flex-shrink-0">距离 = 上下步数相加 + 左右步数相加</p>
      <div class="mb-4 p-3 rounded-lg bg-surface/55 backdrop-blur-md flex-shrink-0">
        <div class="border border-border rounded-lg p-4">
          <div class="grid grid-cols-2 gap-3">
            <label class="flex items-center justify-center gap-2 text-sm text-text-secondary">上
              <input type="number" step="0.01" min="0" max="1" v-model.number="rateUp" class="w-24 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
            </label>
            <label class="flex items-center justify-center gap-2 text-sm text-text-secondary">左
              <input type="number" step="0.01" min="0" max="1" v-model.number="rateLeft" class="w-24 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
            </label>
            <label class="flex items-center justify-center gap-2 text-sm text-text-secondary">下
              <input type="number" step="0.01" min="0" max="1" v-model.number="rateDown" class="w-24 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
            </label>
            <label class="flex items-center justify-center gap-2 text-sm text-text-secondary">右
              <input type="number" step="0.01" min="0" max="1" v-model.number="rateRight" class="w-24 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
            </label>
            <label class="col-span-2 flex items-center justify-center gap-2 text-sm text-text-secondary">最小值
              <input type="number" step="0.01" min="0" max="1" v-model.number="minValue" class="w-24 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
            </label>
          </div>
        </div>
      </div>

      <!-- 超出最小值设定的提示 -->
      <p v-if="overflow" class="text-sm text-info mb-4 flex-shrink-0">已超出最小值设定，已自动设为满足条件的最大梯度</p>

      <!-- 实时热力图预览：子标题在毛玻璃外，毛玻璃内只放热力图；内容居中。
           高度不足时由内部热力图区域出现滚动条，弹窗本身不出现滚动条。 -->
      <p class="text-sm font-medium text-text mb-3 flex-shrink-0">权重预览</p>
      <div class="mb-4 p-3 rounded-lg bg-surface/55 backdrop-blur-md flex-1 min-h-0 flex flex-col">
        <div class="border border-border rounded-lg p-4 flex-1 min-h-0 flex flex-col">
          <div class="overflow-auto min-h-0 flex-1" style="max-height: 16rem;">
            <div class="grid gap-1 w-max mx-auto" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
              <div
                v-for="(cell, i) in flatPreview"
                :key="i"
                class="w-10 h-8 flex items-center justify-center text-[11px] rounded border border-border"
                :style="{ background: cell.bg, color: cell.fg }"
              >{{ cell.text }}</div>
            </div>
          </div>
          <p class="text-xs text-text-muted mt-2 text-center flex-shrink-0">中心区域为 1，向四周按上下左右速率递减</p>
        </div>
      </div>

      <div class="flex justify-end gap-2 flex-shrink-0">
        <button @click="$emit('close')" class="bg-surface-hover px-4 py-2 rounded text-text border border-border">取消</button>
        <button @click="apply" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme">生成并应用</button>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'
import AppSelect from '../base/AppSelect.vue'
import { ref, computed, watch } from 'vue'

defineOptions({ name: 'WeightAlgorithmDialog' })

const props = defineProps({
  visible: Boolean,
  rows: { type: Number, default: 6 },
  cols: { type: Number, default: 7 },
})
const emit = defineEmits(['close', 'apply'])

// 中心区域类型：下拉选择（一个位置 / 矩形区域）
const centerTypeOptions = ref([
  { value: 'point', label: '一个位置' },
  { value: 'rect', label: '矩形区域' },
])
const centerType = ref('point')
const pointRow = ref(1)
const pointCol = ref(1)
const rowStart = ref(1)
const rowEnd = ref(1)
const colStart = ref(1)
const colEnd = ref(1)
const rateUp = ref(0.1)
const rateDown = ref(0.1)
const rateLeft = ref(0.1)
const rateRight = ref(0.1)
const minValue = ref(0)

// 中心区域（0-based，已夹到网格范围内）
const centerRect = computed(() => {
  let r1, r2, c1, c2
  if (centerType.value === 'point') {
    r1 = r2 = pointRow.value
    c1 = c2 = pointCol.value
  } else {
    r1 = Math.min(rowStart.value, rowEnd.value)
    r2 = Math.max(rowStart.value, rowEnd.value)
    c1 = Math.min(colStart.value, colEnd.value)
    c2 = Math.max(colStart.value, colEnd.value)
  }
  const clampCell = (v, max) => Math.max(1, Math.min(max, Math.round(Number(v) || 1)))
  return {
    r1: clampCell(r1, props.rows) - 1,
    r2: clampCell(r2, props.rows) - 1,
    c1: clampCell(c1, props.cols) - 1,
    c2: clampCell(c2, props.cols) - 1,
  }
})
// 权重矩阵：中心为 1，向四周按上下左右速率递减（等差数列）。
// 若最远处低于最低权重 → 整体改用 (1-最低权重)/最远距离 的梯度，使最远处恰好等于最低权重。
const result = computed(() => {
  const { r1, r2, c1, c2 } = centerRect.value
  const ru = _rate(rateUp.value), rd = _rate(rateDown.value)
  const rl = _rate(rateLeft.value), rr = _rate(rateRight.value)
  const dist = (r, c) => {
    const up = Math.max(0, r1 - r)
    const down = Math.max(0, r - r2)
    const left = Math.max(0, c1 - c)
    const right = Math.max(0, c - c2)
    return up * ru + down * rd + left * rl + right * rr
  }
  let maxDist = 0
  for (let r = 0; r < props.rows; r++) {
    for (let c = 0; c < props.cols; c++) maxDist = Math.max(maxDist, dist(r, c))
  }
  const min = _rate(minValue.value)
  const overflow = maxDist > (1 - min) + 1e-9
  const gradient = overflow ? (1 - min) / (maxDist || 1) : 1
  const matrix = []
  for (let r = 0; r < props.rows; r++) {
    const row = []
    for (let c = 0; c < props.cols; c++) {
      let w = 1 - dist(r, c) * gradient
      w = Math.max(min, Math.min(1, w))
      row.push(Math.round(w * 1000) / 1000)
    }
    matrix.push(row)
  }
  return { matrix, overflow }
})
const previewMatrix = computed(() => result.value.matrix)
const overflow = computed(() => result.value.overflow)
const flatPreview = computed(() => {
  const out = []
  for (const row of previewMatrix.value) {
    for (const w of row) out.push({ text: w.toFixed(2), ...heat(w) })
  }
  return out
})

watch(() => props.visible, (v) => { if (v) resetDefaults() })

// 把输入规整到 0–1（非数字按 0 处理）
function _rate(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}
// 打开时把中心默认放在网格正中
function resetDefaults() {
  const cr = Math.max(1, Math.ceil(props.rows / 2))
  const cc = Math.max(1, Math.ceil(props.cols / 2))
  pointRow.value = cr
  pointCol.value = cc
  rowStart.value = cr
  rowEnd.value = cr
  colStart.value = cc
  colEnd.value = cc
}
// 依权重深浅插值：浅（低）→ 深（高），并自动切换文字色保证可读
function heat(w) {
  const k = Math.max(0, Math.min(1, w))
  const from = [239, 246, 255], to = [30, 58, 138]
  const rgb = from.map((f, i) => Math.round(f + (to[i] - f) * k))
  const lin = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(rgb[0] / 255) + 0.7152 * lin(rgb[1] / 255) + 0.0722 * lin(rgb[2] / 255)
  return { bg: `rgb(${rgb.join(', ')})`, fg: L < 0.45 ? '#FFFFFF' : '#1E293B' }
}
function apply() {
  emit('apply', previewMatrix.value)
}
</script>
