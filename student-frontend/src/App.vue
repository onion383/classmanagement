<template>
  <div class="app-root flex flex-col h-screen overflow-hidden">
    <!-- 自绘标题栏（所有主题统一）：主窗口为无边框透明窗口，标题栏承载窗口控制，整条可拖动。
     应用名已放在侧边栏顶部，标题栏本身不再显示文字。 -->
    <div class="window-title-bar flex-shrink-0 select-none" style="height:44px;">
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
      <div v-else class="flex w-full min-w-0">
        <Sidebar />
        <main class="flex-1 min-w-0 p-6 bg-bg overflow-auto">
          <router-view v-slot="{ Component }">
            <!-- 缓存全部业务页面：当前共 15 个（不含 /login 与 /account 重定向），取 16 留 1 个余量。
                 实测多缓存几个页面仅多几 MB，故不再按最近访问淘汰。 -->
            <KeepAlive :max="16">
              <component :is="Component" />
            </KeepAlive>
          </router-view>
        </main>
      </div>
    </div>
  </div>

  <!-- 全局通知弹窗 -->
  <NotificationToast />

  <!-- 运行期后端异常：真挂了才全屏复用启动失败页（蓝字标题 + 蓝色感叹号三角 + 重试/退出）。
       重连过程静默进行，不占屏、不弹提示条。 -->
  <Teleport to="body">
    <div v-if="backendDead" class="backend-overlay">
      <svg class="warn-icon" width="36" height="36" viewBox="0 0 24 24" fill="none"
           stroke="#1e40af" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span class="logo">班级管理系统</span>
      <div class="fail-box">
        <div class="fail-msg">后台启动失败，请点击下面按钮重试或退出应用重试</div>
        <div class="fail-row">
          <button class="fail-btn primary" :disabled="reconnectRetrying" @click="retryBackendFromDead">
            {{ reconnectRetrying ? '重启中…' : '重启后端' }}
          </button>
          <button class="fail-btn" @click="quitAppFromDead">退出应用</button>
        </div>
      </div>
    </div>
  </Teleport>

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
import { useNotification } from './composables/useNotification'
import { defineAsyncComponent, h } from 'vue'
import { prefetchRoutes } from './router'
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
      // 关闭选择弹窗状态
      shutdownMenuVisible: false,
      shutdownHasToolbox: false,
      shutdownHasDesktop: false,
      // 主进程消息监听（on 返回的 wrapper，供 beforeUnmount off）
      ipcFromMain: null,
      // 运行期后端异常：真挂了才全屏显示启动失败页（蓝色三角 + 蓝字），重连过程静默
      backendDead: false,
      // 是否曾经就绪过：只有「启动成功后再异常」才由本页接管，
      // 启动阶段的失败提示归首屏占位页负责，避免两层全屏遮罩叠在一起
      backendEverReady: false,
      reconnectRetrying: false,
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
    // 启动回报「桌面小组件启用状态 + 首帧真正空闲」：主进程据此错峰创建工具箱浮窗与（如启用）桌面小组件。
    // 延迟到主窗口首帧「真正空闲」时回报，避免与首屏渲染抢占资源；不用固定延迟。
    const reportWidgetsReady = () => {
      try {
        const enabled = (localStorage.getItem('desktopWidgetEnabled') ?? '1') !== '0'
        if (window.electron?.send) window.electron.send('widgets-ready', enabled)
      } catch (_) {}
    }
    // 空闲预热其余页面路由 chunk：让侧边栏跳转不再等 chunk 下载/解析。
    // 未登录（登录页）时不预热业务页面，避免无谓的后台解析。
    const startIdlePrefetch = () => {
      if (this.$route.path === '/login') return
      prefetchRoutes()
    }
    if (typeof window.requestIdleCallback === 'function') {
      // 双重 idle：确保首帧渲染与首屏请求都让出一段空闲后才上报
      window.requestIdleCallback(() => window.requestIdleCallback(reportWidgetsReady))
      // 再让出一轮空闲后预热路由 chunk，避免与首屏请求/组件创建抢资源
      window.requestIdleCallback(() => window.requestIdleCallback(startIdlePrefetch), { timeout: 4000 })
    } else {
      reportWidgetsReady()
      setTimeout(startIdlePrefetch, 1500)
    }
  },
  created() {
    this.themeStore = useThemeStore()
    this.setupShutdownIpc()
    this.fetchPendingNotification()
    // 兜住「就绪广播早于本组件创建」的竞态：查一次当前状态，确保之后运行期异常能接管提示
    window.electron?.invoke('backend-status').then((ok) => { if (ok) this.backendEverReady = true }).catch(() => {})
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
      this._iconMoved = false
      document.addEventListener('mousemove', this.onDragIcon, { capture: true })
      document.addEventListener('mouseup', this.stopDragIcon, { capture: true })
      e.preventDefault()
      e.stopPropagation()
    },
    onDragIcon(e) {
      if (!this.iconDrag) return
      const drag = this.iconDrag
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._iconMoved = true
      // 计算新左上角位置并钳制在可视区内（留出 12px 边距）
      const size = 48
      const m = 12
      const vw = window.innerWidth
      const vh = window.innerHeight
      let newLeft = drag.startLeft + dx
      let newTop = drag.startTop + dy
      newLeft = Math.max(m, Math.min(newLeft, vw - size - m))
      newTop = Math.max(m, Math.min(newTop, vh - size - m))
      // translate = 新位置 - 基准位置（基准是 right=1.5rem/bottom=1.5rem 时的 left/top）
      const baseLeft = vw - size - 24
      const baseTop = vh - size - 24
      drag.x = newLeft - baseLeft
      drag.y = newTop - baseTop
      // 直接改 DOM transform，避免每帧写响应式导致根组件重渲染；松手时再同步回 iconTranslate
      const el = this.$refs.aiIcon
      if (el) el.style.transform = `translate(${drag.x}px, ${drag.y}px)`
    },
    stopDragIcon() {
      document.removeEventListener('mousemove', this.onDragIcon, { capture: true })
      document.removeEventListener('mouseup', this.stopDragIcon, { capture: true })
      const drag = this.iconDrag
      // 松手后把最终位移同步回响应式状态，保持后续窗口缩放等逻辑一致
      if (drag && drag.x != null) this.iconTranslate = { x: drag.x, y: drag.y }
      this.iconDrag = null
    },
    // 图标点击：拖动超过阈值则不触发；否则切换浮窗打开/关闭
    onIconClick() {
      if (this._iconMoved) { this._iconMoved = false; return }
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

    // ---- 运行期后端异常 ----
    // 复用启动失败页的两个动作
    async retryBackendFromDead() {
      if (this.reconnectRetrying) return
      this.reconnectRetrying = true
      try { await window.electron?.invoke('restart-backend') } catch (_) {}
      // 后端已重新 fork：整页重载重走一遍启动流程（若仍起不来会再次显示失败提示）
      setTimeout(() => location.reload(), 400)
    },
    quitAppFromDead() {
      window.electron?.send('quit-app')
    },

    // 取走主进程暂存的待展示提示（如数据库迁移完成）。迁移会重建主窗口，
    // 提示无法在迁移时推送到尚未加载的渲染层，故由主窗口加载后主动取走再弹提示条。
    async fetchPendingNotification() {
      try {
        const res = await window.electron?.invoke('get-pending-notification')
        if (res && res.message) {
          const notify = useNotification()
          const fn = { success: notify.success, error: notify.error, warning: notify.warning, info: notify.info }[res.type] || notify.info
          fn(res.message)
        }
      } catch (_) {}
    },

    // ---- 关闭选择弹窗（复用现有弹窗动画，替代主进程原生菜单） ----
    setupShutdownIpc() {
      // 告知主进程：渲染层已就绪，可接管关闭菜单（弹窗生命周期内有 IPC 时此标记生效）
      window.electron?.send('shutdown-action', { type: 'ready' })
      this.ipcFromMain = window.electron?.on('from-main', (data) => {
        if (!data) return
        // 运行期后端异常状态（心跳探测 / 进程退出后主进程发起的重连）
        if (data.type === 'backend-ready') {
          this.backendEverReady = true
          this.backendDead = false
          this.reconnectRetrying = false
          return
        }
        if (data.type === 'backend-failed') {
          // 启动阶段的失败由首屏占位页接管；本页只接管「跑起来之后再挂」
          if (!this.backendEverReady) return
          this.backendDead = !!data.failed
          return
        }
        if (data.type === 'shutdown-menu') {
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
/* 运行期后端异常遮罩：完全复用启动失败页的观感（同底色、同蓝字标题、同按钮），
   仅在后端确实重启失败时显示，重连过程不占屏。 */
.backend-overlay {
  position: fixed; inset: 0; z-index: 2147483000;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px;
  background: linear-gradient(160deg, #eef2ff 0%, #e2e8ff 100%);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
.backend-overlay .logo { font-size: 22px; font-weight: 600; color: #1e40af; letter-spacing: 1px; }
.backend-overlay .fail-box { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.backend-overlay .fail-msg { font-size: 13px; color: #b91c1c; }
.backend-overlay .fail-row { display: flex; gap: 10px; }
.backend-overlay .fail-btn {
  font-size: 13px; padding: 6px 16px; border-radius: 6px; cursor: pointer;
  border: 1px solid rgba(30, 64, 175, .35); background: #fff; color: #1e40af;
}
.backend-overlay .fail-btn.primary { background: #1e40af; border-color: #1e40af; color: #fff; }
.backend-overlay .fail-btn:disabled { opacity: .5; cursor: default; }

/* 无边框自绘标题栏：拖拽区 + 右侧窗口控制按钮。
   用全局样式而非 scoped，确保对登录页与主体布局一致生效。 */
.window-title-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end; /* 控制按钮靠右，左侧为可拖动空白区 */
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
  height: 100%; /* 满高，与加高后的标题栏对齐 */
  border: none !important; /* 覆盖毛玻璃/Win11 主题全局 button 边框（theme-glass.css） */
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