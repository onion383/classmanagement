<template>
  <!-- 导出 Markdown 文件：只有「导出格式 + 文件名」两步（无选择步骤） -->
  <Teleport to="body">
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="cancel">
    <div class="bg-surface p-5 rounded-lg min-w-[400px] max-w-xl shadow-card border border-border dialog-card">
      <h3 class="text-lg font-bold mb-3">导出选项</h3>

      <div class="mb-4">
        <p class="font-semibold mb-2">导出格式：</p>
        <AppSelect v-model="exportFormat" class="w-full" :options="FORMAT_OPTIONS" />
      </div>

      <div class="mb-4">
        <label class="font-semibold block mb-1">文件名</label>
        <input v-model="filename" class="filename-input border border-border bg-surface text-text p-2 w-full !rounded-[12px]" />
      </div>

      <div class="text-right">
        <button @click="cancel" class="bg-surface-hover text-text border border-border px-4 py-1.5 rounded-lg mr-2 cursor-pointer">取消</button>
        <button @click="doExport" :disabled="exporting" class="bg-info text-text-inverse border-none px-4 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">{{ exporting ? '导出中…' : '导出' }}</button>
      </div>
    </div>
  </div>
  </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'
import AppSelect from '../base/AppSelect.vue'
import { useNotification } from '../../composables/useNotification'
import { runTableExport, FORMAT_OPTIONS, FORMAT_LABELS } from '../../composables/exportFormats.js'
import { saveBlobWithDialog } from '../../utils/saveFile.js'
import '../../styles/dialog-transition.css'

defineOptions({ name: 'ExportMarkdownDialog' })
const props = defineProps({
  visible: { type: Boolean, default: false },
  // 待导出的 Markdown 原文 + 默认文件名（不含扩展名）
  content: { type: String, default: '' },
  defaultFilename: { type: String, default: 'Markdown文件' },
})
const emit = defineEmits(['update:visible'])
const { success: notifySuccess, error: notifyError } = useNotification()

const exportFormat = ref('md')
const filename = ref('')
const exporting = ref(false)

watch(() => props.visible, (v) => {
  if (v) {
    exportFormat.value = 'md'
    filename.value = props.defaultFilename || 'Markdown文件'
    exporting.value = false
  }
}, { immediate: true })

function cancel() { emit('update:visible', false) }
async function doExport() {
  if (exporting.value) return
  const name = (filename.value || '').trim() || 'Markdown文件'
  exporting.value = true
  try {
    let saved = true
    // 纯文本格式：直接落原文（Markdown 文件本身即 md/txt 内容），不再包成表格
    if (exportFormat.value === 'md' || exportFormat.value === 'txt') {
      const blob = new Blob([props.content || ''], {
        type: exportFormat.value === 'md' ? 'text/markdown;charset=utf-8;' : 'text/plain;charset=utf-8;',
      })
      saved = await saveBlobWithDialog(`${name}.${exportFormat.value}`, blob)
    } else {
      // 其余格式：按「内容」单列逐行导出
      const rows = (props.content || '').split(/\r?\n/).map((line) => [line])
      saved = await runTableExport({ format: exportFormat.value, columns: ['内容'], rows, filename: name, title: name })
    }
    if (saved) notifySuccess(`已成功导出 ${FORMAT_LABELS[exportFormat.value] || '文件'}`)
  } catch (err) {
    console.error('导出失败:', err)
    notifyError('导出失败，请重试')
  } finally {
    exporting.value = false
    emit('update:visible', false)
  }
}
</script>

<style scoped>
.filename-input {
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.filename-input:focus {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.28) !important;
  outline: none;
  background-color: rgba(255, 255, 255, 0.98) !important;
}
</style>
