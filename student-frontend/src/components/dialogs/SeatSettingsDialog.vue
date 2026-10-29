<template>
  <DialogShell :visible="visible" :z-index="50" overlay-class="bg-black/30">
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
      <div class="mb-4 flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-medium">显示走廊</span>
          <AppHelp text="单桌：每列间有走廊；同桌：每两列为一组，组间有走廊。" aria-label="显示走廊说明" />
        </div>
        <AppSwitch v-model="localShowAisle" aria-label="显示走廊" />
      </div>
      <div class="flex justify-end gap-2">
        <button @click="$emit('cancel')" class="bg-surface-hover px-4 py-2 rounded text-text">取消</button>
        <button @click="save" class="bg-info text-text-inverse px-4 py-2 rounded">保存</button>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useNotification } from '../../composables/useNotification.js'
import '../../styles/dialog-transition.css'
import AppHelp from '../base/AppHelp.vue'
import AppSwitch from '../base/AppSwitch.vue'
import DialogShell from '../base/DialogShell.vue'

defineOptions({ name: 'SeatSettingsDialog' })
const props = defineProps({
  visible: Boolean,
  rows: { type: Number, required: true },
  cols: { type: Number, required: true },
  mode: { type: String, default: 'single' },
  showAisle: { type: Boolean, default: true }
})
const emit = defineEmits(['save', 'cancel'])
const { error: notifyError } = useNotification()

const localRows = ref(props.rows)
const localCols = ref(props.cols)
const localMode = ref(props.mode)
const localShowAisle = ref(props.showAisle)

watch(() => props.visible, (val) => {
  if (val) {
    localRows.value = props.rows
    localCols.value = props.cols
    localMode.value = props.mode
    localShowAisle.value = props.showAisle
  }
})
// 同桌模式下列数必须为偶数（每两列为一组）；切到同桌时自动把奇数取整为偶数
watch(localMode, (val) => {
  if (val === 'double' && localCols.value % 2 !== 0) {
    localCols.value = Math.max(2, Math.min(30, localCols.value + 1))
  }
})

function save() {
  if (!Number.isInteger(localRows.value) || !Number.isInteger(localCols.value)) {
    notifyError('行数和列数必须是整数')
    return
  }
  if (localRows.value < 1 || localRows.value > 50) {
    notifyError('设置的行/列过大\n过大的行和列会引起显示问题和程序卡顿')
    return
  }
  if (localCols.value < 1 || localCols.value > 30) {
    notifyError('设置的行/列过大\n过大的行和列会引起显示问题和程序卡顿')
    return
  }
  if (localMode.value === 'double' && localCols.value % 2 !== 0) {
    notifyError('同桌模式下列数必须为偶数\n如需单桌，请自行留空该座位')
    return
  }
  emit('save', {
    rows: localRows.value,
    cols: localCols.value,
    mode: localMode.value,
    showAisle: localShowAisle.value
  })
}
</script>