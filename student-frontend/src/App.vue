<template>
  <div class="flex flex-col h-screen overflow-hidden">
    <!-- 无边框自绘标题栏：仅当「Win11 主题」（无边框透明窗口）时渲染，
         其余主题为系统原生边框，自带标题栏/最小化/最大化/关闭。 -->
    <div v-if="isWin11" class="window-title-bar flex-shrink-0 select-none" style="height:36px;">
      <div class="flex items-center" style="height:100%;">
        <span class="px-3 text-sm font-semibold truncate" style="line-height:36px;">班级管理系统</span>
      </div>
      <div class="window-controls flex items-center" style="height:100%;">
        <button class="win-btn" title="最小化" @click="winMinimize">
          <Minus :size="14" stroke-width="1.5" />
        </button>
        <button class="win-btn" title="最大化/还原" @click="winMaximizeToggle">
          <Square :size="12" stroke-width="1.5" />
        </button>
        <button class="win-btn win-btn-close" title="关闭" @click="winClose">
          <X :size="14" stroke-width="1.5" />
        </button>
      </div>
    </div>

    <!-- 内容区：占满标题栏以下的剩余高度 -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 登录页：全屏、无侧边栏 -->
      <div v-if="$route.path === '/login'" class="h-full flex-1 w-full">
        <router-view />
      </div>

      <!-- 其他页面：带侧边栏布局 -->
      <div v-else class="flex w-full">
        <Sidebar />
        <main class="flex-1 p-6 bg-bg overflow-auto">
          <router-view v-slot="{ Component }">
            <KeepAlive :max="10">
              <component :is="Component" />
            </KeepAlive>
          </router-view>
        </main>
      </div>
    </div>
  </div>

  <!-- 全局通知弹窗 -->
  <NotificationToast />

  <!-- 关闭选择弹窗：点主窗口关闭按钮时居中弹出（复用 dialog-transition 动画） -->
  <ShutdownMenuDialog
    :visible="shutdownMenuVisible"
    :has-toolbox="shutdownHasToolbox"
    :has-desktop="shutdownHasDesktop"
    @choose="onShutdownChoose"
    @cancel="onShutdownCancel"
  />

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
        style="background-color: rgba(255,255,255,0.72); backdrop-filter: blur(28px) saturate(1.5);"
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
import ShutdownMenuDialog from './components/base/ShutdownMenuDialog.vue'
import { useThemeStore } from './stores/theme'
import { defineAsyncComponent, h } from 'vue'
import { Minus, Square, X } from '@lucide/vue'

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
  components: { Sidebar, NotificationToast, ShutdownMenuDialog, Minus, Square, X, AiAssistant },
  data() {
    return {
      themeStore: null,
      assistantOpen: false,
      assistantPos: { x: null, y: null },
      assistantDrag: null,
      // 图标位置：用 CSS transform translate 做偏移，基准位置始终 right/bottom: 1.5rem
      iconTranslate: { x: 0, y: 0 },
      iconDrag: null,
      iconMoved: false,
      // 关闭选择弹窗状态
      shutdownMenuVisible: false,
      shutdownHasToolbox: false,
      shutdownHasDesktop: false,
      // 主进程消息监听（on 返回的 wrapper，供 beforeUnmount off）
      ipcFromMain: null,
    }
  },
  computed: {
    // 仅「Win11 主题」使用无边框透明窗口，需要自绘标题栏；其余主题由系统原生边框接管
    isWin11() {
      return this.themeStore.currentTheme === 'win11'
    },
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
    // 启动回报「桌面小组件启用状态 + 首帧真正空闲」：主进程据此错峰创建工具箱浮窗与（如启用）桌面小组件。
    // 延迟到主窗口首帧「真正空闲」时回报，避免与首屏渲染抢占资源；不用固定延迟。
    const reportWidgetsReady = () => {
      try {
        const enabled = (localStorage.getItem('desktopWidgetEnabled') ?? '1') !== '0'
        if (window.electron?.send) window.electron.send('widgets-ready', enabled)
      } catch (_) {}
    }
    if (typeof window.requestIdleCallback === 'function') {
      // 双重 idle：确保首帧渲染与首屏请求都让出一段空闲后才上报
      window.requestIdleCallback(() => window.requestIdleCallback(reportWidgetsReady))
    } else {
      reportWidgetsReady()
    }
  },
  created() {
    this.themeStore = useThemeStore()
    this.setupShutdownIpc()
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.onWindowResize)
    this.stopDragAssistant()
    this.stopDragIcon()
    this.teardownShutdownIpc()
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

    // ---- 无边框窗口控制（经 preload 白名单通道通知主进程） ----
    winMinimize() {
      window.electron?.send('win-minimize')
    },
    winMaximizeToggle() {
      window.electron?.send('win-maximize-toggle')
    },
    winClose() {
      window.electron?.send('win-close')
    },

    // ---- 关闭选择弹窗（复用现有弹窗动画，替代主进程原生菜单） ----
    setupShutdownIpc() {
      // 告知主进程：渲染层已就绪，可接管关闭菜单（弹窗生命周期内有 IPC 时此标记生效）
      window.electron?.send('shutdown-action', { type: 'ready' })
      this.ipcFromMain = window.electron?.on('from-main', (data) => {
        if (data && data.type === 'shutdown-menu') {
          // 若用户上次选了「下次不再提示」，则直接按上次的范围执行，不再弹窗
          const remembered = this.getRememberedShutdown()
          if (remembered && remembered.action) {
            window.electron?.send('shutdown-action', { action: remembered.action, remember: true })
            return
          }
          this.shutdownHasToolbox = !!data.hasToolbox
          this.shutdownHasDesktop = !!data.hasDesktop
          this.shutdownMenuVisible = true
        }
      })
    },
    teardownShutdownIpc() {
      if (window.electron?.off && this.ipcFromMain) {
        window.electron.off('from-main', this.ipcFromMain)
        this.ipcFromMain = null
      }
    },
    onShutdownChoose(payload) {
      const { action, remember } = payload || {}
      this.shutdownMenuVisible = false
      if (remember) this.setRememberedShutdown(action)
      else this.clearRememberedShutdown()
      window.electron?.send('shutdown-action', { action })
    },
    onShutdownCancel() {
      this.shutdownMenuVisible = false
      window.electron?.send('shutdown-action', { action: 'cancel' })
    },
    // 持久化「下次不再提示」的选择：仅前端 localStorage（同主窗口会话内有效）
    getRememberedShutdown() {
      try {
        const raw = localStorage.getItem('shutdown-remember')
        return raw ? JSON.parse(raw) : null
      } catch (_) { return null }
    },
    setRememberedShutdown(action) {
      try { localStorage.setItem('shutdown-remember', JSON.stringify({ action })) } catch (_) {}
    },
    clearRememberedShutdown() {
      try { localStorage.removeItem('shutdown-remember') } catch (_) {}
    },
  },
}
</script>

<style>
/* 无边框自绘标题栏：拖拽区 + 右侧窗口控制按钮。
   用全局样式而非 scoped，确保对登录页与主体布局一致生效。 */
.window-title-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  -webkit-app-region: drag; /* 整条可拖动窗口 */
  user-select: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
/* 右侧三个控制按钮及其容器必须可点击（脱离拖拽区） */
.window-controls {
  -webkit-app-region: no-drag;
}
.window-controls .win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 34px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.window-controls .win-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}
.window-controls .win-btn-close:hover {
  background: #e81123;
  color: #fff;
}
</style>