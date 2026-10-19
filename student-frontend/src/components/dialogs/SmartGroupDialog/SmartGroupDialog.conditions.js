// ===== 智能分组：流水线条件操作 + 拖拽交互 =====
// 纯代码搬运自 SmartGroupDialog.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
// nextKey 由主组件以参数传入，避免循环依赖。
export function useSmartGroupConditions(nextKey) {
  return {
    // ==================== 流水线条件操作 ====================
    addStage(type) {
      const s = { key: nextKey() }
      if (type === 'relation') Object.assign(s, { type: 'relation', kind: 'together', a: '', b: '' })
      else if (type === 'identity') Object.assign(s, { type: 'identity', kind: 'leader', studentId: '' })
      else Object.assign(s, { type: 'gender', mode: 'balanced' })
      this.stages.push(s)
    },
    removeStage(si) {
      this.stages.splice(si, 1)
    },

    // ==================== 拖拽交互（拖入添加 / 拖动手柄调序） ====================
    // 从下方选项区拖入：记录待添加的条件类型
    onChipDragStart(e, type) {
      this._pendingType = type
      this._dragIdx = null
      e.dataTransfer.setData('text/plain', 'chip')
      e.dataTransfer.effectAllowed = 'copy'
    },
    // 拖动已有条件的手柄：记录来源下标
    onStageDragStart(si, e) {
      this._dragIdx = si
      this._pendingType = null
      e.dataTransfer.setData('text/plain', 'stage')
      e.dataTransfer.effectAllowed = 'move'
    },
    // 悬停某行时计算插入位置（上半 → 之前，下半 → 之后）
    rowDragover(si, e) {
      e.preventDefault()
      e.stopPropagation()
      const rect = e.currentTarget.getBoundingClientRect()
      const next = e.clientY < rect.top + rect.height / 2 ? si : si + 1
      // 值未变化时不写响应式状态，避免拖拽过程中每帧触发整个条件列表重渲染
      if (this._overIdx !== next) this._overIdx = next
    },
    // 松开到条件区：处理拖入新条件 / 拖动手柄调序
    boxDrop(e) {
      e.preventDefault()
      if (this._dragIdx != null) {
        // 已有条件调序
        const from = this._dragIdx
        let to = this._overIdx
        if (to == null) to = this.stages.length
        const [moved] = this.stages.splice(from, 1)
        let insert = to
        if (from < to) insert = to - 1
        this.stages.splice(insert, 0, moved)
      } else if (this._pendingType) {
        // 从选项区拖入新条件（追加到末尾）
        this.addStage(this._pendingType)
      }
      this._dragIdx = null
      this._overIdx = null
      this._pendingType = null
    },
    satisfactionOf(st) {
      const key = st.key
      if (!this.satisfaction[key]) return null
      const { done, total } = this.satisfaction[key]
      return total ? Math.round((done / total) * 100) : 0
    },
    trackSatisfaction(key, done, total) {
      if (!this.satisfaction[key]) this.satisfaction[key] = { done: 0, total: 0 }
      this.satisfaction[key].done += done
      this.satisfaction[key].total += total
    },
    showReject(text) {
      this.rejectText = text
      clearTimeout(this._rejectTimer)
      this._rejectTimer = setTimeout(() => { this.rejectText = '' }, 2500)
    },
  }
}
