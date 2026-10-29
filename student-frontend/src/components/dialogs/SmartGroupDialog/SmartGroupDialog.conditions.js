// ===== 智能分组：流水线条件操作 + 拖拽交互 =====
// 纯代码搬运自 SmartGroupDialog.vue 的 methods，未改写逻辑；经 ctx 闭包调用（script setup）。
// ctx 契约：{ stages, satisfaction, rejectText, _dragIdx, _overIdx, _pendingType, _rejectTimer, addStage }
// （状态为 ref，模块内用 .value；临时字段与跨模块方法直接挂在 ctx 上）。
// nextKey 由主组件以参数传入，避免循环依赖。
export function useSmartGroupConditions(ctx, nextKey) {
  return {
    // ==================== 流水线条件操作 ====================
    addStage(type) {
      const s = { key: nextKey() }
      if (type === 'relation') Object.assign(s, { type: 'relation', kind: 'together', a: '', b: '' })
      else if (type === 'identity') Object.assign(s, { type: 'identity', kind: 'leader', studentId: '' })
      else Object.assign(s, { type: 'gender', mode: 'balanced' })
      ctx.stages.value.push(s)
    },
    removeStage(si) {
      ctx.stages.value.splice(si, 1)
    },

    // ==================== 拖拽交互（拖入添加 / 拖动手柄调序） ====================
    // 从下方选项区拖入：记录待添加的条件类型
    onChipDragStart(e, type) {
      ctx._pendingType = type
      ctx._dragIdx = null
      e.dataTransfer.setData('text/plain', 'chip')
      e.dataTransfer.effectAllowed = 'copy'
    },
    // 拖动已有条件的手柄：记录来源下标
    onStageDragStart(si, e) {
      ctx._dragIdx = si
      ctx._pendingType = null
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
      if (ctx._overIdx !== next) ctx._overIdx = next
    },
    // 松开到条件区：处理拖入新条件 / 拖动手柄调序
    boxDrop(e) {
      e.preventDefault()
      if (ctx._dragIdx != null) {
        // 已有条件调序
        const from = ctx._dragIdx
        let to = ctx._overIdx
        if (to == null) to = ctx.stages.value.length
        const [moved] = ctx.stages.value.splice(from, 1)
        let insert = to
        if (from < to) insert = to - 1
        ctx.stages.value.splice(insert, 0, moved)
      } else if (ctx._pendingType) {
        // 从选项区拖入新条件（追加到末尾）
        ctx.addStage(ctx._pendingType)
      }
      ctx._dragIdx = null
      ctx._overIdx = null
      ctx._pendingType = null
    },
    satisfactionOf(st) {
      const key = st.key
      if (!ctx.satisfaction.value[key]) return null
      const { done, total } = ctx.satisfaction.value[key]
      return total ? Math.round((done / total) * 100) : 0
    },
    trackSatisfaction(key, done, total) {
      if (!ctx.satisfaction.value[key]) ctx.satisfaction.value[key] = { done: 0, total: 0 }
      ctx.satisfaction.value[key].done += done
      ctx.satisfaction.value[key].total += total
    },
    showReject(text) {
      ctx.rejectText.value = text
      clearTimeout(ctx._rejectTimer)
      ctx._rejectTimer = setTimeout(() => { ctx.rejectText.value = '' }, 2500)
    },
  }
}
