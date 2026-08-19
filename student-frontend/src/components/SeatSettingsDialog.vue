<template>
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
    <div class="bg-surface rounded-lg p-6 w-80 shadow-card dialog-card">
      <h3 class="text-lg font-bold mb-4">座位设置</h3>
      <div class="mb-3">
        <label class="block text-sm font-medium">行数</label>
        <input v-model.number="localRows" type="number" min="1" max="50" class="w-full border px-3 py-2 rounded" />
      </div>
      <div class="mb-3">
        <label class="block text-sm font-medium">列数</label>
        <input v-model.number="localCols" type="number" min="1" max="30" class="w-full border px-3 py-2 rounded" />
      </div>
      <div class="mb-3">
        <label class="block text-sm font-medium mb-1">座位模式</label>
        <div class="flex gap-4">
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="radio" v-model="localMode" value="single" /> 单桌
          </label>
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="radio" v-model="localMode" value="double" /> 同桌
          </label>
        </div>
      </div>
      <div class="mb-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="localShowAisle" /> 显示走廊
        </label>
        <p class="text-xs text-text-muted mt-1">
          单桌：每列间有走廊；同桌：每两列为一组，组间有走廊。
        </p>
      </div>
      <div class="flex justify-end gap-2">
        <button @click="$emit('cancel')" class="bg-surface-hover px-4 py-2 rounded text-text">取消</button>
        <button @click="save" class="bg-info text-text-inverse px-4 py-2 rounded">保存</button>
      </div>
    </div>
  </div>
  </Transition>
</template>

<script>
import { useNotification } from '../composables/useNotification.js'
import '../styles/dialog-transition.css'

export default {
  name: 'SeatSettingsDialog',
  props: {
    visible: Boolean,
    rows: { type: Number, required: true },
    cols: { type: Number, required: true },
    mode: { type: String, default: 'single' },
    showAisle: { type: Boolean, default: true }
  },
  emits: ['save', 'cancel'],
  setup() {
    const { error: notifyError } = useNotification()
    return { notifyError }
  },
  data() {
    return {
      localRows: this.rows,
      localCols: this.cols,
      localMode: this.mode,
      localShowAisle: this.showAisle
    }
  },
  watch: {
    visible(val) {
      if (val) {
        this.localRows = this.rows
        this.localCols = this.cols
        this.localMode = this.mode
        this.localShowAisle = this.showAisle
      }
    },
    // 同桌模式下列数必须为偶数（每两列为一组）；切到同桌时自动把奇数取整为偶数
    localMode(val) {
      if (val === 'double' && this.localCols % 2 !== 0) {
        this.localCols = Math.max(2, Math.min(30, this.localCols + 1))
      }
    }
  },
  methods: {
    save() {
      if (this.localRows < 1 || this.localRows > 50) {
        this.notifyError('设置的行/列过大\n过大的行和列会引起显示问题和程序卡顿')
        return
      }
      if (this.localCols < 1 || this.localCols > 30) {
        this.notifyError('设置的行/列过大\n过大的行和列会引起显示问题和程序卡顿')
        return
      }
      if (this.localMode === 'double' && this.localCols % 2 !== 0) {
        this.notifyError('同桌模式下列数必须为偶数\n如需单桌，请自行留空该座位')
        return
      }
      this.$emit('save', {
        rows: this.localRows,
        cols: this.localCols,
        mode: this.localMode,
        showAisle: this.localShowAisle
      })
    }
  }
}
</script>