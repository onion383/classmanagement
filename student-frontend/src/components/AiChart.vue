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

<script>
import { useNotification } from '../composables/useNotification.js'
import { INVOKE } from '../electronChannels.js'
import { hitBand, hitRow, hitPieSlice, hitLegendRow } from '../utils/chartHit.js'

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
export default {
  name: 'AiChart',
  props: {
    data: { type: Object, required: true },
  },
  data() {
    return {
      sel: -1,     // 点击固定的下标（-1 为未选中）
      hover: -1,   // 悬停命中的下标（自动选中的「最近数据」）
      tip: { i: -1 },  // 提示框当前内容对应的下标（坐标/显隐不走响应式）
      saving: false,
      // 主题色快照：SVG 元素用内联属性着色，导出为图片时样式不会丢
      c: {
        primary: '#22c55e', primaryHover: '#16a34a', surface: '#ffffff',
        text: '#111827', muted: '#6b7280', border: '#e5e7eb',
        info: '#3b82f6', warning: '#f59e0b', danger: '#ef4444', success: '#22c55e',
      },
    }
  },
  computed: {
    type() {
      return ['bar', 'barh', 'pie', 'line'].includes(this.data.type) ? this.data.type : 'bar'
    },
    title() { return this.data.title || '' },
    unit() { return this.data.unit || '' },
    labels() { return Array.isArray(this.data.labels) ? this.data.labels : [] },
    values() {
      return (Array.isArray(this.data.values) ? this.data.values : [])
        .map((v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 })
    },
    vbW() { return 360 },
    // 横向柱状图没有底部 x 轴标签，给更多行高，同时把数值刻度留在底部
    vbH() { return this.type === 'barh' ? 250 : 230 },
    palette() {
      return [this.c.primary, this.c.info, this.c.warning, this.c.danger, ...EXTRA_PALETTE]
    },
    // 柱状/折线的绘图区（y0 下移，给标题和最高网格线之间留出呼吸空间）
    plot() { return { x0: 36, x1: 348, y0: 52, y1: 168 } },
    // 横向柱状图：左侧留出类别名，右侧留出数值文字的空间
    hplot() { return { x0: 92, x1: 318, y0: 52, y1: 210 } },
    maxVal() {
      const m = Math.max(0, ...this.values)
      return m > 0 ? m : 1
    },
    // 横向网格线（0 / 中值 / 最大值）
    grid() {
      const { y0, y1 } = this.plot
      const half = this.maxVal / 2
      return [
        { y: y1, label: this.num(0), dash: '0' },
        { y: (y0 + y1) / 2, label: this.num(half), dash: '3 3' },
        { y: y0, label: this.num(this.maxVal), dash: '3 3' },
      ]
    },
    bars() {
      const { x0, x1, y0, y1 } = this.plot
      const band = (x1 - x0) / Math.max(1, this.values.length)
      const w = Math.min(30, band * 0.55)
      return this.values.map((v, i) => {
        const cx = x0 + band * (i + 0.5)
        const h = Math.max(2, (Math.max(0, v) / this.maxVal) * (y1 - y0))
        return { i, v, cx, w, x: cx - w / 2, y: y1 - h, h }
      })
    },
    // 纵向网格线（0 / 中值 / 最大值），底部显示数值刻度
    hGrid() {
      const { x0, x1 } = this.hplot
      const half = this.maxVal / 2
      return [
        { x: x0, label: this.num(0), dash: '0' },
        { x: (x0 + x1) / 2, label: this.num(half), dash: '3 3' },
        { x: x1, label: this.num(this.maxVal), dash: '3 3' },
      ]
    },
    hBars() {
      const { x0, x1, y0, y1 } = this.hplot
      const band = (y1 - y0) / Math.max(1, this.values.length)
      const h = Math.min(18, band * 0.62)
      return this.values.map((v, i) => {
        const cy = y0 + band * (i + 0.5)
        const w = Math.max(2, (Math.max(0, v) / this.maxVal) * (x1 - x0))
        return { i, v, cy, h, x: x0, y: cy - h / 2, w, label: this.labelOf(i) }
      })
    },
    points() {
      const { x0, x1, y0, y1 } = this.plot
      const band = (x1 - x0) / Math.max(1, this.values.length)
      return this.values.map((v, i) => ({
        i, v,
        x: x0 + band * (i + 0.5),
        y: y1 - (Math.max(0, v) / this.maxVal) * (y1 - y0),
      }))
    },
    linePoints() {
      return this.points.map((p) => `${p.x},${p.y}`).join(' ')
    },
    total() {
      return this.values.reduce((a, b) => a + Math.max(0, b), 0) || 1
    },
    // 饼图圆心与半径（命中测试与外弹方向共用）
    pieCx() { return 110 },
    pieCy() { return 118 },
    pieR() { return 64 },
    // 只算静态几何（路径 / 颜色 / 扇区中线）。外弹位移由 rAF 直接写 DOM，
    // 不能让 slices 依赖动画状态，否则每帧都会重算所有路径并触发整棵组件重渲染。
    slices() {
      const cx = this.pieCx, cy = this.pieCy, r = this.pieR
      const out = []
      let start = -Math.PI / 2
      this.values.forEach((v, i) => {
        const frac = Math.max(0, v) / this.total
        const end = start + frac * Math.PI * 2
        const s = this.polar(cx, cy, r, start)
        const e = this.polar(cx, cy, r, end)
        const large = end - start > Math.PI ? 1 : 0
        // 单项占满（100%）时弧线退化，改用整圆
        const path = frac >= 0.9999
          ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
          : `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`
        const mid = (start + end) / 2
        const lp = this.polar(cx, cy, r * 0.62, mid)
        out.push({
          i, v, frac, mid, path,
          labelX: lp.x, labelY: lp.y,
          color: this.palette[i % this.palette.length],
        })
        start = end
      })
      return out
    },
    // 柱状/折线的 x 轴标签：与数值一一对应，避免多余标签堆在左侧
    axisLabels() { return this.labels.slice(0, this.values.length) },
    pieLegendX() { return 196 },
    // 图例每行基线的 y，命中测试用（缓存，避免每次 mousemove 临时建数组）
    legendRows() { return this.slices.map((_, i) => this.legendY(i)) },
    hint() {
      if (this.type === 'pie') return '移动鼠标查看占比 · 点击扇区固定'
      if (this.type === 'line') return '移动鼠标查看数值 · 点击数据点固定'
      if (this.type === 'barh') return '移动鼠标查看数据 · 点击横条固定'
      return '移动鼠标查看数据 · 点击柱子固定'
    },
    // 当前高亮项：悬停优先（鼠标靠近即自动选中最近的数据），否则用点击固定的那一个
    focus() {
      if (this.hover >= 0 && this.hover < this.values.length) return this.hover
      if (this.sel >= 0 && this.sel < this.values.length) return this.sel
      return -1
    },
    // 提示框内容
    tipData() {
      const i = this.tip.i
      if (i < 0 || i >= this.values.length) return null
      return {
        label: this.labelOf(i),
        value: this.fmt(this.values[i]),
        percent: this.type === 'pie' ? Math.round((Math.max(0, this.values[i]) / this.total) * 100) : null,
      }
    },
  },
  watch: {
    // 数据换了就清掉旧的悬停/选中，避免下标越界
    data() {
      this.sel = -1
      this.hover = -1
      this.stopAnim()
      this._tipVisible = false
      this.tip.i = -1
      this._offs = []
      this._crossX = null
      // DOM 复用的扇区可能还带着上一份数据的外弹位移，等渲染完再清掉
      this.$nextTick(() => {
        this._sliceEls.forEach((el) => el && el.removeAttribute('transform'))
        this.hideCrosshair()
        this.updateTip()
      })
    },
    sel() { this.startAnim() },
    hover() { this.startAnim() },
    'tip.i'() {
      // 提示框内容变了 → 尺寸可能变 → 重新量一次用于翻转判断
      this.$nextTick(() => this.measureTip())
    },
  },
  created() {
    // 非响应式的交互/动画状态：每帧改这些不会触发 Vue 重渲染
    this._sliceEls = []      // 扇区 <g> 的 DOM 引用（按下标存）
    this._offs = []          // 各扇区当前外移量（动画中间值）
    this._crossX = null      // 准星当前横坐标（动画中间值）
    this._pending = null     // 最近一次鼠标位置（等下一帧处理）
    this._rect = null        // 缓存的图表/容器矩形，避免每帧 getBoundingClientRect 触发重排
    this._moveRaf = 0        // 鼠标移动的节流帧
    this._animRaf = 0        // 位置动画的帧（与鼠标移动分开，互不阻塞）
    this._lastT = 0
    this._tipSize = { w: 0, h: 0 }
    this._tipPos = { x: 0, y: 0 }
    this._wrapW = 0
    this._tipVisible = false
  },
  mounted() {
    this.c = {
      primary: cssVar('--color-primary', this.c.primary),
      primaryHover: cssVar('--color-primary-hover', this.c.primaryHover),
      surface: cssVar('--color-surface', this.c.surface),
      text: cssVar('--color-text', this.c.text),
      muted: cssVar('--color-text-muted', this.c.muted),
      border: cssVar('--color-border', this.c.border),
      info: cssVar('--color-info', this.c.info),
      warning: cssVar('--color-warning', this.c.warning),
      danger: cssVar('--color-danger', this.c.danger),
      success: cssVar('--color-success', this.c.success),
    }
    // 图表尺寸/位置变化（窗口缩放、聊天区滚动、布局变化）时让缓存矩形失效
    this._onViewportChange = () => { this._rect = null }
    window.addEventListener('scroll', this._onViewportChange, { capture: true, passive: true })
    window.addEventListener('resize', this._onViewportChange)
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onViewportChange)
      if (this.$refs.wrap) this._ro.observe(this.$refs.wrap)
      if (this.$refs.svg) this._ro.observe(this.$refs.svg)
    }
    this.$nextTick(() => this.measureTip())
  },
  beforeUnmount() {
    this.stopAnim()
    if (this._moveRaf) cancelAnimationFrame(this._moveRaf)
    this._moveRaf = 0
    window.removeEventListener('scroll', this._onViewportChange, { capture: true })
    window.removeEventListener('resize', this._onViewportChange)
    if (this._ro) this._ro.disconnect()
  },
  methods: {
    // ===== 命中测试 =====
    // 把鼠标位置换算成 SVG 用户坐标（viewBox 内），再判断落在哪个数据上
    hitIndex(ux, uy) {
      if (this.type === 'pie') {
        const onSlice = hitPieSlice(ux, uy, this.slices, this.pieCx, this.pieCy, this.pieR, 14)
        if (onSlice >= 0) return onSlice
        // 图例也能命中对应扇区
        return hitLegendRow(ux, uy, this.legendRows, this.pieLegendX)
      }
      // 横向柱状图：按 y 落到哪一行就算哪一行；标签区和数值区也允许命中
      if (this.type === 'barh') {
        const { y0, y1 } = this.hplot
        if (ux < 6 || ux > this.vbW - 6 || uy < y0 - 10 || uy > y1 + 10) return -1
        return hitRow(uy, this.values.length, y0, y1)
      }
      // 柱状/折线：按 x 落到哪一列就算哪一列；纵向超出绘图区则不算命中
      const { y0, y1 } = this.plot
      if (uy < y0 - 12 || uy > y1 + 18) return -1
      return hitBand(ux, this.values.length, this.plot.x0, this.plot.x1)
    },
    // 记下扇区 DOM，动画时直接写 transform 属性
    setSliceEl(i, el) {
      if (!this._sliceEls) this._sliceEls = []
      if (el) this._sliceEls[i] = el
      else delete this._sliceEls[i]
    },
    // 图表/容器的矩形缓存：只在首次进入或尺寸变化后量一次
    measureRect() {
      const svg = this.$refs.svg
      const wrap = this.$refs.wrap
      if (!svg || !wrap) return null
      const sr = svg.getBoundingClientRect()
      if (!sr.width || !sr.height) return null
      const wr = wrap.getBoundingClientRect()
      this._wrapW = wr.width
      return {
        left: sr.left, top: sr.top,
        wrapLeft: wr.left, wrapTop: wr.top,
        scale: this.vbW / sr.width,
      }
    },
    onMove(e) {
      // 一帧只处理一次鼠标移动；与位置动画的 rAF 分开，动画进行中也不阻塞跟手
      this._pending = { x: e.clientX, y: e.clientY }
      if (this._moveRaf) return
      this._moveRaf = requestAnimationFrame(() => {
        this._moveRaf = 0
        this.applyMove()
      })
    },
    // 每次进入图表都重新量一次位置，避免聊天区内容变化后缓存的矩形过期
    onEnter() {
      this._rect = null
    },
    applyMove() {
      const p = this._pending
      if (!p) return
      if (!this._rect) this._rect = this.measureRect()
      const r = this._rect
      if (!r) return
      const ux = (p.x - r.left) * r.scale
      const uy = (p.y - r.top) * r.scale
      const idx = this.hitIndex(ux, uy)
      this._tipPos = { x: p.x - r.wrapLeft, y: p.y - r.wrapTop }
      this._tipVisible = idx >= 0
      // hover / tip.i 只在真正跨过数据项时更新，减少组件重渲染
      if (this.tip.i !== idx) this.tip.i = idx
      if (this.hover !== idx) this.hover = idx
      this.updateTip()
    },
    onLeave() {
      this._pending = null
      if (this._moveRaf) {
        cancelAnimationFrame(this._moveRaf)
        this._moveRaf = 0
      }
      this._tipVisible = false
      this.tip.i = -1
      this.hover = -1
      this.updateTip()
    },
    measureTip() {
      const el = this.$refs.tip
      if (!el || el.style.display === 'none') return
      this._tipSize = { w: el.offsetWidth, h: el.offsetHeight }
      this.updateTip()
    },
    // 提示框位置：只写 transform（合成层位移，不触发布局），并做靠边翻转
    updateTip() {
      const el = this.$refs.tip
      if (!el) return
      if (!this._tipVisible || !this.tipData) {
        el.style.display = 'none'
        return
      }
      const { x, y } = this._tipPos
      const { w, h } = this._tipSize
      const gap = 12
      let tx = x + gap
      let ty = y - gap - h
      if (w > 0 && tx + w > this._wrapW) tx = x - gap - w
      if (ty < 0) ty = y + gap
      el.style.display = 'flex'
      el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
    },
    select(i) {
      this.sel = this.sel === i ? -1 : i
    },

    // ===== 位置动画（扇区外弹 / 准星滑动）=====
    // 目标值：固定选中的扇区明显外弹，仅悬停时轻微外弹；准星滑到高亮项
    animTargets() {
      const n = this.values.length
      const pie = []
      for (let i = 0; i < n; i++) {
        if (i === this.sel) pie.push(SLICE_OUT)
        else if (i === this.hover) pie.push(SLICE_OUT_HOVER)
        else pie.push(0)
      }
      let cross = null
      if (this.focus >= 0 && this.type !== 'pie') {
        if (this.type === 'barh') {
          const p = this.hBars[this.focus]
          cross = p ? p.cy : null
        } else {
          const arr = this.type === 'bar' ? this.bars : this.points
          const p = arr[this.focus]
          cross = p ? (this.type === 'bar' ? p.cx : p.x) : null
        }
      }
      return { pie, cross }
    },
    startAnim() {
      if (this._animRaf) return
      const step = () => {
        const t = this.animTargets()
        const now = performance.now()
        const dt = this._lastT ? Math.min(64, now - this._lastT) : 16
        this._lastT = now
        const k = 1 - Math.exp(-dt / EASE_TAU) // 时间常数缓动，与帧率无关
        let moving = false
        // 动画只直接改 SVG 属性（transform / x1 / x2），不写响应式状态，
        // 因此每帧不会触发 Vue 重渲染和 slices 重算。
        if (this.type === 'pie') {
          if (this._offs.length !== t.pie.length) this._offs = new Array(t.pie.length).fill(0)
          for (let i = 0; i < t.pie.length; i++) {
            const cur = this._offs[i] || 0
            const next = cur + (t.pie[i] - cur) * k
            if (Math.abs(t.pie[i] - next) > 0.05) moving = true
            this._offs[i] = next
            this.applySliceOffset(i, next)
          }
        }
        if (t.cross != null) {
          const next = this._crossX == null ? t.cross : this._crossX + (t.cross - this._crossX) * k
          if (Math.abs(t.cross - next) > 0.2) moving = true
          this._crossX = next
          this.setCrosshair(next)
        } else if (this._crossX != null) {
          this._crossX = null
          this.hideCrosshair()
        }
        if (moving) {
          this._animRaf = requestAnimationFrame(step)
        } else {
          // 收敛后停在目标值（避免残留微小误差）
          this.applyFinalState(t)
          this._animRaf = 0
          this._lastT = 0
        }
      }
      this._animRaf = requestAnimationFrame(step)
    },
    stopAnim() {
      if (this._animRaf) cancelAnimationFrame(this._animRaf)
      this._animRaf = 0
      this._lastT = 0
    },
    // 立即把动画跳到终态（导出图片前用，保证 PNG 与「固定选中」状态一致）
    snapAnim() {
      this.stopAnim()
      this.applyFinalState(this.animTargets())
    },
    applyFinalState(t) {
      if (this.type === 'pie') {
        this._offs = t.pie.slice()
        for (let i = 0; i < this._offs.length; i++) this.applySliceOffset(i, this._offs[i])
      }
      if (t.cross != null) {
        this._crossX = t.cross
        this.setCrosshair(t.cross)
      } else {
        this._crossX = null
        this.hideCrosshair()
      }
    },
    // 扇区沿自身中线外弹：直接写 transform 属性
    applySliceOffset(i, off) {
      const el = this._sliceEls[i]
      if (!el) return
      if (off > 0.02) {
        const s = this.slices[i]
        if (!s) return
        const ox = Math.cos(s.mid) * off
        const oy = Math.sin(s.mid) * off
        el.setAttribute('transform', `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`)
      } else if (el.hasAttribute('transform')) {
        el.removeAttribute('transform')
      }
    },
    setCrosshair(pos) {
      if (this.type === 'barh') {
        const line = this.$refs.crossLineH
        if (!line) return
        line.setAttribute('y1', pos)
        line.setAttribute('y2', pos)
        line.style.display = ''
        return
      }
      const line = this.$refs.crossLine
      if (!line) return
      line.setAttribute('x1', pos)
      line.setAttribute('x2', pos)
      line.style.display = ''
    },
    hideCrosshair() {
      const v = this.$refs.crossLine
      if (v) v.style.display = 'none'
      const h = this.$refs.crossLineH
      if (h) h.style.display = 'none'
    },

    // ===== 高亮样式（颜色类动画交给 CSS 过渡）=====
    sliceOpacity(i) {
      // 有选中项时，其余扇区变暗
      if (this.focus < 0 && this.sel < 0) return 0.9
      return (i === this.focus || i === this.sel) ? 1 : 0.42
    },
    barStyle(b) {
      const on = this.focus === b.i
      return {
        fillOpacity: on ? 1 : 0.82,
        stroke: this.c.primaryHover,
        strokeWidth: on ? 1.5 : 0,
      }
    },

    labelOf(i) {
      const v = this.labels[i]
      return v == null || v === '' ? `第 ${i + 1} 项` : String(v)
    },
    short(s, len = 6) {
      const t = String(s == null ? '' : s)
      return t.length > len ? t.slice(0, len) + '…' : t
    },
    num(v) {
      const n = Math.round(v * 100) / 100
      return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n)
    },
    fmt(v) {
      const n = Number(v)
      if (!Number.isFinite(n)) return ''
      return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
    },
    polar(cx, cy, r, ang) {
      return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) }
    },
    legendY(i) {
      const n = this.slices.length
      const rowH = n <= 6 ? 18 : 14
      return 52 + i * rowH
    },
    async saveImage() {
      const svg = this.$refs.svg
      if (!svg || this.saving) return
      this.saving = true
      const { success: notify, error: notifyError } = useNotification()
      // 导出的是「固定选中」的状态：临时清掉悬停、并把动画跳到终态，再克隆 DOM
      const hov = this.hover
      this.hover = -1
      this.snapAnim()
      await this.$nextTick()
      try {
        const w = this.vbW, h = this.vbH
        const clone = svg.cloneNode(true)
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        clone.setAttribute('width', String(w))
        clone.setAttribute('height', String(h))
        // 铺一层底色，避免导出 PNG 背景透明
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        bg.setAttribute('x', '0'); bg.setAttribute('y', '0')
        bg.setAttribute('width', String(w)); bg.setAttribute('height', String(h))
        bg.setAttribute('fill', this.c.surface)
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
        ctx2.fillStyle = this.c.surface
        ctx2.fillRect(0, 0, canvas.width, canvas.height)
        ctx2.drawImage(img, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
        if (!blob) throw new Error('图片生成失败')
        const name = `${(this.title || '图表').replace(/[\\/:*?"<>|]/g, '_')}.png`
        await this.saveBlob(name, blob)
        notify('图表已保存')
      } catch (err) {
        // 用户在保存对话框点了取消，不算失败
        if (err && err.message !== '已取消') notifyError('保存失败：' + (err.message || '未知错误'))
      } finally {
        this.saving = false
        this.hover = hov
        this.startAnim()
      }
    },
    // Electron 下弹系统保存对话框；浏览器环境直接下载
    async saveBlob(defaultName, blob) {
      if (window.electron && typeof window.electron.invoke === 'function') {
        const data = await blob.arrayBuffer()
        const result = await window.electron.invoke(INVOKE.SAVE_FILE, { defaultName, data })
        if (!result || result.canceled) throw new Error('已取消')
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = defaultName
      a.click()
      URL.revokeObjectURL(url)
    },
  },
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
