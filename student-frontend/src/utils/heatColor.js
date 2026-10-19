// ===== 热力配色：权重表 / 座位指数共用的蓝→白对比算法 =====
// 从 DutyView.vue 与 SeatView.vue 各自重复的实现合并而来（原逻辑逐字保留）。

// 蓝色热力：浅蓝(#EFF6FF) → 深蓝(#1E3A8A) 线性插值
export function weightHeatRgb(t) {
  const k = Math.max(0, Math.min(1, t))
  const from = [239, 246, 255], to = [30, 58, 138]
  return from.map((f, i) => Math.round(f + (to[i] - f) * k))
}

// 依底色相对亮度自动切换文字色：深底白字、浅底深色字，保证可读性
export function weightHeatFg(t) {
  const [r, g, b] = weightHeatRgb(t).map(v => v / 255)
  const lin = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L < 0.45 ? '#FFFFFF' : '#1E293B'
}
