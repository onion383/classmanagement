// =========================================================================
// usePhotoTimeline.js —— 相册「按日期分组的照片网格」窗口化虚拟滚动
//
// 纯代码搬运：逻辑与原 AlbumView.vue 里的实现一致（含注释），抽出后由
// 相册页（AlbumView）与「选择照片」弹窗（PhotoPickerDialog）共用，
// 避免两处各写一份窗口计算、尺寸测量与滚动监听。
//
// 以“日期分组”为窗口单元：外部用总高度撑起滚动条，
// 内部只挂载视口附近（含缓冲）的分组，其余用绝对定位占位。
// 分组内部 grid 用固定尺寸的方形格子（flex-wrap），
// 列数由容器宽度按「目标格宽 200px」反推、格子尺寸再据此平均分配，
// 保证各分组高度可精确预算，无需测量。
// =========================================================================
import { ref, computed, onBeforeUnmount } from 'vue'

export function usePhotoTimeline(groupsRef, options = {}) {
  const GAP = options.gap ?? 12       // 格子间距（与模板 gap-3 一致）
  const HEADER = options.header ?? 40 // 分组日期标题高度约值
  const GROUP_GAP = options.groupGap ?? 32 // 组间距（与模板 mb-8 一致）
  const BUFFER = options.buffer ?? 900     // 上下预留缓冲，提前渲染避免闪过空白
  // 目标格宽（CSS px）：列数按容器宽度反推，格子始终维持在这个量级
  const TARGET_CELL = options.targetCell ?? 200
  const MIN_COLS = options.minCols ?? 3
  const MAX_COLS = options.maxCols ?? 12

  const containerRef = ref(null)
  const scrollTop = ref(0)
  const clientH = ref(0)
  const viewW = ref(0)
  const cols = ref(6)
  const cell = ref(150)
  let rafId = 0

  // 列数自适应：以前写死 6 列，宽屏上每格会被拉到 300+ CSS px，
  // HiDPI 下需要的设备像素远超 512 缩略图 → 放大发糊；
  // 改成按目标格宽反推列数，宽屏多列、窄屏少列，格子稳定在 200px 上下。
  function columnsFor(width) {
    if (!width) return 6
    const n = Math.floor(width / (TARGET_CELL + GAP))
    return Math.max(MIN_COLS, Math.min(MAX_COLS, n))
  }

  function measure() {
    const el = containerRef.value
    if (!el) return
    viewW.value = el.clientWidth
    clientH.value = el.clientHeight
    // 把剩余宽度平均分给每格，让格子尽量铺满容器（仍是正方形）
    cols.value = columnsFor(viewW.value)
    cell.value = cols.value > 1 ? Math.floor((viewW.value - (cols.value - 1) * GAP) / cols.value) : viewW.value
  }

  const cellStyle = computed(() => ({ width: cell.value + 'px', height: cell.value + 'px' }))

  function groupHeight(g) {
    const n = g.photos ? g.photos.length : 0
    const rows = n ? Math.ceil(n / cols.value) : 0
    return HEADER + (rows ? rows * cell.value + (rows - 1) * GAP : 0)
  }

  const layout = computed(() => {
    const groups = groupsRef.value || []
    let offset = 0
    const items = []
    for (const g of groups) {
      const h = groupHeight(g)
      items.push({ g, offset, h })
      offset += h + GROUP_GAP
    }
    return { total: offset, items }
  })

  const totalH = computed(() => layout.value.total)

  const visibleGroups = computed(() => {
    const top = scrollTop.value - BUFFER
    const bottom = scrollTop.value + clientH.value + BUFFER
    return layout.value.items
      .filter(v => v.offset + v.h >= top && v.offset <= bottom)
      .map(v => ({ g: v.g, offset: v.offset }))
  })

  function onScroll() {
    const el = containerRef.value
    if (!el) return
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = 0
      scrollTop.value = el.scrollTop
      clientH.value = el.clientHeight
    })
  }

  function onResize() {
    measure()
  }

  // 回到顶部并重新计量（切换相册 / 刷新后调用）
  async function reset() {
    scrollTop.value = 0
    const el = containerRef.value
    if (el) el.scrollTop = 0
    measure()
  }

  onBeforeUnmount(() => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  })

  return {
    containerRef, scrollTop, clientH, viewW, cols, cell,
    cellStyle, layout, totalH, visibleGroups,
    measure, onScroll, onResize, reset,
  }
}
