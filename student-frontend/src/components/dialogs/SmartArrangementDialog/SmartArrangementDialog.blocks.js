// ===== 智能排表：组块置换 + 位置公平 =====
// 纯代码搬运自 SmartArrangementDialog.vue 的 methods，未改写逻辑。
import { shuffle } from './SmartArrangementDialog.pipeline.js'
export function useSmartArrangementBlocks() {
  return {
    // ==================== 组块置换工具 ====================
    // 按置换把组块内容整块搬到目标位置（块内成员不拆分；只写回这些区块，区域外不受影响）
    applyPerm(grid, blocks, perm) {
      const contents = blocks.map(b => b.pos.map(p => grid[p.r][p.c]))
      const writes = []
      blocks.forEach((b, i) => {
        const src = contents[perm[i]] || []
        b.pos.forEach((p, k) => { writes.push([p, src[k] ?? null]) })
      })
      for (const [p, v] of writes) grid[p.r][p.c] = v
    },
    // 同大小组块之间随机置换（避免大小不同的区块互相搬运导致学生丢失）
    permWithinSizes(blocks) {
      const sizes = blocks.map(b => b.pos.length)
      const bySize = new Map()
      blocks.forEach((b, i) => {
        const k = sizes[i]
        if (!bySize.has(k)) bySize.set(k, [])
        bySize.get(k).push(i)
      })
      const perm = new Array(blocks.length)
      for (const [, idxs] of bySize) {
        const sh = shuffle(idxs)
        idxs.forEach((orig, k) => { perm[orig] = sh[k] })
      }
      return perm
    },
    // 分组方式置换：随机 → 同大小随机；Z字形 / 上下交换形 → 在块阵列内按路径置换
    buildGroupPerm(blocks, swapType) {
      const n = blocks.length
      if (swapType !== 'updown' && swapType !== 'z') return this.permWithinSizes(blocks)
      const brs = blocks.map(b => b.br), bcs = blocks.map(b => b.bc)
      const minBr = Math.min(...brs), minBc = Math.min(...bcs)
      const rows = Math.max(...brs) - minBr + 1
      const cols = Math.max(...bcs) - minBc + 1
      const indexOf = new Array(rows * cols).fill(-1)
      blocks.forEach((b, i) => { indexOf[(b.br - minBr) * cols + (b.bc - minBc)] = i })
      const perm = new Array(n).fill(-1)
      if (swapType === 'updown') {
        blocks.forEach((b, i) => {
          const lr = rows - 1 - (b.br - minBr)
          const lc = b.bc - minBc
          const j = indexOf[lr * cols + lc]
          perm[i] = j >= 0 ? j : i
        })
      } else {
        // Z字形路径：逐列蛇形（偶数列自上而下，奇数列自下而上），沿路径整体前移一位
        const path = []
        for (let lc = 0; lc < cols; lc++) {
          for (let lb = 0; lb < rows; lb++) {
            const lr = lc % 2 === 0 ? lb : rows - 1 - lb
            const j = indexOf[lr * cols + lc]
            if (j >= 0) path.push(j)
          }
        }
        for (let i = 0; i < path.length; i++) perm[path[i]] = path[(i - 1 + path.length) % path.length]
      }
      for (let i = 0; i < n; i++) if (perm[i] < 0) perm[i] = i
      return perm
    },
    // 分组选项：在「作用域」内按「单位」切块，再按「分组方式」整块换位（成员不跨块、不丢学生）
    applyGroupAction(grid, regions, node) {
      const swapType = node.swapType || 'random'
      const unit = node.unit || 'six'
      let total = 0
      for (const region of regions) {
        const blocks = this.splitRegion(region, unit)
        if (blocks.length >= 2) {
          const sizes = blocks.map(b => b.pos.length)
          const allSame = sizes.every(s => s === sizes[0])
          // Z字形 / 上下交换形要求各块大小一致，否则退化为同大小随机
          const perm = allSame ? this.buildGroupPerm(blocks, swapType) : this.permWithinSizes(blocks)
          this.applyPerm(grid, blocks, perm)
        }
        total += region.filter(p => grid[p.r][p.c]).length
      }
      this.trackSatisfaction(node.uid, total, total)
    },

    // 性别选择：在「作用域」内，按性别把学生配成同桌（same=同性别，mixed=异性别），单座保持单座
    applyGender(grid, regions, node) {
      const genderMode = node.genderMode
      let satisfied = 0, total = 0
      for (const region of regions) {
        const students = region.map(p => grid[p.r][p.c]).filter(s => s)
        total += students.length
        const boys = students.filter(s => s.性别 === '男')
        const girls = students.filter(s => s.性别 === '女')
        const others = students.filter(s => s.性别 !== '男' && s.性别 !== '女')
        const pairTwo = arr => { const out = []; for (let i = 0; i < arr.length; i += 2) out.push(arr.slice(i, i + 2)); return out }
        const units = []
        if (genderMode === 'same') {
          for (const g of [pairTwo(boys), pairTwo(girls), pairTwo(others)]) {
            for (const p of g) {
              units.push(p.length === 2 ? { cells: [p[0], p[1]], indivisible: true } : { cells: [p[0]], indivisible: false })
            }
          }
        } else {
          const max = Math.max(boys.length, girls.length)
          for (let i = 0; i < max; i++) {
            const b = boys[i], g = girls[i]
            if (b && g) units.push({ cells: [b, g], indivisible: true })
            else if (b) units.push({ cells: [b], indivisible: false })
            else if (g) units.push({ cells: [g], indivisible: false })
          }
          for (const o of others) units.push({ cells: [o], indivisible: false })
        }
        this.fillSlots(grid, region, this.regionSlots(region), units)
        // 满足率：同桌对符合性别规则 + 单座视为满足
        for (const u of units) {
          if (u.indivisible) {
            const [x, y] = u.cells
            if (genderMode === 'same' && x.性别 === y.性别) satisfied += 2
            else if (genderMode === 'mixed' && x.性别 !== y.性别) satisfied += 2
          } else {
            satisfied += 1
          }
        }
      }
      this.trackSatisfaction(node.uid, satisfied, total)
    },

    // 同桌关系：在「作用域」内，保留原座位表达成的同桌对（内部坐序按 lockMode 控制），单座保持单座
    applyLockDeskmate(grid, regions, node) {
      const lockMode = node.lockMode || 'no-swap'
      const orig = this.extractOriginalPairs()
      let placedTotal = 0, pairsTotal = 0
      for (const region of regions) {
        const students = region.map(p => grid[p.r][p.c]).filter(s => s)
        const regionIds = new Set(students.map(s => s.id))
        let localPairs = 0
        const units = []
        const used = new Set()
        for (const [a, b] of orig.pairs) {
          if (regionIds.has(a.id) && regionIds.has(b.id)) {
            localPairs++
            units.push({ cells: [a, b], indivisible: true })
            used.add(a.id); used.add(b.id)
          }
        }
        for (const s of students) {
          if (!used.has(s.id)) { units.push({ cells: [s], indivisible: false }); used.add(s.id) }
        }
        pairsTotal += localPairs
        if (lockMode === 'none') {
          // 不变：座位原样保留，仅统计满足情况
          placedTotal += localPairs
          continue
        }
        if (lockMode === 'swap') {
          units.forEach(u => { if (u.indivisible) u.cells = [u.cells[1], u.cells[0]] })
        }
        placedTotal += this.fillSlots(grid, region, this.regionSlots(region), units)
      }
      this.trackSatisfaction(node.uid, placedTotal, pairsTotal)
    },

    // 特殊关系：在「作用域」内修复两人关系。
    //  - 两人同处一个作用块 → 在该块内移动（靠拢型/分离型）；
    //  - 两人分处不同作用块 → 靠拢型不可能满足（统计 0%），分离型按实际距离判定，且绝不跨块移动学生。
    applyRelation(grid, regions, node) {
      const pair = node.pair || {}
      const a = pair.a, b = pair.b
      const type = node.relationType || 'deskmate'
      if (!a || !b || a === b) return
      const pa = this.findPos(grid, a)
      const pb = this.findPos(grid, b)
      if (!pa || !pb) return

      const contains = (region, pos) => region.some(p => p.r === pos[0] && p.c === pos[1])
      const regionA = regions.find(r => contains(r, pa))
      const regionB = regions.find(r => contains(r, pb))
      const needSame = type === 'deskmate' || type === 'nearby'
      if (!regionA || !regionB || regionA !== regionB) {
        const ok = type === 'not-deskmate' ? !this.isTwoAdjacent(pa, pb) : !this.isTwoNearby(pa, pb)
        this.trackSatisfaction(node.uid, needSame ? 0 : (ok ? 1 : 0), 1)
        return
      }

      const effRegion = regionA
      const regionSet = new Set(effRegion.map(p => p.r + ',' + p.c))
      const inRegion = pos => regionSet.has(pos[0] + ',' + pos[1])
      let ok = false
      if (type === 'deskmate') {
        ok = this.isTwoAdjacent(pa, pb)
        if (!ok) ok = this.tryTogetherInRegion(grid, pa, pb, inRegion)
      } else if (type === 'not-deskmate') {
        ok = !this.isTwoAdjacent(pa, pb)
        if (!ok) ok = this.trySeparateInRegion(grid, pa, pb, inRegion, type)
      } else if (type === 'nearby') {
        ok = this.isTwoNearby(pa, pb)
        if (!ok) ok = this.tryNearbyInRegion(grid, pa, pb, inRegion)
      } else { // not-nearby
        ok = !this.isTwoNearby(pa, pb)
        if (!ok) ok = this.trySeparateInRegion(grid, pa, pb, inRegion, type)
      }
      this.trackSatisfaction(node.uid, ok ? 1 : 0, 1)
    },

    // 特殊关系：作为同桌 → 把 b 移到 a 的相邻空位（作用域内，且不隔走廊）
    tryTogetherInRegion(grid, pa, pb, inRegion) {
      const movedStudent = grid[pb[0]][pb[1]]
      if (!movedStudent) return false
      const [ra, ca] = pa
      for (const dc of [-1, 1]) {
        const nc = ca + dc
        if (!inRegion([ra, nc])) continue
        if (grid[ra][nc] !== null) continue
        // 双人桌模式下必须组成偶数列开头的同桌对（隔走廊不算同桌）
        if (this.mode !== 'single' && Math.min(ca, nc) % 2 !== 0) continue
        grid[ra][nc] = movedStudent
        grid[pb[0]][pb[1]] = null
        return true
      }
      return false
    },
    // 特殊关系：坐在附近 → 把 b 移到 a 的相邻一格（含对角，作用域内）
    tryNearbyInRegion(grid, pa, pb, inRegion) {
      const movedStudent = grid[pb[0]][pb[1]]
      if (!movedStudent) return false
      const [ra, ca] = pa
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = ra + dr, nc = ca + dc
          if (nr < 0 || nr >= grid.length) continue
          if (nc < 0 || nc >= grid[nr].length) continue
          if (!inRegion([nr, nc])) continue
          if (nr === pb[0] && nc === pb[1]) continue
          if (grid[nr][nc] === null) {
            grid[nr][nc] = movedStudent
            grid[pb[0]][pb[1]] = null
            return true
          }
        }
      }
      return false
    },
    // 特殊关系：不作为同桌 / 不坐在附近 → 把其中一人移到远处（作用域内空位优先，否则与远处学生最小交换）
    trySeparateInRegion(grid, pa, pb, inRegion, type) {
      const moved = Math.random() < 0.5 ? pa : pb
      const other = moved === pa ? pb : pa
      const movedStudent = grid[moved[0]][moved[1]]
      if (!movedStudent) return false
      const isFar = (r, c) => {
        if (type === 'not-deskmate') return !this.isTwoAdjacent([r, c], other)
        return Math.max(Math.abs(r - other[0]), Math.abs(c - other[1])) > 1
      }
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (!inRegion([r, c])) continue
          if (r === moved[0] && c === moved[1]) continue
          if (r === other[0] && c === other[1]) continue
          if (grid[r][c] === null && isFar(r, c)) {
            grid[r][c] = movedStudent
            grid[moved[0]][moved[1]] = null
            return true
          }
        }
      }
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (!inRegion([r, c])) continue
          if (r === moved[0] && c === moved[1]) continue
          if (r === other[0] && c === other[1]) continue
          const occ = grid[r][c]
          if (occ && isFar(r, c)) {
            grid[moved[0]][moved[1]] = occ
            grid[r][c] = movedStudent
            return true
          }
        }
      }
      return false
    },

    // ==================== 位置公平（公平排表算法） ====================
    // 与「公平权重算法」解耦：权重矩阵 + 座位指数账本由外部传入，这里只负责排表。
    // 目标：最小化 Σ(账本_学生 × 权重_新位置)。该式与「最小化各人公平指数(账本+权重)的方差」等价，
    // 即让累计坐过好位置的同学，接下来坐相对靠后/边缘的位置，使整体更公平。
    // 步骤：① 按「按照 X 为一组」切块，整体调整组块顺序；
    //       ② 若允许，则再「组不动、只换人」调整组内排序。
    applyFair(grid, regions, node) {
      const weights = this.weights || []
      const ledger = this.ledger || {}
      const unit = node.unit || 'six'
      const allowInner = node.innerOrder === 'yes'
      const wOf = (r, c) => (typeof weights[r]?.[c] === 'number' ? weights[r][c] : 0)
      const lOf = s => (s && s.id != null && typeof ledger[s.id] === 'number') ? ledger[s.id] : 0

      let doneTotal = 0, allTotal = 0
      for (const region of regions) {
        const students = region.map(p => grid[p.r][p.c]).filter(Boolean)
        allTotal += students.length
        // 作用域内的组块
        const blocks = this.splitRegion(region, unit)
        const active = blocks.map(b => ({ pos: b.pos })).filter(b => b.pos.length > 0)
        if (active.length < 2 || students.length < 2) { doneTotal += students.length; continue }

        // 每组块：当前学生（按位置原序）与该块各位置的权重
        const groups = active.map(b => ({
          studs: b.pos.map(p => grid[p.r][p.c]).filter(Boolean),
          posW: b.pos.map(p => wOf(p.r, p.c))
        }))

        // 把「学生组 i」放到「位置块 j」的代价（可调整组内排序时按 账本降序×权重升序 的最优配对计）
        const costOf = (i, j) => {
          let ls = groups[i].studs.map(lOf)
          let ws = groups[j].posW
          if (allowInner) {
            ls = [...ls].sort((a, b) => b - a)
            ws = [...ws].sort((a, b) => a - b)
          }
          let sum = 0
          const m = Math.min(ls.length, ws.length)
          for (let k = 0; k < m; k++) sum += ls[k] * ws[k]
          return sum
        }

        // 求组→块的最优一一对应：组数少时暴力枚举全排列，多时用贪心
        const n = groups.length
        let best = null
        if (n <= 7) {
          const arr = Array.from({ length: n }, (_, i) => i)
          let bestCost = Infinity
          const permute = (a, k) => {
            if (k === a.length) {
              let c = 0
              for (let i = 0; i < n; i++) c += costOf(i, a[i])
              if (c < bestCost - 1e-9) { bestCost = c; best = [...a] }
              return
            }
            for (let i = k; i < n; i++) {
              ;[a[k], a[i]] = [a[i], a[k]]
              permute(a, k + 1)
              ;[a[k], a[i]] = [a[i], a[k]]
            }
          }
          permute(arr, 0)
        } else {
          const sumLedger = i => groups[i].studs.reduce((t, s) => t + lOf(s), 0)
          const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => sumLedger(b) - sumLedger(a))
          best = new Array(n).fill(-1)
          const used = new Set()
          for (const i of order) {
            let pick = -1, pc = Infinity
            for (let j = 0; j < n; j++) {
              if (used.has(j)) continue
              const c = costOf(i, j)
              if (c < pc - 1e-9) { pc = c; pick = j }
            }
            best[i] = pick
            used.add(pick)
          }
        }

        // 落盘：组块整体移位；允许时组内再按 账本降序→低权重位置 落座
        const writes = []
        for (let i = 0; i < n; i++) {
          const target = active[best[i]].pos
          const studs = [...groups[i].studs]
          if (allowInner) {
            studs.sort((a, b) => lOf(b) - lOf(a))
            const posSorted = [...target].sort((a, b) => wOf(a.r, a.c) - wOf(b.r, b.c))
            posSorted.forEach((p, k) => writes.push([p, studs[k] || null]))
          } else {
            target.forEach((p, k) => writes.push([p, studs[k] || null]))
          }
        }
        for (const [p, v] of writes) grid[p.r][p.c] = v
        doneTotal += students.length
      }
      this.trackSatisfaction(node.uid, doneTotal, allTotal)
    },

    // 记录满足率
    trackSatisfaction(key, done, total) {
      if (!this.satisfaction[key]) this.satisfaction[key] = { done: 0, total: 0 }
      this.satisfaction[key].done += done
      this.satisfaction[key].total += total
    },
    // 某条件的满足率（未排表或无统计时返回 null）：内联显示在每行条件右侧
    satisfactionOf(node) {
      const st = this.satisfaction[node.uid]
      if (!st) return null
      return st.total ? Math.round((st.done / st.total) * 100) : 0
    },

    // 生成排表结果：保证每次"开始排表/换一换"布局与当前预览不同
    generatePreview() {
      let result = this.buildSeats()
      let guard = 0
      while (guard < 30 && this.previewSeats && this.previewSeats.length && this.sameLayout(result, this.previewSeats)) {
        result = this.buildSeats()
        guard++
      }
      this.previewSeats = result
      this.previewVersion++
    },

    // 判断两张座次网格是否完全相同（任一学生位置不同即视为不同）
    sameLayout(a, b) {
      if (!a || !b || a.length !== b.length) return false
      for (let r = 0; r < a.length; r++) {
        const rowA = a[r] || []
        const rowB = b[r] || []
        for (let c = 0; c < rowA.length; c++) {
          const ia = rowA[c]?.id ?? null
          const ib = rowB[c]?.id ?? null
          if (ia !== ib) return false
        }
      }
      return true
    },
  }
}
