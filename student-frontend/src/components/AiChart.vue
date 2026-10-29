<template>
  <div class="my-1.5 ai-dark-frame p-2">
    <!-- 工具条 -->
    <div class="flex items-center justify-end gap-1.5 mb-1">
      <span v-if="focus >= 0" class="text-[10px] text-text-muted">
        {{ labelOf(focus) }}：{{ fmt(values[focus]) }}<span v-if="unit" class="ml-0.5">{{ unit }}</span>
      </span>
      <button
        type="button"
        :disabled="saving"
        @click="saveImage"
        class="text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface text-text-muted hover:text-text hover:border-primary transition-theme cursor-pointer disabled:opacity-50"
        title="把图表保存为 PNG 图片"
      >{{ saving ? '保存中…' : '保存图片' }}</button>
    </div>

    <!-- 图表 + 跟随鼠标的提示框。
         提示框是 HTML 浮层（不在 SVG 内），因此不会被「保存图片」导进 PNG。 -->
    <div ref="wrap" class="relative" @mouseenter="onEnter" @mousemove="onMove" @mouseleave="onLeave">
      <!-- 图表本体：纯 SVG 绘制（可单独导出为图片，文字用属性内联以免导出丢失样式）。
           block + mx-auto：在深色框内水平居中（限宽 480px，不再贴左） -->
      <svg
        ref="svg"
        :viewBox="`0 0 ${vbW} ${vbH}`"
        class="block mx-auto w-full h-auto rounded-lg select-none"
        :style="{ maxWidth: '480px', background: c.surface }"
        font-family="'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif"
      >
        <!-- 标题 -->
        <text v-if="title" x="12" y="18" font-size="12" font-weight="700" :fill="c.text">{{ title }}</text>

        <!-- ===================== 横向柱状图 ===================== -->
        <g v-if="type === 'barh'">
          <g v-for="g in hGrid" :key="'hg' + g.x">
            <line :x1="g.x" :x2="g.x" :y1="hplot.y0" :y2="hplot.y1" :stroke="c.border" stroke-width="1" :stroke-dasharray="g.dash" />
            <text :x="g.x" :y="hplot.y1 + 11" text-anchor="middle" font-size="8" :fill="c.muted">{{ g.label }}</text>
          </g>
          <!-- 横向准星：跟随当前行上下滑动 -->
          <line
            ref="crossLineH" class="ai-chart-cross" style="display: none"
            :x1="hplot.x0" :x2="hplot.x1" :y1="hplot.y0" :y2="hplot.y0"
            :stroke="c.primary" stroke-width="1" stroke-dasharray="3 3" opacity="0.45"
          />
          <g v-for="b in hBars" :key="'hb' + b.i" class="cursor-pointer" @click.stop="select(b.i)">
            <!-- 透明行点击区：标签区、横条和数值区都能命中 -->
            <rect :x="12" :y="b.y - 2" :width="vbW - 24" :height="b.h + 4" fill="transparent" />
            <rect
              :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="3" :fill="c.primary"
              class="ai-chart-bar" :style="barStyle(b)"
            />
            <text
              :x="hplot.x0 - 6" :y="b.cy + 3.5" text-anchor="end" font-size="9"
              :fill="focus === b.i ? c.text : c.muted" :font-weight="focus === b.i ? 600 : 400"
              class="ai-chart-label"
            >{{ short(b.label, 8) }}</text>
            <text
              :x="b.x + b.w + 4" :y="b.cy + 3.5" font-size="10" font-weight="600" :fill="c.text"
              class="ai-chart-label" :style="{ opacity: focus === b.i ? 1 : 0 }"
            >{{ fmt(b.v) }}</text>
          </g>
        </g>

        <!-- ===================== 柱状图 ===================== -->
        <g v-else-if="type === 'bar'">
          <g v-for="g in grid" :key="'g' + g.y">
            <line :x1="plot.x0" :x2="plot.x1" :y1="g.y" :y2="g.y" :stroke="c.border" stroke-width="1" :stroke-dasharray="g.dash" />
            <text :x="plot.x0 - 4" :y="g.y + 3" text-anchor="end" font-size="8" :fill="c.muted">{{ g.label }}</text>
          </g>
          <!-- 准星：跟着「最近的数据」平滑滑动。
               位置由 rAF 直接写 SVG 属性，不走响应式，避免每帧触发整个组件重渲染。 -->
          <line
            ref="crossLine" class="ai-chart-cross" style="display: none"
            :x1="plot.x0" :x2="plot.x0" :y1="plot.y0" :y2="plot.y1"
            :stroke="c.primary" stroke-width="1" stroke-dasharray="3 3" opacity="0.45"
          />
          <g v-for="b in bars" :key="'b' + b.i" class="cursor-pointer" @click.stop="select(b.i)">
            <!-- 透明加宽点击区，避免细柱难点 -->
            <rect :x="b.cx - b.w / 2 - 4" :y="plot.y0" :width="b.w + 8" :height="plot.y1 - plot.y0" fill="transparent" />
            <rect
              :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="3" :fill="c.primary"
              class="ai-chart-bar" :style="barStyle(b)"
            />
            <text
              :x="b.cx" :y="b.y - 4" text-anchor="middle" font-size="10" font-weight="600" :fill="c.text"
              class="ai-chart-label" :style="{ opacity: focus === b.i ? 1 : 0 }"
            >{{ fmt(b.v) }}</text>
          </g>
          <text
            v-for="(l, i) in axisLabels" :key="'l' + i"
            :x="bars[i] ? bars[i].cx : 0" :y="plot.y1 + 13" text-anchor="middle" font-size="8"
            :fill="focus === i ? c.text : c.muted" :font-weight="focus === i ? 600 : 400"
            class="ai-chart-label"
          >{{ short(l) }}</text>
        </g>

        <!-- ===================== 折线图 ===================== -->
        <g v-else-if="type === 'line'">
          <g v-for="g in grid" :key="'g' + g.y">
            <line :x1="plot.x0" :x2="plot.x1" :y1="g.y" :y2="g.y" :stroke="c.border" stroke-width="1" :stroke-dasharray="g.dash" />
            <text :x="plot.x0 - 4" :y="g.y + 3" text-anchor="end" font-size="8" :fill="c.muted">{{ g.label }}</text>
          </g>
          <line
            ref="crossLine" class="ai-chart-cross" style="display: none"
            :x1="plot.x0" :x2="plot.x0" :y1="plot.y0" :y2="plot.y1"
            :stroke="c.primary" stroke-width="1" stroke-dasharray="3 3" opacity="0.45"
          />
          <polyline :points="linePoints" fill="none" :stroke="c.primary" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
          <g v-for="p in points" :key="'p' + p.i" class="cursor-pointer" @click.stop="select(p.i)">
            <circle :cx="p.x" :cy="p.y" r="9" fill="transparent" />
            <!-- 悬停光晕：淡入淡出 -->
            <circle :cx="p.x" :cy="p.y" r="8" :fill="c.primary" class="ai-chart-halo" :style="{ opacity: focus === p.i ? 0.2 : 0 }" />
            <circle
              :cx="p.x" :cy="p.y" r="4" :fill="focus === p.i ? c.primaryHover : c.primary"
              :stroke="c.surface" stroke-width="1" class="ai-chart-point"
            />
            <text
              :x="p.x" :y="p.y - 9" text-anchor="middle" font-size="10" font-weight="600" :fill="c.text"
              class="ai-chart-label" :style="{ opacity: focus === p.i ? 1 : 0 }"
            >{{ fmt(p.v) }}</text>
          </g>
          <text
            v-for="(l, i) in axisLabels" :key="'l' + i"
            :x="points[i] ? points[i].x : 0" :y="plot.y1 + 13" text-anchor="middle" font-size="8"
            :fill="focus === i ? c.text : c.muted" :font-weight="focus === i ? 600 : 400"
            class="ai-chart-label"
          >{{ short(l) }}</text>
        </g>

        <!-- ===================== 饼图 ===================== -->
        <g v-else>
          <!-- 透明圆盘：鼠标落在饼图外圈一点也算命中最近的扇区 -->
          <circle :cx="pieCx" :cy="pieCy" :r="pieR + 12" fill="transparent" />
          <g
            v-for="s in slices" :key="'s' + s.i"
            :ref="(el) => setSliceEl(s.i, el)"
            class="cursor-pointer ai-chart-slice" @click.stop="select(s.i)"
          >
            <path :d="s.path" :fill="s.color" :stroke="c.surface" stroke-width="1.5" :style="{ fillOpacity: sliceOpacity(s.i) }" />
            <!-- 百分比文字放在扇区组内，跟着扇区一起外弹 -->
            <text
              v-if="s.frac > 0.08" :x="s.labelX" :y="s.labelY + 3" text-anchor="middle" font-size="9" font-weight="600" fill="#ffffff"
            >{{ Math.round(s.frac * 100) }}%</text>
          </g>
          <!-- 图例（放在 SVG 内，导出图片时一并保留） -->
          <g v-for="(s, i) in slices" :key="'lg' + i" class="cursor-pointer" @click.stop="select(i)">
            <rect :x="pieLegendX" :y="legendY(i) - 8" width="9" height="9" rx="2" :fill="s.color" />
            <text
              :x="pieLegendX + 13" :y="legendY(i) + 0.5" font-size="9"
              :fill="focus === i ? c.text : c.muted" :font-weight="focus === i ? 600 : 400"
              class="ai-chart-label"
            >{{ short(labelOf(i), 8) }} · {{ fmt(values[i]) }}<tspan v-if="unit">{{ unit }}</tspan></text>
          </g>
        </g>

        <!-- 操作提示 / 选中明细（画在 SVG 内，导出时保留） -->
        <text x="180" :y="vbH - 8" text-anchor="middle" font-size="9" :fill="c.muted">
          {{ focus >= 0 ? `${labelOf(focus)}：${fmt(values[focus])}${unit}` : hint }}
        </text>
      </svg>

      <!-- 跟随鼠标的提示框：始终存在，位置/显隐由 rAF 直接写样式。
           它只做 transform 位移（不写 left/top），不触发布局，也不会进入 SVG 导出。 -->
      <div ref="tip" class="chart-tip" style="left: 0; top: 0; display: none">
        <template v-if="tipData">
          <span class="font-medium text-text">{{ tipData.label }}</span>
          <span class="text-text-muted">{{ tipData.value }}<span v-if="unit">{{ unit }}</span></span>
          <span v-if="tipData.percent != null" class="text-text-muted">（{{ tipData.percent }}%）</span>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useNotification } from '../composables/useNotification.js'
import { INVOKE } from '../electronChannels.js'
import { hitBand, hitRow, hitPieSlice, hitLegendRow } from '../utils/chartHit.js'

defineOptions({ name: 'AiChart' })
const props = defineProps({
  data: { type: Object, required: true },
})

// 主色之外的补充色（切片超过 4 个时使用，保证同一张图里颜色不重复）
const EXTRA_PALETTE = ['#8b5cf6', '#14b8a6', '#ec4899', '#0ea5e9', '#f97316', '#64748b', '#a3e635', '#a855f7']

// 动画参数
const SLICE_OUT = 9        // 扇区被固定选中时的外弹距离（SVG 用户单位）
const SLICE_OUT_HOVER = 4  // 仅悬停时的轻微外弹
const EASE_TAU = 60        // 缓动时间常数（毫秒），越小越快收敛

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// AI 图表：按 { type, title, labels, values, unit } 绘制柱状/折线/饼图。
// 交互：鼠标靠近自动选中最近的数据并弹出跟随鼠标的提示框；点击可固定选中；扇区外弹等位置动画走属性插值。

// 模板 ref（与模板 ref="xxx" 同名自动绑定）
const wrap = ref(null)
const svg = ref(null)
const tip = ref(null)
const crossLine = ref(null)
const crossLineH = ref(null)

const sel = ref(-1)     // 点击固定的下标（-1 为未选中）
const hover = ref(-1)   // 悬停命中的下标（自动选中的「最近数据」）
const tipState = ref({ i: -1 })  // 提示框当前内容对应的下标（坐标/显隐不走响应式）
const saving = ref(false)
// 主题色快照：SVG 元素用内联属性着色，导出为图片时样式不会丢
const c = ref({
  primary: '#22c55e', primaryHover: '#16a34a', surface: '#ffffff',
  text: '#111827', muted: '#6b7280', border: '#e5e7eb',
  info: '#3b82f6', warning: '#f59e0b', danger: '#ef4444', success: '#22c55e',
})

// 非响应式的交互/动画状态：每帧改这些不会触发 Vue 重渲染
let _sliceEls = []      // 扇区 <g> 的 DOM 引用（按下标存）
let _offs = []          // 各扇区当前外移量（动画中间值）
let _crossX = null      // 准星当前横坐标（动画中间值）
let _pending = null     // 最近一次鼠标位置（等下一帧处理）
let _rect = null        // 缓存的图表/容器矩形，避免每帧 getBoundingClientRect 触发重排
let _moveRaf = 0        // 鼠标移动的节流帧
let _animRaf = 0        // 位置动画的帧（与鼠标移动分开，互不阻塞）
let _lastT = 0
let _tipSize = { w: 0, h: 0 }
let _tipPos = { x: 0, y: 0 }
let _wrapW = 0
let _tipVisible = false
let _ro = null
let _onViewportChange = null

const type = computed(() => ['bar', 'barh', 'pie', 'line'].includes(props.data.type) ? props.data.type : 'bar')
const title = computed(() => props.data.title || '')
const unit = computed(() => props.data.unit || '')
const labels = computed(() => (Array.isArray(props.data.labels) ? props.data.labels : []))
const values = computed(() =>
  (Array.isArray(props.data.values) ? props.data.values : [])
    .map((v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }))
const vbW = computed(() => 360)
// 横向柱状图没有底部 x 轴标签，给更多行高，同时把数值刻度留在底部
const vbH = computed(() => (type.value === 'barh' ? 250 : 230))
const palette = computed(() => [c.value.primary, c.value.info, c.value.warning, c.value.danger, ...EXTRA_PALETTE])
// 柱状/折线的绘图区（y0 下移，给标题和最高网格线之间留出呼吸空间）
const plot = computed(() => ({ x0: 36, x1: 348, y0: 52, y1: 168 }))
// 横向柱状图：左侧留出类别名，右侧留出数值文字的空间
const hplot = computed(() => ({ x0: 92, x1: 318, y0: 52, y1: 210 }))
const maxVal = computed(() => {
  const m = Math.max(0, ...values.value)
  return m > 0 ? m : 1
})
// 横向网格线（0 / 中值 / 最大值）
const grid = computed(() => {
  const { y0, y1 } = plot.value
  const half = maxVal.value / 2
  return [
    { y: y1, label: num(0), dash: '0' },
    { y: (y0 + y1) / 2, label: num(half), dash: '3 3' },
    { y: y0, label: num(maxVal.value), dash: '3 3' },
  ]
})
const bars = computed(() => {
  const { x0, x1, y0, y1 } = plot.value
  const band = (x1 - x0) / Math.max(1, values.value.length)
  const w = Math.min(30, band * 0.55)
  return values.value.map((v, i) => {
    const cx = x0 + band * (i + 0.5)
    const h = Math.max(2, (Math.max(0, v) / maxVal.value) * (y1 - y0))
    return { i, v, cx, w, x: cx - w / 2, y: y1 - h, h }
  })
})
// 纵向网格线（0 / 中值 / 最大值），底部显示数值刻度
const hGrid = computed(() => {
  const { x0, x1 } = hplot.value
  const half = maxVal.value / 2
  return [
    { x: x0, label: num(0), dash: '0' },
    { x: (x0 + x1) / 2, label: num(half), dash: '3 3' },
    { x: x1, label: num(maxVal.value), dash: '3 3' },
  ]
})
const hBars = computed(() => {
  const { x0, x1, y0, y1 } = hplot.value
  const band = (y1 - y0) / Math.max(1, values.value.length)
  const h = Math.min(18, band * 0.62)
  return values.value.map((v, i) => {
    const cy = y0 + band * (i + 0.5)
    const w = Math.max(2, (Math.max(0, v) / maxVal.value) * (x1 - x0))
    return { i, v, cy, h, x: x0, y: cy - h / 2, w, label: labelOf(i) }
  })
})
const points = computed(() => {
  const { x0, x1, y0, y1 } = plot.value
  const band = (x1 - x0) / Math.max(1, values.value.length)
  return values.value.map((v, i) => ({
    i, v,
    x: x0 + band * (i + 0.5),
    y: y1 - (Math.max(0, v) / maxVal.value) * (y1 - y0),
  }))
})
const linePoints = computed(() => points.value.map((p) => `${p.x},${p.y}`).join(' '))
const total = computed(() => values.value.reduce((a, b) => a + Math.max(0, b), 0) || 1)
// 饼图圆心与半径（命中测试与外弹方向共用）
const pieCx = computed(() => 110)
const pieCy = computed(() => 118)
const pieR = computed(() => 64)
// 只算静态几何（路径 / 颜色 / 扇区中线）。外弹位移由 rAF 直接写 DOM，
// 不能让 slices 依赖动画状态，否则每帧都会重算所有路径并触发整棵组件重渲染。
const slices = computed(() => {
  const cx = pieCx.value, cy = pieCy.value, r = pieR.value
  const out = []
  let start = -Math.PI / 2
  values.value.forEach((v, i) => {
    const frac = Math.max(0, v) / total.value
    const end = start + frac * Math.PI * 2
    const s = polar(cx, cy, r, start)
    const e = polar(cx, cy, r, end)
    const large = end - start > Math.PI ? 1 : 0
    // 单项占满（100%）时弧线退化，改用整圆
    const path = frac >= 0.9999
      ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
      : `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`
    const mid = (start + end) / 2
    const lp = polar(cx, cy, r * 0.62, mid)
    out.push({
      i, v, frac, mid, path,
      labelX: lp.x, labelY: lp.y,
      color: palette.value[i % palette.value.length],
    })
    start = end
  })
  return out
})
// 柱状/折线的 x 轴标签：与数值一一对应，避免多余标签堆在左侧
const axisLabels = computed(() => labels.value.slice(0, values.value.length))
const pieLegendX = computed(() => 196)
// 图例每行基线的 y，命中测试用（缓存，避免每次 mousemove 临时建数组）
const legendRows = computed(() => slices.value.map((_, i) => legendY(i)))
const hint = computed(() => {
  if (type.value === 'pie') return '移动鼠标查看占比 · 点击扇区固定'
  if (type.value === 'line') return '移动鼠标查看数值 · 点击数据点固定'
  if (type.value === 'barh') return '移动鼠标查看数据 · 点击横条固定'
  return '移动鼠标查看数据 · 点击柱子固定'
})
// 当前高亮项：悬停优先（鼠标靠近即自动选中最近的数据），否则用点击固定的那一个
const focus = computed(() => {
  if (hover.value >= 0 && hover.value < values.value.length) return hover.value
  if (sel.value >= 0 && sel.value < values.value.length) return sel.value
  return -1
})
// 提示框内容
const tipData = computed(() => {
  const i = tipState.value.i
  if (i < 0 || i >= values.value.length) return null
  return {
    label: labelOf(i),
    value: fmt(values.value[i]),
    percent: type.value === 'pie' ? Math.round((Math.max(0, values.value[i]) / total.value) * 100) : null,
  }
})

// 数据换了就清掉旧的悬停/选中，避免下标越界
watch(() => props.data, () => {
  sel.value = -1
  hover.value = -1
  stopAnim()
  _tipVisible = false
  tipState.value.i = -1
  _offs = []
  _crossX = null
  // DOM 复用的扇区可能还带着上一份数据的外弹位移，等渲染完再清掉
  nextTick(() => {
    _sliceEls.forEach((el) => el && el.removeAttribute('transform'))
    hideCrosshair()
    updateTip()
  })
})
watch(sel, () => { startAnim() })
watch(hover, () => { startAnim() })
watch(() => tipState.value.i, () => {
  // 提示框内容变了 → 尺寸可能变 → 重新量一次用于翻转判断
  nextTick(() => measureTip())
})

onMounted(() => {
  c.value = {
    primary: cssVar('--color-primary', c.value.primary),
    primaryHover: cssVar('--color-primary-hover', c.value.primaryHover),
    surface: cssVar('--color-surface', c.value.surface),
    text: cssVar('--color-text', c.value.text),
    muted: cssVar('--color-text-muted', c.value.muted),
    border: cssVar('--color-border', c.value.border),
    info: cssVar('--color-info', c.value.info),
    warning: cssVar('--color-warning', c.value.warning),
    danger: cssVar('--color-danger', c.value.danger),
    success: cssVar('--color-success', c.value.success),
  }
  // 图表尺寸/位置变化（窗口缩放、聊天区滚动、布局变化）时让缓存矩形失效
  _onViewportChange = () => { _rect = null }
  window.addEventListener('scroll', _onViewportChange, { capture: true, passive: true })
  window.addEventListener('resize', _onViewportChange)
  if (typeof ResizeObserver !== 'undefined') {
    _ro = new ResizeObserver(_onViewportChange)
    if (wrap.value) _ro.observe(wrap.value)
    if (svg.value) _ro.observe(svg.value)
  }
  nextTick(() => measureTip())
})

onBeforeUnmount(() => {
  stopAnim()
  if (_moveRaf) cancelAnimationFrame(_moveRaf)
  _moveRaf = 0
  window.removeEventListener('scroll', _onViewportChange, { capture: true })
  window.removeEventListener('resize', _onViewportChange)
  if (_ro) _ro.disconnect()
})

// ===== 命中测试 =====
// 把鼠标位置换算成 SVG 用户坐标（viewBox 内），再判断落在哪个数据上
function hitIndex(ux, uy) {
  if (type.value === 'pie') {
    const onSlice = hitPieSlice(ux, uy, slices.value, pieCx.value, pieCy.value, pieR.value, 14)
    if (onSlice >= 0) return onSlice
    // 图例也能命中对应扇区
    return hitLegendRow(ux, uy, legendRows.value, pieLegendX.value)
  }
  // 横向柱状图：按 y 落到哪一行就算哪一行；标签区和数值区也允许命中
  if (type.value === 'barh') {
    const { y0, y1 } = hplot.value
    if (ux < 6 || ux > vbW.value - 6 || uy < y0 - 10 || uy > y1 + 10) return -1
    return hitRow(uy, values.value.length, y0, y1)
  }
  // 柱状/折线：按 x 落到哪一列就算哪一列；纵向超出绘图区则不算命中
  const { y0, y1 } = plot.value
  if (uy < y0 - 12 || uy > y1 + 18) return -1
  return hitBand(ux, values.value.length, plot.value.x0, plot.value.x1)
}
// 记下扇区 DOM，动画时直接写 transform 属性
function setSliceEl(i, el) {
  if (!_sliceEls) _sliceEls = []
  if (el) _sliceEls[i] = el
  else delete _sliceEls[i]
}
// 图表/容器的矩形缓存：只在首次进入或尺寸变化后量一次
function measureRect() {
  const svgEl = svg.value
  const wrapEl = wrap.value
  if (!svgEl || !wrapEl) return null
  const sr = svgEl.getBoundingClientRect()
  if (!sr.width || !sr.height) return null
  const wr = wrapEl.getBoundingClientRect()
  _wrapW = wr.width
  return {
    left: sr.left, top: sr.top,
    wrapLeft: wr.left, wrapTop: wr.top,
    scale: vbW.value / sr.width,
  }
}
function onMove(e) {
  // 一帧只处理一次鼠标移动；与位置动画的 rAF 分开，动画进行中也不阻塞跟手
  _pending = { x: e.clientX, y: e.clientY }
  if (_moveRaf) return
  _moveRaf = requestAnimationFrame(() => {
    _moveRaf = 0
    applyMove()
  })
}
// 每次进入图表都重新量一次位置，避免聊天区内容变化后缓存的矩形过期
function onEnter() {
  _rect = null
}
function applyMove() {
  const p = _pending
  if (!p) return
  if (!_rect) _rect = measureRect()
  const r = _rect
  if (!r) return
  const ux = (p.x - r.left) * r.scale
  const uy = (p.y - r.top) * r.scale
  const idx = hitIndex(ux, uy)
  _tipPos = { x: p.x - r.wrapLeft, y: p.y - r.wrapTop }
  _tipVisible = idx >= 0
  // hover / tip.i 只在真正跨过数据项时更新，减少组件重渲染
  if (tipState.value.i !== idx) tipState.value.i = idx
  if (hover.value !== idx) hover.value = idx
  updateTip()
}
function onLeave() {
  _pending = null
  if (_moveRaf) {
    cancelAnimationFrame(_moveRaf)
    _moveRaf = 0
  }
  _tipVisible = false
  tipState.value.i = -1
  hover.value = -1
  updateTip()
}
function measureTip() {
  const el = tip.value
  if (!el || el.style.display === 'none') return
  _tipSize = { w: el.offsetWidth, h: el.offsetHeight }
  updateTip()
}
// 提示框位置：只写 transform（合成层位移，不触发布局），并做靠边翻转
function updateTip() {
  const el = tip.value
  if (!el) return
  if (!_tipVisible || !tipData.value) {
    el.style.display = 'none'
    return
  }
  const { x, y } = _tipPos
  const { w, h } = _tipSize
  const gap = 12
  let tx = x + gap
  let ty = y - gap - h
  if (w > 0 && tx + w > _wrapW) tx = x - gap - w
  if (ty < 0) ty = y + gap
  el.style.display = 'flex'
  el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
}
function select(i) {
  sel.value = sel.value === i ? -1 : i
}

// ===== 位置动画（扇区外弹 / 准星滑动）=====
// 目标值：固定选中的扇区明显外弹，仅悬停时轻微外弹；准星滑到高亮项
function animTargets() {
  const n = values.value.length
  const pie = []
  for (let i = 0; i < n; i++) {
    if (i === sel.value) pie.push(SLICE_OUT)
    else if (i === hover.value) pie.push(SLICE_OUT_HOVER)
    else pie.push(0)
  }
  let cross = null
  if (focus.value >= 0 && type.value !== 'pie') {
    if (type.value === 'barh') {
      const p = hBars.value[focus.value]
      cross = p ? p.cy : null
    } else {
      const arr = type.value === 'bar' ? bars.value : points.value
      const p = arr[focus.value]
      cross = p ? (type.value === 'bar' ? p.cx : p.x) : null
    }
  }
  return { pie, cross }
}
function startAnim() {
  if (_animRaf) return
  const step = () => {
    const t = animTargets()
    const now = performance.now()
    const dt = _lastT ? Math.min(64, now - _lastT) : 16
    _lastT = now
    const k = 1 - Math.exp(-dt / EASE_TAU) // 时间常数缓动，与帧率无关
    let moving = false
    // 动画只直接改 SVG 属性（transform / x1 / x2），不写响应式状态，
    // 因此每帧不会触发 Vue 重渲染和 slices 重算。
    if (type.value === 'pie') {
      if (_offs.length !== t.pie.length) _offs = new Array(t.pie.length).fill(0)
      for (let i = 0; i < t.pie.length; i++) {
        const cur = _offs[i] || 0
        const next = cur + (t.pie[i] - cur) * k
        if (Math.abs(t.pie[i] - next) > 0.05) moving = true
        _offs[i] = next
        applySliceOffset(i, next)
      }
    }
    if (t.cross != null) {
      const next = _crossX == null ? t.cross : _crossX + (t.cross - _crossX) * k
      if (Math.abs(t.cross - next) > 0.2) moving = true
      _crossX = next
      setCrosshair(next)
    } else if (_crossX != null) {
      _crossX = null
      hideCrosshair()
    }
    if (moving) {
      _animRaf = requestAnimationFrame(step)
    } else {
      // 收敛后停在目标值（避免残留微小误差）
      applyFinalState(t)
      _animRaf = 0
      _lastT = 0
    }
  }
  _animRaf = requestAnimationFrame(step)
}
function stopAnim() {
  if (_animRaf) cancelAnimationFrame(_animRaf)
  _animRaf = 0
  _lastT = 0
}
// 立即把动画跳到终态（导出图片前用，保证 PNG 与「固定选中」状态一致）
function snapAnim() {
  stopAnim()
  applyFinalState(animTargets())
}
function applyFinalState(t) {
  if (type.value === 'pie') {
    _offs = t.pie.slice()
    for (let i = 0; i < _offs.length; i++) applySliceOffset(i, _offs[i])
  }
  if (t.cross != null) {
    _crossX = t.cross
    setCrosshair(t.cross)
  } else {
    _crossX = null
    hideCrosshair()
  }
}
// 扇区沿自身中线外弹：直接写 transform 属性
function applySliceOffset(i, off) {
  const el = _sliceEls[i]
  if (!el) return
  if (off > 0.02) {
    const s = slices.value[i]
    if (!s) return
    const ox = Math.cos(s.mid) * off
    const oy = Math.sin(s.mid) * off
    el.setAttribute('transform', `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`)
  } else if (el.hasAttribute('transform')) {
    el.removeAttribute('transform')
  }
}
function setCrosshair(pos) {
  if (type.value === 'barh') {
    const line = crossLineH.value
    if (!line) return
    line.setAttribute('y1', pos)
    line.setAttribute('y2', pos)
    line.style.display = ''
    return
  }
  const line = crossLine.value
  if (!line) return
  line.setAttribute('x1', pos)
  line.setAttribute('x2', pos)
  line.style.display = ''
}
function hideCrosshair() {
  const v = crossLine.value
  if (v) v.style.display = 'none'
  const h = crossLineH.value
  if (h) h.style.display = 'none'
}

// ===== 高亮样式（颜色类动画交给 CSS 过渡）=====
function sliceOpacity(i) {
  // 有选中项时，其余扇区变暗
  if (focus.value < 0 && sel.value < 0) return 0.9
  return (i === focus.value || i === sel.value) ? 1 : 0.42
}
function barStyle(b) {
  const on = focus.value === b.i
  return {
    fillOpacity: on ? 1 : 0.82,
    stroke: c.value.primaryHover,
    strokeWidth: on ? 1.5 : 0,
  }
}

function labelOf(i) {
  const v = labels.value[i]
  return v == null || v === '' ? `第 ${i + 1} 项` : String(v)
}
function short(s, len = 6) {
  const t = String(s == null ? '' : s)
  return t.length > len ? t.slice(0, len) + '…' : t
}
function num(v) {
  const n = Math.round(v * 100) / 100
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n)
}
function fmt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}
function polar(cx, cy, r, ang) {
  return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) }
}
function legendY(i) {
  const n = slices.value.length
  const rowH = n <= 6 ? 18 : 14
  return 52 + i * rowH
}
async function saveImage() {
  const svgEl = svg.value
  if (!svgEl || saving.value) return
  saving.value = true
  const { success: notify, error: notifyError } = useNotification()
  // 导出的是「固定选中」的状态：临时清掉悬停、并把动画跳到终态，再克隆 DOM
  const hov = hover.value
  hover.value = -1
  snapAnim()
  await nextTick()
  try {
    const w = vbW.value, h = vbH.value
    const clone = svgEl.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(w))
    clone.setAttribute('height', String(h))
    // 铺一层底色，避免导出 PNG 背景透明
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0')
    bg.setAttribute('width', String(w)); bg.setAttribute('height', String(h))
    bg.setAttribute('fill', c.value.surface)
    clone.insertBefore(bg, clone.firstChild)
    const xml = new XMLSerializer().serializeToString(clone)
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = () => rej(new Error('图表渲染失败'))
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
    })
    const scale = 2 // 2 倍分辨率，导出的图片更清晰
    const canvas = document.createElement('canvas')
    canvas.width = w * scale
    canvas.height = h * scale
    const ctx2 = canvas.getContext('2d')
    ctx2.fillStyle = c.value.surface
    ctx2.fillRect(0, 0, canvas.width, canvas.height)
    ctx2.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('图片生成失败')
    const name = `${(title.value || '图表').replace(/[\\/:*?"<>|]/g, '_')}.png`
    await saveBlob(name, blob)
    notify('图表已保存')
  } catch (err) {
    // 用户在保存对话框点了取消，不算失败
    if (err && err.message !== '已取消') notifyError('保存失败：' + (err.message || '未知错误'))
  } finally {
    saving.value = false
    hover.value = hov
    startAnim()
  }
}
// 弹系统保存对话框，用户确认后才写入
async function saveBlob(defaultName, blob) {
  const data = await blob.arrayBuffer()
  const result = await window.electron.invoke(INVOKE.SAVE_FILE, { defaultName, data })
  if (!result || result.canceled) throw new Error('已取消')
}
</script>

<style scoped>
/* 颜色类动画（高亮、光晕、变暗）走 CSS 过渡。
   位置类动画（扇区外弹、准星滑动）走 rAF 插值写 SVG 属性，
   这样导出的 PNG 与屏幕上的最终状态一致（CSS 过渡不会被导出）。 */
.ai-chart-bar { transition: fill-opacity 180ms ease, stroke-width 180ms ease; }
.ai-chart-point { transition: fill 180ms ease; }
.ai-chart-halo { transition: opacity 200ms ease; }
.ai-chart-slice path { transition: fill-opacity 240ms ease; }
.ai-chart-label { transition: fill 180ms ease, opacity 180ms ease; }
/* 准星只做属性更新，不参与命中，避免抢占鼠标事件 */
.ai-chart-cross { pointer-events: none; }

/* 跟随鼠标的提示框：HTML 浮层，不参与 SVG 导出 */
.chart-tip {
  position: absolute;
  z-index: 10;
  pointer-events: none;
  display: flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
  will-change: transform;
  font-size: 11px;
  line-height: 1.5;
  padding: 3px 8px;
  border-radius: var(--radius-control);
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  box-shadow: var(--shadow-md, 0 4px 6px rgba(0, 0, 0, 0.07));
}
</style>
