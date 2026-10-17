import axios from 'axios'
import { CONV_COLLAPSE_KEY } from './aiConstants.js'
import { ensureMarkdown, isMarkdownReady } from './aiMarkdown.js'

// 会话 / 模型 / 加载 相关的方法组 + computed 组（Options API mixin）。
// 方法体保留 this.xxx 写法，由 Vue 在合并为实例方法时 bind 到组件实例。
export default {
  computed: {
    // 会话列表：默认只渲染最近 3 条（列表本身已按 updated_at 倒序，越靠前越新）
    visibleConversations() {
      return this.conversationList.slice(0, this.visibleConvCount)
    },
    // 还有多少条更早的会话没渲染（决定「加载更多历史对话」按钮是否出现，并标注数量）
    hiddenConvCount() {
      return Math.max(0, this.conversationList.length - this.visibleConvCount)
    },
    // 模型快捷切换的下拉选项
    modelOptions() {
      return this.models.map((m) => ({ value: m.id, label: m.name || m.model }))
    },
    // 当前模型是否开启了推理（用于在没收到思考内容时给出提示）
    activeReasoningOn() {
      const m = this.models.find((x) => x.is_active)
      return !!(m && m.reasoning)
    },
    // 待用户回答的提问（只有最后一条助手消息可能是待回答状态）
    pendingAsk() {
      const last = this._lastAssistant()
      const a = last && last.ask
      return a && !a.answered && !a.dismissed ? a : null
    },
    // 多问题分页：当前页的那一题
    askCurrent() {
      const a = this.pendingAsk
      return a ? a.questions[this.askPage] : null
    },
    // 当前页能否翻到下一题（无选项的题视为可过；多选需至少选中 1 项且「其他」已填写）
    askCanAdvance() {
      return this.isAskQuestionReady(this.askCurrent)
    },
    // 所有题都作答有效才能提交（无选项的题不阻塞）
    askCanSubmit() {
      const a = this.pendingAsk
      return !!a && a.questions.every((q) => this.isAskQuestionReady(q))
    },
    // 待确认的写提案（只有最后一条助手消息可能是待确认状态）
    pendingProposal() {
      const last = this._lastAssistant()
      const p = last && last.proposal
      return p && !p.executed && !p.dismissed ? p : null
    },
  },
  methods: {
    // 会话列表折叠：折叠后变成数字栏，状态写入 localStorage 记忆
    toggleConvCollapsed() {
      this.convCollapsed = !this.convCollapsed
      localStorage.setItem(CONV_COLLAPSE_KEY, this.convCollapsed ? '1' : '0')
    },
    // 加载更多历史对话：每次多渲染 10 条（列表按时间倒序，越往后越旧）
    loadMoreConversations() {
      this.visibleConvCount += 10
    },
    async loadEnabled() {
      try {
        const { data } = await axios.get('/api/ai/config')
        this.enabled = data.success && data.data.enabled
        if (this.enabled) {
          await this.loadConversationList()
          await this.loadModels()
          await this.restoreConversation()
        }
      } catch (_) { this.enabled = false }
    },
    // 设置弹窗保存成功后刷新启用状态，并通知根组件同步悬浮按钮的显隐
    onSettingsSaved() {
      this.loadEnabled()
      window.dispatchEvent(new Event('ai-config-changed'))
    },
    // 预计算助手消息的渲染块（在后台异步加载库后重算）
    async _computeHtml(msg) {
      if (msg.role !== 'assistant' || !msg.content || msg._blocks) return
      await ensureMarkdown()
      msg._blocks = this._buildBlocks(msg.content)
    },
    _computeAllHtml() {
      this.messages.forEach((m) => {
        if (m.role === 'assistant' && m.content && !m._blocks) {
          if (isMarkdownReady()) {
            m._blocks = this._buildBlocks(m.content)
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
    // 加载模型列表（输入区快捷切换用）
    async loadModels() {
      try {
        const { data } = await axios.get('/api/ai/models')
        this.models = data.success ? data.data : []
        const active = this.models.find((m) => m.is_active)
        this.activeModelId = active ? active.id : null
      } catch (_) { /* 忽略 */ }
    },
    // 输入区快捷切换当前模型（立即生效）
    async switchModel(id) {
      const target = this.models.find((m) => m.id === id)
      if (!target || target.is_active || this.busy) return
      try {
        await axios.put(`/api/ai/models/${id}/active`)
        await this.loadModels()
      } catch (err) {
        alert((err.response && err.response.data && err.response.data.error) || '切换失败')
      }
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
        // 恢复会话只取最近若干条消息（反馈轮次的隐藏用户消息会追加在助手消息之后，窗口需覆盖到该助手消息）
        const { data } = await axios.get(`/api/ai/conversations/${latest.id}/messages?limit=20`)
        this.messages = this._parseMessages(data.data)
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
        // 切换会话只取最近若干条消息（反馈轮次的隐藏用户消息会追加在助手消息之后，窗口需覆盖到该助手消息）
        const { data } = await axios.get(`/api/ai/conversations/${id}/messages?limit=20`)
        this.messages = this._parseMessages(data.data)
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
  },
}
