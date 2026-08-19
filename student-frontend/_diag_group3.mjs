// 诊断3：综合测试 group 排表（含锁定同桌组合），覆盖同桌模式/不均块容量
// 检测每轮：1) 组是否被拆散(跨组)  2) 是否丢学生
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

function run(rows, cols, N, lockDeskmate, gender, groupBy) {
  const students = Array.from({ length: N }, (_, i) => ({ id: i + 1, 姓名: 'S' + (i + 1), 性别: i % 2 ? '男' : '女' }))
  const initialSeats = []
  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < cols; c++) { const idx = r * cols + c; row.push(idx < N ? idx + 1 : null) }
    initialSeats.push(row)
  }
  const groupConfig = { groupBy, swapType: 'random' }
  const hasCondition = k => k === 'group' || k === 'random' || (lockDeskmate && k === 'lock-deskmate') || (gender && k === 'gender')

  function buildGroupBlocks() {
    let blockRows, blockCols
    if (groupBy === 'column') { blockRows = 1; blockCols = cols }
    else if (groupBy === 'whole') { blockRows = 1; blockCols = 1 }
    else if (groupBy === 'six') { blockRows = Math.ceil(rows / 2); blockCols = Math.ceil(cols / 3) }
    else { blockRows = Math.ceil(rows / 2); blockCols = Math.ceil(cols / 2) }
    const blocks = []
    for (let br = 0; br < blockRows; br++) for (let bc = 0; bc < blockCols; bc++) {
      const pos = []
      const rStart = br * 2, rEnd = groupBy === 'column' ? rows - 1 : Math.min(br * 2 + 1, rows - 1)
      const cSpan = groupBy === 'six' ? 3 : groupBy === 'four' ? 2 : 1
      const cStart = bc * cSpan, cEnd = Math.min(bc * cSpan + cSpan - 1, cols - 1)
      for (let r = rStart; r <= rEnd; r++) for (let c = cStart; c <= cEnd; c++) pos.push({ r, c })
      blocks.push({ br, bc, pos })
    }
    return { blockRows, blockCols, blocks }
  }
  function buildGroupMembers(groupSizes) {
    const members = groupSizes.map(() => [])
    const { blocks } = buildGroupBlocks()
    const used = new Set()
    blocks.forEach((b, gi) => { for (const p of b.pos) {
      const val = initialSeats[p.r]?.[p.c]; let st = null
      if (typeof val === 'number') st = students.find(s => s.id === val) || null
      else if (val && typeof val === 'object') st = val
      if (st) { members[gi].push(st); used.add(st.id) }
    } })
    const rest = students.filter(s => !used.has(s.id)); let ri = 0
    members.forEach((m, gi) => { while (m.length < groupSizes[gi] && ri < rest.length) m.push(rest[ri++]) })
    return members
  }
  function arrangeGroup(group) {
    const list = [...group]
    const realPair = (a, b) => ({ cells: [a, b], required: 2, indivisible: true })
    const virtualSingle = s => ({ cells: [s, null], required: 1, indivisible: false })
    const plainSingle = s => ({ cells: [s], required: 1, indivisible: false })
    const isSingle = s => lockDeskmate ? virtualSingle(s) : plainSingle(s)
    let units = []
    if (gender) {
      const boys = list.filter(s => s.性别 === '男'); const girls = list.filter(s => s.性别 === '女')
      const others = list.filter(s => s.性别 !== '男' && s.性别 !== '女')
      const pairTwo = arr => { const out = []; for (let i = 0; i < arr.length; i += 2) out.push(arr.slice(i, i + 2)); return out }
      // 只用 same 模式测试
      for (const g of [pairTwo(boys), pairTwo(girls), pairTwo(others)]) for (const p of g) units.push(p.length === 2 ? realPair(p[0], p[1]) : isSingle(p[0]))
    } else if (lockDeskmate) {
      const pairTwo = arr => { const out = []; for (let i = 0; i < arr.length; i += 2) out.push(arr.slice(i, i + 2)); return out }
      const take = list.length % 2 === 1 ? 1 : 0
      units = list.slice(0, take).map(s => isSingle(s))
      units.push(...pairTwo(list.slice(take)).map(p => realPair(p[0], p[1] || null)))
    } else {
      units = list.map(s => plainSingle(s))
    }
    if (hasCondition('random')) units = shuffle(units)
    const cells = []
    for (const u of units) { if (u.indivisible) cells.push(...u.cells); else cells.push(u.cells[0]) }
    return cells
  }
  function extractGroupContents(grid, blocks) { return blocks.map(b => b.pos.map(p => grid[p.r][p.c])) }
  function buildGroupPerm(blocks, blockRows, blockCols) {
    const n = blocks.length; const idx = b => b.br * blockCols + b.bc
    const perm = blocks.map((_, i) => i)
    for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]] }
    return perm
  }
  function applyGroupSwap(grid) {
    const { blockRows, blockCols, blocks } = buildGroupBlocks()
    const contents = extractGroupContents(grid, blocks)
    const sizes = blocks.map(b => b.pos.length); const n = blocks.length; const perm = new Array(n)
    const allSame = sizes.every(s => s === sizes[0])
    if (allSame) { const p = buildGroupPerm(blocks, blockRows, blockCols); p.forEach((v, i) => { perm[i] = v }) }
    else {
      const bySize = {}; blocks.forEach((b, i) => { (bySize[sizes[i]] = bySize[sizes[i]] || []).push(i) })
      for (const sz in bySize) { const idxs = bySize[sz]; const p = idxs.map((_, i) => i)
        for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] }
        idxs.forEach((orig, k) => { perm[orig] = idxs[p[k]] })
      }
    }
    const newGrid = grid.map(row => row.map(() => null))
    blocks.forEach((b, i) => { const src = contents[perm[i]]; b.pos.forEach((p, k) => { newGrid[p.r][p.c] = src[k] ?? null }) })
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) grid[r][c] = newGrid[r][c]
  }
  function applyRandomWithinGroups(grid) {
    const { blocks } = buildGroupBlocks()
    for (const block of blocks) { const studs = block.pos.map(p => grid[p.r][p.c]).filter(s => s !== null && s !== undefined); const shuf = shuffle(studs); let k = 0
      for (const p of block.pos) grid[p.r][p.c] = k < shuf.length ? shuf[k++] : null }
  }
  function buildGroupSeats() {
    const { blocks } = buildGroupBlocks(); const groupSizes = blocks.map(b => b.pos.length)
    const members = buildGroupMembers(groupSizes); const groupCells = members.map(g => arrangeGroup(g))
    const grid = []; for (let r = 0; r < rows; r++) grid[r] = new Array(cols).fill(null)
    blocks.forEach((b, i) => { const cells = groupCells[i]; b.pos.forEach((p, k) => { grid[p.r][p.c] = cells[k] ?? null }) })
    applyGroupSwap(grid)
    if (hasCondition('random')) applyRandomWithinGroups(grid)
    return grid
  }

  const { blocks } = buildGroupBlocks(); const groupSizes = blocks.map(b => b.pos.length)
  const members = buildGroupMembers(groupSizes)
  const assigned = {}; members.forEach((g, gi) => g.forEach(s => { assigned[s.id] = gi }))
  const idToBlock = (grid) => { const map = {}; blocks.forEach((b, gi) => { for (const p of b.pos) { const s = grid[p.r][p.c]; if (s && s.id != null) map[s.id] = gi } }); return map }
  const membersByGroup = {}; Object.entries(assigned).forEach(([id, g]) => { (membersByGroup[g] = membersByGroup[g] || []).push(+id) })

  let splits = 0, loss = 0
  const RUNS = 5000
  for (let i = 0; i < RUNS; i++) {
    const g = buildGroupSeats()
    const id2b = idToBlock(g)
    // 丢学生？assigned 里的学生是否都在网格中
    for (const id of Object.keys(assigned)) if (id2b[+id] === undefined) { loss++; break }
    // 拆散？某组出现>1个块
    for (const grp in membersByGroup) {
      const bs = new Set(membersByGroup[grp].map(id => id2b[id]))
      if (bs.size > 1) { splits++; break }
    }
  }
  const label = `${rows}x${cols} N=${N} ${lockDeskmate ? '+锁定同桌' : ''} ${gender ? '+性别' : ''} ${groupBy}`
  console.log(`[${label}] 块容量=${groupSizes.join(',')} 每组人数=${members.map(m => m.length).join(',')} | 拆散=${splits}(${((splits/RUNS)*100).toFixed(2)}%) 丢学生=${loss}(${((loss/RUNS)*100).toFixed(2)}%)`)
}

console.log('=== 区间: 各配置 × 5000 次 ===')
// 同桌模式：列数偶数
run(3, 4, 4, true, false, 'six')    // 4生 1对+2单，6位组，块容量可能不均(6,2,3,1)
run(3, 4, 4, false, false, 'six')   // 同上但不锁定
run(3, 6, 6, true, false, 'six')    // 6生 3对，6x3 六位块
run(4, 6, 12, true, false, 'six')   // 12生 6对
run(4, 6, 12, false, false, 'six')  // 12生 随机
run(3, 4, 4, false, true, 'six')    // 性别 same
run(4, 6, 12, false, true, 'six')   // 性别 same 12生
run(3, 4, 4, true, true, 'six')     // 锁定+性别
// 四组 arrange
run(4, 4, 8, true, false, 'four')
run(4, 4, 8, false, false, 'four')
// 单桌模式 奇数列
run(4, 5, 10, false, false, 'six')