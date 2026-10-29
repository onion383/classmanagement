<template>
  <!-- 统一图标：跟随「图标样式」设置（color=彩色图形 / emoji=表情）。
       tint="color" 时用语义配色（页面/小节标题），tint="current" 时继承文字色（按钮等）。
       图形数据内联渲染（见 IconGlyph.shapes.js）：不再实例化 @lucide/vue 组件，
       每个图标从「一个组件实例 + 一棵 VNode」变成「一个 svg + 若干形状元素」。 -->
  <svg
    v-if="iconStyle === 'color'"
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    :class="{ 'icon-loading': isLoading, 'icon-color': tint !== 'current' }"
    :style="tint === 'current' ? { color: 'currentColor', flexShrink: 0 } : { color: entry.color, flexShrink: 0 }"
  >
    <path v-for="(a, i) in entry.shapes.paths" :key="'p' + i" v-bind="a" />
    <circle v-for="(a, i) in entry.shapes.circles" :key="'c' + i" v-bind="a" />
    <rect v-for="(a, i) in entry.shapes.rects" :key="'r' + i" v-bind="a" />
    <line v-for="(a, i) in entry.shapes.lines" :key="'l' + i" v-bind="a" />
    <polyline v-for="(a, i) in entry.shapes.polylines" :key="'pl' + i" v-bind="a" />
    <polygon v-for="(a, i) in entry.shapes.polygons" :key="'pg' + i" v-bind="a" />
    <ellipse v-for="(a, i) in entry.shapes.ellipses" :key="'e' + i" v-bind="a" />
  </svg>
  <span v-else class="icon-emoji" :class="{ 'icon-loading': isLoading }" :style="{ fontSize: size + 'px', lineHeight: 1 }">{{ entry.emoji }}</span>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { ICON_SHAPES } from './IconGlyph.shapes.js'
import { useThemeStore } from '../../stores/theme'

const props = defineProps({
  // 图标 key（见 MAP），例如 name="students" 或 name="refresh"
  name: { type: String, required: true },
  // 尺寸（px），lucide 与 emoji 保持一致
  size: { type: Number, default: 24 },
  // 线条粗细：仅 color 档生效
  strokeWidth: { type: Number, default: 2 },
  // 取色方式：'current' 继承文字色（按钮）；其他默认用语义彩色
  tint: { type: String, default: 'color' },
})

// 页面/小节标题语义配色（与侧边栏导航一一对应）+ 通用图标
const MAP = {
  // ---- 页面主标题 ----
  students: { lucide: 'Users', emoji: '📚', color: '#60a5fa' },
  group: { lucide: 'Network', emoji: '👥', color: '#818cf8' },
  schedule: { lucide: 'CalendarDays', emoji: '📅', color: '#22d3ee' },
  fee: { lucide: 'Coins', emoji: '💰', color: '#fbbf24' },
  seat: { lucide: 'Armchair', emoji: '🪑', color: '#fb923c' },
  duty: { lucide: 'Broom', emoji: '🧹', color: '#34d399' },
  leave: { lucide: 'BedDouble', emoji: '🛌', color: '#a78bfa' },
  score: { lucide: 'Medal', emoji: '🏅', color: '#f87171' },
  album: { lucide: 'Images', emoji: '📷', color: '#f472b6' },
  activity: { lucide: 'PartyPopper', emoji: '🎉', color: '#fb7185' },
  ai: { lucide: 'Bot', emoji: '🤖', color: '#38bdf8' },
  settings: { lucide: 'Settings', emoji: '⚙️', color: '#94a3b8' },
  about: { lucide: 'Info', emoji: 'ℹ️', color: '#94a3b8' },

  // ---- 通用（按钮多为 tint=current 继承文字色）----
  refresh: { lucide: 'RefreshCw', emoji: '🔄', color: '#64748b' },
  download: { lucide: 'Download', emoji: '📥', color: '#f97316' },
  upload: { lucide: 'Upload', emoji: '📥', color: '#f97316' },
  trash: { lucide: 'Trash2', emoji: '🗑️', color: '#ef4444' },
  search: { lucide: 'Search', emoji: '🔍', color: '#38bdf8' },
  clipboard: { lucide: 'ClipboardList', emoji: '📋', color: '#6366f1' },
  folder: { lucide: 'Folder', emoji: '📁', color: '#f59e0b' },
  box: { lucide: 'FolderOpen', emoji: '🗂️', color: '#f59e0b' },
  undo: { lucide: 'Undo2', emoji: '↩️', color: '#94a3b8' },
  image: { lucide: 'Image', emoji: '🖼️', color: '#a78bfa' },
  sliders: { lucide: 'SlidersHorizontal', emoji: '🎚️', color: '#94a3b8' },
  check: { lucide: 'Check', emoji: '✅', color: '#22c55e' },
  wrench: { lucide: 'Wrench', emoji: '🛠️', color: '#64748b' },
  paperclip: { lucide: 'Paperclip', emoji: '📎', color: '#64748b' },
  clock: { lucide: 'Clock', emoji: '⏳', color: '#0ea5e9' },
  calendar: { lucide: 'CalendarDays', emoji: '🗓️', color: '#0ea5e9' },
  chart: { lucide: 'BarChart3', emoji: '📊', color: '#6366f1' },
  users: { lucide: 'Users', emoji: '👥', color: '#60a5fa' },
  toolbox: { lucide: 'Toolbox', emoji: '🧰', color: '#64748b' },
  user: { lucide: 'User', emoji: '👤', color: '#60a5fa' },
  palette: { lucide: 'Palette', emoji: '🎨', color: '#ec4899' },
  brain: { lucide: 'Brain', emoji: '🧠', color: '#a78bfa' },
  loading: { lucide: 'Loader2', emoji: '🔄', color: '#64748b' },
  home: { lucide: 'Home', emoji: '🏠', color: '#10b981' },
  zap: { lucide: 'Zap', emoji: '⚡', color: '#f59e0b' },
  camera: { lucide: 'Camera', emoji: '📸', color: '#64748b' },
  rollback: { lucide: 'RotateCcw', emoji: '↺', color: '#f59e0b' },
  // 金额显示/隐藏切换：eye=显示（睁眼）｜eyeOff=隐藏（捂脸）
  eye: { lucide: 'Eye', emoji: '👁️', color: '#64748b' },
  eyeOff: { lucide: 'EyeOff', emoji: '🙈', color: '#64748b' },

  // ---- 工具箱（浮窗图标 / 工具菜单 / 四个小工具）----
  timer: { lucide: 'Timer', emoji: '⏱️', color: '#0ea5e9' },
  rollcall: { lucide: 'Dices', emoji: '🎲', color: '#818cf8' },
  screenshot: { lucide: 'Camera', emoji: '📷', color: '#64748b' },
  note: { lucide: 'NotebookPen', emoji: '📝', color: '#f59e0b' },
  brush: { lucide: 'PenLine', emoji: '🖊️', color: '#3b82f6' },
  eraser: { lucide: 'Eraser', emoji: '🧹', color: '#64748b' },
  save: { lucide: 'Save', emoji: '💾', color: '#3b82f6' },
  close: { lucide: 'X', emoji: '✕',  color: '#64748b' },
  ballpoint: { lucide: 'Pen', emoji: '🖊️', color: '#3b82f6' },
  pen: { lucide: 'PenTool', emoji: '✒️', color: '#1e293b' },
  highlighter: { lucide: 'Highlighter', emoji: '🖍️', color: '#f59e0b' },
  error: { lucide: 'XCircle', emoji: '❌', color: '#ef4444' },
  developing: { lucide: 'Construction', emoji: '🚧', color: '#f59e0b' },
}

const { iconStyle } = storeToRefs(useThemeStore())
const entry = computed(() => {
  const hit = MAP[props.name]
  // 拼错/未登记的 key 会静默回退成「学生」图标，视觉上极难发现：开发态显式告警
  if (!hit && import.meta.env.DEV) console.warn('[IconGlyph] unknown icon:', props.name)
  const key = hit ? props.name : 'students'
  // shapes 与 emoji/color 同源：都按同一个 key 取，未登记的一并回退
  return { ...(hit || MAP.students), shapes: ICON_SHAPES[key] || ICON_SHAPES.students }
})
const isLoading = computed(() => props.name === 'loading')
</script>

<style scoped>
.icon-emoji {
  display: inline-block;
  flex-shrink: 0;
}
/* loading 时旋转 */
.icon-loading :deep(svg) {
  animation: icon-spin 1s linear infinite;
}
@keyframes icon-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>