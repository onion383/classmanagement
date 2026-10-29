<template>
  <!-- 数据管理弹窗：由 AI 助手标题栏的「数据管理」按钮启动（不是独立页面） -->
  <Teleport to="body">
  <Transition name="dialog" appear>
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="close">
    <div class="bg-surface rounded-lg border border-border shadow-card dialog-card dm-card flex flex-col p-5">
      <div class="flex items-center justify-between mb-4 flex-shrink-0">
        <h3 class="text-lg font-bold">数据管理</h3>
        <button class="dlg-close" title="关闭" @click="close">✕</button>
      </div>

      <!-- 弹窗主体：内容超出时整体滚动；每个列表自身超过 30vh 也会出现滚动条 -->
      <div class="dm-body flex-1 min-h-0 overflow-y-auto">
        <!-- 区块一：聊天记录管理 -->
        <section class="mb-6">
          <h2 class="text-base font-bold mb-2.5">聊天记录管理</h2>
          <div v-if="loadingConv" class="text-sm text-text-muted py-5 text-center">正在加载…</div>
          <div v-else-if="!conversations.length" class="text-sm text-text-muted py-5 text-center">暂无聊天记录</div>
          <div v-else class="list-box border border-border rounded-lg overflow-y-auto">
            <div
              v-for="c in conversations" :key="c.id"
              class="flex items-center justify-between gap-3 px-3 py-2 border-b border-border last:border-b-0 hover:bg-surface-hover transition-theme"
            >
              <div class="min-w-0">
                <div class="text-sm text-text truncate">{{ c.title || '未命名对话' }}</div>
                <div class="text-xs text-text-muted">{{ c.msg_count }} 条 · {{ formatTime(c.updated_at) }}</div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button class="row-btn" @click="openChatExport(c)">导出</button>
                <button class="row-btn" @click="askDeleteConversation(c)">删除</button>
              </div>
            </div>
          </div>
        </section>

        <!-- 区块二：Markdown 文件管理 -->
        <section>
          <div class="flex items-center justify-between mb-2.5">
            <h2 class="text-base font-bold">Markdown 文件管理</h2>
            <button class="row-btn primary" @click="openNewSkill">新增文件</button>
          </div>
          <!-- 技能文件目录：展示当前配置路径并提供打开文件夹（与系统设置一致） -->
          <div class="flex items-center justify-between gap-3 mb-2.5">
            <div class="text-xs text-text-muted truncate min-w-0" :title="skillsDir">技能目录：{{ skillsDir || '加载中…' }}</div>
            <button class="row-btn shrink-0" :disabled="!skillsDir" @click="openSkillsDir">打开文件夹</button>
          </div>
          <div v-if="loadingSkill" class="text-sm text-text-muted py-5 text-center">正在加载…</div>
          <div v-else class="list-box border border-border rounded-lg overflow-y-auto">
            <!-- AI 记忆文件：名称固定，删除按钮置灰不可点 -->
            <div class="flex items-center justify-between gap-3 px-3 py-2 border-b border-border hover:bg-surface-hover transition-theme">
              <div class="min-w-0">
                <div class="text-sm text-text truncate">AI 记忆文件</div>
                <div class="flex items-center gap-1.5">
                  <span class="text-xs text-text-muted">系统长期记忆</span>
                  <AppHelp text="随对话自动注入" aria-label="AI 记忆文件说明" :size="12" :z-index="10002" />
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button class="row-btn" disabled title="AI 记忆文件不可删除">删除</button>
                <button class="row-btn" @click="openEditMemory">编辑</button>
                <button class="row-btn" @click="openExportMemory">导出</button>
              </div>
            </div>
            <!-- 技能文件 -->
            <div
              v-for="s in skills" :key="s.name"
              class="flex items-center justify-between gap-3 px-3 py-2 border-b border-border last:border-b-0 hover:bg-surface-hover transition-theme"
            >
              <div class="min-w-0">
                <div class="text-sm text-text truncate">{{ s.name }}</div>
                <div class="text-xs text-text-muted">{{ sizeText(s.size) }} · {{ formatTime(s.updatedAt) }}</div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button class="row-btn" @click="askDeleteSkill(s)">删除</button>
                <button class="row-btn" @click="openEditSkill(s)">编辑</button>
                <button class="row-btn" @click="openExportSkill(s)">导出</button>
              </div>
            </div>
            <div v-if="!skills.length" class="text-sm text-text-muted py-5 text-center">暂无技能文件，点击「新增文件」创建</div>
          </div>
        </section>
      </div>
    </div>

    <!-- 通用确认弹窗 -->
    <ConfirmDialog
      :visible="confirm.visible"
      :title="confirm.title"
      :message="confirm.message"
      show-cancel
      confirm-text="确定"
      @confirm="runConfirm"
      @cancel="confirm.visible = false"
    />

    <!-- Markdown 编辑窗口 -->
    <MarkdownEditDialog
      v-model:visible="mdDlg.visible"
      :is-new="mdDlg.isNew"
      :name-disabled="mdDlg.nameDisabled"
      :original-name="mdDlg.originalName"
      :initial-name="mdDlg.initialName"
      :initial-content="mdDlg.initialContent"
      @save="onMdSave"
    />

    <!-- 聊天记录导出弹窗 -->
    <ExportChatDialog
      v-model:visible="chatDlg.visible"
      :conversation-id="chatDlg.id"
      :conversation-name="chatDlg.name"
    />

    <!-- Markdown 文件导出弹窗（仅格式 + 文件名） -->
    <ExportMarkdownDialog
      v-model:visible="mdExportDlg.visible"
      :content="mdExportDlg.content"
      :default-filename="mdExportDlg.filename"
    />
  </div>
  </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'
import axios from 'axios'
import AppHelp from '../base/AppHelp.vue'
import ConfirmDialog from '../base/ConfirmDialog.vue'
import MarkdownEditDialog from './MarkdownEditDialog.vue'
import ExportChatDialog from './ExportChatDialog.vue'
import ExportMarkdownDialog from './ExportMarkdownDialog.vue'
import { useNotification } from '../../composables/useNotification'
import { formatTime } from '../../composables/ai/aiMessages.js'
import '../../styles/dialog-transition.css'
import { INVOKE } from '../../electronChannels.js'

defineOptions({ name: 'DataManageDialog' })
const props = defineProps({
  visible: { type: Boolean, default: false },
})
const emit = defineEmits(['update:visible'])
const { success: notifySuccess, error: notifyError } = useNotification()

const conversations = ref([])
const skills = ref([])
const memoryContent = ref('')
// 技能 md 文件所在目录（来自主进程配置，供展示与打开）
const skillsDir = ref('')
const loadingConv = ref(false)
const loadingSkill = ref(false)
// 通用确认弹窗（删除等破坏性操作）
const confirm = ref({ visible: false, title: '', message: '', action: null })
// Markdown 编辑窗口
const mdDlg = ref({ visible: false, isNew: false, nameDisabled: false, originalName: '', initialName: '', initialContent: '', target: 'skill' })
// 聊天记录导出弹窗
const chatDlg = ref({ visible: false, id: null, name: '' })
// Markdown 导出弹窗
const mdExportDlg = ref({ visible: false, content: '', filename: '' })

// 每次打开弹窗都重新拉一遍数据，保证与「数据管理」页维护的内容一致
watch(() => props.visible, (v) => { if (v) loadAll() }, { immediate: true })

function close() { emit('update:visible', false) }
function sizeText(size) {
  const n = Number(size) || 0
  return n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'
}
function errMsg(err) { return (err && err.response && err.response.data && err.response.data.error) || (err && err.message) || '操作失败' }

// ---------- 数据加载 ----------
function loadAll() {
  loadConversations()
  loadSkills()
  loadMemory()
  loadSkillsDir()
}
// 技能 md 文件目录：取主进程配置（与系统设置「技能文件目录」一致）
async function loadSkillsDir() {
  try {
    const res = await window.electron?.invoke(INVOKE.GET_DATA_DIRECTORIES)
    skillsDir.value = (res && res.skillsDir) || ''
  } catch (_) { skillsDir.value = '' }
}
// 在资源管理器中打开技能文件目录
async function openSkillsDir() {
  if (!skillsDir.value) return
  try { await window.electron?.invoke(INVOKE.OPEN_FOLDER, skillsDir.value) } catch (_) { /* 忽略 */ }
}
async function loadConversations() {
  loadingConv.value = true
  try {
    const { data } = await axios.get('/api/ai/conversations')
    conversations.value = data.data || []
  } catch (_) { conversations.value = [] }
  finally { loadingConv.value = false }
}
async function loadSkills() {
  loadingSkill.value = true
  try {
    const { data } = await axios.get('/api/ai/skills')
    skills.value = data.data || []
  } catch (_) { skills.value = [] }
  finally { loadingSkill.value = false }
}
async function loadMemory() {
  try {
    const { data } = await axios.get('/api/ai/memory')
    memoryContent.value = (data.data && data.data.content) || ''
  } catch (_) { memoryContent.value = '' }
}

// ---------- 确认弹窗 ----------
function confirmAsk(title, message, action) {
  confirm.value = { visible: true, title, message, action }
}
async function runConfirm() {
  const action = confirm.value.action
  confirm.value.visible = false
  confirm.value.action = null
  if (action) await action()
}

// ---------- 聊天记录 ----------
function askDeleteConversation(c) {
  confirmAsk('删除聊天记录', `确定删除「${c.title || '未命名对话'}」吗？删除后不可恢复。`, async () => {
    try {
      await axios.delete(`/api/ai/conversations/${c.id}`)
      await loadConversations()
      notifySuccess('已删除聊天记录')
    } catch (err) { notifyError(errMsg(err)) }
  })
}
function openChatExport(c) {
  chatDlg.value = { visible: true, id: c.id, name: c.title || '聊天记录' }
}

// ---------- Markdown 文件 ----------
function openNewSkill() {
  mdDlg.value = { visible: true, isNew: true, nameDisabled: false, originalName: '', initialName: '', initialContent: '', target: 'skill' }
}
function openEditMemory() {
  mdDlg.value = { visible: true, isNew: false, nameDisabled: true, originalName: '', initialName: 'AI 记忆文件', initialContent: memoryContent.value, target: 'memory' }
}
async function openEditSkill(s) {
  try {
    const { data } = await axios.get(`/api/ai/skills/${encodeURIComponent(s.name)}`)
    mdDlg.value = { visible: true, isNew: false, nameDisabled: false, originalName: s.name, initialName: s.name, initialContent: (data.data && data.data.content) || '', target: 'skill' }
  } catch (err) { notifyError(errMsg(err)) }
}
async function onMdSave(payload) {
  const dlg = mdDlg.value
  try {
    if (dlg.target === 'memory') {
      await axios.put('/api/ai/memory', { content: payload.content })
      await loadMemory()
      notifySuccess('已保存记忆文件')
    } else if (dlg.isNew) {
      await axios.post('/api/ai/skills', { name: payload.name, content: payload.content })
      await loadSkills()
      notifySuccess('已新增文件')
    } else {
      await axios.put(`/api/ai/skills/${encodeURIComponent(payload.original)}`, { name: payload.name, content: payload.content })
      await loadSkills()
      notifySuccess('已保存文件')
    }
    mdDlg.value.visible = false
  } catch (err) { notifyError(errMsg(err)) }
}
function askDeleteSkill(s) {
  confirmAsk('删除技能文件', `确定删除「${s.name}」吗？删除后不可恢复。`, async () => {
    try {
      await axios.delete(`/api/ai/skills/${encodeURIComponent(s.name)}`)
      await loadSkills()
      notifySuccess('已删除技能文件')
    } catch (err) { notifyError(errMsg(err)) }
  })
}
function openExportMemory() {
  mdExportDlg.value = { visible: true, content: memoryContent.value, filename: 'AI 记忆文件' }
}
async function openExportSkill(s) {
  try {
    const { data } = await axios.get(`/api/ai/skills/${encodeURIComponent(s.name)}`)
    mdExportDlg.value = { visible: true, content: (data.data && data.data.content) || '', filename: s.name }
  } catch (err) { notifyError(errMsg(err)) }
}
</script>

<style scoped>
/* 弹窗尺寸：内容较大，给一个偏大的窗口；超出高度时弹窗主体内部滚动 */
.dm-card {
  width: 760px;
  max-width: 92vw;
  max-height: 88vh;
}
.dm-body {
  padding-right: 2px;
}
/* 列表滚动区：条目多时超过 30vh 出现滚动条（不撑高整个弹窗） */
.list-box {
  max-height: 30vh;
}
/* 行内操作按钮：与主题一致的小号毛玻璃按钮 */
.row-btn {
  font-size: 13px;
  line-height: 1;
  padding: 6px 12px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.row-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-text) 12%, transparent);
}
.row-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.row-btn.primary {
  background: var(--color-primary);
  border-color: transparent;
  color: var(--color-text-inverse);
}
.row-btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover, var(--color-primary));
}
</style>
