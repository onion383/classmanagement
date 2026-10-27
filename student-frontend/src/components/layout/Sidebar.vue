<template>
  <div
    class="bg-sidebar text-text-inverse h-full p-4 flex flex-col sidebar-root"
    :class="collapsed ? 'w-16 sidebar-collapsed' : 'w-60'"
  >
    <h2
      class="app-name text-lg font-bold mb-6 flex items-center gap-2"
      :class="{ 'flex-col sidebar-header-collapsed': collapsed }"
    >
      <img src="/logo.webp" alt="logo" class="w-7 h-7 object-contain shrink-0" />
      <span v-if="!collapsed" class="truncate">班集</span>
      <button
        class="mode-toggle-btn mode-toggle-theme"
        :disabled="!nightSupported"
        :title="!nightSupported ? '当前主题暂不支持夜间模式' : (isNightPending ? '切换到日间模式' : '切换到夜间模式')"
        @click="toggleMode"
      >
        <Sun v-if="isNightPending" :size="15" stroke-width="1.8" />
        <Moon v-else :size="15" stroke-width="1.8" />
      </button>
      <button
        class="mode-toggle-btn"
        :title="collapsed ? '展开侧边栏' : '折叠侧边栏'"
        @click="toggleCollapsed"
      >
        <PanelLeftOpen v-if="collapsed" :size="15" stroke-width="1.8" />
        <PanelLeftClose v-else :size="15" stroke-width="1.8" />
      </button>
    </h2>
    <nav class="space-y-1 flex-1 min-h-0 overflow-y-auto sidebar-scroll" @pointerover="onNavOver">
      <template v-for="group in navGroups" :key="group.title">
        <div v-if="!collapsed" class="text-[11px] sidebar-group-title uppercase tracking-wider px-3 pt-1 pb-0.5">{{ group.title }}</div>
        <router-link
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="nav-item hover:bg-sidebar-hover transition-theme"
          :class="{ 'bg-sidebar-active': isSelected(item.to) }"
          :title="collapsed ? item.label : null"
          @pointerdown="onNavPointerDown($event, item.to)"
        >
          <component
            v-if="iconStyle === 'color'"
            :is="item.lucide"
            class="icon-color"
            :size="16"
            :stroke-width="2"
            :style="{ color: item.color }"
          />
          <span v-else class="nav-emoji">{{ item.emoji }}</span>
          <span v-if="!collapsed" class="nav-label">{{ item.label }}</span>
        </router-link>
        <div class="border-t border-white/10 my-2"></div>
      </template>
    </nav>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Sun, Moon, PanelLeftClose, PanelLeftOpen } from '@lucide/vue'
import { PAGE_GROUPS as navGroups } from '../../config/searchIndex.js'
import { useThemeStore } from '../../stores/theme'
import { prefetchRoute } from '../../utils/routePrefetch.js'

const router = useRouter()
const route = useRoute()

/* 选中态：按下即高亮（乐观更新），不等路由切换完成才移动。
   router-link 的 active-class 要等导航 resolve（懒加载挂载/数据请求）后才生效，
   在大页面上会明显「点了没反应」，故这里自己判定：
   有按下目标时以它为准（保证同时只有一个高亮），路由真正切换后再交回 route.path。 */
const pendingPath = ref(null)
function onNavPointerDown(e, to) {
  if (e.button !== 0) return // 仅左键
  pendingPath.value = to === route.path ? null : to
}
watch(() => route.path, () => { pendingPath.value = null })
function isSelected(to) {
  return (pendingPath.value ?? route.path) === to
}

// 图标样式跟随主题设置：'lucide' 线性图标 | 'emoji' 表情
const themeStore = useThemeStore()
const { iconStyle, isNightPending, nightSupported } = storeToRefs(themeStore)
// 全局日/夜切换（仅 glass / glass2 支持，见 theme-night.css）
const { toggleMode } = themeStore

function onNavOver(e) {
  const link = e.target.closest('a[href]')
  if (!link) return
  prefetchRoute(router, link.getAttribute('href'))
}

/* 侧边栏折叠：折叠后仅保留图标，状态写入 localStorage 记忆 */
const COLLAPSE_KEY = 'app-sidebar-collapsed'
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1')
function toggleCollapsed() {
  collapsed.value = !collapsed.value
  localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0')
}
</script>

<style scoped>
/* 侧边栏细滚动条：窗口过高时导航区独立滚动，标题行固定不滚 */
.sidebar-scroll::-webkit-scrollbar {
  width: 6px;
}
.sidebar-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.25);
  /* 滚动条滑块：宽度 6px，半高圆角 3px 才呈胶囊。
     写死 3px 是因为它必须等于滑块自身宽度的一半，与卡片圆角体系无关。 */
  border-radius: 3px;
}
.sidebar-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}
.sidebar-scroll::-webkit-scrollbar-track {
  background: transparent;
}
/* 导航项：图标 + 文字垂直居中，图标与文字间距固定，去掉链接下划线。
   过渡覆盖 background/border/color/box-shadow/border-radius/transform（Tailwind transition-theme
   不含 transform，若无则 active 的 translateY 会硬跳）。backdrop-filter 逐帧重绘代价高，
   不加入过渡（避免顿挫），仅让颜色/阴影/位移平滑。 */
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-control);
  text-decoration: none;
  /* padding 也纳入过渡：折叠/展开时图标靠 padding-left 平滑移动，避免瞬跳 */
  transition-property: background-color, border-color, color, box-shadow, border-radius, transform, padding-left, padding-right;
  transition-duration: 100ms;
  transition-timing-function: ease-out;
  /* 原常驻 will-change: background-color, color, box-shadow, transform 已移除：
     它会让 13 个导航项长期各占一个合成层，而 100ms 的颜色/阴影过渡无需 GPU 提升。 */
}
.nav-item svg,
.nav-item .nav-emoji {
  flex-shrink: 0;
}
/* Emoji 图标：与 lucide 16px 图标视觉等宽，保持垂直居中对齐 */
.nav-emoji {
  width: 20px;
  text-align: center;
  font-size: 14px;
  line-height: 1;
}

/* ==================== 折叠 ====================
   要让「宽度 240↔64」与「内部布局 行排↔竖排」两件事同步，否则布局瞬变会
   形成跳动。做法：
   1) 根节点宽度平滑过渡，并 overflow:hidden —— 展开时文字以 nowrap 溢出，
      被容器裁掉后随宽度增长逐步「揭示」，不再换行撑高；
   2) 头部固定高度并过渡：展开 28px（一行）、折叠 96px（logo 28 + 按钮 26×2
       + 间距 8×2），高度变化平滑带动下方导航区平稳移动；
   3) 导航项图标靠 padding-left 过渡平移，取代无过渡的 justify-content 居中。 */
.sidebar-root {
  transition: width 0.15s ease;
  overflow: hidden;
}
.sidebar-root > h2 {
  transition: height 0.15s ease;
  overflow: hidden;
}
.sidebar-root:not(.sidebar-collapsed) > h2 {
  height: 28px;
}
.sidebar-collapsed > h2 {
  height: 96px;
}
/* 文字一律不换行（配合根节点裁剪，形成平滑揭示），避免换行把行高撑大 */
.sidebar-group-title,
.nav-label {
  white-space: nowrap;
}
/* 折叠后导航项只留图标：左右内边距收窄到 8px，使 16px 图标在 64px 栏内居中；
   展开态为 12px，两者之间的差值由上面的 padding 过渡平滑衔接。 */
.sidebar-collapsed .nav-item {
  padding-left: 8px;
  padding-right: 8px;
}
/* 顶部两个按钮：展开态下第一个占满左侧剩余空间（沿用全局 margin-left:auto），
   第二个紧跟其后不再撑开；折叠态为竖排，两个按钮都取消 auto 边距以居中。
   这两条选择器特异性均高于 theme-night.css 的 `:root .bg-sidebar .mode-toggle-btn`(0,3,0)，
   确保覆盖生效。 */
.sidebar-root .mode-toggle-btn + .mode-toggle-btn {
  margin-left: 0;
}
.sidebar-header-collapsed button.mode-toggle-btn {
  margin-left: 0;
}
</style>