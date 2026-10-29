// ===== 值日智能排表：槽位模型 + 均衡轮转填充 + 流水线排表 + 权重公平分配 + 满足率 + 预览 =====
// 纯代码搬运自 DutyArrangementDialog.vue 的 methods，未改写逻辑；经 ctx 闭包调用（script setup）。
// ctx 契约：{ daysArr, itemsArr, studentNames, weights, ledger, tree, previewCells, previewVersion,
//            satisfaction, _groupMainDay, buildSlots... 等跨模块方法 }（状态为 ref，模块内用 .value）。

// Fisher-Yates 洗牌
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function useDutyArrangementPipeline(ctx, OPTIONS) {
  return {
    // ==================== 槽位模型 ====================
    // 值日槽位：{item, day, k}，按「天」外层排列，使同一天连续，便于均衡轮转同一天互不重复
    buildSlots() {
      const slots = []
      ctx.daysArr.value.forEach(day => {
        ctx.itemsArr.value.forEach(it => {
          const n = Math.max(1, Number(it.count) || 1)
          for (let k = 0; k < n; k++) slots.push({ item: it.name, day, k })
        })
      })
      return slots
    },
    // 由 assigned(下标→姓名) 还原 cells：{项目:{星期:[姓名,...]}}
    buildCells(slots, assigned) {
      const cells = {}
      ctx.itemsArr.value.forEach(it => { cells[it.name] = {}; ctx.daysArr.value.forEach(d => { cells[it.name][d] = [] }) })
      slots.forEach((s, i) => {
        const name = assigned[i]
        if (name && typeof name === 'string' && name.trim()) cells[s.item][s.day].push(name)
      })
      // 对齐每个项目每天人数 = count
      ctx.itemsArr.value.forEach(it => {
        const n = Math.max(1, Number(it.count) || 1)
        ctx.daysArr.value.forEach(d => {
          const arr = cells[it.name][d]
          while (arr.length < n) arr.push('')
        })
      })
      return cells
    },
    findSlots(slots, assigned, name) {
      const out = []
      for (let i = 0; i < slots.length; i++) if (assigned[i] === name) out.push(i)
      return out
    },

    // ==================== 均衡轮转填充 ====================
    // 把 names 循环填入所有槽位（尽量均衡；同一天连续槽位互不重复）
    roundRobinFill(slots, names) {
      const assigned = new Array(slots.length).fill('')
      names = [...names]
      for (let i = 0; i < slots.length; i++) assigned[i] = names[i % names.length]
      return assigned
    },
    // 分组填充：每组分配到「主天」，同组成员尽量同一天；空余用全体均衡补充
    groupFill(slots, buckets) {
      const names = ctx.studentNames.value
      const allMembers = buckets.flat().filter(Boolean)
      const others = names.filter(n => !allMembers.includes(n))
      const dayList = ctx.daysArr.value
      // 组 → 主天（循环分配，保证尽量分布在天上）
      const pool = {}
      buckets.forEach((g, gi) => {
        const d = dayList[gi % dayList.length]
        ;(pool[d] = pool[d] || []).push(...shuffle(g))
        // 记录主天统计（用于符合度）
        const key = 'g' + gi
        ctx._groupMainDay = ctx._groupMainDay || {}
        ctx._groupMainDay[key] = d
      })
      // 每 slot 归到其天
      const byDay = {}
      slots.forEach((s, i) => { (byDay[s.day] = byDay[s.day] || []).push(i) })
      Object.keys(byDay).forEach(d => {
        const need = byDay[d].length
        const have = (pool[d] || []).length
        if (have < need) {
          const source = others.length ? others.concat(allMembers) : names
          for (let i = have; i < need; i++) pool[d].push(source[i % source.length])
        }
      })
      const assigned = new Array(slots.length).fill('')
      Object.keys(byDay).forEach(d => {
        const arr = (pool[d] || [])
        byDay[d].forEach((si, idx) => { assigned[si] = arr[idx] || '' })
      })
      return assigned
    },

    // ==================== 流水线排表 ====================
    isMethod(n) {
      return OPTIONS.find(o => o.key === n.key)?.type === 'method'
    },
    // 先序处理：随机/分组/权重公平可并存，主填充优先级：公平 > 分组 > 随机
    buildAssignment() {
      ctx.satisfaction.value = {}
      const slots = ctx.buildSlots()
      if (!slots.length) { ctx.previewCells.value = {}; return }
      // 方式节点：多个方式可同时存在，取最高优先级的作主策略
      const methods = ctx.tree.value.filter(n => ctx.isMethod(n))
      const group = methods.find(n => n.key === 'group')
      const fair = methods.find(n => n.key === 'fair')
      let assigned
      if (fair && ctx.hasWeightData()) {
        assigned = ctx.fairFill(slots)
      } else if (group && ctx.groupBuckets().length) {
        ctx._groupMainDay = {}
        assigned = ctx.groupFill(slots, ctx.groupBuckets())
      } else {
        assigned = ctx.roundRobinFill(slots, shuffle(ctx.studentNames.value))
        ctx.trackSatisfaction('random', ctx.studentNames.value.length, ctx.studentNames.value.length)
      }
      // 收集全部约束：各方式子级 + 独立拖放顶部的限制条件，逐个应用
      const constraints = methods.flatMap(n => n.children || [])
        .concat(ctx.tree.value.filter(n => !ctx.isMethod(n)))
      for (const c of constraints) {
        if (c.key === 'relation') assigned = ctx.applyRelation(slots, assigned, c)
        else if (c.key === 'labor') assigned = ctx.applyLabor(slots, assigned, c)
      }
      return { slots, assigned }
    },
    // 是否具备可用的权重数据（每个槽位都能取到权重值）
    hasWeightData() {
      const w = ctx.weights.value || {}
      return ctx.itemsArr.value.every(it => w[it.name] && typeof w[it.name] === 'object')
    },

    // 分组符合度：组内成员落在「其组主天」人数的占比（由 computeGroupSatisfaction 依据实际排表结果计算）

    // 特殊关系：A、B 不在同一天值日。冲突时把 B 的一个槽位移到别的天
    applyRelation(slots, assigned, node) {
      assigned = [...assigned]
      if (!node.a || !node.b || node.a === node.b) return assigned
      const ia = ctx.findSlots(slots, assigned, node.a)
      const ib = ctx.findSlots(slots, assigned, node.b)
      const daysA = new Set(ia.map(i => slots[i].day))
      let conflict = false
      for (const i of ib) if (daysA.has(slots[i].day)) { conflict = true; break }
      let ok = !conflict
      if (conflict) {
        // 找一个不同天的空槽位给 b 的第一个冲突槽位
        const targetDay = ctx.daysArr.value.find(d => !daysA.has(d))
        for (let i = 0; i < ib.length && !ok; i++) {
          const idx = ib[i]
          if (!daysA.has(slots[idx].day)) continue
          if (targetDay == null) break
          // 在该目标天找一个空槽位
          const empty = slots.findIndex((s, j) => s.day === targetDay && !assigned[j])
          if (empty >= 0) {
            assigned[empty] = assigned[idx]
            assigned[idx] = ''
            ok = true
            break
          }
        }
      }
      ctx.trackSatisfaction('relation:' + node.a + '-' + node.b, ok ? 1 : 0, 1)
      return assigned
    },

    // 特殊劳动：A 一定做 / 不做某劳动项目
    applyLabor(slots, assigned, node) {
      assigned = [...assigned]
      if (!node.student || !node.item) return assigned
      const a = node.student
      const want = node.action === 'do' // true=一定做，false=不做
      const aSlots = ctx.findSlots(slots, assigned, a)
      const inItem = aSlots.filter(i => slots[i].item === node.item)
      let ok
      if (want) {
        ok = inItem.length > 0
        if (!ok) {
          // 找到该项目空槽位放 A；否则把 A 一个非该项目槽位与该项目的某槽位交换
          const empty = slots.findIndex((s, i) => s.item === node.item && !assigned[i])
          if (empty >= 0) {
            if (aSlots.length) { assigned[empty] = a; assigned[aSlots[0]] = '' }
            else assigned[empty] = a
            ok = true
          } else {
            const otherItemSlot = aSlots.find(i => slots[i].item !== node.item)
            const tgtItem = slots.findIndex((s, i2) => s.item === node.item && i2 !== aSlots[0])
            if (otherItemSlot != null && tgtItem >= 0) {
              const tmp = assigned[tgtItem]; assigned[tgtItem] = a; assigned[otherItemSlot] = tmp
              ok = true
            }
          }
        }
      } else {
        ok = inItem.length === 0
        if (!ok) {
          // 把 A 移出该项目：移到任意空位，否则清空（保证不占用该劳动）
          for (const idx of inItem) {
            const empty = slots.findIndex((s, i) => s.item !== node.item && !assigned[i])
            if (empty >= 0) { assigned[empty] = a; assigned[idx] = '' }
            else { assigned[idx] = '' }
          }
          if (ctx.findSlots(slots, assigned, a).length === 0) ok = true
        }
      }
      ctx.trackSatisfaction('labor:' + a + ':' + node.item, ok ? 1 : 0, 1)
      return assigned
    },

    // ==================== 权重公平分配 ====================
    // 把槽位按权重升序排列、学生按累计权重（账本）降序排列，配对分配——
    // 权重低的槽位给累计多的人，权重高的槽位给累计少的人，使长期趋于公平。
    fairFill(slots) {
      const w = ctx.weights.value || {}
      const led = ctx.ledger.value || {}
      // 学生名单 + 账本值（没记录的按 0 计），按账本降序
      const students = ctx.studentNames.value.map(name => ({ name, led: led[name] || 0 }))
      students.sort((a, b) => b.led - a.led)
      // 槽位按权重升序（权重相同保持原顺序）
      const slotOrder = slots.map((s, i) => ({ i, w: w[s.item]?.[s.day] ?? 0.5 }))
      slotOrder.sort((a, b) => a.w - b.w)
      const assigned = new Array(slots.length).fill('')
      // 多对多：若学生数 < 槽位数，循环使用（仍按账本降序轮询）；反之多余学生不上表
      // 名单为空时 students.length === 0，i % 0 = NaN，students[NaN] 为 undefined，
      // 取 .name 会直接抛 TypeError。空名单应返回「全部留空」，由调用方提示未选学生。
      if (students.length === 0) {
        ctx.trackSatisfaction('fair', 0, 0)
        return new Array(slots.length).fill('')
      }
      for (let i = 0; i < slotOrder.length; i++) {
        assigned[slotOrder[i].i] = students[i % students.length].name
      }
      ctx.trackSatisfaction('fair', slots.length, slots.length)
      return assigned
    },

    // ==================== 满足率 ====================
    trackSatisfaction(key, done, total) {
      if (!ctx.satisfaction.value[key]) ctx.satisfaction.value[key] = { done: 0, total: 0 }
      ctx.satisfaction.value[key].done += done
      ctx.satisfaction.value[key].total += total
    },
    satisfactionKey(node) {
      if (node.key === 'relation') return 'relation:' + node.a + '-' + node.b
      if (node.key === 'labor') return 'labor:' + node.student + ':' + node.item
      return node.key
    },
    satisfactionOf(node) {
      const key = ctx.satisfactionKey(node)
      if (!key || !ctx.satisfaction.value[key]) return null
      const { done, total } = ctx.satisfaction.value[key]
      return total ? Math.round((done / total) * 100) : 0
    },

    // ==================== 预览 ====================
    generatePreview() {
      let result = ctx.buildAssignment()
      if (!result || !result.assigned.length) return
      ctx.previewCells.value = ctx.buildCells(result.slots, result.assigned)
      ctx.previewVersion.value++
      // 分组符合度：补算（需用排表结果）
      ctx.computeGroupSatisfaction()
    },
    computeGroupSatisfaction() {
      if (!ctx._groupMainDay) return
      const buckets = ctx.groupBuckets()
      let done = 0, total = 0
      // 每位学生所在天 = 其在 previewCells 中出现的 day 集合的主天
      buckets.forEach((g, gi) => {
        const main = ctx._groupMainDay['g' + gi]
        if (!main || !g.length) return
        g.forEach(name => {
          total++
          const days = new Set()
          for (const it of Object.keys(ctx.previewCells.value))
            for (const day of Object.keys(ctx.previewCells.value[it]))
              if (ctx.previewCells.value[it][day].includes(name)) days.add(day)
          if (days.has(main)) done++
        })
      })
      if (total) { ctx.satisfaction.value.group = { done, total } }
    },

    buildPreviewRows(cells) {
      const rows = []
      const days = ctx.daysArr.value
      ctx.itemsArr.value.forEach(it => {
        const n = Math.max(1, Number(it.count) || 1)
        for (let k = 0; k < n; k++) {
          rows.push({
            _rowKey: `it_${it.name}_${k}`,
            label: it.name,
            _isReadonly: true,
            _rowHeaderRowSpan: k === 0 ? n : 0,
            cells: days.map(day => ({ course: cells[it.name]?.[day]?.[k] || '' }))
          })
        }
      })
      return rows
    },
  }
}
