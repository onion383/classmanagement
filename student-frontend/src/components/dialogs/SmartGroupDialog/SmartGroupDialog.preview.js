// ===== 智能分组：生成预览 + 按钮 =====
// 纯代码搬运自 SmartGroupDialog.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
export function useSmartGroupPreview() {
  return {
    // ==================== 生成预览 ====================
    generatePreview() {
      if (this.groups.length === 0) { this.showReject('当前维度还没有小组，请先添加小组'); return }
      if (this.roster.length === 0) { this.showReject('班级学生列表为空，无法分组'); return }
      const result = this.buildAssignment()
      // 保证"换一换"每次结果与上次预览不同
      let final = result
      let guard = 0
      while (guard < 20 && this.lastResult && this.sameResult(final, this.lastResult)) {
        final = this.buildAssignment()
        guard++
      }
      this.lastResult = final
      this.previewGroups = this.toPreview(final)
      this.arranged = true
    },
    sameResult(a, b) {
      const sig = (members) => members.map(g => [...g].sort((x, y) => x - y).join(',')).join('|')
      return sig(a.members) === sig(b.members)
    },
    // 把当前已有的分组数据转成预览格式（尚未排表时作为初始预览）
    // 每组为一个成员姓名对象数组（与 toPreview 结构一致：组长排最前）
    buildGroupsPreview() {
      return (this.groups || []).map(g =>
        (g.members || [])
          .map(m => String(m.member_name || '').trim())
          .filter(n => n)
          .map(n => ({ 姓名: n }))
      )
    },
    // 转成预览：每组的【组长排最前】的学生对象数组
    toPreview(result) {
      const { members, leaders } = result
      return members.map((set, g) => {
        const arr = [...set].map(si => ({ si, obj: this.roster[si] }))
        const li = leaders[g]
        if (li != null) {
          const idx = arr.findIndex(x => x.si === li)
          if (idx > 0) arr.unshift(arr.splice(idx, 1)[0])
        }
        return arr.map(x => x.obj)
      })
    },

    // 最终输出：Array(G)，每组为排好序（组长在前）的学生姓名数组
    outputGroups(result) {
      const { members, leaders } = result
      return members.map((set, g) => {
        const arr = [...set].map(si => ({ si, name: this.roster[si].姓名 }))
        const li = leaders[g]
        if (li != null) {
          const idx = arr.findIndex(x => x.si === li)
          if (idx > 0) { arr.unshift(arr.splice(idx, 1)[0]) }
        }
        return arr.map(x => x.name)
      })
    },

    // ==================== 按钮 ====================
    startArrange() {
      // 首次排表且小组里有新同学时，先弹窗确认是否参与
      if (!this.arranged && this.strangers.length > 0) { this.showNewPrompt = true; return }
      this.generatePreview()
    },
    onParticipate() {
      this.showNewPrompt = false
      this.includeNew = true
      this.generatePreview()
    },
    onNot() {
      this.showNewPrompt = false
      this.includeNew = false
      this.generatePreview()
    },
    cancel() { this.$emit('cancel') },
    confirm() {
      if (!this.arranged) return this.showReject('请先点击「开始排表」生成分组结果')
      const result = this.lastResult
      if (!result) return this.showReject('尚未生成分组结果')
      this.$emit('confirm', { groups: this.outputGroups(result) })
    }
  }
}
