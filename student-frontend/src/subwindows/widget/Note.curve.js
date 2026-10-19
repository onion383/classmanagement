// ===== 便签浮窗：笔宽计算 + Centripetal Catmull-Rom 平滑曲线 =====
// 纯代码搬运自 Note.vue，未改写逻辑；只依赖入参（画布 ctx 由调用方传入），无组件状态。

export function calcW(speed, cfg) {
  if (cfg.minW === cfg.maxW) return cfg.w
  return cfg.maxW - (cfg.maxW - cfg.minW) * Math.min(speed / 5, 1)
}

// ====== Centripetal Catmull-Rom 样条插值 (alpha=0.5) ======
// 相比均匀 Catmull-Rom，弦长参数化能更好地处理采样点间距不均的情况，
// 避免自交和回环，曲线更自然
export function catmullRom(p0, p1, p2, p3, t) {
  const alpha = 0.5
  function getT(prev, p0, p1) {
    const d = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    return Math.pow(d, alpha) + prev
  }
  const t0 = 0
  const t1 = getT(t0, p0, p1)
  const t2 = getT(t1, p1, p2)
  const t3 = getT(t2, p2, p3)
  const tt = t1 + t * (t2 - t1)

  const lerp = (a, b, r) => a + (b - a) * r
  // 相邻采样点重合时分母 (t1-t0) 等为 0，直接相除会得到 NaN/Infinity：
  // ctx.lineTo(NaN, ...) 会让该段路径失效、笔画出现断线。
  // 起笔点与第二个点天然重合（pointBuffer 初始写入两个相同点），必然触发；
  // 高分辨率下画布内部分辨率放大，鼠标抖动产生重合采样点也更频繁，断线更明显。
  // 分母为 0 时按 0 处理，让退化的曲线收敛成有限值（起笔段还原为一条直线）。
  const ratio = (num, den) => (den === 0 ? 0 : num / den)

  const a1x = lerp(p0.x, p1.x, ratio(tt - t0, t1 - t0))
  const a1y = lerp(p0.y, p1.y, ratio(tt - t0, t1 - t0))
  const a2x = lerp(p1.x, p2.x, ratio(tt - t1, t2 - t1))
  const a2y = lerp(p1.y, p2.y, ratio(tt - t1, t2 - t1))
  const a3x = lerp(p2.x, p3.x, ratio(tt - t2, t3 - t2))
  const a3y = lerp(p2.y, p3.y, ratio(tt - t2, t3 - t2))

  const b1x = lerp(a1x, a2x, ratio(tt - t0, t2 - t0))
  const b1y = lerp(a1y, a2y, ratio(tt - t0, t2 - t0))
  const b2x = lerp(a2x, a3x, ratio(tt - t1, t3 - t1))
  const b2y = lerp(a2y, a3y, ratio(tt - t1, t3 - t1))

  const cx = lerp(b1x, b2x, ratio(tt - t1, t2 - t1))
  const cy = lerp(b1y, b2y, ratio(tt - t1, t2 - t1))

  // 宽度用 smoothstep 过渡，避免线性插值的生硬感
  const st = t * t * (3 - 2 * t)
  return { x: cx, y: cy, w: p1.w + (p2.w - p1.w) * st }
}

// 根据两点距离自适应调整插值步数，保证平滑
export function drawCurveSegment(ctx, p0, p1, p2, p3) {
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  const steps = Math.max(8, Math.ceil(dist / 3))
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  for (let i = 1; i <= steps; i++) {
    const pt = catmullRom(p0, p1, p2, p3, i / steps)
    ctx.lineWidth = pt.w
    ctx.lineTo(pt.x, pt.y)
  }
  ctx.stroke()
}
