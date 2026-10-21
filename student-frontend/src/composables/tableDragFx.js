// =========================================================================
// tableDragFx.js —— 表格拖拽的「实时让位」与「边缘自动滚动」
//
// 只做视觉与滚动辅助，不碰数据：
//   · 让位：把源与目标之间的行/列整体平移一格，腾出目标位置的「空槽」，
//     松手后由表格既有的重排逻辑（splice 删除 + 插入）真正落位，并播放各自的 FLIP 动画。
//   · 自动滚动：拖动到滚动容器上下左右边缘时按距离加速滚动，并把拖拽几何缓存
//     同步减去滚动量，保证命中判定与落点高亮框始终跟手。
//
// 之所以只用 transform：
//   不动 DOM 顺序 → 与 Vue 的渲染完全解耦，不会让 v-for 的 key/复用错乱；
//   行/列自身的 CSS 过渡会让位移平滑（表格已给 tr/td 配了 transform 过渡）。
// =========================================================================

const SHIFT_ATTR = 'data-drag-shift'
const SHIFT_EASE = '180ms cubic-bezier(0.22, 0.61, 0.36, 1)'

// 每个元素记录「上次写入的位移」，值没变就直接跳过写样式。
// 拖拽时本函数每帧会被调一次（行/列全量遍历），无条件写 transform/transition
// 会持续触发样式重算，是卡顿的主要来源之一。
const DX = '__dsx'
const DY = '__dsy'

function markShift(el, dx, dy) {
  if (!el) return
  if (el[DX] === dx && el[DY] === dy) return
  el[DX] = dx
  el[DY] = dy
  if (!el.hasAttribute(SHIFT_ATTR)) {
    el.setAttribute(SHIFT_ATTR, '1')
    el.style.transition = `transform ${SHIFT_EASE}`
  }
  el.style.transform = `translate(${dx}px, ${dy}px)`
}

function unmarkShift(el) {
  if (!el) return
  if (!el.hasAttribute(SHIFT_ATTR) && el[DX] === 0 && el[DY] === 0) return
  // 保留 transition，让"退出让位"也是滑回去的；transition 由 clearShift 统一收尾清掉
  if (el[DX] !== 0 || el[DY] !== 0) {
    el[DX] = 0
    el[DY] = 0
    el.style.transform = ''
  }
  el.removeAttribute(SHIFT_ATTR)
}

/** 清除范围内所有让位位移（拖拽结束/取消时调用） */
export function clearShift(root) {
  if (!root || !root.querySelectorAll) return
  const els = root.querySelectorAll(`[${SHIFT_ATTR}]`)
  for (const el of els) {
    el.style.transform = ''
    el.style.transition = ''
    el[DX] = 0
    el[DY] = 0
    // 标记必须一起摘掉：否则下次拖动的 unmarkShift 会认为它仍在让位态，
    // 白白清一次 transition，且 clearShift 每次都要多扫一遍
    el.removeAttribute(SHIFT_ATTR)
  }
  // 兜底：属性可能挂在 root 自身
  if (root.hasAttribute && root.hasAttribute(SHIFT_ATTR)) {
    root.style.transform = ''
    root.style.transition = ''
    root.removeAttribute(SHIFT_ATTR)
  }
}

/**
 * 行让位：中间行整体挪一格，把目标位置的「空槽」让出来。
 *
 * 位移按**几何逐行补偿**：每一行都挪到「邻行原来的位置」，
 * 而不是统一挪一个「被拖行高度」。表格里行高往往不相等（讲台行、分隔行、合并行），
 * 统一高度会让中间行错位、空槽大小也对不上，松手时看着是"跳一下"。
 *
 * @param {Array<HTMLElement>} rows 与数据顺序一致的 <tr> 列表（可含 null 占位）
 * @param {number|null} from 源索引
 * @param {number|null} to 目标索引
 * @param {Array<{top:number,bottom:number}>|number} geom 各行的几何缓存（左右边界/top），或回退用的统一高度
 * @param {((el:HTMLElement)=>HTMLElement|null)|null} counterOf 取「需要反向位移」的子元素（如序号列内容）：
 *        行往上让位时它往下补同样的距离，净位移为 0，看起来固定不动
 */
export function applyRowShift(rows, from, to, geom, fallback = 0, counterOf = null) {
  if (!rows || !rows.length) return
  const active = from !== null && to !== null && from !== to
  const uniform = typeof geom === 'number' ? geom : fallback
  const g = Array.isArray(geom) ? geom : null
  const topOf = (k) => (g && g[k] ? g[k].top : null)
  for (let i = 0; i < rows.length; i++) {
    const el = rows[i]
    if (!el) continue
    let dy = 0
    if (active) {
      // 向下拖：from 之后的行走 up 到它们各自上一行的位置
      // 向上拖：to..from-1 行走 down 到它们各自下一行的位置
      if (to > from && i > from && i <= to) {
        const a = topOf(i - 1), b = topOf(i)
        dy = (a != null && b != null) ? a - b : -uniform
      } else if (to < from && i >= to && i < from) {
        const a = topOf(i + 1), b = topOf(i)
        dy = (a != null && b != null) ? a - b : uniform
      }
    }
    const counter = counterOf ? counterOf(el) : null
    if (dy) {
      markShift(el, 0, dy)
      // 序号等内容做反向位移：跟着行一起走的话，会显得序号整体错了一行
      if (counter) markShift(counter, 0, -dy)
    } else {
      unmarkShift(el)
      if (counter) unmarkShift(counter)
    }
  }
}

/**
 * 列让位：中间列整体挪一格，把目标位置的「空槽」让出来。
 *
 * 同样是**按几何逐列补偿**：每一列都挪到「邻列原来的位置」。
 * 座位表在「同桌」模式下列宽并不相等（还有走廊列），
 * 统一用被拖列的宽度去平移会让中间列全部错位。
 *
 * @param {Array<Array<HTMLElement>>} colEls 索引 = 数据列序号；每项是该列需一起平移的元素
 * @param {number|null} from 源列
 * @param {number|null} to 目标列
 * @param {Array<{left:number,right:number}>|number} geom 各列的左右边界缓存，或回退用的统一宽度
 */
export function applyColShift(colEls, from, to, geom, fallback = 0) {
  if (!colEls || !colEls.length) return
  const active = from !== null && to !== null && from !== to
  const uniform = typeof geom === 'number' ? geom : fallback
  const g = Array.isArray(geom) ? geom : null
  const cellOf = (k) => (g && g[k]) || null
  const isAisle = (k) => !!(cellOf(k) && cellOf(k).aisle)
  const leftOf = (k) => (cellOf(k) ? cellOf(k).left : null)
  // 相邻的「真实列」：跳过走廊这类钉住不动的列，避免用它的位置当基准
  const prevCol = (k) => {
    for (let j = k - 1; j >= 0; j--) { if (cellOf(j) && !cellOf(j).aisle) return j }
    return -1
  }
  const nextCol = (k) => {
    if (!g) return -1
    for (let j = k + 1; j < g.length; j++) { if (cellOf(j) && !cellOf(j).aisle) return j }
    return -1
  }
  // 让位链允许「跨过」走廊：走廊本身钉住不动（见下面的 isAisle 判断），
  // 但它两侧的列仍然依次让位 —— 走廊每隔两列就有一个，
  // 若跨走廊就整段不动，用户看到的就是"根本没让位"。
  const shiftable = active
  for (let i = 0; i < colEls.length; i++) {
    const els = colEls[i]
    if (!els || !els.length) continue
    let dx = 0
    // 走廊列永远不动（它是分隔用的固定列）
    if (shiftable && !isAisle(i)) {
      if (to > from && i > from && i <= to) {
        const p = prevCol(i)
        const a = p >= 0 ? leftOf(p) : null
        const b = leftOf(i)
        dx = (a != null && b != null) ? a - b : -uniform
      } else if (to < from && i >= to && i < from) {
        const n = nextCol(i)
        const a = n >= 0 ? leftOf(n) : null
        const b = leftOf(i)
        dx = (a != null && b != null) ? a - b : uniform
      }
    }
    for (const el of els) {
      if (!el) continue
      if (dx) markShift(el, dx, 0)
      else unmarkShift(el)
    }
  }
}

/**
 * 行互换让位：只把「源行」与「目标行」互相挪到对方位置，中间行不动。
 * 网格表格（座位/课程/值日）拖行的结果就是「两行交换」，所以预览也必须是互换，
 * 否则松手会看到中间行弹回原位。
 * @param {Array<HTMLElement>} rows 与数据顺序一致的 <tr> 列表
 * @param {number|null} from 源索引
 * @param {number|null} to 目标索引
 * @param {number} dyFrom 源行的垂直位移（= 目标行 top - 源行 top）
 * @param {number} dyTo 目标行的垂直位移（= 源行 top - 目标行 top）
 */
export function applyRowSwap(rows, from, to, dyFrom, dyTo) {
  if (!rows || !rows.length) return
  const active = from !== null && to !== null && from !== to
  for (let i = 0; i < rows.length; i++) {
    const el = rows[i]
    if (!el) continue
    let dy = 0
    if (active) {
      if (i === from) dy = dyFrom
      else if (i === to) dy = dyTo
    }
    if (dy) markShift(el, 0, dy)
    else unmarkShift(el)
  }
}

/**
 * 列互换让位：只把「源列」与「目标列」互相挪到对方位置，中间列不动。
 * 用于网格表格（座位/课表/值日）——它们的列拖拽结果是「交换两列数据、表头固定」，
 * 所以预览也必须是互换，不能像普通表格那样整排平移（否则松手会看到中间列弹回去）。
 * @param {Array<Array<HTMLElement>>} colEls 索引 = 数据列序号
 * @param {number|null} from 源列
 * @param {number|null} to 目标列
 * @param {number} dxFrom 源列的水平位移（= 目标列左边界 - 源列左边界）
 * @param {number} dxTo 目标列的水平位移（= 源列左边界 - 目标列左边界）
 */
export function applyColSwap(colEls, from, to, dxFrom, dxTo) {
  if (!colEls || !colEls.length) return
  const active = from !== null && to !== null && from !== to
  for (let i = 0; i < colEls.length; i++) {
    const els = colEls[i]
    if (!els || !els.length) continue
    let dx = 0
    if (active) {
      if (i === from) dx = dxFrom
      else if (i === to) dx = dxTo
    }
    for (const el of els) {
      if (!el) continue
      if (dx) markShift(el, dx, 0)
      else unmarkShift(el)
    }
  }
}

/**
 * 边缘自动滚动：拖动到容器边缘附近时按距离加速滚动，四向都支持。
 * @param {() => HTMLElement|null} getScroller 取滚动容器（每次取，兼容重建）
 * @param {(dx:number, dy:number) => void} onScrolled 实际滚动后回调（用于同步几何缓存）
 * @param {{edge?:number, maxSpeed?:number}} opts
 * @returns {{update:(x:number,y:number)=>void, stop:()=>void}}
 */
export function createEdgeAutoScroll(getScroller, onScrolled, opts = {}) {
  const edge = opts.edge || 56          // 触发区宽度（px）
  const maxSpeed = opts.maxSpeed || 22  // 每帧最大滚动量（px）
  let raf = null
  let px = 0
  let py = 0

  const speedOf = (dist) => Math.min(maxSpeed, Math.max(3, Math.round(dist / 3)))

  const step = () => {
    raf = null
    const el = typeof getScroller === 'function' ? getScroller() : getScroller
    if (!el) return
    const r = el.getBoundingClientRect()
    let dx = 0
    let dy = 0
    if (py < r.top + edge) dy = -speedOf(r.top + edge - py)
    else if (py > r.bottom - edge) dy = speedOf(py - (r.bottom - edge))
    if (px < r.left + edge) dx = -speedOf(r.left + edge - px)
    else if (px > r.right - edge) dx = speedOf(px - (r.right - edge))
    if (!dx && !dy) return
    const bx = el.scrollLeft
    const by = el.scrollTop
    if (dx) el.scrollLeft = bx + dx
    if (dy) el.scrollTop = by + dy
    const mx = el.scrollLeft - bx
    const my = el.scrollTop - by
    if (!mx && !my) return // 已到边界：停下，等下一次 mousemove 再判断
    if (onScrolled) onScrolled(mx, my)
    raf = requestAnimationFrame(step)
  }

  return {
    update(x, y) {
      px = x
      py = y
      if (!raf) raf = requestAnimationFrame(step)
    },
    stop() {
      if (raf) cancelAnimationFrame(raf)
      raf = null
    },
  }
}
