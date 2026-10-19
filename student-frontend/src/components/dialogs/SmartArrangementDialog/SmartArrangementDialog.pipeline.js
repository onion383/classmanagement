// ===== 智能排表：网格工具 + 统一条件流水线 =====
// 纯代码搬运自 SmartArrangementDialog.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
// Fisher-Yates 洗牌（组块置换模块也复用）
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
export { shuffle }
export function useSmartArrangementPipeline(CONDITION_REGISTRY) {
  return {
    // ==================== 网格工具（与座位网格保持一致的显示算法） ====================
    generateColHeaders(cols, mode, showAisle) {
      const headers = []
      if (!showAisle) { for (let i = 0; i < cols; i++) headers.push(`列${i + 1}`); return headers }
      if (mode === 'single') {
        for (let i = 0; i < cols; i++) { headers.push(`列${i + 1}`); if (i < cols - 1) headers.push('走廊') }
      } else {
        for (let i = 0; i < cols; i++) { headers.push(`列${i + 1}`); if ((i + 1) % 2 === 0 && i < cols - 1) headers.push('走廊') }
      }
      return headers
    },
    getDisplayColCount(cols, mode, showAisle) {
      if (!showAisle) return cols
      if (mode === 'single') return cols + (cols - 1)
      else return cols + Math.floor((cols - 1) / 2)
    },
    isAisleCol(displayIdx, cols, mode, showAisle) {
      if (!showAisle) return false
      const totalDisplay = this.getDisplayColCount(cols, mode, showAisle)
      if (mode === 'single') return displayIdx % 2 === 1
      else return displayIdx >= 2 && (displayIdx - 2) % 3 === 0 && displayIdx < totalDisplay
    },

    // ==================== 统一条件流水线（一层平铺，线性执行） ====================
    // 依据当前条件列表构建一张新的座位网格。
    // 每条条件都自带「作用域 scope」：先把区域按 scope 切成若干作用块，条件在每个块内生效；
    // 列表按顺序依次执行，越靠后的条件越晚执行、可部分覆盖前面的结果（越靠后越重要）。
    buildSeats() {
      this.satisfaction = {}
      const grid = this.initGrid()
      const all = this.allCells()
      for (const node of this.conditions) {
        // 作用域切块后取各块的格子列表，作为「区域」交给条件（条件内部再按 unit 切块）
        const regions = this.splitRegion(all, node.scope).map(b => b.pos)
        this.applyCondition(grid, regions, node)
      }
      return grid
    },

    // 应用单条条件（按条件类注册表查表分发）
    applyCondition(grid, regions, node) {
      if (!node) return
      const reg = CONDITION_REGISTRY[node.key]
      const fn = reg && reg.apply
      if (fn) this[fn](grid, regions, node)
    },

    // 初始化网格：从原座位表填满学生，未出现的学生补到空位
    initGrid() {
      const grid = Array.from({ length: this.rows }, () => new Array(this.cols).fill(null))
      const used = new Set()
      // 新同学(字符串名字)没有真实 id，给一个负 id 占位，使其能走通排表流水线
      let pseudoId = -1
      const pseudoCache = {}
      const ensurePseudo = n => {
        if (!pseudoCache[n]) pseudoCache[n] = { id: pseudoId--, 姓名: n }
        return pseudoCache[n]
      }
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const val = this.baseSeats?.[r]?.[c]
          let s = null
          if (typeof val === 'number') {
            s = this.students.find(x => x.id === val)
          } else if (typeof val === 'string') {
            // 班级学生存 id，字符串名字均为"新同学"（未识别的自由文本）
            const n = val.trim()
            if (n && !(this.excludeNew && this.strangerNames.has(n))) s = ensurePseudo(n)
          } else if (val && typeof val === 'object') {
            const n = String(val.姓名 || '').trim()
            if (!(this.excludeNew && this.strangerNames.has(n))) {
              s = n ? ensurePseudo(n) : val
            }
          }
          if (s) { grid[r][c] = s; used.add(s.id) }
        }
      }
      const rest = this.students.filter(s => !used.has(s.id))
      let k = 0
      for (let r = 0; r < this.rows && k < rest.length; r++) {
        for (let c = 0; c < this.cols && k < rest.length; c++) {
          if (!grid[r][c]) { grid[r][c] = rest[k++]; used.add(rest[k - 1].id) }
        }
      }
      return grid
    },
    allCells() {
      const cells = []
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) cells.push({ r, c })
      return cells
    },

    // 几何切块规则：column 一列（每列一块）| whole 一大组（整块）| six 相邻六位(3行×2列) | four 相邻四位(2行×2列)
    //             | student 同学（一人一格一块）| deskmate 同桌（同行左右相邻两人一块）
    shapeSpans(shape) {
      if (shape === 'column') return { rSpan: this.rows, cSpan: 1 }
      if (shape === 'whole') return { rSpan: this.rows, cSpan: this.cols }
      if (shape === 'six') return { rSpan: 3, cSpan: 2 }
      if (shape === 'student') return { rSpan: 1, cSpan: 1 }
      return { rSpan: 2, cSpan: 2 }
    },
    // 把区域按几何方式切成若干子块（scope 与 unit 共用此规则）
    splitRegion(region, shape) {
      // 同桌：不按矩形切，改按「同行相邻两列」成对（与人数桌模式无关，单/双人桌都适用）
      if (shape === 'deskmate') {
        const map = new Map()
        for (const p of region) {
          const k = p.r + ',' + Math.floor(p.c / 2)
          let b = map.get(k)
          if (!b) { b = { br: p.r, bc: Math.floor(p.c / 2), pos: [] }; map.set(k, b) }
          b.pos.push(p)
        }
        return [...map.values()]
      }
      const { rSpan, cSpan } = this.shapeSpans(shape)
      const map = new Map()
      for (const p of region) {
        const br = Math.floor(p.r / rSpan), bc = Math.floor(p.c / cSpan)
        const k = br + ',' + bc
        let b = map.get(k)
        if (!b) { b = { br, bc, pos: [] }; map.set(k, b) }
        b.pos.push(p)
      }
      return [...map.values()]
    },

    // 区域内单元格的"同桌槽位"：桌据模式（double）下偶数列相邻两格为一桌，其余为单格
    regionSlots(region) {
      const byRow = {}
      for (const p of region) (byRow[p.r] = byRow[p.r] || []).push(p.c)
      const slots = []
      const rows = Object.keys(byRow).map(Number).sort((a, b) => a - b)
      for (const r of rows) {
        const cols = byRow[r].sort((a, b) => a - b)
        const inRow = new Set(cols)
        let i = 0
        while (i < cols.length) {
          const c = cols[i]
          if (this.mode !== 'single' && c % 2 === 0 && inRow.has(c + 1)) {
            slots.push([{ r, c }, { r, c: c + 1 }])
            i += 2
          } else {
            slots.push([{ r, c }])
            i += 1
          }
        }
      }
      return slots
    },
    cellOrder(region) {
      return [...region].sort((a, b) => (a.r - b.r) || (a.c - b.c))
    },
    // 把单元（同桌对 + 单座）填入区域槽位。返回成功保持相邻的同桌对数。
    //  - 同桌对不可拆分，优先占 2 格槽位；槽位不足时拆成两个单座（不丢学生）
    //  - 单座优先占 2 格槽位的左格（右侧留空，保持单桌视觉），槽位不足时填剩余空位
    fillSlots(grid, region, slots, units) {
      const twoSlots = slots.filter(s => s.length === 2)
      for (const p of region) grid[p.r][p.c] = null
      const pairs = units.filter(u => u.indivisible)
      const singles = units.filter(u => !u.indivisible)
      let placedPairs = 0
      pairs.forEach((u, i) => {
        if (i < twoSlots.length) {
          const s = twoSlots[i]
          grid[s[0].r][s[0].c] = u.cells[0]
          grid[s[1].r][s[1].c] = u.cells[1]
          placedPairs++
        } else {
          // 2 格槽位不足：拆成两个单座，保住学生
          singles.push({ cells: [u.cells[0]], indivisible: false })
          singles.push({ cells: [u.cells[1]], indivisible: false })
        }
      })
      // 单座优先占剩余 2 格槽位左格
      let si = 0
      for (let i = placedPairs; i < twoSlots.length && si < singles.length; i++) {
        grid[twoSlots[i][0].r][twoSlots[i][0].c] = singles[si].cells[0]
        si++
      }
      // 再填剩余空位
      const empties = this.cellOrder(region).filter(p => !grid[p.r][p.c])
      for (const p of empties) {
        if (si >= singles.length) break
        grid[p.r][p.c] = singles[si].cells[0]
        si++
      }
      return placedPairs
    },

    // 随机排表：在「作用域」内，按「操作单元」把内容整块打乱（单元即最小不可分割单位，成员不跨块）
    applyRandom(grid, regions, node) {
      const unit = node.unit || 'six'
      let total = 0
      for (const region of regions) {
        const blocks = this.splitRegion(region, unit)
        if (blocks.length >= 2) {
          this.applyPerm(grid, blocks, this.permWithinSizes(blocks))
        } else {
          // 只有一块时退化为「逐个学生」打乱，保证"换一换"仍能换出不同布局
          this.shuffleSingles(grid, region)
        }
        total += region.filter(p => grid[p.r][p.c]).length
      }
      this.trackSatisfaction(node.uid, total, total)
    },

    // 以「个人」为最小单位打乱（每个学生独立，不保留同桌对）
    shuffleSingles(grid, region) {
      const students = region.map(p => grid[p.r][p.c]).filter(s => s)
      const units = students.map(s => ({ cells: [s], indivisible: false }))
      this.fillSlots(grid, region, this.regionSlots(region), shuffle(units))
    },
  }
}
