<template>
  <div class="w-60 bg-sidebar text-text-inverse h-full p-4 flex flex-col">
    <h2 class="app-name text-lg font-bold mb-6 flex items-center gap-2">
      <img src="/logo.png" alt="logo" class="w-7 h-7 object-contain shrink-0" />
      <span class="truncate">班集</span>
    </h2>
    <nav class="space-y-1 flex-1 min-h-0 overflow-y-auto sidebar-scroll" @pointerover="onNavOver">
      <template v-for="group in navGroups" :key="group.title">
        <div class="text-[11px] sidebar-group-title uppercase tracking-wider px-3 pt-1 pb-0.5">{{ group.title }}</div>
        <router-link
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="nav-item hover:bg-sidebar-hover transition-theme"
          :class="{ 'bg-sidebar-active': isSelected(item.to) }"
          @pointerdown="onNavPointerDown($event, item.to)"
        >
          <component
            v-if="iconStyle === 'color'"
            :is="item.lucide"
            :size="16"
            :stroke-width="2"
            :style="{ color: item.color }"
          />
          <span v-else class="nav-emoji">{{ item.emoji }}</span>
          {{ item.label }}
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
const { iconStyle } = storeToRefs(useThemeStore())

function onNavOver(e) {
  const link = e.target.closest('a[href]')
  if (!link) return
  prefetchRoute(router, link.getAttribute('href'))
}
</script>

<style scoped>
/* 侧边栏细滚动条：窗口过高时导航区独立滚动，标题行固定不滚 */
.sidebar-scroll::-webkit-scrollbar {
  width: 6px;
}
.sidebar-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.25);
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
  border-radius: 8px;
  text-decoration: none;
  transition-property: background-color, border-color, color, box-shadow, border-radius, transform;
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
</style>