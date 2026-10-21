<template>
  <div class="app-root flex flex-col h-screen overflow-hidden">
    <!-- 自绘标题栏（所有主题统一）：主窗口为无边框透明窗口，标题栏承载窗口控制，整条可拖动。
     应用名已放在侧边栏顶部，标题栏本身不再显示文字。 -->
    <div class="window-title-bar flex-shrink-0 select-none" style="height:44px;">
      <!-- 左侧：撤销 / 重做 / 全局搜索（登录页隐藏，保持干净） -->
      <div v-if="$route.path !== '/login'" class="titlebar-left flex items-center" style="gap:6px; padding-left:10px; height:100%;">
        <button class="tb-btn" :disabled="!undoState.canUndo || undoState.busy" :title="undoTitle" @mouseenter="onUndoHover" @click="onUndo">
          <Undo2 :size="15" stroke-width="1.8" />
        </button>
        <button class="tb-btn" :disabled="!undoState.canRedo || undoState.busy" :title="redoTitle" @mouseenter="onUndoHover" @click="onRedo">
          <Redo2 :size="15" stroke-width="1.8" />
        </button>
        <button class="tb-btn" title="搜索（页面 / 设置）" v-preload="preloadSearchDialog" @click="searchOpen = true">
          <Search :size="15" stroke-width="2" />
        </button>
        <button class="tb-btn" title="切换主题" v-preload="preloadThemePickerDialog" @click="themeOpen = true">
          <Palette :size="15" stroke-width="1.8" />
        </button>
        <button class="tb-btn" title="账户" v-preload="preloadAccountDialog" @click="accountOpen = true">
          <User :size="15" stroke-width="1.8" />
        </button>
        <button class="tb-btn" title="系统设置" @click="goToSettings">
          <Settings :size="15" stroke-width="1.8" />
        </button>
        <button class="tb-btn" title="关于软件" @click="goToAbout">
          <Info :size="15" stroke-width="1.8" />
        </button>
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

    <!-- 标题栏全局搜索弹窗（懒加载组件，自包含 Teleport/Transition） -->
    <SearchDialog v-if="chromeReady" :visible="searchOpen" @close="searchOpen = false" />

    <!-- 标题栏「切换主题」弹窗：复用引导页的主题卡片 + 动画开关，点主题即时生效 -->
    <ThemePickerDialog v-if="chromeReady" :visible="themeOpen" @close="themeOpen = false" />

    <!-- 标题栏「账户」弹窗：用户名 / 权限 + 退出登录（带二次确认） -->
    <AccountDialog v-if="chromeReady" :visible="accountOpen" @close="accountOpen = false" />

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
      <span class="logo">班集</span>
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
    v-if="chromeReady"
    :visible="shutdownMenuVisible"
    :has-toolbox="shutdownHasToolbox"
    :has-desktop="shutdownHasDesktop"
    @choose="onShutdownChoose"
    @cancel="onShutdownCancel"
  />

  <!-- 启动提示：存在智能排表草稿时弹一次，告知已恢复上次草稿（内容在打开智能排表时恢复） -->
  <ConfirmDialog
    :visible="seatDraftPromptVisible"
    title="草稿已恢复"
    message="已恢复上一次的草稿表"
    confirm-text="知道了"
    @confirm="seatDraftPromptVisible = false"
  />

  <!-- AI 助手：悬浮呼出按钮与浮窗（登录页不显示；AI 助手页面本身已有完整对话界面，也不再渲染悬浮按钮；AI 未启用时同样不显示悬浮按钮） -->
  <template v-if="$route.path !== '/login' && $route.path !== '/ai-assistant' && aiEnabled && !aiIconHidden">
    <Teleport to="body">
      <button
        ref="aiIcon"
        @mousedown="startUnitDrag"
        @contextmenu.prevent="onAiContextMenu"
        v-preload="preloadAiAssistant"
        @click="onIconClick"
        class="fixed z-[20000] w-12 h-12 rounded-full bg-primary hover:bg-primary-hover text-text-inverse text-xl shadow-lg flex items-center justify-center cursor-move select-none"
        :style="iconStyle"
        title="AI 助手（左键打开/关闭浮窗，右键菜单，可拖动）"
      >🤖</button>
    </Teleport>
    <Teleport to="body">
      <!-- 复用工具箱的浮现/收回动画：整块面板从贴合图标的一侧缩放浮现 -->
      <Transition name="ai-pop">
        <!-- ai-glass-panel：硬编码浅色玻璃的标记类，夜间模式由 theme-night.css 统一覆盖为深色玻璃
             （与 AI 页面内的对话列表/聊天区等玻璃块保持一致） -->
        <div
          v-if="assistantOpen"
          ref="assistantPanel"
          class="ai-panel ai-glass-panel fixed z-[20001] border border-border rounded-card shadow-2xl flex flex-col overflow-hidden"
          :class="{ 'ai-panel-retracted': assistantRetracted }"
          style="background-color: rgba(255,255,255,0.72); backdrop-filter: blur(28px) saturate(1.5);"
          :style="{
            width: '36rem',
            maxWidth: 'calc(100vw - 2rem)',
            height: 'min(520px, calc(100vh - 6.5rem))',
            maxHeight: 'calc(100vh - 6rem)',
            left: assistantPos.x != null ? assistantPos.x + 'px' : 'auto',
            right: assistantPos.x == null ? '1.5rem' : 'auto',
            top: assistantPos.y != null ? assistantPos.y + 'px' : '5rem',
            transformOrigin: assistantAttach === 'left' ? 'left center' : 'right center',
          }">
          <div
            @mousedown="startUnitDrag"
            @click.stop
            class="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-hover flex-shrink-0 cursor-move select-none"
          >
            <span class="font-semibold text-text">🤖 AI 助手</span>
            <button
              type="button"
              @click.stop="assistantOpen = false"
              class="dlg-close"
              title="关闭"
            >✕</button>
          </div>
          <div class="flex-1 p-4 overflow-hidden">
            <AiAssistant :floating="true" @capture-start="onAssistantCaptureStart" @capture-end="onAssistantCaptureEnd" />
          </div>
        </div>
      </Transition>
    </Teleport>
  </template>
</template>

<script>
import Sidebar from './components/layout/Sidebar.vue'
import NotificationToast from './components/base/NotificationToast.vue'
import ConfirmDialog from './components/base/ConfirmDialog.vue'
import { useThemeStore } from './stores/theme'
import { useNotification } from './composables/useNotification'
import { useSeatDraft } from './composables/useSeatDraft'
import { defineAsyncComponent, h } from 'vue'
import { prefetchRoutes } from './router'
import { prefetchThemeStyles, warmNightMode, isNightWarmEnabled } from './styles/themeLoader'
import { Minus, Square, X, Undo2, Redo2, Search, Palette, User, Settings, Info } from '@lucide/vue'
import axios from 'axios'
import { undoState as undo, performUndo, refreshUndoStatus } from './composables/useUndo.js'
import './styles/dialog-transition.css'
import { SEND, INVOKE, RECEIVE } from './electronChannels.js'

// AI 助手懒加载：loader 抽成命名函数，既给 defineAsyncComponent 用，也供悬浮图标 hover 预取（v-preload）
const loadAiAssistant = () => import('./views/AiAssistant.vue')
// 异步组件：加载中/失败展示占位文案，避免浮窗点开就消失却毫无反馈
const AiAssistant = defineAsyncComponent({
  loader: loadAiAssistant,
  loadingComponent: {
    render() { return h('div', { class: 'h-full flex items-center justify-center text-sm text-text-muted' }, 'AI 助手加载中…') },
  },
  errorComponent: {
    render() { return h('div', { class: 'h-full flex items-center justify-center text-sm text-danger' }, 'AI 助手加载失败，请查看控制台') },
  },
  onError(retry, fail, attempts) { if (attempts < 3) retry() },
})

// 标题栏功能窗口懒加载：loader 抽成命名函数，既给 defineAsyncComponent 用，也供按钮 hover 预取（v-preload）
const loadSearchDialog = () => import('./components/base/SearchDialog.vue')
const loadThemePickerDialog = () => import('./components/base/ThemePickerDialog.vue')
const loadAccountDialog = () => import('./components/base/AccountDialog.vue')
const SearchDialog = defineAsyncComponent(loadSearchDialog)
const ThemePickerDialog = defineAsyncComponent(loadThemePickerDialog)
const AccountDialog = defineAsyncComponent(loadAccountDialog)
// 关闭选择弹窗：只有点窗口关闭按钮/Alt+F4 才用得上。
// 组件在 App 挂载时就会被渲染，因此 chunk 在挂载那一刻就开始加载（不阻塞首帧），
// 只是不再计入入口 chunk 的同步解析；实际弹窗前必定已就绪。
const loadShutdownMenuDialog = () => import('./components/base/ShutdownMenuDialog.vue')
const ShutdownMenuDialog = defineAsyncComponent(loadShutdownMenuDialog)

export default {
  components: { Sidebar, NotificationToast, ShutdownMenuDialog, ConfirmDialog, SearchDialog, ThemePickerDialog, AccountDialog, Minus, Square, X, Undo2, Redo2, Search, Palette, User, Settings, Info, AiAssistant },
  data() {
    return {
      themeStore: null,
      assistantOpen: false,
      // AI 助手是否已启用（null=尚未查到，先用隐藏态，避免图标闪一下又消失）
      aiEnabled: null,
      // 本次运行是否已从图标右键菜单「本次退出」隐藏悬浮图标（不持久化，重启恢复）
      aiIconHidden: false,
      assistantPos: { x: null, y: null },
      // 浮窗打开中（异步等 AI 内容加载完成，避免连点重复触发）
      assistantOpening: false,
      // 浮窗贴合图标的一侧（'left'|'right'）：决定浮现动画的缩放锚点
      assistantAttach: 'right',
      // 截屏期间把浮窗收起到图标位置（保持挂载，不丢对话/附件状态），截屏结束再展开
      assistantRetracted: false,
      // 图标位置：用 CSS transform translate 做偏移，基准位置始终 right/bottom: 1.5rem
      iconTranslate: { x: 0, y: 0 },
      // 整体拖动状态：图标与浮窗作为一个整体一起移动
      unitDrag: null,
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
      // 智能排表草稿：启动查到草稿时弹一次提示；draftChecked 保证只查一次（避免后端就绪事件重复触发）
      seatDraftPromptVisible: false,
      seatDraftChecked: false,
      // 标题栏全局搜索弹窗开关（搜索逻辑在 SearchDialog.vue 内）
      searchOpen: false,
      // 标题栏「切换主题」弹窗开关
      themeOpen: false,
      // 标题栏「账户」弹窗开关
      accountOpen: false,
      // 首屏可交互标志：这四个异步弹窗都是「关闭态也要先渲染 wrapper 才会去下载 chunk」，
      // 挪到占位页移除后（app-visible，见下方 reportWidgetsOnce）再挂载，
      // 把约 14KB JS + 5.7KB CSS 移出首屏窗口；关闭态不渲染，观感无任何变化。
      chromeReady: false,
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
    // 标题栏撤销/重做：直接暴露共享的响应式状态供模板读取
    undoState() { return undo },
    undoTitle() {
      if (!undo.key) return '当前页面不支持撤销'
      if (!undo.canUndo) return '当前页面没有可撤销的操作'
      return undo.undoLabel ? `撤销：${undo.undoLabel}` : '撤销'
    },
    redoTitle() {
      if (!undo.key) return '当前页面不支持重做'
      if (!undo.canRedo) return '当前页面没有可重做的操作'
      return undo.redoLabel ? `重做：${undo.redoLabel}` : '重做'
    },
  },
  watch: {
    '$route.path'() {
      // 切页时保持浮窗状态（用户可边操作边问）；若切换到 AI 助手页则收起浮窗
      if (this.$route.path === '/ai-assistant') this.assistantOpen = false
      // 切页时收起搜索弹窗
      this.searchOpen = false
    },
  },
  mounted() {
    window.addEventListener('resize', this.onWindowResize)
    // 点击浮窗/图标以外的区域自动收起（与工具箱一致）
    document.addEventListener('mousedown', this.onDocMouseDown)
    // 启动回报「桌面小组件启用状态」：主进程据此按需创建工具箱浮窗与（如启用）桌面小组件。
    // 时机：推迟到占位页消失（首屏真正可用）之后 —— 主进程建这两个窗口有约 40ms 的同步开销，
    // 早于此前它会紧压在「后端就绪」的处理之前，占用启动关键路径的时间。
    const reportWidgetsReady = () => {
      try {
        const enabled = (localStorage.getItem('desktopWidgetEnabled') ?? '1') !== '0'
        if (window.electron?.send) window.electron.send(SEND.WIDGETS_READY, enabled)
      } catch (_) {}
    }
    // 占位页移除时由渲染层入口广播 app-visible（见 src/main.js 的 dropSplash）。
    // 兜底 5s：后端起不来时占位页会常驻（它是失败提示的载体），此时照旧把小组件建出来。
    let widgetsReported = false
    let widgetsFallback = null
    const reportWidgetsOnce = () => {
      if (widgetsReported) return
      widgetsReported = true
      if (widgetsFallback) clearTimeout(widgetsFallback)
      window.removeEventListener('app-visible', reportWidgetsOnce)
      // 首屏已可见（或走 5s 兜底）：这时才挂载标题栏那几个异步弹窗，
      // 让它们的 chunk 下载/解析落在首屏之后。
      this.chromeReady = true
      reportWidgetsReady()
    }
    window.addEventListener('app-visible', reportWidgetsOnce)
    widgetsFallback = setTimeout(reportWidgetsOnce, 5000)
    // 空闲预热其余页面路由 chunk：让侧边栏跳转不再等 chunk 下载/解析。
    // 未登录（登录页）时不预热业务页面，避免无谓的后台解析。
    const startIdlePrefetch = () => {
      if (this.$route.path === '/login') return
      // AI 助手 chunk 排到预热末档；仅当 AI 未被明确禁用时才预热（未知/已启用都预热）
      prefetchRoutes({ warmDeferred: this.aiEnabled !== false })
      // 其余主题/日夜间 CSS 一并空闲预热：切换主题时不再有下载/解析间隙（见 styles/themeLoader.js）
      prefetchThemeStyles()
      // 预解码 glass 主题「另一张」内置底图：把首次切日/夜的图片解码挪到空闲期，
      // 否则快照交叉淡入会被解码拖住，观感是「切换按钮先变、界面后变」（见 stores/theme.js）
      this.themeStore.warmModeBackgrounds()
      // 夜间模式的「样式预热」：把首次切日/夜的那次性样式编译成本挪到空闲期。
      // 不预热的话，用户第一次点日/夜切换会有一次长任务（实测 ~160ms，见 themeLoader.js）。
      // 注意：applyTheme 里也会调度同一件事（覆盖「启动时是别的主题、之后才切到玻璃」的情况），
      //      两者靠 themeLoader 内部的 warmedThemes 去重，不会重复执行。
      // 开关已关（见 themeLoader.js 的 NIGHT_WARM_ENABLED）：预热会把整页日→夜→日跑一遍，
      // 用户反馈切主题时有可见闪动，故不再调用（判断放这里，模块也就不会被执行）。
      if (isNightWarmEnabled()) warmNightMode(this.themeStore.currentTheme, this.themeStore.mode)
    }
    // 预热锚点：等首屏占位页移除（app-visible）后再等「真正空闲」才预热。
    // 不设 timeout：宁可一直不预热，也不用兜底强制把 chunk 解析插进启动/交互的忙碌期。
    // app-visible 由渲染层入口在占位移除的下一帧派发（见 src/main.js 的 dropSplash），
    // 必定晚于本组件 mounted，故此处注册不会漏。
    const onAppVisiblePrefetch = () => {
      window.removeEventListener('app-visible', onAppVisiblePrefetch)
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(startIdlePrefetch)
      } else {
        setTimeout(startIdlePrefetch, 300)
      }
    }
    window.addEventListener('app-visible', onAppVisiblePrefetch)
  },
  created() {
    this.themeStore = useThemeStore()
    this.setupShutdownIpc()
    this.fetchPendingNotification()
    // 兜住「就绪广播早于本组件创建」的竞态：查一次当前状态，确保之后运行期异常能接管提示。
    // 后端确认就绪后顺带查一次智能排表草稿（此时接口才可用，避免启动瞬间静默失败）。
    window.electron?.invoke(INVOKE.BACKEND_STATUS).then((ok) => { if (ok) { this.backendEverReady = true; this.checkSeatDraft(); this.loadAiEnabled() } }).catch(() => {})
    // AI 设置变更（启用/停用、换模型）后刷新图标显隐
    window.addEventListener('ai-config-changed', this.onAiConfigChanged)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.onWindowResize)
    window.removeEventListener('ai-config-changed', this.onAiConfigChanged)
    document.removeEventListener('mousedown', this.onDocMouseDown)
    this.stopUnitDrag()
    this.teardownShutdownIpc()
  },
  methods: {
    onWindowResize() {
      const size = 48
      const m = 12
      const vw = window.innerWidth
      const vh = window.innerHeight
      // 图标以 right=1.5rem / bottom=1.5rem 锚定，窗口缩放时基准位置随边缘移动，
      // 故先按新尺寸钳制 translate，再把图标新位置换算回绝对坐标。
      const maxX = vw - size - 24 - m
      const maxY = vh - size - 24 - m
      const nx = Math.max(-maxX, Math.min(this.iconTranslate.x, 0))
      const ny = Math.max(-maxY, Math.min(this.iconTranslate.y, 0))
      if (nx !== this.iconTranslate.x || ny !== this.iconTranslate.y) {
        this.iconTranslate = { x: nx, y: ny }
      }
      // 浮窗与图标是一个整体：按图标钳制后的新屏幕位置重新贴合同一侧，使面板随图标一起移动
      if (!this.assistantOpen || this.assistantPos.x == null) return
      const left = vw - size - 24 + this.iconTranslate.x
      const top = vh - size - 24 + this.iconTranslate.y
      const pos = this.computeAssistantAttachPos(
        { left, top, right: left + size, bottom: top + size },
        true,
      )
      if (pos.x !== this.assistantPos.x || pos.y !== this.assistantPos.y) {
        this.assistantPos = { x: pos.x, y: pos.y }
      }
    },

    // ---- 悬浮按钮 + 浮窗整体拖动 ----
    // 图标与浮窗视为一个整体（与工具箱一致）：拖动按钮或拖动面板标题栏，两者一起移动，相对位置保持不变。
    // 拖动过程中直接改 DOM 样式，松手时再同步回响应式状态，避免每帧写响应式导致根组件重渲染。
    startUnitDrag(e) {
      if (e.button !== 0) return
      const iconEl = this.$refs.aiIcon
      const panelEl = this.assistantOpen ? this.$refs.assistantPanel : null
      const iconRect = iconEl ? iconEl.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 }
      const panelRect = panelEl ? panelEl.getBoundingClientRect() : null
      // 取「图标 + 面板」的联合包围盒作为整体，拖动时按整体钳制，保证两者都不出界
      const left = panelRect ? Math.min(iconRect.left, panelRect.left) : iconRect.left
      const top = panelRect ? Math.min(iconRect.top, panelRect.top) : iconRect.top
      const right = panelRect ? Math.max(iconRect.right, panelRect.right) : iconRect.right
      const bottom = panelRect ? Math.max(iconRect.bottom, panelRect.bottom) : iconRect.bottom
      this.unitDrag = {
        startX: e.clientX,
        startY: e.clientY,
        box: { left, top, w: right - left, h: bottom - top },
        icon: { left: iconRect.left, top: iconRect.top },
        panel: panelRect ? { left: panelRect.left, top: panelRect.top } : null,
        curIconX: this.iconTranslate.x,
        curIconY: this.iconTranslate.y,
        curPanelX: this.assistantPos.x,
        curPanelY: this.assistantPos.y,
      }
      this._iconMoved = false
      document.addEventListener('mousemove', this.onUnitDrag, { capture: true })
      document.addEventListener('mouseup', this.stopUnitDrag, { capture: true })
      e.preventDefault()
      e.stopPropagation()
    },
    onUnitDrag(e) {
      const d = this.unitDrag
      if (!d) return
      let dx = e.clientX - d.startX
      let dy = e.clientY - d.startY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._iconMoved = true
      // 整体包围盒钳制在可视区内（留 12px 边距）
      const m = 12
      const vw = window.innerWidth
      const vh = window.innerHeight
      const maxLeft = Math.max(m, vw - d.box.w - m)
      const maxTop = Math.max(m, vh - d.box.h - m)
      const newLeft = Math.max(m, Math.min(d.box.left + dx, maxLeft))
      const newTop = Math.max(m, Math.min(d.box.top + dy, maxTop))
      dx = newLeft - d.box.left
      dy = newTop - d.box.top
      // 图标：translate = 实际位置 - 基准位置（基准是 right=1.5rem/bottom=1.5rem 时的 left/top）
      const baseLeft = vw - 48 - 24
      const baseTop = vh - 48 - 24
      d.curIconX = d.icon.left + dx - baseLeft
      d.curIconY = d.icon.top + dy - baseTop
      const iconEl = this.$refs.aiIcon
      if (iconEl) iconEl.style.transform = `translate(${d.curIconX}px, ${d.curIconY}px)`
      // 面板：跟随同一位移
      const panelEl = this.$refs.assistantPanel
      if (panelEl && d.panel) {
        d.curPanelX = d.panel.left + dx
        d.curPanelY = d.panel.top + dy
        panelEl.style.left = d.curPanelX + 'px'
        panelEl.style.top = d.curPanelY + 'px'
        panelEl.style.right = 'auto'
      }
    },
    stopUnitDrag() {
      document.removeEventListener('mousemove', this.onUnitDrag, { capture: true })
      document.removeEventListener('mouseup', this.stopUnitDrag, { capture: true })
      const d = this.unitDrag
      this.unitDrag = null
      if (!d) return
      // 松手后把最终位置同步回响应式状态，保持后续窗口缩放等逻辑一致
      this.iconTranslate = { x: d.curIconX, y: d.curIconY }
      if (d.panel) this.assistantPos = { x: d.curPanelX, y: d.curPanelY }
    },
    // 图标点击：拖动超过阈值则不触发；否则切换浮窗打开/关闭
    onIconClick() {
      if (this._iconMoved) { this._iconMoved = false; return }
      if (this.assistantOpen) this.assistantOpen = false
      else this.openAssistant()
    },
    // 图标右键：呼出原生菜单（与工具箱一致，含「本次退出」）
    onAiContextMenu() {
      window.electron?.send(SEND.AI_CONTEXT_MENU)
    },
    // 点击浮窗/图标以外的区域自动收起（与工具箱一致）。AI 自身被 Teleport 到 body 的
    // 弹出层（截屏遮罩、权限挡位菜单等）带 data-ai-float-keep，视为浮窗内部，不触发收起。
    onDocMouseDown(e) {
      if (!this.assistantOpen) return
      const t = e.target
      if (t && typeof t.closest === 'function' && t.closest('[data-ai-float-keep]')) return
      const panel = this.$refs.assistantPanel
      const icon = this.$refs.aiIcon
      if (panel && panel.contains(t)) return
      if (icon && icon.contains(t)) return
      this.assistantOpen = false
    },
    // 打开浮窗：先等 AI 内容加载完成，再定位、下一帧显示（对齐工具箱「内容就位后再出现」的延迟策略），
    // 避免浮窗先露出「加载中…」占位再跳成正式内容
    async openAssistant() {
      if (this.assistantOpening || this.assistantOpen) return
      this.assistantOpening = true
      try { await loadAiAssistant() } catch (_) {}
      await new Promise((r) => requestAnimationFrame(r))
      const el = this.$refs.aiIcon
      if (el) this.assistantPos = this.computeAssistantAttachPos(el.getBoundingClientRect())
      this.assistantOpen = true
      this.assistantOpening = false
    },
    // 截屏开始：把浮窗收起到图标位置（用 CSS 过渡缩放淡出，保持组件挂载，不丢对话/附件状态），
    // 让浮窗在截屏画面前先消失，避免被截进画面
    onAssistantCaptureStart() {
      this.assistantRetracted = true
    },
    // 截屏结束：把浮窗重新展开
    onAssistantCaptureEnd() {
      this.assistantRetracted = false
    },
    // 依据图标当前屏幕位置计算浮窗落点。尺寸与浮窗样式保持一致：
    // 宽 36rem(576px)（maxWidth 100vw-2rem），高 min(520px, 100vh-6.5rem)
    // keepSide=true 时保持当前贴合侧（窗口缩放用），避免面板在左右之间跳变。
    computeAssistantAttachPos(rect, keepSide = false) {
      const m = 12, gap = 8
      const vw = this.clientW()
      const vh = this.clientH()
      const w = Math.min(576, vw - 32)
      const h = Math.min(520, vh - 104)
      let x
      if (keepSide) {
        x = this.assistantAttach === 'left' ? rect.right + gap : rect.left - gap - w
        x = Math.max(m, Math.min(x, vw - w - m))
      } else if (rect.left - gap - w >= m) {
        x = rect.left - gap - w
        this.assistantAttach = 'right'
      } else if (rect.right + gap + w <= vw - m) {
        x = rect.right + gap
        this.assistantAttach = 'left'
      } else {
        x = Math.max(m, Math.min(rect.left - gap - w, vw - w - m))
        this.assistantAttach = 'right'
      }
      const y = Math.max(m, Math.min(rect.bottom - h, vh - h - m))
      return { x, y }
    },
    clientW() { return document.documentElement.clientWidth || window.innerWidth || 800 },
    clientH() { return document.documentElement.clientHeight || window.innerHeight || 600 },

    // ---- 无边框窗口控制（经 preload 白名单通道通知主进程） ----
    winMinimize() {
      window.electron?.send(SEND.WIN_MINIMIZE)
    },
    winMaximizeToggle() {
      window.electron?.send(SEND.WIN_MAXIMIZE_TOGGLE)
    },
    winClose() {
      window.electron?.send(SEND.WIN_CLOSE)
    },

    // 模板只能访问实例成员，故把懒加载 loader 包成方法供 v-preload 预取
    preloadSearchDialog() { return loadSearchDialog() },
    preloadThemePickerDialog() { return loadThemePickerDialog() },
    preloadAccountDialog() { return loadAccountDialog() },
    preloadAiAssistant() { return loadAiAssistant() },

    // ---- 标题栏：跳转系统设置（跳转后给一条 info 提示） ----
    goToSettings() {
      if (this.$route.path !== '/settings') this.$router.push('/settings')
      useNotification().info('已跳转到系统设置')
    },

    // ---- 标题栏：跳转关于软件（跳转后给一条 info 提示） ----
    goToAbout() {
      if (this.$route.path !== '/about') this.$router.push('/about')
      useNotification().info('已跳转到关于软件')
    },

    // ---- 标题栏：撤销 / 重做（与页面内 Ctrl+Z 共用同一套逻辑） ----
    onUndo() { refreshUndoStatus(); performUndo(false) },
    onRedo() { refreshUndoStatus(); performUndo(true) },
    // 悬停时轻量刷新可用态（非 force，内部 400ms 节流），避免长时间停留后状态过期
    onUndoHover() { refreshUndoStatus() },

    // ---- 运行期后端异常 ----
    // 复用启动失败页的两个动作
    async retryBackendFromDead() {
      if (this.reconnectRetrying) return
      this.reconnectRetrying = true
      try { await window.electron?.invoke(INVOKE.RESTART_BACKEND) } catch (_) {}
      // 后端已重新 fork：整页重载重走一遍启动流程（若仍起不来会再次显示失败提示）
      setTimeout(() => location.reload(), 400)
    },
    quitAppFromDead() {
      window.electron?.send(SEND.QUIT_APP)
    },

    // 取走主进程暂存的待展示提示（如数据库迁移完成）。迁移会重建主窗口，
    // 提示无法在迁移时推送到尚未加载的渲染层，故由主窗口加载后主动取走再弹提示条。
    async fetchPendingNotification() {
      try {
        const res = await window.electron?.invoke(INVOKE.GET_PENDING_NOTIFICATION)
        if (res && res.message) {
          const notify = useNotification()
          const fn = { success: notify.success, error: notify.error, warning: notify.warning, info: notify.info }[res.type] || notify.info
          fn(res.message)
        }
      } catch (_) {}
    },

    // ---- 智能排表草稿：启动查到草稿就弹一次模态提示（内容待打开智能排表时恢复） ----
    async checkSeatDraft() {
      // 未登录（登录页）没有 token，接口会 401，直接跳过；查过就不再重复查（就绪事件可能多次到达）
      if (this.seatDraftChecked || !localStorage.getItem('token')) return
      this.seatDraftChecked = true
      const { draft, fetchDraft } = useSeatDraft()
      await fetchDraft()
      if (draft.exists) this.seatDraftPromptVisible = true
    },

    // 拉取 AI 助手启用状态：未启用时隐藏右下角悬浮按钮
    async loadAiEnabled() {
      // 未登录（登录页）没有 token，接口会 401，直接跳过
      if (!localStorage.getItem('token')) return
      try {
        const { data } = await axios.get('/api/ai/config')
        this.aiEnabled = !!(data && data.success && data.data && data.data.enabled)
      } catch (_) {
        this.aiEnabled = false
      }
      // 若浮窗正开着而此时 AI 已被停用，一并收起，避免留下一个打不开的窗口
      if (!this.aiEnabled) this.assistantOpen = false
    },
    onAiConfigChanged() {
      this.loadAiEnabled()
    },

    // ---- 关闭选择弹窗（复用现有弹窗动画，替代主进程原生菜单） ----
    // 工具箱右键「关闭工具箱」：先读完整设置、再整体写回。
    // 后端 PUT /api/widget-settings 是整体覆盖，只传 toolboxEnabled 会把两个保存路径清空。
    async persistToolboxDisabled() {
      try {
        const res = await axios.get('/api/widget-settings')
        const d = (res.data && res.data.data) || {}
        await axios.put('/api/widget-settings', {
          toolboxEnabled: false,
          noteSavePath: d.noteSavePath || '',
          screenshotSavePath: d.screenshotSavePath || '',
        })
        // 通知浮窗按最新设置刷新（此时它已被主进程隐藏，这里只是同步状态）
        window.electron?.send(SEND.TO_WIDGET, { type: 'settings-changed' })
        useNotification().success('工具箱已关闭，可在「设置 → 工具箱设置」重新启用')
      } catch (_) {
        useNotification().error('关闭工具箱失败，请重试')
      }
    },
    setupShutdownIpc() {
      // 告知主进程：渲染层已就绪，可接管关闭菜单（弹窗生命周期内有 IPC 时此标记生效）
      window.electron?.send(SEND.SHUTDOWN_ACTION, { type: 'ready' })
      this.ipcFromMain = window.electron?.on(RECEIVE.FROM_MAIN, (data) => {
        if (!data) return
        // 版本更新：新版本下载完成后给一条常驻提示（可在「关于」页点「重启并安装」）
        if (data.type === 'update-state') {
          const s = data.state || {}
          if (s.status === 'downloaded') {
            useNotification().success(`新版本 ${s.latestVersion ? 'v' + s.latestVersion : ''} 已下载，重启应用即可完成安装`, 0)
          }
          return
        }
        // AI 网页抽屉里网页触发的下载被主进程拦截：提示改用本地浏览器打开
        if (data.type === 'link-download-blocked') {
          useNotification().info('下载文件请打开本地浏览器')
          return
        }
        // 工具箱浮窗右键菜单选了「关闭工具箱」：把持久化开关一并置 false
        if (data.type === 'toolbox-close-request') {
          this.persistToolboxDisabled()
          return
        }
        // AI 悬浮图标右键菜单选了「本次退出」：本次运行隐藏悬浮图标与浮窗（重启恢复）
        if (data.type === 'ai-widget-exit') {
          this.aiIconHidden = true
          this.assistantOpen = false
          return
        }
        // 运行期后端异常状态（心跳探测 / 进程退出后主进程发起的重连）
        if (data.type === 'backend-ready') {
          this.backendEverReady = true
          this.backendDead = false
          this.reconnectRetrying = false
          this.checkSeatDraft()
          this.loadAiEnabled()
          return
        }
        if (data.type === 'backend-failed') {
          // 启动阶段的失败默认由首屏占位页接管（避免两层全屏遮罩叠在一起）。
          // 但占位页可能已先移除（乐观退出方案下不再等后端就绪），那时它已无法承载失败提示，
          // 这时必须由本页接管，否则用户会卡在骨架屏上、没有任何「重启后端 / 退出」入口。
          if (!this.backendEverReady && document.querySelector('.app-splash')) return
          this.backendDead = !!data.failed
          return
        }
        if (data.type === 'shutdown-menu') {
          // 若用户上次选了「下次不再提示」，则直接按上次的范围执行，不再弹窗
          const remembered = this.getRememberedShutdown()
          if (remembered && remembered.action) {
            window.electron?.send(SEND.SHUTDOWN_ACTION, { action: remembered.action, remember: true })
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
        window.electron.off(RECEIVE.FROM_MAIN, this.ipcFromMain)
        this.ipcFromMain = null
      }
    },
    onShutdownChoose(payload) {
      const { action, remember } = payload || {}
      this.shutdownMenuVisible = false
      if (remember) this.setRememberedShutdown(action)
      else this.clearRememberedShutdown()
      window.electron?.send(SEND.SHUTDOWN_ACTION, { action })
    },
    onShutdownCancel() {
      this.shutdownMenuVisible = false
      window.electron?.send(SEND.SHUTDOWN_ACTION, { action: 'cancel' })
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
  justify-content: space-between; /* 左侧功能区靠左、窗口控制按钮靠右，中间为可拖动空白 */
  background: transparent;
  -webkit-app-region: drag; /* 整条可拖动窗口 */
  user-select: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
/* 左侧功能区（撤销/重做/搜索）脱离拖拽区，可点击。app-region 不继承，须逐个子元素覆盖。 */
.titlebar-left,
.titlebar-left * {
  -webkit-app-region: no-drag;
}
/* 标题栏小按钮（撤销/重做）：26×26 圆角方块，配色随顶栏文字（currentColor）。
   必须清掉毛玻璃/Win11 主题的按钮皮肤（边框、阴影、荧光描边 ::before）。 */
.tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none !important;
  box-shadow: none !important;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.85;
  transition: background-color 0.12s ease, opacity 0.12s ease;
}
.tb-btn::before { display: none !important; }
.tb-btn:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 14%, transparent);
  opacity: 1;
}
.tb-btn:disabled { opacity: 0.35; cursor: default; }
/* 搜索弹窗结果行：逐条错开浮入（新类名，避免与设置页搜索动画互相干扰） */
@keyframes titleSearchRowIn {
  from { opacity: 0; transform: translateX(-10px); }
  to { opacity: 1; transform: translateX(0); }
}
.tb-search-row { animation: titleSearchRowIn 0.18s ease-out both; }
/* 清掉毛玻璃/Win11 主题给 button 加的皮肤：主题强制了 1px 实线边框而 Tailwind 默认边框色是
   currentColor，会让每行外面多出一圈近黑色框；box-shadow / ::before 荧光描边同理。
   圆角改回 8px，与上方搜索输入框的 rounded-lg 一致。 */
.tb-search-row {
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  border-radius: 8px !important;
}
.tb-search-row::before { display: none !important; }
/* 右侧三个控制按钮及其容器必须可点击（脱离拖拽区） */
.window-controls {
  -webkit-app-region: no-drag;
  /* 登录页隐藏了左侧功能区，标题栏只剩这一个子项，justify-content: space-between
     会把唯一子项排到最左边；用 margin-left:auto 恒定把它顶到最右。 */
  margin-left: auto;
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
  /* 关闭钮 hover 红：Win11 官方关闭红 #c42b1c，比原来的 #e81123 深一档，不那么刺眼 */
  background: #c42b1c;
  color: #fff;
}

/* AI 助手浮窗：截屏时收起到图标位置（保持挂载，不丢对话/附件状态），截屏结束再展开。
   过渡放在基础类上，收起/展开共用；缩放锚点由浮窗 :style 的 transform-origin 动态指定。 */
.ai-panel {
  transition:
    transform 0.1s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.1s ease;
}
.ai-panel-retracted {
  transform: scale(0.86);
  opacity: 0;
  pointer-events: none;
}

/* AI 助手浮窗：复用工具箱的浮现/收回动画（整块面板从贴合图标的一侧缩放浮现）。
   缩放锚点由浮窗 :style 的 transform-origin 动态指定（图标在右则锚右侧，反之锚左侧）。 */
.ai-pop-enter-active {
  transition:
    transform 0.1s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.1s ease;
}
.ai-pop-leave-active {
  transition:
    transform 0.1s cubic-bezier(0.4, 0, 1, 1),
    opacity 0.1s ease;
}
.ai-pop-enter-from,
.ai-pop-leave-to {
  transform: scale(0.86);
  opacity: 0;
}
</style>