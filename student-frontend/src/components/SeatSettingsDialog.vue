<template>
  <div v-if="visible" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
    <div class="bg-surface rounded-lg p-6 w-80 shadow-card">
      <h3 class="text-lg font-bold mb-4">座位设置</h3>
      <div class="mb-3">
        <label class="block text-sm font-medium">行数</label>
        <input v-model.number="localRows" type="number" min="1" class="w-full border px-3 py-2 rounded" />
      </div>
      <div class="mb-3">
        <label class="block text-sm font-medium">列数（实际座位列数）</label>
        <input v-model.number="localCols" type="number" min="1" class="w-full border px-3 py-2 rounded" />
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
</template>

<script>
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
        // 每次打开时用父组件最新值初始化
        this.localRows = this.rows
        this.localCols = this.cols
        this.localMode = this.mode
        this.localShowAisle = this.showAisle
      }
    }
  },
  methods: {
    save() {
      if (this.localRows <= 0 || this.localCols <= 0) return
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