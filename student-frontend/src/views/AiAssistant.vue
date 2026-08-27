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

    <!-- 配置未就绪提示 -->
    <div v-if="!enabled" class="flex-1 flex items-center justify-center text-sm text-text-muted rounded-xl border border-border bg-white/55 backdrop-blur-md">
      <div class="text-center space-y-2">
        <div>AI 助手尚未启用</div>
        <button @click="showSettings = true" class="text-info hover:underline inline-block cursor-pointer">点击【⚙️ 设置】填写 API Key 并启用</button>
      </div>
    </div>

    <template v-else>
      <!-- 大毛玻璃框：把消息区与输入区一起框住（页面模式生效；悬浮模式复用浮窗自身毛玻璃） -->
      <div class="flex-1 flex flex-col min-h-0" :class="floating ? 'px-1' : 'bg-white/55 backdrop-blur-md border border-border rounded-xl p-3'">
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
          </div>
        </div>

        <div v-for="(m, i) in messages" :key="i" class="flex" :class="m.role === 'user' ? 'justify-end' : 'justify-start'">
          <div class="max-w-[85%]" :class="m.role === 'user' ? 'text-right' : ''">
            <div
              class="px-4 py-2.5 text-sm border"
              :class="m.role === 'user'
                ? 'user-bubble bg-primary text-text-inverse border-transparent whitespace-pre-wrap break-words'
                : 'assistant-bubble bg-surface text-text border-border whitespace-pre-wrap break-words'"
            >
              <span v-if="m.loading">思考中…</span>
              <span v-else-if="m.role === 'user'">{{ m.content || '（无内容）' }}</span>
              <!-- 助手消息渲染 markdown（加粗/斜体/表格等），已用 DOMPurify 清洗 -->
              <div v-else class="markdown-body whitespace-pre-wrap break-words" v-html="renderMarkdown(m.content)"></div>
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

      <!-- 输入区 -->
      <div class="mt-3 flex gap-2 items-start flex-shrink-0">
        <button
          v-if="!busy"
          title="开始新对话（保留历史，可恢复）"
          @click="newConversation"
          class="border border-border bg-surface text-text px-2.5 py-2 rounded-lg hover:bg-surface-hover transition-theme flex-shrink-0"
        >＋</button>
        <textarea
          v-model="input"
          :placeholder="busy ? 'AI 正在回复…' : '输入问题，回车发送（Shift+Enter 换行）'"
          :disabled="busy"
          rows="1"
          class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          @keydown.enter.exact.prevent="send"
        />
        <button
          @click="send"
          :disabled="busy || !input.trim()"
          class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded-lg transition-theme disabled:opacity-40 flex-shrink-0"
        >发送</button>
      </div>
      </div>
    </template>

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
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useNotification } from '../composables/useNotification.js'
import { recordRowInsert } from '../composables/useUndo.js'
import AiSettingsDialog from '../components/dialogs/AiSettingsDialog.vue'

// markdown 配置：开启 GFM（表格），异步关闭以保证同步渲染
marked.setOptions({ gfm: true, breaks: true })
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') node.setAttribute('target', '_blank')
})

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
  components: { AiSettingsDialog },
  props: {
    // 页面模式 / 悬浮呼出模式（紧凑）
    floating: { type: Boolean, default: false },
  },
  emits: ['close'],
  data() {
    return {
      enabled: false,
      busy: false,
      messages: [],
      input: '',
      conversationId: null, // 当前会话 id（持久化用），null 表示尚未创建
      showSettings: false, // AI 设置弹窗
    }
  },
  mounted() {
    this.loadEnabled()
  },
  methods: {
    async loadEnabled() {
      try {
        const { data } = await axios.get('/api/ai/config')
        this.enabled = data.success && data.data.enabled
        if (this.enabled) await this.restoreConversation()
      } catch (_) { this.enabled = false }
    },
    // 设置弹窗保存成功后刷新启用状态
    onSettingsSaved() {
      this.loadEnabled()
    },
    renderMarkdown(text) {
      if (!text) return ''
      return DOMPurify.sanitize(marked.parse(text))
    },
    // 恢复最近一次会话
    async restoreConversation() {
      try {
        const { data: list } = await axios.get('/api/ai/conversations')
        const latest = list.data && list.data.length ? list.data[0] : null
        if (!latest) return
        this.conversationId = latest.id
        const { data } = await axios.get(`/api/ai/conversations/${latest.id}/messages`)
        this.messages = (data.data || []).filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))
        this.scrollBottom()
      } catch (_) { /* 无法恢复则从空开始 */ }
    },
    // 新建会话：保留旧会话在数据库中，只是切换到新的空上下文
    async newConversation() {
      if (this.busy) return
      this.messages = []
      this.conversationId = null
      this.input = ''
    },
    // 惰性创建会话：首次发送时才建
    async ensureConversation() {
      if (this.conversationId) return this.conversationId
      const { data } = await axios.post('/api/ai/conversations', {})
      this.conversationId = data.id
      return data.id
    },
    async persistMessage(role, content) {
      if (!this.conversationId) return
      try {
        await axios.post(`/api/ai/conversations/${this.conversationId}/messages`, { role, content })
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
      if (!text || this.busy) return
      this.input = ''
      try {
        this.conversationId = await this.ensureConversation()
      } catch (_) { /* 建会话失败也继续，流式端若无 conversationId 则不落库 */ }
      await this.persistMessage('user', text)
      this.messages.push({ role: 'user', content: text })
      this.messages.push({ role: 'assistant', loading: true, content: '' })
      this.busy = true
      this.scrollBottom()
      try {
        const history = this.messages
          .filter((m) => !m.loading && !m.proposal)
          .map((m) => ({ role: m.role, content: m.content || '' }))
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
      } catch (err) {
        const last = this.messages[this.messages.length - 1]
        last.loading = false
        last.content = '⚠️ ' + (err.response?.data?.error || err.message || '请求失败')
      } finally {
        this.busy = false
        this.scrollBottom()
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