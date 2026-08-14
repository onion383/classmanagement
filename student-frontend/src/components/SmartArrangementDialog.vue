<template>
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
    <div class="bg-surface rounded-lg p-5 shadow-card dialog-card flex flex-col" style="width: 720px; max-height: 85vh;">
      <h3 class="text-lg font-bold mb-4">🧠 智能排表</h3>

      <!-- 排表方式 -->
      <div class="mb-4 flex items-center gap-3">
        <label class="text-sm font-medium whitespace-nowrap">排表方式</label>
        <select v-model="method" class="border px-3 py-2 rounded bg-surface">
          <option value="random">随机排表</option>
        </select>
        <button @click="generatePreview" class="bg-primary text-text-inverse px-3 py-2 rounded border-none cursor-pointer">🔀 换一换</button>
      </div>

      <!-- 表格预览 -->
      <div class="flex-1 overflow-auto border border-border rounded mb-4" style="min-height: 200px;">
        <GridView
          :key="previewKey"
          :colHeaders="previewColHeaders"
          :rows="previewRows"
          :hideMetaColumns="true"
          :showRowNumber="true"
          :minTableHeight="200"
          :enableCandidate="false"
        />
      </div>

      <div class="flex justify-end gap-2">
        <button @click="cancel" class="bg-surface-hover px-4 py-2 rounded text-text border border-border">取消</button>
        <button @click="confirm" class="bg-info text-text-inverse px-4 py-2 rounded border-none">确定</button>
      </div>
    </div>
  </div>
  </Transition>
</template>

<script>
import GridView from './GridView.vue';
import '../styles/dialog-transition.css'

// Fisher-Yates 洗牌
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default {
  name: 'SmartArrangementDialog',
  components: { GridView },
  props: {
    visible: Boolean,
    rows: { type: Number, default: 6 },
    cols: { type: Number, default: 7 },
    mode: { type: String, default: 'single' },
    showAisle: { type: Boolean, default: true },
    students: { type: Array, default: () => [] }
  },
  emits: ['cancel', 'confirm'],
  data() {
    return {
      method: 'random',
      previewSeats: [],
      previewVersion: 0
    }
  },
  computed: {
    previewKey() {
      return this.visible ? `arrange-${this.rows}-${this.cols}-${this.method}-${this.previewVersion}` : 'closed'
    },
    previewColHeaders() {
      return this.generateColHeaders(this.cols, this.mode, this.showAisle)
    },
    previewRows() {
      return this.buildPreviewRows(this.previewSeats)
    }
  },
  watch: {
    visible(v) {
      if (v) this.generatePreview()
    }
  },
  methods: {
    // ==================== 网格工具（与座位网格保持一致的显示算法） ====================
    generateColHeaders(cols, mode, showAisle) {
      const headers = []
      if (!showAisle) { for (let i = 0; i < cols; i++) headers.push(`列${i + 1}`); return headers }
      if (mode === 'single') {
        for (let i = 0; i < cols; i++) { headers.push(`列${i + 1}`); if (i < cols - 1) headers.push('走廊') }
      } else {
        for (let i = 0; i < cols; i++) { headers.push(`列${i + 1}`); if ((i + 1) % 2 === 0 && i < cols - 1) headers.push('走廊') }
      }
      return headers
    },
    getDisplayColCount(cols, mode, showAisle) {
      if (!showAisle) return cols
      if (mode === 'single') return cols + (cols - 1)
      else return cols + Math.floor((cols - 1) / 2)
    },
    isAisleCol(displayIdx, cols, mode, showAisle) {
      if (!showAisle) return false
      const totalDisplay = this.getDisplayColCount(cols, mode, showAisle)
      if (mode === 'single') return displayIdx % 2 === 1
      else return displayIdx >= 2 && (displayIdx - 2) % 3 === 0 && displayIdx < totalDisplay
    },

    // 生成随机排表结果
    generatePreview() {
      const shuffled = shuffle(this.students)
      const newSeats = []
      let idx = 0
      for (let r = 0; r < this.rows; r++) {
        const row = []
        for (let c = 0; c < this.cols; c++) {
          row.push(idx < shuffled.length ? shuffled[idx] : null)
          idx++
        }
        newSeats.push(row)
      }
      this.previewSeats = newSeats
      this.previewVersion++
    },

    // 构建 GridView 预览用的显示行
    buildPreviewRows(seats) {
      const displayCols = this.getDisplayColCount(this.cols, this.mode, this.showAisle)
      const result = []
      result.push({ _rowKey: 'podium', label: '讲  台', _isPodium: true, _isReadonly: true, cells: [] })
      for (let r = 0; r < this.rows; r++) {
        const rowCells = []
        let realCol = 0
        for (let d = 0; d < displayCols; d++) {
          if (this.isAisleCol(d, this.cols, this.mode, this.showAisle)) {
            if (r === 0) rowCells.push({ course: '走廊', _isAisle: true, _aisleRowSpan: this.rows, _isAisleHidden: false })
            else rowCells.push({ course: '', _isAisle: false, _isAisleHidden: true })
          } else {
            const student = seats[r]?.[realCol]
            rowCells.push({ course: student?.姓名 || '', _isAisle: false, _isAisleHidden: false, _studentId: student?.id ?? null })
            realCol++
          }
        }
        result.push({ _rowKey: `row_${r}`, label: `第${r + 1}行`, cells: rowCells, _isReadonly: true, _lessonIdx: r, _periodRowSpan: 0, periodLabel: '' })
      }
      return result
    },

    cancel() { this.$emit('cancel') },
    confirm() {
      // 输出为座位表数据：二维数组，元素为学生 id 或 null
      const seatsOut = this.previewSeats.map(row => row.map(s => (s ? s.id : null)))
      this.$emit('confirm', { seats: seatsOut })
    }
  }
}
</script>