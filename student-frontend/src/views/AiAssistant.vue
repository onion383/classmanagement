<template>
  <div class="h-full flex flex-col" :class="floating ? 'rounded-xl overflow-hidden' : ''">
    <!-- 顶部（页面模式显示标题） -->
    <div v-if="!floating" class="w-full bg-surface shadow-md rounded-xl mb-4 px-6 py-5 border border-border min-h-[4.5rem] flex items-center justify-between">
      <h1 class="text-2xl font-bold text-text">🤖 AI 助手</h1>
      <div class="flex items-center gap-3">
        <span v-if="!enabled" class="text-xs text-text-muted">{{ enabled ? '' : '未启用' }}</span>
        <button
          @click="showSettings = true"
          class="bg-surface-hover hover:bg-primary hover:text-text-inverse text-text px-4 py-2 rounded transition-theme"
          title="AI 助手设置"
        >⚙️ 设置</button>
      </div>
    </div>

    <!-- 加载中骨架 -->
    <div v-if="enabled === null" class="flex-1 flex items-center justify-center text-sm text-text-muted rounded-xl border border-border bg-white/55 backdrop-blur-md">
      <div class="text-center space-y-2">
        <div class="animate-pulse">加载中…</div>
      </div>
    </div>

    <!-- 配置未就绪提示 -->
    <div v-else-if="!enabled" class="flex-1 flex items-center justify-center text-sm text-text-muted rounded-xl border border-border bg-white/55 backdrop-blur-md">
      <div class="text-center space-y-2">
        <div>AI 助手尚未启用</div>
        <button @click="showSettings = true" class="text-info hover:underline inline-block cursor-pointer">点击【⚙️ 设置】填写 API Key 并启用</button>
      </div>
    </div>

    <template v-else-if="enabled">
      <div class="flex-1 flex gap-3 min-h-0">
        <!-- 左侧会话列表 -->
        <div class="w-56 flex-shrink-0 bg-white/55 backdrop-blur-md border border-border rounded-xl p-2 flex flex-col min-h-0">
          <div class="flex items-center justify-between mb-2 px-1">
            <span class="text-sm font-medium text-text">对话列表</span>
            <button
              @click="newConversation"
              :disabled="busy"
              class="text-text-muted hover:text-text text-lg leading-none cursor-pointer disabled:opacity-40"
              title="新建对话"
            >＋</button>
          </div>
          <div class="flex-1 overflow-y-auto min-h-0 space-y-1">
            <div
              v-for="conv in conversationList"
              :key="conv.id"
              @click="switchConversation(conv.id)"
              class="flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-theme group"
              :class="conv.id === conversationId ? 'bg-primary/10 border border-primary' : 'hover:bg-surface-hover border border-transparent'"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm text-text truncate">{{ conv.title }}</div>
                <div class="text-[10px] text-text-muted">
                  {{ conv.msg_count }} 条消息 · {{ formatTime(conv.updated_at) }}
                </div>
              </div>
              <button
                @click.stop="deleteConversation(conv.id)"
                class="text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity text-sm leading-none px-1"
                title="删除对话"
              >✕</button>
            </div>
            <div v-if="!conversationList.length" class="text-center text-xs text-text-muted py-4">
              暂无历史对话
            </div>
          </div>
        </div>

        <!-- 右侧聊天区 -->
        <div class="flex-1 flex flex-col min-h-0 bg-white/55 backdrop-blur-md border border-border rounded-xl p-3">
          <!-- 消息区 -->
          <div ref="msgBox" class="flex-1 overflow-auto space-y-3 pr-1">
            <div v-if="!messages.length" class="h-full flex items-center justify-center">
              <div class="text-center text-text-muted text-sm space-y-2">
                <div class="text-3xl">🤖</div>
                <div>你可以问我班级数据，例如：</div>
                <div class="space-y-1 text-xs">
                  <div>「这个月班费支出了多少」</div>
                  <div>「有多少同学在请病假」</div>
                  <div>「新增一个学生 张三」</div>
                </div>
                <button v-if="!busy" @click="newConversation" class="text-info hover:underline">开始新对话</button>
              </div>
            </div>

            <div v-for="(m, i) in messages" :key="i" class="flex content-visibility-auto" :class="m.role === 'user' ? 'justify-end' : 'justify-start'">
              <div class="max-w-[85%]" :class="m.role === 'user' ? 'text-right' : ''">
                <!-- 用户消息中的图片 -->
                <div v-if="m.role === 'user' && m.images && m.images.length" class="mb-1 flex flex-wrap gap-1 justify-end">
                  <img
                    v-for="(img, idx) in m.images"
                    :key="idx"
                    :src="img"
                    loading="lazy"
                    class="max-w-48 max-h-36 rounded-lg border border-border object-cover"
                  />
                </div>
                <div
                  class="px-4 py-2.5 text-sm border"
                  :class="m.role === 'user'
                    ? 'user-bubble bg-primary text-text-inverse border-transparent whitespace-pre-wrap break-words'
                    : 'assistant-bubble bg-surface text-text border-border whitespace-pre-wrap break-words'"
                >
                  <span v-if="m.loading">思考中…</span>
                  <template v-else-if="m.role === 'user'">
                    <!-- 含文件内容的消息：显示文件标签 + 用户文字 -->
                    <template v-if="m.content && m.content.startsWith('文件「')">
                      <div class="flex items-center gap-1 text-primary/80 text-xs mb-1">
                        <span class="text-xs">📄</span>
                        <span class="font-medium truncate max-w-40">{{ extractFileName(m.content) }}</span>
                      </div>
                      <span>{{ extractUserText(m.content) || '（无内容）' }}</span>
                    </template>
                    <span v-else>{{ m.content || '（无内容）' }}</span>
                  </template>
                  <!-- 助手消息渲染 markdown（加粗/斜体/表格等），已用 DOMPurify 清洗 -->
                  <div v-else class="markdown-body whitespace-pre-wrap break-words" v-html="m._html || m.content"></div>
                </div>
                <!-- 写提案卡片 -->
                <div v-if="m.proposal" class="mt-2 text-left rounded-lg border border-warning/40 bg-surface p-3">
                  <div class="flex items-center gap-2 text-xs text-warning mb-2">
                    <span class="font-semibold">{{ m.proposal.label }}</span>
                    <span class="text-text-muted">将写入「{{ tableLabel(m.proposal.table) }}」</span>
                  </div>
                  <pre class="text-xs text-text-secondary bg-surface-hover rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">{{ proposalPreview(m.proposal) }}</pre>
                  <div class="flex gap-2 mt-2">
                    <button
                      v-if="!m.proposal.executed && !m.proposal.executing"
                      @click="executeProposal(m, i)"
                      class="bg-primary hover:bg-primary-hover text-text-inverse text-xs px-3 py-1.5 rounded transition-theme"
                    >确认执行</button>
                    <span v-if="m.proposal.executing" class="text-xs text-text-muted">执行中…</span>
                    <span v-if="m.proposal.executed" class="text-xs text-success">✅ 已执行</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 附件预览 -->
          <div v-if="attachedFile" class="mb-2 flex items-center gap-2">
            <!-- 图片预览 -->
            <div v-if="attachedFile.isImage" class="relative border border-border rounded-lg overflow-hidden inline-block">
              <img :src="attachedFile.dataUrl" class="max-h-32 max-w-64" />
              <button
                @click="clearAttachment"
                class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-danger text-white rounded-full flex items-center justify-center text-xs leading-none cursor-pointer hover:bg-danger-hover"
                title="移除"
              >✕</button>
            </div>
            <!-- 文件预览 -->
            <div v-else class="relative border border-border rounded-lg bg-surface px-3 py-2 inline-flex items-center gap-2 max-w-full">
              <span class="text-sm">📄</span>
              <span class="text-sm font-medium text-text truncate max-w-40">{{ attachedFile.name }}</span>
              <span class="text-xs text-text-muted flex-shrink-0">({{ attachedFile.sizeLabel }})</span>
              <button
                @click="clearAttachment"
                class="text-text-muted hover:text-danger text-sm leading-none cursor-pointer flex-shrink-0"
                title="移除"
              >✕</button>
            </div>
          </div>

          <!-- 输入区 -->
          <div class="mt-0 flex gap-2 items-start flex-shrink-0">
            <input
              ref="fileInput"
              type="file"
              accept="image/*,.pdf,.docx,.xlsx,.xls,.csv,.txt,.md"
              class="hidden"
              @change="onFileSelected"
            />
            <button
              v-if="!busy"
              @click="triggerFileSelect"
              class="border border-border bg-surface text-text px-2.5 py-2 rounded-lg hover:bg-surface-hover transition-theme flex-shrink-0"
              title="上传图片/PDF/Excel/Word/文本（支持粘贴图片）"
            >📎</button>
            <textarea
              ref="textareaRef"
              v-model="input"
              :placeholder="busy ? 'AI 正在回复…' : '输入问题，回车发送（Shift+Enter 换行），可粘贴图片'"
              :disabled="busy"
              rows="1"
              class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              @keydown.enter.exact.prevent="send"
              @paste="onPaste"
            />
            <button
              @click="send"
              :disabled="busy || (!input.trim() && !attachedFile)"
              class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded-lg transition-theme disabled:opacity-40 flex-shrink-0"
            >发送</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 删除确认弹窗 -->
    <ConfirmDialog
      :visible="confirmDeleteShow"
      message="确定删除该对话？删除后无法恢复。"
      :show-cancel="true"
      @confirm="onDeleteConfirm"
      @cancel="confirmDeleteShow = false"
    />

    <!-- AI 助手设置弹窗 -->
    <AiSettingsDialog :show="showSettings" @close="showSettings = false" @saved="onSettingsSaved" />
  </div>
</template>

<style scoped>
/* 对话气泡圆角：提问框右下角小圆，回答框左下角小圆（镜像对称），用固定值确保生效 */
.user-bubble { border-radius: 16px 16px 6px 16px !important; }
.assistant-bubble { border-radius: 16px 16px 16px 6px !important; }

/* 助手消息的 markdown 排版（加粗/斜体/表格/列表/代码） */
.markdown-body :deep(p) { margin: 0 0 0.5em; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(strong) { font-weight: 700; }
.markdown-body :deep(em) { font-style: italic; }
.markdown-body :deep(code) {
  background: var(--color-surface-hover, #f1f5f9);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.markdown-body :deep(pre) {
  background: var(--color-surface-hover, #f1f5f9);
  padding: 0.6em 0.8em;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.4em 0;
}
.markdown-body :deep(pre code) { background: transparent; padding: 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { margin: 0.3em 0 0.5em; padding-left: 1.3em; }
.markdown-body :deep(li) { margin: 0.1em 0; }
.markdown-body :deep(a) { color: var(--color-info, #2563eb); text-decoration: underline; }
.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 0.4em 0;
  width: 100%;
  font-size: 0.95em;
  display: block;
  overflow-x: auto;
}
.markdown-body :deep(th), .markdown-body :deep(td) {
  border: 1px solid var(--color-border, #e2e8f0);
  padding: 0.25em 0.6em;
}
.markdown-body :deep(th) {
  background: var(--color-surface-hover, #f1f5f9);
  font-weight: 600;
}
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3),
.markdown-body :deep(h4) { margin: 0.5em 0 0.3em; font-weight: 700; }
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--color-border, #e2e8f0);
  padding-left: 0.7em;
  color: var(--color-text-muted, #64748b);
  margin: 0.4em 0;
}
</style>

<script>
import axios from 'axios'
import { useNotification } from '../composables/useNotification.js'
import { recordRowInsert } from '../composables/useUndo.js'
import AiSettingsDialog from '../components/dialogs/AiSettingsDialog.vue'
import ConfirmDialog from '../components/base/ConfirmDialog.vue'

// marked / DOMPurify 异步懒加载（减少页面 chunk 大小，降低 LCP）
let _marked = null
let _purify = null
async function ensureMarkdown() {
  if (_marked) return
  const [markedModule, purifyModule] = await Promise.all([
    import('marked'),
    import('dompurify'),
  ])
  _marked = markedModule.marked
  _purify = purifyModule.default
  _marked.setOptions({ gfm: true, breaks: true })
  _purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') node.setAttribute('target', '_blank')
  })
}

// 可写表的执行端点（与后端 propose_write 白名单保持一致）
const EXEC = {
  students: { url: '/api/students', undoKey: 'students' },
  fee_records: { url: '/api/fee-records', undoKey: 'fee_records' },
  activities: { url: '/api/activities', undoKey: 'activities' },
  countdowns: { url: '/api/countdowns', undoKey: 'countdowns' },
}
const LABELS = { students: '学生', fee_records: '班费记录', activities: '班级活动', countdowns: '倒计时' }

export default {
  name: 'AiAssistant',
  components: { AiSettingsDialog, ConfirmDialog },
  props: {
    // 页面模式 / 悬浮呼出模式（紧凑）
    floating: { type: Boolean, default: false },
  },
  emits: ['close'],
  data() {
    return {
      enabled: null, // null=加载中, false=未启用, true=已启用
      busy: false,
      messages: [],
      input: '',
      conversationId: null, // 当前会话 id（持久化用），null 表示尚未创建
      conversationList: [], // 会话列表
      showSettings: false, // AI 设置弹窗
      confirmDeleteShow: false, // 删除确认弹窗
      confirmDeleteId: null, // 待删除的会话 id
      attachedFile: null,    // 当前待发送的附件：{name, isImage, dataUrl, textContent, sizeLabel}
    }
  },
  mounted() {
    // 后台预加载 markdown 库（不阻塞首次渲染）
    ensureMarkdown().then(() => this._computeAllHtml())
    this.loadEnabled()
  },
  methods: {
    async loadEnabled() {
      try {
        const { data } = await axios.get('/api/ai/config')
        this.enabled = data.success && data.data.enabled
        if (this.enabled) {
          await this.loadConversationList()
          await this.restoreConversation()
        }
      } catch (_) { this.enabled = false }
    },
    // 设置弹窗保存成功后刷新启用状态
    onSettingsSaved() {
      this.loadEnabled()
    },
    renderMarkdown(text) {
      if (!text) return ''
      if (!_marked || !_purify) return text // 库未加载完时回退到纯文本
      return _purify.sanitize(_marked.parse(text))
    },
    // 预计算助手消息的 HTML（在后台异步加载库后重算）
    async _computeHtml(msg) {
      if (msg.role !== 'assistant' || !msg.content || msg._html) return
      await ensureMarkdown()
      msg._html = _purify.sanitize(_marked.parse(msg.content))
    },
    _computeAllHtml() {
      this.messages.forEach((m) => {
        if (m.role === 'assistant' && m.content && !m._html) {
          if (_marked && _purify) {
            m._html = _purify.sanitize(_marked.parse(m.content))
          }
        }
      })
    },
    // 加载会话列表
    async loadConversationList() {
      try {
        const { data } = await axios.get('/api/ai/conversations')
        this.conversationList = data.data || []
      } catch (_) { /* 忽略 */ }
    },
    // 从数据库加载的消息反序列化：支持多模态 JSON 数组
    parseMessage(m) {
      if (m.role === 'user' && m.content && m.content.startsWith('[')) {
        try {
          const parts = JSON.parse(m.content)
          if (Array.isArray(parts)) {
            const text = parts.find((p) => p.type === 'text')?.text || ''
            const images = parts.filter((p) => p.type === 'image_url').map((p) => p.image_url.url)
            return { role: 'user', content: text, images }
          }
        } catch (_) { /* 解析失败则当普通文本 */ }
      }
      return { role: m.role, content: m.content || '' }
    },
    // 恢复最近一次会话
    async restoreConversation() {
      if (!this.conversationList.length) return
      // 如果当前已有会话且在列表中，不切换；否则切到最新
      const current = this.conversationList.find((c) => c.id === this.conversationId)
      if (current) return
      const latest = this.conversationList[0]
      this.conversationId = latest.id
      try {
        const { data } = await axios.get(`/api/ai/conversations/${latest.id}/messages`)
        this.messages = (data.data || []).filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => this.parseMessage(m))
        this._computeAllHtml()
        this.$nextTick(() => this.scrollBottom())
      } catch (_) { this.messages = [] }
    },
    // 切换会话
    async switchConversation(id) {
      if (id === this.conversationId || this.busy) return
      this.conversationId = id
      this.messages = []
      this.input = ''
      try {
        const { data } = await axios.get(`/api/ai/conversations/${id}/messages`)
        this.messages = (data.data || []).filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => this.parseMessage(m))
        this._computeAllHtml()
        this.$nextTick(() => this.scrollBottom())
      } catch (_) { /* 忽略 */ }
    },
    // 新建会话
    async newConversation() {
      if (this.busy) return
      this.messages = []
      this.conversationId = null
      this.input = ''
      this.attachedFile = null
    },
    // 删除会话
    deleteConversation(id) {
      this.confirmDeleteId = id
      this.confirmDeleteShow = true
    },
    async onDeleteConfirm() {
      const id = this.confirmDeleteId
      if (!id) return
      this.confirmDeleteShow = false
      this.confirmDeleteId = null
      try {
        await axios.delete(`/api/ai/conversations/${id}`)
        // 如果删除的是当前会话，切到空状态
        if (this.conversationId === id) {
          this.conversationId = null
          this.messages = []
        }
        await this.loadConversationList()
      } catch (_) { /* 忽略 */ }
    },
    formatTime(t) {
      if (!t) return ''
      const d = new Date(t)
      const now = new Date()
      const diff = now - d
      // 今天
      if (diff < 86400000 && d.getDate() === now.getDate()) {
        return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }
      // 昨天
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear()) {
        return '昨天 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }
      // 今年
      if (d.getFullYear() === now.getFullYear()) {
        return (d.getMonth() + 1) + '/' + d.getDate()
      }
      return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
    },
    // 文件上传相关
    triggerFileSelect() {
      this.$refs.fileInput.click()
    },
    async onFileSelected(e) {
      const file = e.target.files && e.target.files[0]
      if (!file) return
      e.target.value = ''
      this.attachedFile = await this.readFile(file)
    },
    // 读取文件提取文本内容
    async readFile(file) {
      const name = file.name
      const ext = name.split('.').pop().toLowerCase()
      const sizeLabel = file.size > 1048576
        ? (file.size / 1048576).toFixed(1) + ' MB'
        : (file.size / 1024).toFixed(0) + ' KB'

      // 图片：保持 data URL，用于 vision API
      if (file.type.startsWith('image/')) {
        const dataUrl = await this.readAsDataURL(file)
        return { name, isImage: true, dataUrl, textContent: '', sizeLabel }
      }

      // 文本类文件：直接在前端读取
      const textExts = ['txt', 'csv', 'md', 'json', 'xml', 'html', 'htm', 'js', 'py', 'rb', 'php', 'java', 'ts', 'tsx', 'jsx', 'css', 'scss', 'less', 'yaml', 'yml', 'log', 'sh', 'bat', 'env', 'ini', 'cfg', 'conf', 'sql', 'r', 'go', 'rs', 'swift', 'kt', 'toml']
      if (textExts.includes(ext)) {
        const text = await this.readAsText(file)
        const truncated = text.length > 100000 ? text.slice(0, 100000) + '\n\n...（文件太长，已截断）' : text
        return { name, isImage: false, dataUrl: '', textContent: truncated, sizeLabel }
      }

      // PDF / Excel / Word：上传到后端解析
      const result = await this.uploadAndParse(file)
      return { name, isImage: false, dataUrl: '', textContent: result.text, sizeLabel }
    },
    readAsDataURL(file) {
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target.result)
        reader.readAsDataURL(file)
      })
    },
    readAsText(file) {
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target.result)
        reader.readAsText(file)
      })
    },
    async uploadAndParse(file) {
      const form = new FormData()
      form.append('file', file)
      try {
        const { data } = await axios.post('/api/ai/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        if (data.success) return data.data
        return { text: `文件名：${file.name}\n\n错误：${data.error || '解析失败'}` }
      } catch (err) {
        return { text: `文件名：${file.name}\n\n错误：${err.message || '上传失败'}` }
      }
    },
    onPaste(e) {
      const items = e.clipboardData && e.clipboardData.items
      if (!items) return
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            const reader = new FileReader()
            reader.onload = (event) => {
              const name = file.name || '粘贴图片.png'
              const sizeLabel = file.size > 1048576
                ? (file.size / 1048576).toFixed(1) + ' MB'
                : (file.size / 1024).toFixed(0) + ' KB'
              this.attachedFile = { name, isImage: true, dataUrl: event.target.result, textContent: '', sizeLabel }
            }
            reader.readAsDataURL(file)
          }
          e.preventDefault()
          return
        }
      }
    },
    clearAttachment() {
      this.attachedFile = null
    },
    // 从文件消息内容中提取文件名
    extractFileName(content) {
      const m = content && content.match(/^文件「(.+?)」/)
      return m ? m[1] : ''
    },
    // 从文件消息内容中提取用户文字
    extractUserText(content) {
      if (!content) return ''
      // 去掉文件内容部分，只保留用户文字
      const idx = content.indexOf('\n```\n')
      if (idx === -1) return ''
      const after = content.slice(idx + 5).trim() // 跳过 ```\n
      // 去掉末尾可能的截断标记
      return after.replace(/^(\n|$)/, '')
    },
    // 惰性创建会话：首次发送时才建
    async ensureConversation() {
      if (this.conversationId) return this.conversationId
      const { data } = await axios.post('/api/ai/conversations', {})
      this.conversationId = data.id
      return data.id
    },
    async persistMessage(role, content, images) {
      if (!this.conversationId) return
      // 多模态消息：存为 JSON 数组
      const payload = (images && images.length)
        ? JSON.stringify([
            { type: 'text', text: content || '' },
            ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ])
        : content
      try {
        await axios.post(`/api/ai/conversations/${this.conversationId}/messages`, { role, content: payload })
      } catch (_) { /* 持久化失败不阻塞对话 */ }
    },
    tableLabel(t) { return LABELS[t] || t },
    proposalPreview(p) {
      try {
        return JSON.stringify(p.data, null, 2)
      } catch (_) { return String(p.data) }
    },
    async send() {
      const text = this.input.trim()
      const file = this.attachedFile
      if (!text && !file) return
      if (this.busy) return
      this.input = ''
      this.attachedFile = null
      try {
        this.conversationId = await this.ensureConversation()
      } catch (_) { /* 建会话失败也继续，流式端若无 conversationId 则不落库 */ }

      // 构建消息内容和图片列表
      let messageContent = text
      let images = []
      if (file) {
        if (file.isImage) {
          // 图片：走 vision API 多模态
          images = [file.dataUrl]
        } else if (file.textContent) {
          // 文本类文件：文件内容拼到提问中
          messageContent = `文件「${file.name}」的内容：\n\`\`\`\n${file.textContent}\n\`\`\`\n${text ? '\n' + text : ''}`
        }
      }

      await this.persistMessage('user', messageContent, images)
      this.messages.push({ role: 'user', content: messageContent, images })
      this.messages.push({ role: 'assistant', loading: true, content: '' })
      this.busy = true
      this.scrollBottom()
      try {
        const history = this.messages
          .filter((m) => !m.loading && !m.proposal)
          .map((m) => {
            if (m.role === 'user' && m.images && m.images.length) {
              return {
                role: 'user',
                content: [
                  { type: 'text', text: m.content || '' },
                  ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
                ],
              }
            }
            return { role: m.role, content: m.content || '' }
          })
        const resp = await fetch('/api/ai/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, conversationId: this.conversationId }),
        })
        if (!resp.ok || !resp.body) throw new Error((resp.status === 400 && 'AI 未启用') || '请求失败')
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let last = this.messages[this.messages.length - 1]
        last.loading = false
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, idx).trim()
            buf = buf.slice(idx + 1)
            if (!line.startsWith('data:')) continue
            let evt
            try { evt = JSON.parse(line.slice(5).trim()) } catch (_) { continue }
            if (evt.type === 'delta') {
              last.content += evt.text || ''
              this.scrollBottom()
            } else if (evt.type === 'proposal') {
              last.proposal = evt.proposal
            } else if (evt.type === 'err') {
              last.content = '⚠️ ' + (evt.message || '请求失败')
            } else if (evt.type === 'done') {
              if (last.content === '' && !last.proposal) last.content = evt.reply || '（无内容）'
            } else if (evt.type === 'status') {
              // 状态提示（思考中/查询数据中…）——可忽略或用于后续状态指示
            }
          }
        }
        if (this.conversationId && last.content) await this.persistMessage('assistant', last.content)
        if (last.content === '' && !last.proposal) last.content = last.content || '⚠️ 未收到回复'
        // 后台预计算 markdown HTML（不阻塞 UI）
        this._computeHtml(last)
      } catch (err) {
        const last = this.messages[this.messages.length - 1]
        last.loading = false
        last.content = '⚠️ ' + (err.response?.data?.error || err.message || '请求失败')
      } finally {
        this.busy = false
        this.scrollBottom()
        // 刷新会话列表（更新标题和消息数）
        await this.loadConversationList()
      }
    },
    async executeProposal(m, i) {
      if (m.proposal.executing || m.proposal.executed) return
      const { success: notify, error: notifyError } = useNotification()
      m.proposal.executing = true
      m.proposal.executed = false
      try {
        const end = EXEC[m.proposal.table]
        if (!end) throw new Error('该表暂不支持 AI 写入')
        const { operation, data } = m.proposal
        let rowAdded
        if (operation === 'add') {
          const res = await axios.post(end.url, this.cleanPayload(data))
          rowAdded = { id: res.data?.id ?? res.data?.row?.id, ...this.cleanPayload(data) }
        } else if (operation === 'update') {
          await axios.put(`${end.url}/${data.id}`, this.cleanPayload(data.changes || {}))
        } else if (operation === 'delete') {
          await axios.delete(`${end.url}/${data.id}`)
        } else {
          throw new Error('未知操作')
        }
        // 新增操作登记撤销，回到对应页面可 Ctrl+Z 回退
        if (operation === 'add' && rowAdded && rowAdded.id != null) {
          recordRowInsert(end.undoKey, rowAdded)
        }
        m.proposal.executing = false
        m.proposal.executed = true
        notify(m.proposal.label + ' 已执行')
      } catch (err) {
        m.proposal.executing = false
        m.proposal.executed = false
        notifyError('执行失败：' + (err.response?.data?.error || err.message || '未知错误'))
      }
    },
    // 仅保留合法的业务字段，剔除内部列（id/position/created_at 等）
    cleanPayload(obj) {
      const drop = new Set(['id', 'position', 'created_at', 'student_id', 'group_id', 'dimension_id'])
      const out = {}
      for (const k of Object.keys(obj || {})) {
        if (!drop.has(k)) out[k] = obj[k]
      }
      return out
    },
    scrollBottom() {
      this.$nextTick(() => {
        const box = this.$refs.msgBox
        if (box) box.scrollTop = box.scrollHeight
      })
    },
  },
}
</script>