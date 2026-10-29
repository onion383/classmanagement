// ===== 智能分组：生成预览 + 按钮 =====
// 纯代码搬运自 SmartGroupDialog.vue 的 methods，未改写逻辑；经 ctx 闭包调用（script setup）。
// ctx 契约：{ groups, roster, strangers, arranged, satisfaction 等状态 ref、
//            buildAssignment/showReject/sameResult 等跨模块方法、emit }。
export function useSmartGroupPreview(ctx) {
  return {
    // ==================== 生成预览 ====================
    generatePreview() {
      if (ctx.groups.value.length === 0) { ctx.showReject('当前维度还没有小组，请先添加小组'); return }
      if (ctx.roster.value.length === 0) { ctx.showReject('班级学生列表为空，无法分组'); return }
      const result = ctx.buildAssignment()
      // 保证"换一换"每次结果与上次预览不同
      let final = result
      let guard = 0
      while (guard < 20 && ctx.lastResult.value && sameResult(final, ctx.lastResult.value)) {
        final = ctx.buildAssignment()
        guard++
      }
      ctx.lastResult.value = final
      ctx.previewGroups.value = toPreview(ctx, final)
      ctx.arranged.value = true
    },
    // 把当前已有的分组数据转成预览格式（尚未排表时作为初始预览）
    // 每组为一个成员姓名对象数组（与 toPreview 结构一致：组长排最前）
    buildGroupsPreview() {
      return (ctx.groups.value || []).map(g =>
        (g.members || [])
          .map(m => String(m.member_name || '').trim())
          .filter(n => n)
          .map(n => ({ 姓名: n }))
      )
    },

    // ==================== 按钮 ====================
    startArrange() {
      // 首次排表且小组里有新同学时，先弹窗确认是否参与
      if (!ctx.arranged.value && ctx.strangers.value.length > 0) { ctx.showNewPrompt.value = true; return }
      ctx.generatePreview()
    },
    onParticipate() {
      ctx.showNewPrompt.value = false
      ctx.includeNew.value = true
      ctx.generatePreview()
    },
    onNot() {
      ctx.showNewPrompt.value = false
      ctx.includeNew.value = false
      ctx.generatePreview()
    },
    cancel() { ctx.emit('cancel') },
    confirm() {
      if (!ctx.arranged.value) return ctx.showReject('请先点击「开始排表」生成分组结果')
      const result = ctx.lastResult.value
      if (!result) return ctx.showReject('尚未生成分组结果')
      ctx.emit('confirm', { groups: outputGroups(ctx, result) })
    }
  }
}

// —— 以下为纯逻辑辅助 ——
function sameResult(a, b) {
  const sig = (members) => members.map(g => [...g].sort((x, y) => x - y).join(',')).join('|')
  return sig(a.members) === sig(b.members)
}
// 转成预览：每组的【组长排最前】的学生对象数组
function toPreview(ctx, result) {
  const { members, leaders } = result
  return members.map((set, g) => {
    const arr = [...set].map(si => ({ si, obj: ctx.roster.value[si] }))
    const li = leaders[g]
    if (li != null) {
      const idx = arr.findIndex(x => x.si === li)
      if (idx > 0) arr.unshift(arr.splice(idx, 1)[0])
    }
    return arr.map(x => x.obj)
  })
}
// 最终输出：Array(G)，每组为排好序（组长在前）的学生姓名数组
function outputGroups(ctx, result) {
  const { members, leaders } = result
  return members.map((set, g) => {
    const arr = [...set].map(si => ({ si, name: ctx.roster.value[si].姓名 }))
    const li = leaders[g]
    if (li != null) {
      const idx = arr.findIndex(x => x.si === li)
      if (idx > 0) { arr.unshift(arr.splice(idx, 1)[0]) }
    }
    return arr.map(x => x.name)
  })
}
