<template>
  <!-- 导出聊天记录：选择消息（可展开/勾选/按角色筛选）→ 导出范围 → 格式 + 文件名（外观沿用导出表格弹窗） -->
  <Teleport to="body">
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="cancel">
    <div class="bg-surface p-5 rounded-lg shadow-card border border-border dialog-card chat-card flex flex-col">
      <h3 class="text-lg font-bold mb-3">导出聊天记录</h3>

      <div class="mb-4 flex flex-col min-h-0">
        <div class="flex items-center justify-between mb-2">
          <p class="font-semibold">选择聊天记录：</p>
          <div class="flex items-center gap-1">
            <button
              v-for="f in FILTERS" :key="f.value"
              @click="filter = f.value"
              class="text-xs px-2.5 py-1 rounded-md border transition-theme cursor-pointer"
              :class="filter === f.value ? 'border-primary text-primary' : 'border-border text-text-muted hover:text-text'"
            >{{ f.label }}</button>
          </div>
        </div>

        <div v-if="loading" class="text-sm text-text-muted py-6 text-center">正在加载聊天记录…</div>
        <div v-else-if="!visibleMsgs.length" class="text-sm text-text-muted py-6 text-center">没有可导出的聊天记录</div>
        <div v-else class="msg-list border border-border rounded-lg overflow-y-auto">
          <div
            v-for="m in visibleMsgs" :key="m.id"
            class="msg-row flex items-start gap-2 px-2.5 py-2 border-b border-border last:border-b-0"
          >
            <input type="checkbox" class="mt-1 shrink-0" :checked="isSelected(m.id)" @change="toggle(m.id)" />
            <span
              class="shrink-0 text-[11px] leading-5 px-1.5 rounded mt-0.5"
              :class="m.role === 'user' ? 'role-user' : 'role-ai'"
            >{{ m.role === 'user' ? '用户' : 'AI回复' }}</span>
            <div class="flex-1 min-w-0">
              <div v-if="!isExpanded(m.id)" class="text-sm text-text truncate">{{ m.content || '（无内容）' }}</div>
              <div v-else class="text-sm text-text whitespace-pre-wrap break-words">{{ m.content || '（无内容）' }}</div>
            </div>
            <button
              v-if="isLong(m)"
              @click="toggleExpand(m.id)"
              class="shrink-0 text-xs text-primary hover:underline cursor-pointer mt-0.5"
            >{{ isExpanded(m.id) ? '收起' : '展开' }}</button>
          </div>
        </div>
        <div v-if="!loading && visibleMsgs.length" class="flex items-center justify-between mt-1.5 text-xs text-text-muted">
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" :checked="allSelected" @change="toggleAll" /> 全选（当前筛选）
          </label>
          <span>已选 {{ selectedIds.length }} / {{ msgs.length }} 条</span>
        </div>
      </div>

      <div class="mb-4">
        <p class="font-semibold mb-2">导出范围：</p>
        <AppSelect v-model="range" class="w-full" :options="RANGES" />
      </div>

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
        <button @click="doExport" :disabled="exporting || !selectedIds.length" class="bg-info text-text-inverse border-none px-4 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{{ exporting ? '导出中…' : '导出' }}</button>
      </div>
    </div>
  </div>
  </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import AppSelect from '../base/AppSelect.vue'
import { useNotification } from '../../composables/useNotification'
import { parseMessages } from '../../composables/ai/aiMessages.js'
import { runTableExport, FORMAT_OPTIONS, FORMAT_LABELS } from '../../composables/exportFormats.js'
import '../../styles/dialog-transition.css'

// 单条消息正文超过该长度即提供「展开」按钮（预览只显示一行，展开看全文）
const PREVIEW_MAX = 60

defineOptions({ name: 'ExportChatDialog' })
const props = defineProps({
  visible: { type: Boolean, default: false },
  conversationId: { type: [Number, String], default: null },
  conversationName: { type: String, default: '' },
})
const emit = defineEmits(['update:visible'])
const { success: notifySuccess, error: notifyError, info: notifyInfo } = useNotification()

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'user', label: '仅用户' },
  { value: 'ai', label: '仅AI回复' },
]
const RANGES = [
  { value: 'content', label: '仅最后输出内容' },
  { value: 'reasoning', label: '仅思维链' },
  { value: 'all', label: '全部' },
]

const loading = ref(false)
const msgs = ref([])
const selectedIds = ref([])
const expandedIds = ref([])
const filter = ref('all')
const range = ref('content')
const exportFormat = ref('md')
const filename = ref('')
const exporting = ref(false)

const visibleMsgs = computed(() => {
  if (filter.value === 'user') return msgs.value.filter((m) => m.role === 'user')
  if (filter.value === 'ai') return msgs.value.filter((m) => m.role === 'assistant')
  return msgs.value
})
const allSelected = computed(() => {
  const vis = visibleMsgs.value
  return !!vis.length && vis.every((m) => selectedIds.value.includes(m.id))
})

watch(() => props.visible, (v) => { if (v) onOpen() }, { immediate: true })

function isSelected(id) { return selectedIds.value.includes(id) }
function isExpanded(id) { return expandedIds.value.includes(id) }
function isLong(m) { return (m.content || '').length > PREVIEW_MAX || /[\r\n]/.test(m.content || '') }
function toggle(id) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else selectedIds.value.push(id)
}
function toggleExpand(id) {
  const i = expandedIds.value.indexOf(id)
  if (i >= 0) expandedIds.value.splice(i, 1)
  else expandedIds.value.push(id)
}
function toggleAll() {
  const vis = visibleMsgs.value
  if (allSelected.value) {
    selectedIds.value = selectedIds.value.filter((id) => !vis.some((m) => m.id === id))
  } else {
    for (const m of vis) { if (!selectedIds.value.includes(m.id)) selectedIds.value.push(m.id) }
  }
}
// 消息里承载的思维链：优先取 process.reasoning，其次从「思考」步骤拼接
function reasoningOf(m) {
  if (m.reasoning && String(m.reasoning).trim()) return String(m.reasoning).trim()
  const steps = Array.isArray(m.steps) ? m.steps : []
  return steps.filter((s) => s.kind === 'reason' && s.text).map((s) => s.text).join('\n\n').trim()
}
function onOpen() {
  filter.value = 'all'
  range.value = 'content'
  exportFormat.value = 'md'
  filename.value = props.conversationName || '聊天记录'
  expandedIds.value = []
  selectedIds.value = []
  exporting.value = false
  loadMessages()
}
async function loadMessages() {
  msgs.value = []
  if (props.conversationId == null) return
  loading.value = true
  try {
    const { data } = await axios.get(`/api/ai/conversations/${props.conversationId}/messages`)
    let seq = 0
    msgs.value = parseMessages(data.data)
      .map((m) => ({
        id: m._id != null ? m._id : `x${seq++}`,
        role: m.role,
        content: (m.content || '').trim(),
        reasoning: reasoningOf(m),
      }))
      .filter((m) => m.content || m.reasoning)
    selectedIds.value = msgs.value.map((m) => m.id)
  } catch (_) { msgs.value = [] }
  finally { loading.value = false }
}
// 依据导出范围拼出二维数据（列 + 行）
function buildTable() {
  const sel = msgs.value.filter((m) => selectedIds.value.includes(m.id))
  const role = (m) => (m.role === 'user' ? '用户' : 'AI回复')
  if (range.value === 'reasoning') return { columns: ['角色', '思维链'], rows: sel.map((m) => [role(m), m.reasoning]) }
  if (range.value === 'all') return { columns: ['角色', '内容', '思维链'], rows: sel.map((m) => [role(m), m.content, m.reasoning]) }
  return { columns: ['角色', '内容'], rows: sel.map((m) => [role(m), m.content]) }
}
function cancel() { emit('update:visible', false) }
async function doExport() {
  if (exporting.value) return
  const sel = msgs.value.filter((m) => selectedIds.value.includes(m.id))
  if (!sel.length) { notifyInfo('请至少选择一条聊天记录'); return }
  if (range.value === 'reasoning' && !sel.some((m) => m.reasoning)) {
    notifyInfo('所选聊天记录中没有思维链内容'); return
  }
  const name = (filename.value || '').trim() || '聊天记录'
  exporting.value = true
  try {
    const { columns, rows } = buildTable()
    const saved = await runTableExport({ format: exportFormat.value, columns, rows, filename: name, title: name })
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
.chat-card {
  width: 640px;
  max-width: 92vw;
}
.msg-list {
  max-height: 40vh;
}
.msg-row:hover {
  background: var(--color-surface-hover, rgba(0, 0, 0, 0.04));
}
.role-user {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
  color: var(--color-primary);
}
.role-ai {
  background: color-mix(in srgb, var(--color-success, #10b981) 18%, transparent);
  color: var(--color-success, #10b981);
}
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
