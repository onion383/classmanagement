/**
 * 网格行对象复用缓存（座位表 / 课表 / 值日表共用）。
 *
 * 背景：这些页面的 displayRows 都是「派生」出来的——每次数据变动都会把整表重新构造成
 * 一批新对象。GridView 用 `row._rowKey` 做键控渲染，但行对象每次都是新的，于是任何一次
 * 编辑都会让所有行的 vnode 属性全变，触发整表重画（实测 ~30ms 量级）。
 *
 * 做法：把上一次的行按 `_rowKey` 记住，本次重新构造后逐行比对——内容完全一致的行直接
 * 沿用旧对象（连同其中未变的格对象）；若所有行、连顺序都未变，连数组本身也沿用旧引用。
 * 于是 Vue 的键控 diff 只更新真正变化的那一行，数组引用不变时父级更新也不会连带重渲染子表。
 *
 * 注意：比对是「按内容」做的，只有内容确实相同才复用，因此不会吞掉任何编辑结果。
 */
export function createRowReuseCache() {
  let prevByKey = null
  let prevRows = null

  const keyOf = (row, idx) => (row && row._rowKey != null ? String(row._rowKey) : `#${idx}`)

  // 行内容比对：除 cells 外的所有字段 + 每个格子的所有字段（浅比较）
  function sameRow(a, b) {
    for (const k in a) {
      if (k === 'cells') continue
      if (a[k] !== b[k]) return false
    }
    for (const k in b) {
      if (k === 'cells') continue
      if (!(k in a)) return false
    }
    const ac = a.cells, bc = b.cells
    // 没有 cells 字段的行（普通平铺表格，如学生/班费）：该维度无需比对，直接判等
    if (ac === undefined && bc === undefined) return true
    if (!Array.isArray(ac) || !Array.isArray(bc) || ac.length !== bc.length) return false
    for (let i = 0; i < bc.length; i++) {
      const x = ac[i], y = bc[i]
      if (x === y) continue
      if (!x || !y) return false
      for (const k in y) if (x[k] !== y[k]) return false
      for (const k in x) if (!(k in y)) return false
    }
    return true
  }

  return function reuse(rows) {
    if (!prevByKey) {
      prevByKey = new Map()
      prevRows = rows
      rows.forEach((row, idx) => prevByKey.set(keyOf(row, idx), row))
      return rows
    }
    const nextByKey = new Map()
    const out = new Array(rows.length)
    let reusedAll = true
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx]
      const key = keyOf(row, idx)
      const old = prevByKey.get(key)
      if (old && sameRow(old, row)) {
        out[idx] = old
      } else {
        out[idx] = row
        reusedAll = false
      }
      nextByKey.set(key, out[idx])
    }
    prevByKey = nextByKey
    // 全部复用且顺序一致 → 沿用旧数组引用（父级 prop 不变，子表整体不重渲染）
    if (reusedAll && prevRows && prevRows.length === out.length) {
      let same = true
      for (let i = 0; i < out.length; i++) {
        if (out[i] !== prevRows[i]) { same = false; break }
      }
      if (same) return prevRows
    }
    prevRows = out
    return out
  }
}
