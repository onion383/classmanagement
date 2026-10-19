// ===== 智能分组：核心分组算法 =====
// 纯代码搬运自 SmartGroupDialog.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
// Fisher-Yates 洗牌
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function useSmartGroupPipeline() {
  return {
    // ==================== 流水线分组算法（核心） ====================
    // 把班级学生分配到 G 个小组；按 stages 顺序依次应用，后一条件可覆盖前一条件。
    // 返回 { members: Set[si] 每个组的学生下标, leaders: leaders[g]=学生下标|null,
    //         forcedLeaders: Set, notLeaders: Set }
    buildAssignment() {
      const roster = this.roster
      const G = this.groups.length
      this.satisfaction = {}
      const members = Array.from({ length: G }, () => new Set()) // 组 -> 学生下标集合
      const leaders = Array(G).fill(null)                          // 组 -> 组长学生下标
      const forcedLeaders = new Set()
      const notLeaders = new Set()

      // 初始：洗牌 + 均匀分配 (round-robin)
      const total = roster.length
      const target = Math.max(1, Math.ceil(total / G))
      const idxs = shuffle(roster.map((_, i) => i))
      idxs.forEach((si, i) => members[i % G].add(si))

      // 依次应用流水线条件
      for (const st of this.stages) {
        if (st.type === 'relation') this.applyRelation(st, roster, members, leaders, target, G)
        else if (st.type === 'identity') this.applyIdentity(st, roster, members, leaders, forcedLeaders, notLeaders)
        else if (st.type === 'gender') this.applyGender(st, roster, members, target, G)
      }

      // 收尾：保证指定组长的成立；补充每组一个组长
      for (const si of forcedLeaders) {
        const g = this.groupOf(members, si)
        if (g >= 0) leaders[g] = si
      }
      for (const si of notLeaders) {
        const g = this.groupOf(members, si)
        if (g >= 0 && leaders[g] === si) leaders[g] = null
      }
      for (let g = 0; g < G; g++) {
        if (members[g].size === 0 || leaders[g] !== null) continue
        for (const si of members[g]) {
          if (notLeaders.has(si)) continue
          leaders[g] = si
          break
        }
      }
      return { members, leaders, total, target }
    },

    groupOf(members, si) {
      for (let g = 0; g < members.length; g++) if (members[g].has(si)) return g
      return -1
    },
    moveBody(members, leaders, si, from, to) {
      members[from].delete(si)
      members[to].add(si)
      if (leaders[from] === si) leaders[from] = null
    },

    // 特殊关系：XXX 和 YYY 在一组 / 不在一组
    applyRelation(st, roster, members, leaders, target, G) {
      const a = st.a, b = st.b
      if (!a || !b) return
      const ia = roster.findIndex(s => String(s.id) === String(a))
      const ib = roster.findIndex(s => String(s.id) === String(b))
      if (ia < 0 || ib < 0 || ia === ib) return
      const ga = this.groupOf(members, ia)
      const gb = this.groupOf(members, ib)
      let ok = false
      if (st.kind === 'apart') {
        if (ga !== gb) {
          ok = true
        } else {
          // 把 b 移到另一个人数还够的小组
          for (let h = 0; h < G; h++) {
            if (h === ga || members[h].size >= target) continue
            this.moveBody(members, leaders, ib, gb, h)
            ok = true
            break
          }
        }
      } else { // together
        if (ga === gb) {
          ok = true
        } else {
          if (members[ga].size < target) { this.moveBody(members, leaders, ib, gb, ga); ok = true }
          else if (members[gb].size < target) { this.moveBody(members, leaders, ia, ga, gb); ok = true }
        }
      }
      this.trackSatisfaction(st.key, ok ? 1 : 0, 1)
    },

    // 指定身份：XXX 担任/不担任 组长
    applyIdentity(st, roster, members, leaders, forcedLeaders, notLeaders) {
      const id = st.studentId
      if (!id) return
      const si = roster.findIndex(s => String(s.id) === String(id))
      if (si < 0) return
      const g = this.groupOf(members, si)
      let ok = false
      if (st.kind === 'leader') {
        forcedLeaders.add(si)
        notLeaders.delete(si)
        if (g >= 0) {
          leaders[g] = si
          ok = true
        }
      } else { // not-leader
        notLeaders.add(si)
        forcedLeaders.delete(si)
        if (g >= 0 && leaders[g] === si) leaders[g] = null
        ok = true
      }
      this.trackSatisfaction(st.key, ok ? 1 : 0, 1)
    },

    // 性别比例：男女尽量均匀 / 全为男生或女生
    applyGender(st, roster, members, target, G) {
      const total = roster.length
      if (total === 0) return
      const isBoy = s => s.性别 === '男'
      const isGirl = s => s.性别 === '女'
      const boyIdx = [], girlIdx = [], otherIdx = []
      roster.forEach((s, i) => { if (isBoy(s)) boyIdx.push(i); else if (isGirl(s)) girlIdx.push(i); else otherIdx.push(i) })
      const totalBoy = boyIdx.length
      const totalGirl = girlIdx.length

      if (st.mode === 'single') {
        // 每组都放同一性别：男生组 + 女生组 按人数比例拆分
        let boyGroups = 0
        if (totalBoy > 0) {
          boyGroups = Math.max(1, Math.min(G - (totalGirl > 0 ? 1 : 0), Math.round(G * totalBoy / total)))
        }
        const boyGroupIdxs = Array.from({ length: boyGroups }, (_, i) => i)
        const girlGroupIdxs = Array.from({ length: G - boyGroups }, (_, i) => boyGroups + i)
        // 清空现有分配
        for (let g = 0; g < G; g++) members[g] = new Set()
        this.distributeInto(members, boyIdx, boyGroupIdxs, target)
        this.distributeInto(members, girlIdx.concat(otherIdx), girlGroupIdxs, target)
        // 满足率：男生进男生组、女生/其他进女生组
        let done = 0
        const inBoyGroups = new Set(boyGroupIdxs)
        for (const si of boyIdx) { const g = this.groupOf(members, si); if (inBoyGroups.has(g)) done++ }
        for (const si of girlIdx.concat(otherIdx)) { const g = this.groupOf(members, si); if (!inBoyGroups.has(g)) done++ }
        this.trackSatisfaction(st.key, done, total)
        return
      }

      // balanced：男女尽量均匀 —— 把多余的男生调到男生少、且人数不满的小组
      const desiredBoy = Math.round(totalBoy / G)
      const boysNow = Array(G).fill(0)
      boyIdx.forEach(si => boysNow[this.groupOf(members, si)]++)
      let guard = 0
      while (guard < 40) {
        guard++
        let moved = false
        for (let g = 0; g < G; g++) {
          if (boysNow[g] <= desiredBoy + 1) continue
          // 找一个男生少且未满的小组
          for (let h = 0; h < G; h++) {
            if (h === g || boysNow[h] >= desiredBoy || members[h].size >= target) continue
            const victim = [...members[g]].find(si => roster[si].性别 === '男')
            if (victim === undefined) break
            const fromG = this.groupOf(members, victim)
            this.moveBody(members, [], victim, fromG, h)
            boysNow[g]--; boysNow[h]++
            moved = true
            break
          }
          if (moved) break
        }
        if (!moved) break
      }
      // 满足率：落在 目标人数±1 小组里的男生数占比
      let done = 0
      for (const si of boyIdx) { const g = this.groupOf(members, si); if (Math.abs(boysNow[g] - desiredBoy) <= 1) done++ }
      this.trackSatisfaction(st.key, done, totalBoy || 1)
    },

    // 把一组学生均匀填入某些小组（循环放入，超过 target 则跳到下一组）
    distributeInto(members, studentIdxList, groupIdxs, target) {
      if (groupIdxs.length === 0) return
      let gi = 0
      for (const si of studentIdxList) {
        let guard = 0
        while (guard < groupIdxs.length && members[groupIdxs[gi % groupIdxs.length]].size >= target) { gi++; guard++ }
        if (guard >= groupIdxs.length) break // 无空位
        members[groupIdxs[gi % groupIdxs.length]].add(si)
        gi++
      }
    },
  }
}
