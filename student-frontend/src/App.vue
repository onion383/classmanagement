<template>
  <!-- 登录页：全屏、无侧边栏 -->
  <div v-if="$route.path === '/login'" class="h-screen">
    <router-view />
  </div>

  <!-- 其他页面：带侧边栏布局 -->
  <div v-else class="flex h-screen">
    <Sidebar />
    <main class="flex-1 p-6 bg-bg overflow-auto">
      <router-view v-slot="{ Component }">
        <KeepAlive :max="10">
          <component :is="Component" />
        </KeepAlive>
      </router-view>
    </main>
  </div>

  <!-- 全局通知弹窗 -->
  <NotificationToast />

  <!-- AI 助手：悬浮呼出按钮与浮窗（登录页不显示） -->
  <template v-if="$route.path !== '/login'">
    <Teleport to="body">
      <button
        ref="aiIcon"
        @mousedown="startDragIcon"
        @click="onIconClick"
        class="fixed z-[20000] w-12 h-12 rounded-full bg-primary hover:bg-primary-hover text-text-inverse text-xl shadow-lg flex items-center justify-center cursor-move select-none"
        :style="iconStyle"
        title="AI 助手（可拖动，点击打开/关闭浮窗）"
      >🤖</button>
    </Teleport>
    <Teleport to="body" v-if="assistantOpen">
      <div
        ref="assistantPanel"
        class="fixed z-[20001] border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style="background-color: rgba(255,255,255,0.72); backdrop-filter: blur(28px) saturate(1.5); -webkit-backdrop-filter: blur(28px) saturate(1.5);"
        @mousedown="onPanelMouseDown"
        :style="{
          width: '24rem',
          maxWidth: 'calc(100vw - 2rem)',
          height: 'min(520px, calc(100vh - 6.5rem))',
          maxHeight: 'calc(100vh - 6rem)',
          left: assistantPos.x != null ? assistantPos.x + 'px' : 'auto',
          right: assistantPos.x == null ? '1.5rem' : 'auto',
          top: assistantPos.y != null ? assistantPos.y + 'px' : '5rem',
        }">
        <div
          @mousedown="startDragAssistant"
          @click.stop
          class="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-hover flex-shrink-0 cursor-move select-none"
        >
          <span class="font-semibold text-text">🤖 AI 助手</span>
          <button
            type="button"
            @click.stop="assistantOpen = false"
            class="text-text-muted hover:text-text text-lg leading-none transition-theme cursor-pointer"
            title="关闭"
          >✕</button>
        </div>
        <div class="flex-1 p-4 overflow-hidden">
          <AiAssistant :floating="true" />
        </div>
      </div>
    </Teleport>
  </template>
</template>

<script>
import Sidebar from './components/layout/Sidebar.vue'
import NotificationToast from './components/base/NotificationToast.vue'
import { defineAsyncComponent, h } from 'vue'

// 异步组件：加载中/失败展示占位文案，避免浮窗点开就消失却毫无反馈
const AiAssistant = defineAsyncComponent({
  loader: () => import('./views/AiAssistant.vue'),
  loadingComponent: {
    render() { return h('div', { class: 'h-full flex items-center justify-center text-sm text-text-muted' }, 'AI 助手加载中…') },
  },
  errorComponent: {
    render() { return h('div', { class: 'h-full flex items-center justify-center text-sm text-danger' }, 'AI 助手加载失败，请查看控制台') },
  },
  onError(retry, fail, attempts) { if (attempts < 3) retry() },
})

export default {
  components: { Sidebar, NotificationToast, AiAssistant },
  data() {
    return {
      assistantOpen: false,
      assistantPos: { x: null, y: null },
      assistantDrag: null,
      // 图标位置：用 CSS transform translate 做偏移，基准位置始终 right/bottom: 1.5rem
      iconTranslate: { x: 0, y: 0 },
      iconDrag: null,
      iconMoved: false,
    }
  },
  computed: {
    // 图标用 right/bottom 基准 + transform 偏移，拖动时只改 transform，不触发布局，也不回弹
    // 显式写 position: fixed，覆盖 theme-glass.css 中 button { position: relative }
    iconStyle() {
      return {
        position: 'fixed',
        zIndex: 20000,
        right: '1.5rem',
        bottom: '1.5rem',
        // 关闭 theme-glass.css 里 button 的 transform 过渡，拖动"指哪打哪"
        transition: 'none',
        transform: `translate(${this.iconTranslate.x}px, ${this.iconTranslate.y}px)`,
      }
    },
  },
  watch: {
    '$route.path'() {
      // 切页时保持浮窗状态（用户可边操作边问）；若切换到 AI 助手页则收起浮窗
      if (this.$route.path === '/ai-assistant') this.assistantOpen = false
    },
  },
  mounted() {
    window.addEventListener('resize', this.onWindowResize)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.onWindowResize)
    this.stopDragAssistant()
    this.stopDragIcon()
  },
  methods: {
    onWindowResize() {
      // 窗口缩放时，保持图标仍在可视区内（简单钳制 translate 范围）
      const size = 48
      const m = 12
      const maxX = window.innerWidth - size - 24 - m
      const maxY = window.innerHeight - size - 24 - m
      this.iconTranslate.x = Math.max(-maxX, Math.min(this.iconTranslate.x, 0))
      this.iconTranslate.y = Math.max(-maxY, Math.min(this.iconTranslate.y, 0))
    },

    // ---- 悬浮图标拖动 ----
    startDragIcon(e) {
      if (e.button !== 0) return
      const el = this.$refs.aiIcon
      const rect = el.getBoundingClientRect()
      this.iconDrag = {
        startX: e.clientX,
        startY: e.clientY,
        startLeft: rect.left,
        startTop: rect.top,
      }
      this.iconMoved = false
      document.addEventListener('mousemove', this.onDragIcon, { capture: true })
      document.addEventListener('mouseup', this.stopDragIcon, { capture: true })
      e.preventDefault()
      e.stopPropagation()
    },
    onDragIcon(e) {
      if (!this.iconDrag) return
      const { startX, startY, startLeft, startTop } = this.iconDrag
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.iconMoved = true
      // 计算新左上角位置并钳制在可视区内（留出 12px 边距）
      const size = 48
      const m = 12
      const vw = window.innerWidth
      const vh = window.innerHeight
      let newLeft = startLeft + dx
      let newTop = startTop + dy
      newLeft = Math.max(m, Math.min(newLeft, vw - size - m))
      newTop = Math.max(m, Math.min(newTop, vh - size - m))
      // translate = 新位置 - 基准位置（基准是 right=1.5rem/bottom=1.5rem 时的 left/top）
      const baseLeft = vw - size - 24
      const baseTop = vh - size - 24
      this.iconTranslate = { x: newLeft - baseLeft, y: newTop - baseTop }
    },
    stopDragIcon() {
      document.removeEventListener('mousemove', this.onDragIcon, { capture: true })
      document.removeEventListener('mouseup', this.stopDragIcon, { capture: true })
      this.iconDrag = null
    },
    // 图标点击：拖动超过阈值则不触发；否则切换浮窗打开/关闭
    onIconClick() {
      if (this.iconMoved) { this.iconMoved = false; return }
      this.assistantOpen = !this.assistantOpen
    },
    clientW() { return document.documentElement.clientWidth || window.innerWidth || 800 },
    clientH() { return document.documentElement.clientHeight || window.innerHeight || 600 },

    // ---- 浮窗拖拽 ----
    // 面板整体 mousedown 不拦截点击；真正的拖拽只由标题栏 startDragAssistant 触发
    onPanelMouseDown() {},
    startDragAssistant(e) {
      if (e.button !== 0) return
      this.assistantDrag = { startX: e.clientX, startY: e.clientY, x: this.assistantPos.x, y: this.assistantPos.y }
      window.addEventListener('mousemove', this.onDragAssistant)
      window.addEventListener('mouseup', this.stopDragAssistant)
    },
    onDragAssistant(e) {
      if (!this.assistantDrag) return
      const dx = e.clientX - this.assistantDrag.startX
      const dy = e.clientY - this.assistantDrag.startY
      let x = (this.assistantDrag.x ?? 0) + dx
      let y = (this.assistantDrag.y ?? 0) + dy
      // 边界钳制：让面板整体完整留在可视区内（上下左右都不超出），并留 12px 边距
      const el = this.$refs.assistantPanel
      const w = el ? el.offsetWidth : 384
      const h = el ? el.offsetHeight : 520
      const m = 12
      const vw = this.clientW()
      const vh = this.clientH()
      x = Math.max(m, Math.min(x, vw - w - m))
      y = Math.max(m, Math.min(y, vh - h - m))
      this.assistantPos = { x, y }
    },
    stopDragAssistant() {
      this.assistantDrag = null
      window.removeEventListener('mousemove', this.onDragAssistant)
      window.removeEventListener('mouseup', this.stopDragAssistant)
    },
  },
}
</script>