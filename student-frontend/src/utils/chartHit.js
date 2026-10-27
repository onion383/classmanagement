// ===== 图表命中测试：AI 图表的「鼠标靠近自动选中最近的数据」 =====
// 纯函数（不依赖 DOM），供 AiChart.vue 调用；抽成独立模块是为了能直接跑单元测试。
// 坐标一律是 SVG 用户坐标（viewBox 内的数值），不是屏幕像素。

/**
 * 柱状图 / 折线图：按 x 就近取分带（列）。
 * 语义是「最近的一列」——以各列中心（x0 + band*(i+0.5)）为准取距离最近的那个；
 * 距离超过 3/4 个带宽（也就是明显在绘图区之外）则返回 -1。
 */
export function hitBand(x, count, x0, x1) {
  if (!count || x1 <= x0) return -1
  const band = (x1 - x0) / count
  const t = (x - x0) / band - 0.5 // 连续下标
  // Math.round 可能返回 -0（x 落在第一列左侧时），用 Math.max/min 归一化，
  // 顺带把 -0 变成 0，避免下游严格相等比较失败
  const i = Math.max(0, Math.min(count - 1, Math.round(t)))
  const center = x0 + band * (i + 0.5)
  return Math.abs(x - center) <= band * 0.75 ? i : -1
}

/**
 * 横向柱状图：按 y 就近取分带（行）。
 * 语义与 hitBand 相同，只是方向换成纵向：以各行中心（y0 + band*(i+0.5)）为准取最近的一行；
 * 距离超过 3/4 个行高（也就是明显在绘图区之外）则返回 -1。
 */
export function hitRow(y, count, y0, y1) {
  if (!count || y1 <= y0) return -1
  const band = (y1 - y0) / count
  const t = (y - y0) / band - 0.5
  const i = Math.max(0, Math.min(count - 1, Math.round(t)))
  const center = y0 + band * (i + 0.5)
  return Math.abs(y - center) <= band * 0.75 ? i : -1
}

/**
 * 饼图：按极角判断落在哪个扇区。
 * slices 需带 { i, frac }（frac 为占比 0~1）。
 * 扇区外弹是沿自身中线「径向」平移的，极角相对圆心不变 ——
 * 因此用圆心原坐标判角度即可；tol 要留够外弹的余量（默认 12 ≥ 最大外弹距离 9）。
 * 返回命中的扇区下标；都没命中返回 -1。
 */
export function hitPieSlice(x, y, slices, cx, cy, r, tol = 12) {
  if (!slices || !slices.length) return -1
  const TAU = Math.PI * 2
  const dx = x - cx
  const dy = y - cy
  if (Math.hypot(dx, dy) > r + tol) return -1
  // 扇区从 -90°（正上方）开始顺时针铺开，故先把极角换算成「距正上方的顺时针弧度」
  let a = Math.atan2(dy, dx) + Math.PI / 2
  a = ((a % TAU) + TAU) % TAU
  let acc = 0 // 已累计的角度起点（各扇区首尾相接）
  for (const s of slices) {
    const span = s.frac * TAU
    if (span > 0 && a >= acc && a < acc + span) return s.i
    acc += span
  }
  return -1
}

/**
 * 饼图图例：按行命中（rowYs 为每行文字的基线 y），取垂直距离最近的一行。
 * legendX 左侧再留 6px 容差，方便点在色块上；所有行都超出 tol 则返回 -1。
 */
export function hitLegendRow(x, y, rowYs, legendX, tol = 12) {
  if (!rowYs || !rowYs.length) return -1
  if (x < legendX - 6) return -1
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < rowYs.length; i++) {
    const d = Math.abs(y - rowYs[i])
    if (d < bestD) { bestD = d; best = i }
  }
  return bestD <= tol ? best : -1
}
