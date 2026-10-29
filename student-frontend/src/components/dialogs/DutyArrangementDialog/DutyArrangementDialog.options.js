// ===== 值日智能排表：拖拽交互（添加/删除/去重、开始排表、草稿与确认） =====
// 纯代码搬运自 DutyArrangementDialog.vue 的 methods，未改写逻辑；经 ctx 闭包调用（script setup）。
// ctx 契约：{ tree, previewCells, previewVersion, rejectText, arranged, selectedDimId, _rejectTimer,
//            emit, findOption... 等跨模块方法 }（状态为 ref，模块内用 .value）。

export function useDutyArrangementOptions(ctx, OPTIONS) {
  return {
    // ==================== 拖拽交互 ====================
    onOptionDragStart(e, opt) {
      e.dataTransfer.setData('text/plain', opt.key)
      e.dataTransfer.effectAllowed = 'copy'
    },
    onNodeDragStart(e, node) {
      e.dataTransfer.setData('text/plain', node.key)
      e.dataTransfer.effectAllowed = 'copy'
    },
    onDropTop(e) {
      const opt = ctx.findOption(e)
      if (!opt) { ctx.rejectOnce(); return }
      // 排表方式：随机/分组不再二选一，可同时存在，同 key 去重
      if (opt.type === 'method') {
        if (ctx.tree.value.some(n => n.key === opt.key)) {
          ctx.rejectText.value = '「' + opt.label + '」已存在'
          ctx.showReject()
          return
        }
        ctx.tree.value.push({ key: opt.key, label: opt.label, children: [], ...ctx.initExtra(opt) })
      } else {
        // 限制条件：允许独立拖放到顶部（也可挂到某方式下方），去重
        if (ctx.tree.value.some(n => n.key === opt.key)) {
          ctx.rejectText.value = '「' + opt.label + '」已存在'
          ctx.showReject()
          return
        }
        ctx.tree.value.push({ key: opt.key, label: opt.label, children: [], ...ctx.initExtra(opt) })
      }
      ctx.resetArranged()
    },
    onDropChild(e, node) {
      const opt = ctx.findOption(e)
      if (!opt) { return }
      if (opt.type !== 'constraint') {
        ctx.rejectText.value = '「' + opt.label + '」是排表方式，只能拖到顶部作为一级条件'
        ctx.showReject()
        return
      }
      if (node.children.some(c => c.key === opt.key)) {
        ctx.rejectText.value = '「' + opt.label + '」已存在于当前排表方式下'
        ctx.showReject()
        return
      }
      node.children.push({ key: opt.key, label: opt.label, ...ctx.initExtra(opt) })
      ctx.resetArranged()
    },
    findOption(e) {
      const key = e.dataTransfer.getData('text/plain')
      return OPTIONS.find(o => o.key === key)
    },
    initExtra(opt) {
      if (opt.key === 'group') return { option: ctx.selectedDimId.value }
      if (opt.key === 'relation') return { a: '', b: '' }
      if (opt.key === 'labor') return { student: '', action: 'do', item: '' }
      return {}
    },
    removeNode(ni) {
      ctx.tree.value.splice(ni, 1)
      ctx.resetArranged()
    },
    removeChild(ni, ci) {
      ctx.tree.value[ni]?.children.splice(ci, 1)
      ctx.resetArranged()
    },
    // 条件变更后回到「开始排表」，清空预览
    resetArranged() {
      ctx.arranged.value = false
      ctx.previewCells.value = {}
      ctx.previewVersion.value++
    },
    startArrange() {
      ctx.generatePreview()
      ctx.arranged.value = true
    },
    showReject() {
      clearTimeout(ctx._rejectTimer)
      ctx._rejectTimer = setTimeout(() => { ctx.rejectText.value = '' }, 2500)
    },
    rejectOnce() {
      ctx.rejectText.value = ''
    },
    confirm() {
      ctx.emit('confirm', { cells: ctx.previewCells.value })
    },
    onSaveDraft() {
      // 保存条件树 + 当前预览结果；父组件负责调后端接口
      const conditions = ctx.tree.value.map(n => ({
        key: n.key, label: n.label, option: n.option,
        a: n.a, b: n.b, student: n.student, action: n.action, item: n.item,
        children: (n.children || []).map(c => ({
          key: c.key, label: c.label,
          a: c.a, b: c.b, student: c.student, action: c.action, item: c.item
        }))
      }))
      ctx.emit('save-draft', { cells: ctx.previewCells.value, conditions })
    },
    onClearDraft() {
      ctx.emit('clear-draft')
    }
  }
}
