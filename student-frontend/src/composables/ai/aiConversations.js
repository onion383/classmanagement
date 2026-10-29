import axios from 'axios'
import { ensureMarkdown, isMarkdownReady } from './aiMarkdown.js'
import { AI_PERMISSION_FULL } from './aiConstants.js'
import { reportError } from '../../utils/reportError.js'
import { computed, nextTick } from 'vue'

// 恢复 / 切换会话时默认只取最近若干条；更早的消息在滚动到顶部时按需补载
const INITIAL_MSG_LIMIT = 10
const EARLIER_MSG_LIMIT = 20

// 会话 / 模型 / 加载 相关的方法组 + computed 组（原 Options API mixin，现为 ctx 闭包 composable）。
// ctx 契约：状态/computed ref 用 .value 访问，跨模块方法经 ctx 运行时解析。
export function useAiConversations(ctx) {
  return {
    // ===== computed 组 =====
    // 会话列表：默认只渲染最近 3 条（列表本身已按 updated_at 倒序，越靠前越新）
    visibleConversations: computed(() => {
      return ctx.conversationList.value.slice(0, ctx.visibleConvCount.value)
    }),
    // 还有多少条更早的会话没渲染（决定「加载更多历史对话」按钮是否出现，并标注数量）
    hiddenConvCount: computed(() => {
      return Math.max(0, ctx.conversationList.value.length - ctx.visibleConvCount.value)
    }),
    // 模型快捷切换的下拉选项
    modelOptions: computed(() => {
      return ctx.models.value.map((m) => ({ value: m.id, label: m.name || m.model }))
    }),
    // 当前模型是否开启了推理（用于在没收到思考内容时给出提示）
    activeReasoningOn: computed(() => {
      const m = ctx.models.value.find((x) => x.is_active)
      return !!(m && m.reasoning)
    }),
    // 待用户回答的提问（只有最后一条助手消息可能是待回答状态）
    pendingAsk: computed(() => {
      const last = ctx._lastAssistant()
      const a = last && last.ask
      return a && !a.answered && !a.dismissed ? a : null
    }),
    // 多问题分页：当前页的那一题（分页下标越界时返回 null，不抛错）
    askCurrent: computed(() => {
      const a = ctx.pendingAsk.value
      const qs = a && Array.isArray(a.questions) ? a.questions : []
      return qs[ctx.askPage.value] || null
    }),
    // 当前页能否翻到下一题（无选项的题视为可过；多选需至少选中 1 项且「其他」已填写）
    askCanAdvance: computed(() => {
      return ctx.isAskQuestionReady(ctx.askCurrent.value)
    }),
    // 所有题都作答有效才能提交（无选项的题不阻塞）
    askCanSubmit: computed(() => {
      const a = ctx.pendingAsk.value
      const qs = a && Array.isArray(a.questions) ? a.questions : []
      return qs.length > 0 && qs.every((q) => ctx.isAskQuestionReady(q))
    }),
    // 待确认的写提案（只有最后一条助手消息可能是待确认状态）
    pendingProposal: computed(() => {
      const last = ctx._lastAssistant()
      const p = last && last.proposal
      if (!p || p.executed || p.dismissed) return null
      // 完全权限：写入由前端在流结束后自动执行，不再弹确认浮窗
      // （否则执行期间会闪一个「执行中…」的框，等于又通知了用户一次）
      // 例外：技能（md 指令文件）变更即使在全权限下也必须老师确认，故照常弹窗。
      if (ctx.permissionMode.value === AI_PERMISSION_FULL && p.kind !== 'skill') return null
      return p
    }),

    // ===== 方法组 =====
    // 加载更多历史对话：每次多渲染 10 条（列表按时间倒序，越往后越旧）
    loadMoreConversations() {
      ctx.visibleConvCount.value += 10
    },
    async loadEnabled() {
      try {
        const { data } = await axios.get('/api/ai/config')
        ctx.enabled.value = data.success && data.data.enabled
        if (ctx.enabled.value) {
          await ctx.loadConversationList()
          await ctx.loadModels()
          await ctx.restoreConversation()
        }
      } catch (_) { ctx.enabled.value = false }
    },
    // 设置弹窗保存成功后刷新启用状态，并通知根组件同步悬浮按钮的显隐
    onSettingsSaved() {
      ctx.loadEnabled()
      window.dispatchEvent(new Event('ai-config-changed'))
    },
    // 预计算助手消息的渲染块（在后台异步加载库后重算）
    async _computeHtml(msg) {
      if (msg.role !== 'assistant' || !msg.content || msg._blocks) return
      await ensureMarkdown()
      msg._blocks = ctx._buildBlocks(msg.content)
      // 渲染已切到 _blocks（模板里 _blocks 分支优先于 _live 分支），
      // 流式期的临时缓冲是同一份内容的第二、三份拷贝，这里主动释放。
      // 注意保留 msg._live：它决定「未返回思考内容」提示是否显示，清掉会改变观感。
      msg._liveSrc = null
      msg._liveHtml = ''
      msg._liveTail = ''
    },
    _computeAllHtml() {
      ctx.messages.value.forEach((m) => {
        if (m.role === 'assistant' && m.content && !m._blocks) {
          if (isMarkdownReady()) {
            m._blocks = ctx._buildBlocks(m.content)
          }
        }
      })
    },
    // 加载会话列表
    async loadConversationList() {
      try {
        const { data } = await axios.get('/api/ai/conversations')
        ctx.conversationList.value = data.data || []
      } catch (_) { /* 忽略 */ }
    },
    // 加载模型列表（输入区快捷切换用）
    async loadModels() {
      try {
        const { data } = await axios.get('/api/ai/models')
        ctx.models.value = data.success ? data.data : []
        const active = ctx.models.value.find((m) => m.is_active)
        ctx.activeModelId.value = active ? active.id : null
      } catch (_) { /* 忽略 */ }
    },
    // 输入区快捷切换当前模型（立即生效）
    async switchModel(id) {
      const target = ctx.models.value.find((m) => m.id === id)
      if (!target || target.is_active || ctx.busy.value) return
      try {
        await axios.put(`/api/ai/models/${id}/active`)
        await ctx.loadModels()
      } catch (err) {
        reportError(err, { action: '切换模型' })
      }
    },
    // 应用一批「最近消息」响应：写入消息列表，并记录分页游标与「是否还有更早」
    _applyInitialMessages(resp) {
      const rows = resp.data || []
      ctx.messages.value = ctx._parseMessages(rows)
      ctx.earliestMsgId.value = rows.length ? rows[0].id : null
      ctx.hasEarlier.value = !!resp.hasMore
      ctx._computeAllHtml()
    },
    // 上翻补载更早的历史：取 id 小于游标（earliestMsgId）的一批前插，并做滚动补偿
    // 补偿原理：内容插在顶部会把下方内容整体下推，用「新增高度」把视口拉回原位置，避免跳到列表顶
    // 返回是否成功补载（供「补满一屏」循环据此决定是否继续）
    async loadEarlier() {
      if (!ctx.conversationId.value || ctx.loadingEarlier.value || !ctx.hasEarlier.value) return false
      const cursor = ctx.earliestMsgId.value
      if (!cursor) return false
      ctx.loadingEarlier.value = true
      const box = ctx.msgBox.value
      const prevScrollHeight = box ? box.scrollHeight : 0
      const prevScrollTop = box ? box.scrollTop : 0
      try {
        const { data } = await axios.get(
          `/api/ai/conversations/${ctx.conversationId.value}/messages?limit=${EARLIER_MSG_LIMIT}&before_id=${cursor}`
        )
        const rows = data.data || []
        const earlier = ctx._parseMessages(rows)
        if (earlier.length) {
          ctx.messages.value = [...earlier, ...ctx.messages.value]
          ctx.earliestMsgId.value = rows[0].id
          ctx._computeAllHtml()
        }
        ctx.hasEarlier.value = !!data.hasMore
        nextTick(() => {
          const b = ctx.msgBox.value
          if (b) b.scrollTop = prevScrollTop + (b.scrollHeight - prevScrollHeight)
        })
        return true
      } catch (_) { return false } finally {
        ctx.loadingEarlier.value = false
      }
    },
    // 内容不足一屏（没有滚动条）时无法靠滚动触发补载，这里主动补，直到可滚动或已无更早消息
    async _fillEarlier() {
      const box = ctx.msgBox.value
      if (!box || !ctx.hasEarlier.value || ctx.loadingEarlier.value) return
      if (box.scrollHeight > box.clientHeight + 4) return
      if (!(await ctx.loadEarlier())) return
      await nextTick()
      ctx._fillEarlier()
    },
    // 恢复最近一次会话
    async restoreConversation() {
      if (!ctx.conversationList.value.length) return
      // 如果当前已有会话且在列表中，不切换；否则切到最新
      const current = ctx.conversationList.value.find((c) => c.id === ctx.conversationId.value)
      if (current) return
      const latest = ctx.conversationList.value[0]
      ctx.conversationId.value = latest.id
      try {
        // 默认只取最近 5 条；更早的消息在滚动到顶部时按需补载
        const { data } = await axios.get(`/api/ai/conversations/${latest.id}/messages?limit=${INITIAL_MSG_LIMIT}`)
        ctx._applyInitialMessages(data)
        nextTick(() => {
          ctx.scrollBottom()
          ctx._fillEarlier()
        })
      } catch (_) { ctx.messages.value = [] }
    },
    // 切换会话
    async switchConversation(id) {
      if (id === ctx.conversationId.value || ctx.busy.value) return
      ctx.conversationId.value = id
      ctx.messages.value = []
      ctx.input.value = ''
      ctx.hasEarlier.value = false
      ctx.earliestMsgId.value = null
      try {
        // 默认只取最近 5 条；更早的消息在滚动到顶部时按需补载
        const { data } = await axios.get(`/api/ai/conversations/${id}/messages?limit=${INITIAL_MSG_LIMIT}`)
        ctx._applyInitialMessages(data)
        nextTick(() => {
          ctx.scrollBottom()
          ctx._fillEarlier()
        })
      } catch (_) { /* 忽略 */ }
    },
    // 新建会话
    async newConversation() {
      if (ctx.busy.value) return
      ctx.messages.value = []
      ctx.conversationId.value = null
      ctx.input.value = ''
      ctx.attachedFile.value = null
      ctx.hasEarlier.value = false
      ctx.earliestMsgId.value = null
    },
    // 删除会话
    deleteConversation(id) {
      ctx.confirmDeleteId.value = id
      ctx.confirmDeleteShow.value = true
    },
    async onDeleteConfirm() {
      const id = ctx.confirmDeleteId.value
      if (!id) return
      ctx.confirmDeleteShow.value = false
      ctx.confirmDeleteId.value = null
      try {
        await axios.delete(`/api/ai/conversations/${id}`)
        // 如果删除的是当前会话，切到空状态
        if (ctx.conversationId.value === id) {
          ctx.conversationId.value = null
          ctx.messages.value = []
        }
        await ctx.loadConversationList()
      } catch (_) { /* 忽略 */ }
    },
  }
}
