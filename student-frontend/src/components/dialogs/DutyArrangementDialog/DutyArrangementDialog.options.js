// ===== 值日智能排表：拖拽交互（添加/删除/去重、开始排表、草稿与确认） =====
// 纯代码搬运自 DutyArrangementDialog.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。

export function useDutyArrangementOptions(OPTIONS) {
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
      const opt = this.findOption(e)
      if (!opt) { this.rejectOnce(); return }
      // 排表方式：随机/分组不再二选一，可同时存在，同 key 去重
      if (opt.type === 'method') {
        if (this.tree.some(n => n.key === opt.key)) {
          this.rejectText = '「' + opt.label + '」已存在'
          this.showReject()
          return
        }
        this.tree.push({ key: opt.key, label: opt.label, children: [], ...this.initExtra(opt) })
      } else {
        // 限制条件：允许独立拖放到顶部（也可挂到某方式下方），去重
        if (this.tree.some(n => n.key === opt.key)) {
          this.rejectText = '「' + opt.label + '」已存在'
          this.showReject()
          return
        }
        this.tree.push({ key: opt.key, label: opt.label, children: [], ...this.initExtra(opt) })
      }
      this.resetArranged()
    },
    onDropChild(e, node) {
      const opt = this.findOption(e)
      if (!opt) { return }
      if (opt.type !== 'constraint') {
        this.rejectText = '「' + opt.label + '」是排表方式，只能拖到顶部作为一级条件'
        this.showReject()
        return
      }
      if (node.children.some(c => c.key === opt.key)) {
        this.rejectText = '「' + opt.label + '」已存在于当前排表方式下'
        this.showReject()
        return
      }
      node.children.push({ key: opt.key, label: opt.label, ...this.initExtra(opt) })
      this.resetArranged()
    },
    findOption(e) {
      const key = e.dataTransfer.getData('text/plain')
      return OPTIONS.find(o => o.key === key)
    },
    initExtra(opt) {
      if (opt.key === 'group') return { option: this.selectedDimId }
      if (opt.key === 'relation') return { a: '', b: '' }
      if (opt.key === 'labor') return { student: '', action: 'do', item: '' }
      return {}
    },
    removeNode(ni) {
      this.tree.splice(ni, 1)
      this.resetArranged()
    },
    removeChild(ni, ci) {
      this.tree[ni]?.children.splice(ci, 1)
      this.resetArranged()
    },
    // 条件变更后回到「开始排表」，清空预览
    resetArranged() {
      this.arranged = false
      this.previewCells = {}
      this.previewVersion++
    },
    startArrange() {
      this.generatePreview()
      this.arranged = true
    },
    showReject() {
      clearTimeout(this._rejectTimer)
      this._rejectTimer = setTimeout(() => { this.rejectText = '' }, 2500)
    },
    rejectOnce() {
      this.rejectText = ''
    },
    confirm() {
      this.$emit('confirm', { cells: this.previewCells })
    },
    onSaveDraft() {
      // 保存条件树 + 当前预览结果；父组件负责调后端接口
      const conditions = this.tree.map(n => ({
        key: n.key, label: n.label, option: n.option,
        a: n.a, b: n.b, student: n.student, action: n.action, item: n.item,
        children: (n.children || []).map(c => ({
          key: c.key, label: c.label,
          a: c.a, b: c.b, student: c.student, action: c.action, item: c.item
        }))
      }))
      this.$emit('save-draft', { cells: this.previewCells, conditions })
    },
    onClearDraft() {
      this.$emit('clear-draft')
    }
  }
}
