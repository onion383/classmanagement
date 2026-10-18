import axios from 'axios'
import { useNotification } from '../useNotification.js'
import { useThemeStore } from '../../stores/theme.js'
import { ASK_OTHER_KEY, AI_PERMISSION_FULL } from './aiConstants.js'
import { apiFetch } from '../../utils/apiUrl.js'
import { encodeStreamRequest, decodeStreamEvent, clearSession, safe } from '../secureChannel.js'

// send / _streamReply / interrupt / retry / rollback / ask 相关的方法组（Options API mixin）。
// 方法体保留 this.xxx 写法。
export default {
  methods: {
    // 点选项：多选=勾选/取消，单选=选中（再点一下取消）；选中「其他」只展开输入框，等填写后再继续
    pickAsk(qi, option) {
      const a = this.pendingAsk
      const q = a && a.questions[qi]
      if (!q) return
      if (q.multiple) {
        const arr = Array.isArray(q.picked) ? q.picked.slice() : []
        const i = arr.indexOf(option)
        if (i >= 0) arr.splice(i, 1)
        else arr.push(option)
        q.picked = arr
        return // 多选需显式点「下一页 / 完成」才继续
      }
      q.picked = q.picked === option ? undefined : option
      q.skipped = false // 重新选择后取消「跳过」标记
      // 选中「其他」需先填写补充内容；取消选中时不自动继续
      if (option === ASK_OTHER_KEY || q.picked === undefined) return
      // 单选：即点即走（分页前进 / 单题直接提交）
      if (a.questions.length > 1 && this.askPage < a.questions.length - 1) this.askPage += 1
      else this.submitAsk()
    },
    // 跳过当前「单选未作答」的题：标记 skipped（避免阻塞后续提交），分页前进，末题/单题直接提交
    skipAsk() {
      const a = this.pendingAsk
      if (!a) return
      const q = this.askCurrent || a.questions[0]
      if (q) q.skipped = true
      if (a.questions.length > 1 && this.askPage < a.questions.length - 1) this.askPage += 1
      else this.submitAsk()
    },
    // 「其他」补充内容输入（单选 / 多选通用），随答案一并回传
    setAskOther(qi, text) {
      const a = this.pendingAsk
      const q = a && a.questions[qi]
      if (q) q.other = String(text || '').slice(0, 200)
    },
    // 单题作答是否已有效：无选项题（自由作答）/ 已跳过 视为可过；多选需至少勾 1 项；选中「其他」必须已填写
    isAskQuestionReady(q) {
      if (!q || !q.options.length) return true
      if (q.skipped) return true
      const arr = Array.isArray(q.picked) ? q.picked : (q.picked ? [q.picked] : [])
      if (!arr.length) return false
      if (arr.includes(ASK_OTHER_KEY) && !String(q.other || '').trim()) return false
      return true
    },
    // 单题答案文本（多选用「、」连接；「其他」拼上补充内容；跳过的单选记为「跳过」）
    askAnswerText(q) {
      const one = (v) => (v === ASK_OTHER_KEY
        ? (String(q.other || '').trim() ? `其他：${String(q.other).trim()}` : '其他')
        : v)
      const arr = Array.isArray(q.picked) ? q.picked : (q.picked ? [q.picked] : [])
      if (!arr.length) return q && q.skipped ? '跳过' : '（未选择）'
      return arr.map(one).join('、')
    },
    // 多问题分页：翻到下一题
    askNext() {
      const a = this.pendingAsk
      if (a && this.askPage < a.questions.length - 1) this.askPage += 1
    },
    // 汇总所有答案发送（单题只发答案本身；多题按「序号. 问题：答案」汇总）
    submitAsk() {
      const m = this._lastAssistant()
      if (!m || !m.ask || m.ask.answered || !this.askCanSubmit) return
      const qs = m.ask.questions || []
      m.ask.answered = true
      const text = qs.length > 1
        ? qs.map((x, i) => `${i + 1}. ${x.question}：${this.askAnswerText(x)}`).join('\n')
        : this.askAnswerText(qs[0])
      // 回答写入原助手消息的思维链，不再新增用户输入气泡
      this._sendFeedback(text, `用户回答：${text}`, m)
    },
    // 取消提问：标记已取消，并把「暂不回答」接着发起下一轮（写入思维链），避免对话停在原地
    dismissAsk() {
      const m = this._lastAssistant()
      if (!m || !m.ask || m.ask.answered || m.ask.dismissed || this.busy) return
      m.ask.dismissed = true
      this._sendFeedback('我暂不回答这个问题，请不要重复提问，按你的判断继续。', '用户暂不回答，继续处理', m)
    },
    // 复制这条回复的正文到剪贴板
    async copyMessage(m) {
      const text = m && m.content ? m.content : ''
      if (!text) return
      const { success: notify, error: notifyError } = useNotification()
      try {
        await navigator.clipboard.writeText(text)
        notify('已复制回复')
      } catch (_) {
        notifyError('复制失败')
      }
    },
    // 重试：丢弃这条回复（及其后并入它的隐藏反馈），用其上一条提问重新生成（同步删除落库旧消息，避免刷新后重复）
    async retryMessage(i) {
      if (!this.isRetryable(i)) return
      const dropped = this.messages.slice(i)
      const ids = dropped.map((m) => m._id).filter((v) => v != null)
      if (this.conversationId && ids.length) {
        try { await axios.post(`/api/ai/conversations/${this.conversationId}/messages/delete`, { ids }) } catch (_) { /* 删除失败不阻塞重试 */ }
      } else if (this.conversationId) {
        try { await axios.delete(`/api/ai/conversations/${this.conversationId}/messages/last-assistant`) } catch (_) { /* 删除失败不阻塞重试 */ }
      }
      this.messages.splice(i)
      this.messages.push({ role: 'assistant', loading: true, content: '', _live: true, steps: [], processOpen: true })
      await this._streamReply()
    },
    // 点「回退」按钮：先弹确认框（提示 AI 更改的数据可能会丢失），确认后再执行
    askRollback() {
      const i = this._lastAssistantIndex()
      if (i < 0 || !this.isRollbackable(i)) return
      this.rollbackConfirmShow = true
    },
    // 确认框点「确定」：关闭弹窗并执行回退
    onRollbackConfirm() {
      this.rollbackConfirmShow = false
      this.rollbackTurn()
    },
    // 回退到本轮提问前：还原本轮已执行的数据改动 → 移除本轮消息 → 把原提问放回输入框供编辑重发
    async rollbackTurn() {
      const li = this._lastAssistantIndex()
      if (li < 0 || !this.isRollbackable(li)) return
      const { success: notify, error: notifyError } = useNotification()
      // 本轮起点：从末尾往前找最近的「真实用户提问」（排除自动续跑消息）
      let start = this.messages.length - 1
      while (start >= 0 && !(this.messages[start].role === 'user' && !this._isAutoMessage(this.messages[start]))) start--
      if (start < 0) start = 0
      const turn = this.messages.slice(start)
      try {
        // 1) 还原本轮已执行且未撤回的数据改动（逆序，保证批量新增按相反顺序删除）
        for (const m of turn) {
          const p = m.proposal
          if (!p || !p.executed || p.reverted) continue
          if (p.kind === 'front' && p.frontUndo) {
            // 前端设置：写回执行前的值
            this._setFrontSetting(useThemeStore(), p.frontUndo.key, p.frontUndo.before)
            p.reverted = true
          } else if (p.undoIds && p.undoIds.length) {
            for (const id of p.undoIds.slice().reverse()) {
              const { data } = await axios.post(`/api/undo/${id}/undo`)
              if (!data || !data.ok) throw new Error((data && data.error) || '还原失败')
            }
            p.reverted = true
          }
        }
        // 2) 移除本轮消息：按落库 id 精确删除，再清出内存
        const ids = turn.map((m) => m._id).filter((v) => v != null)
        if (this.conversationId && ids.length) {
          try { await axios.post(`/api/ai/conversations/${this.conversationId}/messages/delete`, { ids }) } catch (_) { /* 删除失败不阻塞回退 */ }
        }
        this.messages.splice(start)
        // 3) 把本轮的用户提问放回输入框，供继续编辑后重新发送
        const userMsg = turn.find((m) => m.role === 'user')
        this.input = (userMsg && userMsg.content) || ''
        this.$nextTick(() => {
          this.scrollBottom()
          if (this.$refs.composer) this.$refs.composer.focusInput()
        })
        notify('已回退到本轮提问前')
        await this.loadConversationList()
      } catch (err) {
        notifyError('回退失败：' + (err.response?.data?.error || err.message || '未知错误'))
      }
    },
    // auto=true 时为「自动反馈」消息（回答提问 / 执行或取消提案）：落库标记 process.auto，界面不渲染气泡
    // target 为「续写目标」助手消息：本轮输出继续追加到它身上（时间轴保持连续，不再拆成多段）
    async send(auto, autoText, target) {
      const isAuto = auto === true
      const cont = target && target.role === 'assistant' ? target : null
      const text = this.input.trim()
      const file = this.attachedFile
      if (!text && !file) return
      if (this.busy) return
      this.input = ''
      this.attachedFile = null
      try {
        this.conversationId = await this.ensureConversation()
      } catch (_) { /* 建会话失败也继续（本轮消息不落库） */ }

      // 构建消息内容和图片列表
      let messageContent = text
      let images = []
      // 本轮附件（{name, text}）：随用户消息落库，之后每一轮都作为完整上下文的一部分
      // 保留，AI 需要时用 read_document 按需读取（内容不直接塞进消息）
      let attachments = []
      if (file) {
        if (file.isImage) {
          // 图片：走 vision API 多模态
          images = [file.dataUrl]
        } else if (file.textContent) {
          messageContent = `文件「${file.name}」${text ? '\n' + text : ''}`
          attachments = [{ name: file.name, text: file.textContent }]
        }
      }

      // 自动反馈消息：落库标记（process.auto + 展示用文案），刷新后据此并入原助手消息的思维链
      const proc = isAuto ? { auto: true, text: autoText || text } : undefined
      const uid = await this.persistMessage('user', messageContent, images, proc, attachments)
      this.messages.push({ role: 'user', content: messageContent, images, attachments, _id: uid, _auto: isAuto })

      if (cont) {
        // 续写同一助手消息：不新建气泡，记住续写起点（基础正文/已定步骤），本轮输出追加其后
        cont._live = true
        cont.loading = false
        cont.processDone = false
        cont.processOpen = true
        cont._blocks = null
        cont._liveSrc = null
        cont._liveHtml = ''
        cont._liveTail = ''
        // 基础正文（去掉尾部空白，避免多轮续写累积空行），本轮输出以空行分隔追加其后
        cont._baseContent = (cont.content || '').replace(/\s+$/, '')
        cont.content = cont._baseContent ? cont._baseContent + '\n\n' : ''
        cont._baseSteps = (cont.steps || []).length
        cont.reasoning = ''
        await this._streamReply(cont)
      } else {
        this.messages.push({ role: 'assistant', loading: true, content: '', _live: true, steps: [], processOpen: true })
        await this._streamReply()
      }
    },
    // 向 /api/ai/chat/stream 发起请求，把回复流式写入目标助手消息（发送 / 重试共用；不传则取最后一条助手）
    async _streamReply(target) {
      this.busy = true
      // 「中断」按钮通过它停止本次响应：abort 后 fetch 读取会抛 AbortError
      this.abortCtrl = new AbortController()
      const cont = target && target.role === 'assistant' ? target : null
      let last = cont || this.messages[this.messages.length - 1]
      this.scrollBottom()
      try {
        const history = this.messages
          // 过滤掉：加载占位、写提案消息（结果已随「已执行/已取消」消息续跑）、正文为空的助手消息（提问轮正文已移入过程块）
          .filter((m) => !m.loading && !m.proposal && !(m.role === 'assistant' && !m.content))
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
        // 附件已随用户消息落库，后端会按 conversationId 从库中重建「完整上下文」；
        // 这里仍随请求聚合一份附件，作为「会话未落库（无 conversationId）」时的回退。
        const attachments = []
        for (const m of this.messages) {
          if (m.role === 'user' && Array.isArray(m.attachments) && m.attachments.length) {
            for (const a of m.attachments) attachments.push({ name: a.name, text: a.text, messageId: m._id })
          }
        }
        // 安全通道开启时整体加密请求体；关闭时原样明文（后端中间件透明兼容）
        // 本轮由用户在输入框按「/」启用的技能（md 指令文件名）：后端读取内容注入系统提示
        const payload = { messages: history, attachments, conversationId: this.conversationId || 0, skills: this.selectedSkills || [], webSearch: this.webSearchOn !== false }
        const doSend = async () => apiFetch('/api/ai/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(await encodeStreamRequest(payload)),
          signal: this.abortCtrl.signal,
        })
        let resp = await doSend()
        // 加密会话被动过期（15 分钟）时后端返回 401：清会话、重新握手后重试一次（与 axios 层行为一致）
        if (resp.status === 401 && safe()) { clearSession(); resp = await doSend() }
        if (!resp.ok || !resp.body) throw new Error((resp.status === 400 && 'AI 未启用') || '请求失败')
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        if (!last) last = this.messages[this.messages.length - 1]
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
            // 逐帧解码：明文帧直接解析，密文帧（安全通道开启时）解密还原
            const evt = await decodeStreamEvent(line.slice(5).trim())
            if (!evt) continue
            if (evt.type === 'delta') {
              last.content += evt.text || ''
              // 每输出完一行就即时渲染该行的 markdown，未完成的行先按纯文本
              this._updateLiveRender(last)
              // 正文开始输出 → 收起处理过程（避免界面跳动）
              if (last.reasoningStreaming) { last.reasoningStreaming = false; last.processOpen = false }
              this.scrollBottom()
            } else if (evt.type === 'reasoning') {
              // 思维链增量：首次出现时自动展开过程块
              if (!last.reasoning) { last.reasoning = ''; last.reasoningStreaming = true }
              last.reasoning += evt.text || ''
              last.processOpen = true
              this.scrollBottom()
            } else if (evt.type === 'step') {
              // 思考（思维链）已作为时间轴步骤下发：清掉思维链 blob，避免与步骤重复展示
              if (evt.step.kind === 'reason') { last.reasoning = ''; last.reasoningStreaming = false }
              // 工具调用步骤：按 id 合并同一步（running → done/error）
              if (!last.steps) last.steps = []
              const si = last.steps.findIndex((s) => s.id === evt.step.id)
              if (si === -1) last.steps.push(evt.step)
              else last.steps.splice(si, 1, { ...last.steps[si], ...evt.step })
              last.processOpen = true
              this.scrollBottom()
            } else if (evt.type === 'commit_process') {
              // 中间轮的草稿文本归入过程块：从正文移出，作为一条过程文本步骤
              if (!last.steps) last.steps = []
              last.steps.push({ id: 'pt' + last.steps.length + '_' + Date.now(), kind: 'text', text: evt.text, status: 'done' })
              // 续写时保留基础正文，只清掉本轮的草稿正文
              last.content = last._baseContent ? last._baseContent + '\n\n' : ''
              last.processOpen = true
              this.scrollBottom()
            } else if (evt.type === 'proposal') {
              last.proposal = evt.proposal
            } else if (evt.type === 'ask') {
              last.ask = evt.ask
            } else if (evt.type === 'export_file') {
              // AI 导出的文件规格：流结束后再弹保存对话框，避免打断正在输出的正文
              last.exportFile = evt.exportFile
            } else if (evt.type === 'export_image') {
              // AI 导出的排布图规格：同样等流结束后渲染 PNG 并弹保存对话框
              last.exportImage = evt.exportImage
            } else if (evt.type === 'err') {
              last.content = (cont && last._baseContent ? last._baseContent + '\n\n' : '') + '⚠️ ' + (evt.message || '请求失败')
            } else if (evt.type === 'done') {
              last.reasoningStreaming = false
              last.processDone = true
              if (Array.isArray(evt.steps)) {
                // 续写时保留续写前已定的步骤，把本轮步骤追加其后（时间轴连续）
                const base = cont ? (last._baseSteps || 0) : 0
                last.steps = (last.steps || []).slice(0, base).concat(evt.steps)
              }
              last.processMs = evt.ms || 0
              last.tokens = evt.tokens || 0
              last.promptTokens = evt.promptTokens || 0
              last.completionTokens = evt.completionTokens || 0
              if (cont) {
                // 续写：把本轮正文追加到基础正文之后（reply 为最终轮正文，含 record 数据块）
                const round = evt.reply != null ? evt.reply : ''
                last.content = (last._baseContent ? last._baseContent + '\n\n' : '') + round
              } else if (!last.proposal) {
                // 以后端的 reply 为准：它是最终轮的正文，且包含 show_record 生成的 record 数据块
                last.content = evt.reply || last.content || ((last.ask || last.exportFile || last.exportImage) ? '' : '（无内容）')
              }
              // 提问轮不再把问题写进气泡正文：问题以「向你提问」步骤呈现在过程块，选项在浮窗里给出
              // 过程结束后自动收起；若没有任何过程内容，整块自行消失
              if ((last.steps && last.steps.length) || last.reasoning) last.processOpen = false
            }
          }
        }
        // AI 导出：流结束后弹出系统保存对话框生成并保存文件 / 排布图
        this.triggerPendingExport(last)
        this.triggerPendingImage(last)
        const proc = this._buildProc(last)
        // 正文为空但有过程块（写提案轮 / 提问轮）也落库，刷新后仍能看到步骤
        if (this.conversationId && (last.content || proc)) {
          // 续写：覆盖原助手消息（避免每轮新插入一行、刷新后又被拆成多段）
          if (cont && last._id) await this.updateMessage(last._id, last.content, proc)
          else last._id = await this.persistMessage('assistant', last.content, undefined, proc)
        }
        if (last.content === '' && !last.proposal && !last.ask && !last.exportFile && !last.exportImage) last.content = '⚠️ 未收到回复'
        // 后台预计算 markdown HTML（不阻塞 UI）
        this._computeHtml(last)
      } catch (err) {
        if (!last) last = this.messages[this.messages.length - 1]
        last.loading = false
        if (err && err.name === 'AbortError') {
          // 用户点了「中断」：保留已生成的部分正文并落库，不覆盖成报错
          last.interrupted = true
          if (!last.content && !last.proposal && !last.ask && !last.exportFile && !last.exportImage) last.content = '⏹ 已中断'
          const proc = this._buildProc(last)
          if (this.conversationId && (last.content || proc)) {
            if (cont && last._id) await this.updateMessage(last._id, last.content, proc)
            else last._id = await this.persistMessage('assistant', last.content, undefined, proc)
          }
          this._computeHtml(last)
        } else {
          last.content = (cont && last._baseContent ? last._baseContent + '\n\n' : '') + '⚠️ ' + (err.response?.data?.error || err.message || '请求失败')
        }
      } finally {
        this.abortCtrl = null
        this.busy = false
        if (last) { last.reasoningStreaming = false; last.processDone = true }
        this.scrollBottom()
        // 完全权限：写入提案不等用户确认，流一结束就自动执行。
        // 放在 busy 复位之后，执行的收尾才能沿用既有链路（写回思维链 + 让 AI 续跑说明结果）；
        // 用户主动中断的这一轮不自动执行，避免把没回复完的提案直接落库。
        // 例外：技能（md 指令文件）变更即使在全权限下也须老师确认，故不自动执行（走浮窗确认）。
        if (this.permissionMode === AI_PERMISSION_FULL
          && last && last.proposal && last.proposal.kind !== 'skill'
          && !last.proposal.executed && !last.proposal.dismissed && !last.interrupted) {
          this.executeProposal(last)
        }
        // 刷新会话列表（更新标题和消息数）
        await this.loadConversationList()
      }
    },
    // 中断当前回复：停止流式请求并保留已完成的部分，用户可继续输入、发送下一条
    interrupt() {
      if (!this.busy || !this.abortCtrl) return
      try { this.abortCtrl.abort() } catch (_) { /* 忽略 */ }
    },
    // 惰性创建会话：首次发送时才建
    async ensureConversation() {
      if (this.conversationId) return this.conversationId
      const { data } = await axios.post('/api/ai/conversations', {})
      this.conversationId = data.id
      return data.id
    },
    async persistMessage(role, content, images, process, attachments) {
      if (!this.conversationId) return
      // 多模态消息：存为 JSON 数组
      const payload = (images && images.length)
        ? JSON.stringify([
            { type: 'text', text: content || '' },
            ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ])
        : content
      const body = { role, content: payload }
      // 助手消息的过程块（步骤 / 思维链 / 耗时）一并落库，刷新后仍可查看
      if (process) body.process = process
      // 本轮上传的文件随消息落库，供后续轮次在完整上下文里读取
      if (Array.isArray(attachments) && attachments.length) body.attachments = attachments
      try {
        const { data } = await axios.post(`/api/ai/conversations/${this.conversationId}/messages`, body)
        // 返回落库 id，供回退功能精确删除本轮消息
        return (data && data.id) || undefined
      } catch (_) { /* 持久化失败不阻塞对话 */ }
    },
    // 覆盖更新一条已落库的消息（续写同一助手消息时用，避免每轮新插入一行）
    async updateMessage(mid, content, process) {
      if (!this.conversationId || mid == null) return
      const body = { content: content || '' }
      if (process) body.process = process
      try { await axios.put(`/api/ai/conversations/${this.conversationId}/messages/${mid}`, body) } catch (_) { /* 持久化失败不阻塞对话 */ }
    },
  },
}
