<template>
  <!-- 统一图标：跟随「图标样式」设置（color=彩色 lucide / emoji=表情）。
       tint="color" 时用语义配色（页面/小节标题），tint="current" 时继承文字色（按钮等）。 -->
  <component
    v-if="iconStyle === 'color'"
    :is="entry.comp"
    :size="size"
    :stroke-width="strokeWidth"
    :class="{ 'icon-loading': isLoading, 'icon-color': tint !== 'current' }"
    :style="tint === 'current' ? { color: 'currentColor', flexShrink: 0 } : { color: entry.color, flexShrink: 0 }"
  />
  <span v-else class="icon-emoji" :class="{ 'icon-loading': isLoading }" :style="{ fontSize: size + 'px', lineHeight: 1 }">{{ entry.emoji }}</span>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import {
  Users, Network, CalendarDays, Coins, Armchair, Broom, BedDouble, Medal,
  Images, PartyPopper, Bot, Settings, Info,
  RefreshCw, Download, Upload, Trash2, Search, ClipboardList, Folder, FolderOpen,
  Undo2, Image as ImageIcon, SlidersHorizontal, Check, Wrench, Paperclip,
  Clock, BarChart3, Loader2, Toolbox, User, Palette, Brain,
  Home, Zap, Camera, RotateCcw, Eye, EyeOff,
  Timer, Dices, NotebookPen, PenLine, Pen, PenTool, Highlighter, Eraser,
  Save, X, XCircle, Construction,
} from '@lucide/vue'
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
  students: { comp: Users, emoji: '📚', color: '#60a5fa' },
  group:    { comp: Network, emoji: '👥', color: '#818cf8' },
  schedule: { comp: CalendarDays, emoji: '📅', color: '#22d3ee' },
  fee:      { comp: Coins, emoji: '💰', color: '#fbbf24' },
  seat:     { comp: Armchair, emoji: '🪑', color: '#fb923c' },
  duty:     { comp: Broom, emoji: '🧹', color: '#34d399' },
  leave:    { comp: BedDouble, emoji: '🛌', color: '#a78bfa' },
  score:    { comp: Medal, emoji: '🏅', color: '#f87171' },
  album:    { comp: Images, emoji: '📷', color: '#f472b6' },
  activity: { comp: PartyPopper, emoji: '🎉', color: '#fb7185' },
  ai:       { comp: Bot, emoji: '🤖', color: '#38bdf8' },
  settings: { comp: Settings, emoji: '⚙️', color: '#94a3b8' },
  about:    { comp: Info, emoji: 'ℹ️', color: '#94a3b8' },

  // ---- 通用（按钮多为 tint=current 继承文字色）----
  refresh:  { comp: RefreshCw, emoji: '🔄', color: '#64748b' },
  download: { comp: Download, emoji: '📥', color: '#f97316' },
  upload:   { comp: Upload, emoji: '📥', color: '#f97316' },
  trash:    { comp: Trash2, emoji: '🗑️', color: '#ef4444' },
  search:   { comp: Search, emoji: '🔍', color: '#38bdf8' },
  clipboard:{ comp: ClipboardList, emoji: '📋', color: '#6366f1' },
  folder:   { comp: Folder, emoji: '📁', color: '#f59e0b' },
  box:      { comp: FolderOpen, emoji: '🗂️', color: '#f59e0b' },
  undo:     { comp: Undo2, emoji: '↩️', color: '#94a3b8' },
  image:    { comp: ImageIcon, emoji: '🖼️', color: '#a78bfa' },
  sliders:  { comp: SlidersHorizontal, emoji: '🎚️', color: '#94a3b8' },
  check:    { comp: Check, emoji: '✅', color: '#22c55e' },
  wrench:   { comp: Wrench, emoji: '🛠️', color: '#64748b' },
  paperclip:{ comp: Paperclip, emoji: '📎', color: '#64748b' },
  clock:    { comp: Clock, emoji: '⏳', color: '#0ea5e9' },
  calendar: { comp: CalendarDays, emoji: '🗓️', color: '#0ea5e9' },
  chart:    { comp: BarChart3, emoji: '📊', color: '#6366f1' },
  users:    { comp: Users, emoji: '👥', color: '#60a5fa' },
  toolbox:  { comp: Toolbox, emoji: '🧰', color: '#64748b' },
  user:     { comp: User, emoji: '👤', color: '#60a5fa' },
  palette:  { comp: Palette, emoji: '🎨', color: '#ec4899' },
  brain:    { comp: Brain, emoji: '🧠', color: '#a78bfa' },
  loading:  { comp: Loader2, emoji: '🔄', color: '#64748b' },
  home:     { comp: Home, emoji: '🏠', color: '#10b981' },
  zap:      { comp: Zap, emoji: '⚡', color: '#f59e0b' },
  camera:   { comp: Camera, emoji: '📸', color: '#64748b' },
  rollback: { comp: RotateCcw, emoji: '↺', color: '#f59e0b' },
  // 金额显示/隐藏切换：eye=显示（睁眼）｜eyeOff=隐藏（捂脸）
  eye:      { comp: Eye,    emoji: '👁️', color: '#64748b' },
  eyeOff:   { comp: EyeOff, emoji: '🙈', color: '#64748b' },

  // ---- 工具箱（浮窗图标 / 工具菜单 / 四个小工具）----
  timer:       { comp: Timer,       emoji: '⏱️', color: '#0ea5e9' },
  rollcall:    { comp: Dices,       emoji: '🎲', color: '#818cf8' },
  screenshot:  { comp: Camera,      emoji: '📷', color: '#64748b' },
  note:        { comp: NotebookPen, emoji: '📝', color: '#f59e0b' },
  brush:       { comp: PenLine,     emoji: '🖊️', color: '#3b82f6' },
  eraser:      { comp: Eraser,      emoji: '🧹', color: '#64748b' },
  save:        { comp: Save,        emoji: '💾', color: '#3b82f6' },
  close:       { comp: X,           emoji: '✕',  color: '#64748b' },
  ballpoint:   { comp: Pen,         emoji: '🖊️', color: '#3b82f6' },
  pen:         { comp: PenTool,     emoji: '✒️', color: '#1e293b' },
  highlighter: { comp: Highlighter, emoji: '🖍️', color: '#f59e0b' },
  error:       { comp: XCircle,     emoji: '❌', color: '#ef4444' },
  developing:  { comp: Construction,emoji: '🚧', color: '#f59e0b' },
}

const { iconStyle } = storeToRefs(useThemeStore())
const entry = computed(() => {
  const hit = MAP[props.name]
  // 拼错/未登记的 key 会静默回退成「学生」图标，视觉上极难发现：开发态显式告警
  if (!hit && import.meta.env.DEV) console.warn('[IconGlyph] unknown icon:', props.name)
  return hit || MAP.students
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