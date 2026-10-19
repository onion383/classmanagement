<template>
  <!-- 图表整体套一层深色框（与「思考过程」同款），工具条也放在框内 -->
  <div class="my-1.5 ai-dark-frame p-2">
    <!-- 工具条 -->
    <div class="flex items-center justify-end gap-1.5 mb-1">
      <span v-if="sel >= 0" class="text-[10px] text-text-muted">
        {{ labels[sel] }}：{{ fmt(values[sel]) }}<span v-if="unit" class="ml-0.5">{{ unit }}</span>
      </span>
      <button
        type="button"
        :disabled="saving"
        @click="saveImage"
        class="text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface text-text-muted hover:text-text hover:border-primary transition-theme cursor-pointer disabled:opacity-50"
        title="把图表保存为 PNG 图片"
      >{{ saving ? '保存中…' : '保存图片' }}</button>
    </div>

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

      <!-- ===================== 柱状图 ===================== -->
      <g v-if="type === 'bar'">
        <g v-for="g in grid" :key="'g' + g.y">
          <line :x1="plot.x0" :x2="plot.x1" :y1="g.y" :y2="g.y" :stroke="c.border" stroke-width="1" :stroke-dasharray="g.dash" />
          <text :x="plot.x0 - 4" :y="g.y + 3" text-anchor="end" font-size="8" :fill="c.muted">{{ g.label }}</text>
        </g>
        <g v-for="b in bars" :key="'b' + b.i" class="cursor-pointer" @click="select(b.i)">
          <!-- 透明加宽点击区，避免细柱难点 -->
          <rect :x="b.cx - b.w / 2 - 4" :y="plot.y0" :width="b.w + 8" :height="plot.y1 - plot.y0" fill="transparent" />
          <rect
            :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="3"
            :fill="c.primary" :fill-opacity="sel === b.i ? 1 : 0.8"
            :stroke="sel === b.i ? c.primaryHover : 'none'" stroke-width="1.5"
          />
          <text v-if="sel === b.i" :x="b.cx" :y="b.y - 4" text-anchor="middle" font-size="10" font-weight="600" :fill="c.text">{{ fmt(b.v) }}</text>
        </g>
        <text
          v-for="(l, i) in axisLabels" :key="'l' + i"
          :x="bars[i] ? bars[i].cx : 0" :y="plot.y1 + 13" text-anchor="middle" font-size="8" :fill="sel === i ? c.text : c.muted"
        >{{ short(l) }}</text>
      </g>

      <!-- ===================== 折线图 ===================== -->
      <g v-else-if="type === 'line'">
        <g v-for="g in grid" :key="'g' + g.y">
          <line :x1="plot.x0" :x2="plot.x1" :y1="g.y" :y2="g.y" :stroke="c.border" stroke-width="1" :stroke-dasharray="g.dash" />
          <text :x="plot.x0 - 4" :y="g.y + 3" text-anchor="end" font-size="8" :fill="c.muted">{{ g.label }}</text>
        </g>
        <polyline :points="linePoints" fill="none" :stroke="c.primary" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />
        <g v-for="p in points" :key="'p' + p.i" class="cursor-pointer" @click="select(p.i)">
          <circle :cx="p.x" :cy="p.y" r="9" fill="transparent" />
          <circle :cx="p.x" :cy="p.y" :r="sel === p.i ? 4.5 : 3" :fill="sel === p.i ? c.primaryHover : c.primary" :stroke="c.surface" stroke-width="1" />
          <text v-if="sel === p.i" :x="p.x" :y="p.y - 8" text-anchor="middle" font-size="10" font-weight="600" :fill="c.text">{{ fmt(p.v) }}</text>
        </g>
        <text
          v-for="(l, i) in axisLabels" :key="'l' + i"
          :x="points[i] ? points[i].x : 0" :y="plot.y1 + 13" text-anchor="middle" font-size="8" :fill="sel === i ? c.text : c.muted"
        >{{ short(l) }}</text>
      </g>

      <!-- ===================== 饼图 ===================== -->
      <g v-else>
        <g v-for="s in slices" :key="'s' + s.i" class="cursor-pointer" @click="select(s.i)" :transform="sel === s.i ? explode(s) : ''">
          <path :d="s.path" :fill="s.color" :fill-opacity="sel === s.i ? 1 : 0.88" :stroke="c.surface" stroke-width="1.5" />
        </g>
        <text
          v-for="s in pieCaptionSlices" :key="'t' + s.i"
          :x="s.labelX" :y="s.labelY + 3" text-anchor="middle" font-size="9" font-weight="600" fill="#ffffff"
        >{{ Math.round(s.frac * 100) }}%</text>
        <!-- 图例（放在 SVG 内，导出图片时一并保留） -->
        <g v-for="(s, i) in slices" :key="'lg' + i">
          <rect :x="pieLegendX" :y="legendY(i) - 8" width="9" height="9" rx="2" :fill="s.color" />
          <text :x="pieLegendX + 13" :y="legendY(i) + 0.5" font-size="9" :fill="sel === i ? c.text : c.muted" :font-weight="sel === i ? 600 : 400">
            {{ short(labels[i], 8) }} · {{ fmt(values[i]) }}<tspan v-if="unit">{{ unit }}</tspan>
          </text>
        </g>
      </g>

      <!-- 操作提示 / 选中明细（画在 SVG 内，导出时保留） -->
      <text x="180" :y="vbH - 8" text-anchor="middle" font-size="9" :fill="c.muted">
        {{ sel >= 0 ? `${labels[sel]}：${fmt(values[sel])}${unit}` : hint }}
      </text>
    </svg>
  </div>
</template>

<script>
import { useNotification } from '../composables/useNotification.js'
import { INVOKE } from '../electronChannels.js'

// 主色之外的补充色（切片超过 4 个时使用，保证同一张图里颜色不重复）
const EXTRA_PALETTE = ['#8b5cf6', '#14b8a6', '#ec4899', '#0ea5e9', '#f97316', '#64748b', '#a3e635', '#a855f7']

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// AI 图表：按 { type, title, labels, values, unit } 绘制柱状/折线/饼图，可点击查看数值、可保存 PNG
export default {
  name: 'AiChart',
  props: {
    data: { type: Object, required: true },
  },
  data() {
    return {
      sel: -1,   // 当前选中的数据点下标（-1 为未选中）
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
      return ['bar', 'pie', 'line'].includes(this.data.type) ? this.data.type : 'bar'
    },
    title() { return this.data.title || '' },
    unit() { return this.data.unit || '' },
    labels() { return Array.isArray(this.data.labels) ? this.data.labels : [] },
    values() {
      return (Array.isArray(this.data.values) ? this.data.values : [])
        .map((v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 })
    },
    vbW() { return 360 },
    vbH() { return 230 },
    palette() {
      return [this.c.primary, this.c.info, this.c.warning, this.c.danger, ...EXTRA_PALETTE]
    },
    // 柱状/折线的绘图区
    plot() { return { x0: 36, x1: 348, y0: 30, y1: 168 } },
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
    slices() {
      const cx = 110, cy = 118, r = 64
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
        out.push({ i, v, frac, mid, path, labelX: lp.x, labelY: lp.y, color: this.palette[i % this.palette.length] })
        start = end
      })
      return out
    },
    // 柱状/折线的 x 轴标签：与数值一一对应，避免多余标签堆在左侧
    axisLabels() { return this.labels.slice(0, this.values.length) },
    // 饼图扇区内的百分比文字（占比过小的不画，免得挤成一团）
    pieCaptionSlices() { return this.slices.filter((s) => s.frac > 0.08) },
    pieLegendX() { return 196 },
    hint() { return this.type === 'pie' ? '点击扇区查看数据' : this.type === 'line' ? '点击数据点查看数值' : '点击柱子查看数据' },
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
  },
  methods: {
    select(i) { this.sel = this.sel === i ? -1 : i },
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
    // 选中扇区沿自身方向外移，做出「弹出」效果
    explode(s) {
      const dx = Math.cos(s.mid) * 6
      const dy = Math.sin(s.mid) * 6
      return `translate(${dx} ${dy})`
    },
    async saveImage() {
      const svg = this.$refs.svg
      if (!svg || this.saving) return
      this.saving = true
      const { success: notify, error: notifyError } = useNotification()
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
