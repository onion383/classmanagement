<template>
  <DialogShell :visible="visible" :z-index="50" overlay-class="bg-black/30">
    <div class="bg-surface rounded-lg p-6 w-[36rem] max-w-[92vw] max-h-[88vh] shadow-card dialog-card flex flex-col overflow-hidden">
      <h3 class="text-lg font-bold mb-4 flex-shrink-0">值日项目权重算法</h3>

      <!-- 中心区域：一个位置 / 矩形区域，权重均为 1 -->
      <div class="border border-border rounded-lg p-4 mb-4 flex-shrink-0">
        <div class="flex items-center gap-4 mb-3">
          <span class="text-sm font-medium text-text w-24 flex-shrink-0">中心区域</span>
          <AppSelect v-model="centerType" :options="centerTypeOptions" class="w-40" />
        </div>

        <div v-if="centerType === 'point'" class="flex items-center gap-4 flex-wrap">
          <span class="text-sm text-text-muted w-24 flex-shrink-0">中心位置</span>
          <label class="text-sm text-text-secondary">项目
            <AppSelect v-model="pointItem" :options="itemOptions" class="w-32 ml-1" />
          </label>
          <label class="text-sm text-text-secondary">星期
            <AppSelect v-model="pointDay" :options="dayOptions" class="w-24 ml-1" />
          </label>
        </div>

        <div v-else class="flex items-center gap-4 flex-wrap">
          <span class="text-sm text-text-muted w-24 flex-shrink-0">项目范围</span>
          <label class="text-sm text-text-secondary">
            <AppSelect v-model="itemStart" :options="itemOptions" class="w-28" />
            <span class="mx-1">~</span>
            <AppSelect v-model="itemEnd" :options="itemOptions" class="w-28" />
          </label>
        </div>
        <div v-if="centerType === 'rect'" class="flex items-center gap-4 flex-wrap mt-2">
          <span class="text-sm text-text-muted w-24 flex-shrink-0">星期范围</span>
          <label class="text-sm text-text-secondary">
            <AppSelect v-model="dayStart" :options="dayOptions" class="w-24" />
            <span class="mx-1">~</span>
            <AppSelect v-model="dayEnd" :options="dayOptions" class="w-24" />
          </label>
        </div>
      </div>

      <!-- 递减速率（含最小值） -->
      <p class="text-sm font-medium text-text mb-1 flex-shrink-0">递减速率（每跨一格减少的权重，0–1 小数）</p>
      <p class="text-xs text-text-muted mb-3 flex-shrink-0">距离 = 上下项目步数相加 + 左右星期步数相加</p>
      <div class="mb-4 p-3 rounded-lg bg-surface/55 backdrop-blur-md flex-shrink-0">
        <div class="border border-border rounded-lg p-4">
          <div class="grid grid-cols-2 gap-3">
            <label class="flex items-center justify-center gap-2 text-sm text-text-secondary">上（轻项目方向）
              <input type="number" step="0.01" min="0" max="1" v-model.number="rateUp" class="w-24 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
            </label>
            <label class="flex items-center justify-center gap-2 text-sm text-text-secondary">左（靠前天）
              <input type="number" step="0.01" min="0" max="1" v-model.number="rateLeft" class="w-24 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
            </label>
            <label class="flex items-center justify-center gap-2 text-sm text-text-secondary">下（重项目方向）
              <input type="number" step="0.01" min="0" max="1" v-model.number="rateDown" class="w-24 border border-border bg-bg text-text px-2 py-1 rounded text-center" />
            </label>
            <label class="flex items-center justify-center gap-2 text-sm text-text-secondary">右（靠后天）
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

      <!-- 实时热力图预览 -->
      <p class="text-sm font-medium text-text mb-3 flex-shrink-0">权重预览</p>
      <div class="mb-4 p-3 rounded-lg bg-surface/55 backdrop-blur-md flex-1 min-h-0 flex flex-col">
        <div class="border border-border rounded-lg p-4 flex-1 min-h-0 flex flex-col">
          <div class="overflow-auto min-h-0 flex-1" style="max-height: 16rem;">
            <div class="w-max mx-auto">
              <!-- 表头：星期 -->
              <div class="grid gap-1 mb-1" :style="{ gridTemplateColumns: `70px repeat(${dayCount}, minmax(0, 1fr))` }">
                <div></div>
                <div v-for="d in days" :key="'h_'+d" class="text-xs text-text-muted text-center">{{ d }}</div>
              </div>
              <div v-for="(row, ri) in previewRows" :key="'r_'+ri" class="grid gap-1 mb-1 items-center" :style="{ gridTemplateColumns: `70px repeat(${dayCount}, minmax(0, 1fr))` }">
                <div class="text-xs text-text-muted truncate text-right pr-1">{{ row.label }}</div>
                <div
                  v-for="(cell, ci) in row.cells"
                  :key="'c_'+ci"
                  class="w-full h-8 flex items-center justify-center text-[11px] rounded border border-border"
                  :style="{ background: cell.bg, color: cell.fg }"
                >{{ cell.text }}</div>
              </div>
            </div>
          </div>
          <p class="text-xs text-text-muted mt-2 text-center flex-shrink-0">中心区域为 1，向四周按上下左右速率递减</p>
        </div>
      </div>

      <div class="flex justify-end gap-2 flex-shrink-0">
        <button @click="$emit('cancel')" class="bg-surface-hover px-4 py-2 rounded text-text border border-border">取消</button>
        <button @click="apply" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme">生成并应用</button>
      </div>
    </div>
  </DialogShell>
</template>

<script>
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'
import AppSelect from '../base/AppSelect.vue'

export default {
  name: 'DutyWeightAlgorithmDialog',
  components: { AppSelect, DialogShell },
  props: {
    visible: Boolean,
    days: { type: Array, default: () => [] },
    items: { type: Array, default: () => [] },
  },
  emits: ['cancel', 'apply'],
  data() {
    return {
      centerTypeOptions: [
        { value: 'point', label: '一个位置' },
        { value: 'rect', label: '矩形区域' },
      ],
      centerType: 'point',
      pointItem: '',
      pointDay: '',
      itemStart: '',
      itemEnd: '',
      dayStart: '',
      dayEnd: '',
      rateUp: 0.1,
      rateDown: 0.1,
      rateLeft: 0.1,
      rateRight: 0.1,
      minValue: 0,
    }
  },
  computed: {
    dayCount() { return this.days.length },
    itemCount() { return this.items.length },
    itemOptions() { return this.items.map(it => ({ value: it.name, label: it.name })) },
    dayOptions() { return this.days.map(d => ({ value: d, label: d })) },
    // 中心矩形（0-based 索引，已夹到边界）
    centerRect() {
      const items = this.items.map(it => it.name)
      const days = this.days
      const clamp = (v, arr) => Math.max(0, Math.min(arr.length - 1, arr.indexOf(v) < 0 ? 0 : arr.indexOf(v)))
      let r1, r2, c1, c2
      if (this.centerType === 'point') {
        r1 = r2 = clamp(this.pointItem, items)
        c1 = c2 = clamp(this.pointDay, days)
      } else {
        const s = clamp(this.itemStart, items), e = clamp(this.itemEnd, items)
        r1 = Math.min(s, e); r2 = Math.max(s, e)
        const ds = clamp(this.dayStart, days), de = clamp(this.dayEnd, days)
        c1 = Math.min(ds, de); c2 = Math.max(ds, de)
      }
      return { r1, r2, c1, c2 }
    },
    // 权重矩阵：{项目名: {星期: 数值}}
    result() {
      const { r1, r2, c1, c2 } = this.centerRect
      const ru = this._rate(this.rateUp), rd = this._rate(this.rateDown)
      const rl = this._rate(this.rateLeft), rr = this._rate(this.rateRight)
      const dist = (r, c) => {
        const up = Math.max(0, r1 - r)
        const down = Math.max(0, r - r2)
        const left = Math.max(0, c1 - c)
        const right = Math.max(0, c - c2)
        return up * ru + down * rd + left * rl + right * rr
      }
      let maxDist = 0
      for (let r = 0; r < this.itemCount; r++) {
        for (let c = 0; c < this.dayCount; c++) maxDist = Math.max(maxDist, dist(r, c))
      }
      const min = this._rate(this.minValue)
      const overflow = maxDist > (1 - min) + 1e-9
      const gradient = overflow ? (1 - min) / (maxDist || 1) : 1
      const matrix = {}
      this.items.forEach((it, r) => {
        matrix[it.name] = {}
        this.days.forEach((d, c) => {
          let w = 1 - dist(r, c) * gradient
          w = Math.max(min, Math.min(1, w))
          matrix[it.name][d] = Math.round(w * 1000) / 1000
        })
      })
      return { matrix, overflow }
    },
    overflow() { return this.result.overflow },
    // 预览行：[{label, cells:[{text, bg, fg}]}]
    previewRows() {
      const m = this.result.matrix
      return this.items.map(it => ({
        label: it.name,
        cells: this.days.map(d => {
          const w = m[it.name]?.[d] ?? 0
          return { text: w.toFixed(2), ...this.heat(w) }
        })
      }))
    },
  },
  watch: {
    visible(v) { if (v) this.resetDefaults() },
  },
  methods: {
    _rate(v) {
      const n = Number(v)
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
    },
    // 打开时默认中心落在正中
    resetDefaults() {
      const items = this.items, days = this.days
      const ci = Math.max(0, Math.floor(items.length / 2))
      const cd = Math.max(0, Math.floor(days.length / 2))
      const midItem = items[ci]?.name || ''
      const midDay = days[cd] || ''
      this.pointItem = midItem
      this.pointDay = midDay
      this.itemStart = midItem
      this.itemEnd = midItem
      this.dayStart = midDay
      this.dayEnd = midDay
    },
    heat(w) {
      const k = Math.max(0, Math.min(1, w))
      const from = [239, 246, 255], to = [30, 58, 138]
      const rgb = from.map((f, i) => Math.round(f + (to[i] - f) * k))
      const lin = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
      const L = 0.2126 * lin(rgb[0] / 255) + 0.7152 * lin(rgb[1] / 255) + 0.0722 * lin(rgb[2] / 255)
      return { bg: `rgb(${rgb.join(', ')})`, fg: L < 0.45 ? '#FFFFFF' : '#1E293B' }
    },
    apply() {
      this.$emit('apply', this.result.matrix)
    },
  },
}
</script>
