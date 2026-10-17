import axios from 'axios'
import { useNotification } from '../useNotification.js'
import { refreshUndoStatus } from '../useUndo.js'
import { useThemeStore } from '../../stores/theme.js'
import { EXEC, DOC_UNDO_KEY } from './aiConstants.js'

// 提案执行 + undo 登记 + 前端设置读写 相关的方法组（Options API mixin）。
// 方法体保留 this.xxx 写法。
export default {
  methods: {
    // 浮窗内点「确认执行」：找到当前待确认提案所属的消息并执行
    confirmProposal() {
      const m = this._lastAssistant()
      if (m && m.proposal) this.executeProposal(m)
    },
    // 取消写入：标记已取消，把「已取消」接着发起下一轮（写入思维链），让 AI 继续回应
    dismissProposal() {
      const m = this._lastAssistant()
      if (!m || !m.proposal || m.proposal.executing || m.proposal.executed || m.proposal.dismissed || this.busy) return
      m.proposal.dismissed = true
      this._sendFeedback(`已取消：${m.proposal.label}`, `已取消：${m.proposal.label}`, m)
    },
    // 把「用户反馈」写回原助手消息的思维链，并作为用户消息发给模型续跑（不新增用户输入气泡）
    // 续写目标即这条原助手消息：本轮输出继续写回它，时间轴保持连续
    _sendFeedback(content, stepText, sourceMsg) {
      const msg = sourceMsg || this._lastAssistant()
      const isAssistant = msg && msg.role === 'assistant'
      if (isAssistant) {
        if (!msg.steps) msg.steps = []
        msg.steps.push({ id: 'fb' + msg.steps.length + '_' + Date.now(), kind: 'text', text: stepText, status: 'done' })
        // 此刻提案/提问状态已被改写（已执行 / 已取消 / 已回答）：立即回写落库，
        // 避免续跑期间刷新时又还原成「待确认」，造成重复执行同一笔数据更改。
        if (msg._id != null) this.updateMessage(msg._id, msg.content || '', this._buildProc(msg))
      }
      this.input = content
      return this.send(true, stepText, isAssistant ? msg : null)
    },
    async executeProposal(m) {
      if (m.proposal.executing || m.proposal.executed) return
      const { success: notify, error: notifyError } = useNotification()
      m.proposal.executing = true
      m.proposal.executed = false
      let executedLabel = ''
      // 本次执行产生的撤销记录统一打上同一批次标识，供 AI 的 undo_change 工具整批回退
      const origin = 'ai-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      try {
        if (m.proposal.kind === 'front') {
          // 前端设置提案：读旧值 → 经主题 store 立即应用 → 记下前后值供撤销
          const p = m.proposal
          const store = useThemeStore()
          const before = this._readFrontSetting(p.key)
          this._setFrontSetting(store, p.key, p.value)
          const after = this._readFrontSetting(p.key)
          m.proposal.frontUndo = { key: p.key, before, after, label: p.label }
          m.proposal.executing = false
          m.proposal.executed = true
          notify(p.label + ' 已应用')
          executedLabel = p.label
        } else if (m.proposal.kind === 'json') {
          // 整块写入（课表/座位/权重/值日等「非行式」表）：按 id 覆盖指定列
          const p = m.proposal
          const res = await axios.post('/api/ai/doc', { table: p.table, id: p.id, values: p.values })
          const d = res.data || {}
          const uid = await this._pushUndo('doc_update', DOC_UNDO_KEY[p.table] || p.table, p.label, { table: p.table, id: p.id, before: d.before, after: d.after, label: p.label }, origin)
          m.proposal.undoIds = uid != null ? [uid] : []
          m.proposal.executing = false
          m.proposal.executed = true
          notify(p.label + ' 已执行')
          executedLabel = p.label
        } else if (m.proposal.kind === 'batch_ops' || (m.proposal.operation === 'update' && m.proposal.batch)) {
          // 跨表批量操作 / 单表批量修改：统一走后端单事务接口（全部成功或全部回滚）
          const p = m.proposal
          const ops = p.kind === 'batch_ops'
            ? (Array.isArray(p.ops) ? p.ops : [])
            : ((p.data && p.data.updates) || []).map((u) => ({ action: 'update', table: p.table, id: u.id, changes: u.changes }))
          const res = await axios.post('/api/ai/apply-batch', { ops })
          const results = (res.data && res.data.results) || []
          const undoIds = []
          for (const r of results) {
            const uid = await this._pushUndoForBatch(r, p.label, origin)
            if (uid != null) undoIds.push(uid)
          }
          m.proposal.undoIds = undoIds
          m.proposal.executing = false
          m.proposal.executed = true
          notify(`${p.label} 已执行（${results.length} 项）`)
          executedLabel = `${p.label}（${results.length} 项）`
        } else if (m.proposal.kind === 'snapshot_restore') {
          // 还原到整库快照：覆盖当前全部数据（不可撤销），须老师已确认
          const p = m.proposal
          await axios.post('/api/ai/snapshot/restore', { snapshot: p.snapshot })
          m.proposal.executing = false
          m.proposal.executed = true
          notify(p.label + ' 已还原（当前数据已回到该快照）')
          executedLabel = p.label
        } else {
        const end = EXEC[m.proposal.table]
        if (!end) throw new Error('该表暂不支持 AI 写入')
        const { operation, data } = m.proposal
        // 记录本次更改对应的撤销记录 id，供下方「撤回更改」精确回退
        const undoIds = []
        // 批量新增：逐行写入（任一行失败即中断，已写入的行保留）
        if (operation === 'add' && m.proposal.batch) {
          const rows = Array.isArray(data && data.rows) ? data.rows : []
          let ok = 0
          for (const r of rows) {
            const payload = this.cleanPayload(r)
            const res = await axios.post(end.url, payload)
            const added = { id: res.data?.id ?? res.data?.row?.id, ...payload }
            if (added.id != null) {
              const uid = await this._pushUndo('row_insert', end.undoKey, this._rowName(added), { table: end.undoKey, row: added }, origin)
              if (uid != null) undoIds.push(uid)
            }
            ok++
          }
          m.proposal.undoIds = undoIds
          m.proposal.executing = false
          m.proposal.executed = true
          notify(`${m.proposal.label} 已执行（${ok} 条）`)
          executedLabel = `${m.proposal.label}（${ok} 条）`
        } else if (operation === 'delete' && m.proposal.batch) {
          // 批量删除：逐条先取整条记录再删除，撤销时可整条恢复（任一条失败即中断）
          const ids = Array.isArray(data && data.ids) ? data.ids : []
          let ok = 0
          for (const id of ids) {
            const oldRow = await this._fetchRow(end.undoKey, id)
            await axios.delete(`${end.url}/${id}`)
            if (oldRow) {
              const uid = await this._pushUndo('row_delete', end.undoKey, this._rowName(oldRow), { table: end.undoKey, row: oldRow }, origin)
              if (uid != null) undoIds.push(uid)
            }
            ok++
          }
          m.proposal.undoIds = undoIds
          m.proposal.executing = false
          m.proposal.executed = true
          notify(`${m.proposal.label} 已执行（${ok} 条）`)
          executedLabel = `${m.proposal.label}（${ok} 条）`
        } else {
          if (operation === 'add') {
            const payload = this.cleanPayload(data)
            const res = await axios.post(end.url, payload)
            const added = { id: res.data?.id ?? res.data?.row?.id, ...payload }
            if (added.id != null) {
              const uid = await this._pushUndo('row_insert', end.undoKey, this._rowName(added), { table: end.undoKey, row: added }, origin)
              if (uid != null) undoIds.push(uid)
            }
          } else if (operation === 'update') {
            // 先取旧值，再写入，撤销时可还原到旧值
            const oldRow = await this._fetchRow(end.undoKey, data.id)
            await axios.put(`${end.url}/${data.id}`, this.cleanPayload(data.changes || {}))
            if (oldRow) {
              const newRow = { ...oldRow, ...(data.changes || {}) }
              const uid = await this._pushUndo('row_update', end.undoKey, this._rowName(newRow), { table: end.undoKey, rowId: data.id, oldRow, newRow }, origin)
              if (uid != null) undoIds.push(uid)
            }
          } else if (operation === 'delete') {
            // 先取整条记录，再删除，撤销时可整条恢复
            const oldRow = await this._fetchRow(end.undoKey, data.id)
            await axios.delete(`${end.url}/${data.id}`)
            if (oldRow) {
              const uid = await this._pushUndo('row_delete', end.undoKey, this._rowName(oldRow), { table: end.undoKey, row: oldRow }, origin)
              if (uid != null) undoIds.push(uid)
            }
          } else {
            throw new Error('未知操作')
          }
          m.proposal.undoIds = undoIds
          m.proposal.executing = false
          m.proposal.executed = true
          notify(m.proposal.label + ' 已执行')
          executedLabel = m.proposal.label
        }
        }
      } catch (err) {
        // 失败也把结果发回给 AI 继续处理：关闭浮窗、上报失败原因，不在此结束对话
        m.proposal.executing = false
        m.proposal.executed = false
        m.proposal.dismissed = true
        const msg = err.response?.data?.error || err.message || '未知错误'
        notifyError('执行失败：' + msg)
        await this._sendFeedback(
          `执行失败：${m.proposal.label}（原因：${msg}），请分析后告诉我怎么处理。`,
          `执行失败：${m.proposal.label}（原因：${msg}）`,
          m
        )
        return
      }
      // 无论成功或失败都接着发起下一轮：把结果写入思维链并作为用户消息发回，让 AI 继续，工具不结束对话
      await this._sendFeedback(`已执行：${executedLabel}`, `已执行：${executedLabel}`, m)
    },
    // 该回复的数据更改是否可撤回（提案已执行且尚未撤回）
    canUndoChange(m) {
      const p = m && m.proposal
      if (!p || !p.executed || p.reverted || p.reverting) return false
      // 前端设置提案：有 frontUndo 即可撤回；其余：需登记过撤销记录
      if (p.kind === 'front') return !!p.frontUndo
      return !!(p.undoIds && p.undoIds.length)
    },
    // 撤回这条回复已执行的数据更改：按登记的撤销记录逐条精确回退
    async undoChange(m) {
      if (!this.canUndoChange(m) || this.busy) return
      const p = m.proposal
      const { success: notify, error: notifyError } = useNotification()
      p.reverting = true
      try {
        if (p.kind === 'front' && p.frontUndo) {
          // 前端设置：直接把设置写回执行前的值（不经过 /api/undo）
          const store = useThemeStore()
          this._setFrontSetting(store, p.frontUndo.key, p.frontUndo.before)
          p.reverted = true
          notify(`已还原：${p.frontUndo.label || '设置'}`)
          if (m._id != null) this.updateMessage(m._id, m.content || '', this._buildProc(m))
          return
        }
        let label = ''
        // 逆序撤销，保证批量新增按相反顺序删除
        for (const id of p.undoIds.slice().reverse()) {
          const { data } = await axios.post(`/api/undo/${id}/undo`)
          if (!data || !data.ok) throw new Error((data && data.error) || '撤回失败')
          label = data.label || label
        }
        p.reverted = true
        notify(label ? `已撤回：${label}` : '已撤回更改')
        // 回写「已撤回」状态：避免刷新后按钮又还原成可撤回，导致对同一笔更改二次撤回
        if (m._id != null) this.updateMessage(m._id, m.content || '', this._buildProc(m))
      } catch (err) {
        notifyError('撤回失败：' + (err.response?.data?.error || err.message || '未知错误'))
      } finally {
        p.reverting = false
      }
    },
    // 读取一项前端设置的当前值（与 _setFrontSetting 的 value 类型一致）
    _readFrontSetting(key) {
      switch (key) {
        case 'theme': return localStorage.getItem('app-theme') || 'glass'
        case 'mode': return localStorage.getItem('app-mode') === 'night' ? 'night' : 'day'
        case 'iconStyle': return localStorage.getItem('app-icon-style') || 'color'
        case 'topbarColor': return localStorage.getItem('app-topbar-color') || 'light'
        case 'animations': return (localStorage.getItem('app-animations') ?? '1') !== '0'
        case 'bgMaskOpacity': return parseFloat(localStorage.getItem('app-bg-mask-opacity')) || 0.6
        case 'glassOpacity': return parseFloat(localStorage.getItem('app-glass-opacity')) || 0.4
        case 'mergeNotifications': return (localStorage.getItem('mergeNotifications') ?? '1') !== '0'
        default: return null
      }
    },
    // 经主题 store 应用一项前端设置（立即生效并写 localStorage；mergeNotifications 无 store，直接写 localStorage）
    _setFrontSetting(store, key, value) {
      switch (key) {
        case 'theme': store.setTheme(String(value)); break
        case 'mode': store.setMode(value === 'night' ? 'night' : 'day'); break
        case 'iconStyle': store.setIconStyle(String(value)); break
        case 'topbarColor': store.setTopbarColor(String(value)); break
        case 'animations': store.setAnimationsEnabled(!!value); break
        case 'bgMaskOpacity': store.setBgMaskOpacity(Number(value)); break
        case 'glassOpacity': store.setGlassOpacity(Number(value)); break
        case 'mergeNotifications': localStorage.setItem('mergeNotifications', value ? '1' : '0'); break
      }
    },
    // 登记一条撤销记录，返回其 id（撤回按钮据此精确回退这次更改）
    // origin：AI 提案执行时传入的批次标识（供 AI 的 undo_change 工具整批回退）；手动编辑不传
    async _pushUndo(type, key, label, payload, origin) {
      try {
        const { data } = await axios.post('/api/undo', { key, type, label, payload, origin })
        refreshUndoStatus(true)
        return data && data.id
      } catch (_) { return null }
    },
    // 批量事务返回的单项结果 → 登记一条撤销记录（供撤回按钮逐条回退）
    // r：{ action:'add'|'update'|'delete'|'doc', table, id, row, before, after }
    async _pushUndoForBatch(r, label, origin) {
      if (!r || !r.action) return null
      if (r.action === 'add') {
        return this._pushUndo('row_insert', r.table, this._rowName(r.row), { table: r.table, row: r.row }, origin)
      }
      if (r.action === 'update') {
        const row = r.after || r.before || {}
        return this._pushUndo('row_update', r.table, this._rowName(row), { table: r.table, rowId: r.id, oldRow: r.before, newRow: r.after }, origin)
      }
      if (r.action === 'delete') {
        return this._pushUndo('row_delete', r.table, this._rowName(r.row), { table: r.table, row: r.row }, origin)
      }
      if (r.action === 'doc') {
        return this._pushUndo('doc_update', DOC_UNDO_KEY[r.table] || r.table, label, { table: r.table, id: r.id, before: r.before, after: r.after, label }, origin)
      }
      return null
    },
    // 读取某条记录的完整字段（记录编辑/删除前的旧值，供撤回还原）
    async _fetchRow(table, id) {
      try {
        const { data } = await axios.get(`/api/ai/records/${table}?ids=${id}`)
        return (data && data.data && data.data.rows && data.data.rows[0]) || null
      } catch (_) { return null }
    },
    // 撤销记录展示用名称（与全局撤销保持一致的取名规则）
    _rowName(row) {
      if (!row) return ''
      return row.姓名 || row.group_name || row.主题 || row.名称 || row.name || (row.id != null ? `#${row.id}` : '')
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
  },
}
