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
                <div class="text-xs text-text-muted">系统长期记忆，随对话自动注入</div>
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

<script>
import axios from 'axios'
import ConfirmDialog from '../base/ConfirmDialog.vue'
import MarkdownEditDialog from './MarkdownEditDialog.vue'
import ExportChatDialog from './ExportChatDialog.vue'
import ExportMarkdownDialog from './ExportMarkdownDialog.vue'
import { useNotification } from '../../composables/useNotification'
import { formatTime } from '../../composables/ai/aiMessages.js'
import '../../styles/dialog-transition.css'

export default {
  name: 'DataManageDialog',
  components: { ConfirmDialog, MarkdownEditDialog, ExportChatDialog, ExportMarkdownDialog },
  props: {
    visible: { type: Boolean, default: false },
  },
  emits: ['update:visible'],
  setup() {
    const { success, error } = useNotification()
    return { notifySuccess: success, notifyError: error }
  },
  data() {
    return {
      conversations: [],
      skills: [],
      memoryContent: '',
      // 技能 md 文件所在目录（来自主进程配置，供展示与打开）
      skillsDir: '',
      loadingConv: false,
      loadingSkill: false,
      // 通用确认弹窗（删除等破坏性操作）
      confirm: { visible: false, title: '', message: '', action: null },
      // Markdown 编辑窗口
      mdDlg: { visible: false, isNew: false, nameDisabled: false, originalName: '', initialName: '', initialContent: '', target: 'skill' },
      // 聊天记录导出弹窗
      chatDlg: { visible: false, id: null, name: '' },
      // Markdown 导出弹窗
      mdExportDlg: { visible: false, content: '', filename: '' },
    }
  },
  watch: {
    // 每次打开弹窗都重新拉一遍数据，保证与「数据管理」页维护的内容一致
    visible: {
      immediate: true,
      handler(v) { if (v) this.loadAll() },
    },
  },
  methods: {
    formatTime,
    close() { this.$emit('update:visible', false) },
    sizeText(size) {
      const n = Number(size) || 0
      return n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'
    },
    errMsg(err) { return (err && err.response && err.response.data && err.response.data.error) || (err && err.message) || '操作失败' },

    // ---------- 数据加载 ----------
    loadAll() {
      this.loadConversations()
      this.loadSkills()
      this.loadMemory()
      this.loadSkillsDir()
    },
    // 技能 md 文件目录：取主进程配置（与系统设置「技能文件目录」一致）
    async loadSkillsDir() {
      try {
        const res = await window.electron?.invoke('get-data-directories')
        this.skillsDir = (res && res.skillsDir) || ''
      } catch (_) { this.skillsDir = '' }
    },
    // 在资源管理器中打开技能文件目录
    async openSkillsDir() {
      if (!this.skillsDir) return
      try { await window.electron?.invoke('open-folder', this.skillsDir) } catch (_) { /* 忽略 */ }
    },
    async loadConversations() {
      this.loadingConv = true
      try {
        const { data } = await axios.get('/api/ai/conversations')
        this.conversations = data.data || []
      } catch (_) { this.conversations = [] }
      finally { this.loadingConv = false }
    },
    async loadSkills() {
      this.loadingSkill = true
      try {
        const { data } = await axios.get('/api/ai/skills')
        this.skills = data.data || []
      } catch (_) { this.skills = [] }
      finally { this.loadingSkill = false }
    },
    async loadMemory() {
      try {
        const { data } = await axios.get('/api/ai/memory')
        this.memoryContent = (data.data && data.data.content) || ''
      } catch (_) { this.memoryContent = '' }
    },

    // ---------- 确认弹窗 ----------
    confirmAsk(title, message, action) {
      this.confirm = { visible: true, title, message, action }
    },
    async runConfirm() {
      const action = this.confirm.action
      this.confirm.visible = false
      this.confirm.action = null
      if (action) await action()
    },

    // ---------- 聊天记录 ----------
    askDeleteConversation(c) {
      this.confirmAsk('删除聊天记录', `确定删除「${c.title || '未命名对话'}」吗？删除后不可恢复。`, async () => {
        try {
          await axios.delete(`/api/ai/conversations/${c.id}`)
          await this.loadConversations()
          this.notifySuccess('已删除聊天记录')
        } catch (err) { this.notifyError(this.errMsg(err)) }
      })
    },
    openChatExport(c) {
      this.chatDlg = { visible: true, id: c.id, name: c.title || '聊天记录' }
    },

    // ---------- Markdown 文件 ----------
    openNewSkill() {
      this.mdDlg = { visible: true, isNew: true, nameDisabled: false, originalName: '', initialName: '', initialContent: '', target: 'skill' }
    },
    openEditMemory() {
      this.mdDlg = { visible: true, isNew: false, nameDisabled: true, originalName: '', initialName: 'AI 记忆文件', initialContent: this.memoryContent, target: 'memory' }
    },
    async openEditSkill(s) {
      try {
        const { data } = await axios.get(`/api/ai/skills/${encodeURIComponent(s.name)}`)
        this.mdDlg = { visible: true, isNew: false, nameDisabled: false, originalName: s.name, initialName: s.name, initialContent: (data.data && data.data.content) || '', target: 'skill' }
      } catch (err) { this.notifyError(this.errMsg(err)) }
    },
    async onMdSave(payload) {
      const dlg = this.mdDlg
      try {
        if (dlg.target === 'memory') {
          await axios.put('/api/ai/memory', { content: payload.content })
          await this.loadMemory()
          this.notifySuccess('已保存记忆文件')
        } else if (dlg.isNew) {
          await axios.post('/api/ai/skills', { name: payload.name, content: payload.content })
          await this.loadSkills()
          this.notifySuccess('已新增文件')
        } else {
          await axios.put(`/api/ai/skills/${encodeURIComponent(payload.original)}`, { name: payload.name, content: payload.content })
          await this.loadSkills()
          this.notifySuccess('已保存文件')
        }
        this.mdDlg.visible = false
      } catch (err) { this.notifyError(this.errMsg(err)) }
    },
    askDeleteSkill(s) {
      this.confirmAsk('删除技能文件', `确定删除「${s.name}」吗？删除后不可恢复。`, async () => {
        try {
          await axios.delete(`/api/ai/skills/${encodeURIComponent(s.name)}`)
          await this.loadSkills()
          this.notifySuccess('已删除技能文件')
        } catch (err) { this.notifyError(this.errMsg(err)) }
      })
    },
    openExportMemory() {
      this.mdExportDlg = { visible: true, content: this.memoryContent, filename: 'AI 记忆文件' }
    },
    async openExportSkill(s) {
      try {
        const { data } = await axios.get(`/api/ai/skills/${encodeURIComponent(s.name)}`)
        this.mdExportDlg = { visible: true, content: (data.data && data.data.content) || '', filename: s.name }
      } catch (err) { this.notifyError(this.errMsg(err)) }
    },
  },
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
  border-radius: 8px;
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
