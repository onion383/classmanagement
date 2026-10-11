<template>
  <div class="widget-wrapper" :class="{ 'wrapper-fading': wrapperFading, 'no-pad': noteFullscreen }">
    <!-- 图标始终显示（工具状态时隐藏）。左键切换菜单，右键呼出「本次退出」等菜单 -->
    <div v-if="state !== 'tool'" class="fab" :class="{ 'fab-hidden': !fabReady }" @mousedown="onFabMouseDown" @contextmenu.prevent="onFabContextMenu">
      🧰
    </div>

    <!-- 功能菜单：展开/收起用 Transition 做宽度过渡，从图标右侧展开、收拢回图标 -->
    <Transition :name="menuTransition">
      <div v-if="state === 'menu'" class="panel menu-panel">
        <div class="drag-bar" @mousedown="onDragMouseDown">
          <div class="drag-indicator"></div>
        </div>
        <div class="panel-header">
          <span class="title">工具箱</span>
          <button class="close-btn" @click="closeToIcon">✕</button>
        </div>
        <div class="menu-grid">
          <div
            v-for="tool in tools"
            :key="tool.id"
            class="menu-item"
            @click="openTool(tool.id)"
          >
            <span class="menu-icon">{{ tool.icon }}</span>
            <span class="menu-name">{{ tool.name }}</span>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 具体工具 -->
    <div v-if="state === 'tool'" class="panel tool-panel" :class="{ 'tool-hidden': !toolReady, 'no-radius': noteFullscreen }">
      <div v-if="activeTool !== 'note' || !noteFullscreen" class="drag-bar" @mousedown="onDragMouseDown">
        <div class="drag-indicator"></div>
      </div>
      <Timer v-if="activeTool === 'timer'" @close="closeToIcon" />
      <RollCall v-else-if="activeTool === 'rollcall'" @close="closeToIcon" />
      <Screenshot v-else-if="activeTool === 'screenshot'" @close="closeToIcon" />
      <Note v-else-if="activeTool === 'note'" @close="closeToIcon" @ready="onNoteReady" @shrink="onNoteShrink" />
      <div v-else class="placeholder-tool">
        <div class="placeholder-icon">🚧</div>
        <div class="placeholder-text">功能开发中</div>
        <button class="btn-back" @click="closeToIcon">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import Timer from './Timer.vue'
import RollCall from './RollCall.vue'
import Screenshot from './Screenshot.vue'
import Note from './Note.vue'

const state = ref('icon') // 'icon' | 'menu' | 'tool'
const activeTool = ref('')
const toolReady = ref(false)
const noteFullscreen = ref(false)
// 图标是否可见：工具收起时先隐藏图标，等窗口收缩/归位到位后再淡入，避免图标出现在旧位置再跳位
const fabReady = ref(true)
// 整体容器是否整体淡出：点工具时先整体淡出，再切面板/改窗口尺寸，最后整体淡入，避免闪一下
const wrapperFading = ref(false)
// 菜单面板的过渡名：进入工具时置空（不做收起动画，避免与工具面板布局打架），其余情况播放展开/收起
const menuTransition = ref('toolbox-pop')

// 等主进程确认窗口尺寸已生效后再执行 cb（多用于「先改窗口尺寸、再显示内容」），
// 避免用固定延时带来的空窗；兜底 250ms 防止回执丢失时内容一直不显示。
function afterWidgetResized(cb, fallbackMs = 250) {
  let finished = false
  let handler = null
  const timer = setTimeout(finish, fallbackMs)
  function finish() {
    if (finished) return
    finished = true
    if (handler) window.electron.off('from-main', handler)
    clearTimeout(timer)
    // 等一帧，确保渲染层已按新尺寸完成布局后再显示
    requestAnimationFrame(cb)
  }
  handler = window.electron.on('from-main', (data) => {
    if (data && data.type === 'widget-resized') finish()
  })
}

const tools = [
  { id: 'timer', name: '计时器', icon: '⏱️' },
  { id: 'rollcall', name: '点名器', icon: '🎲' },
  { id: 'screenshot', name: '截图', icon: '📷' },
  { id: 'note', name: '注释', icon: '📝' },
]

let toolCloseTimer = null
let toolOpenTimer = null

// 取消尚未执行的「点工具切换」，并恢复整体透明度（用于用户在淡出过程中又操作了其它入口）
function cancelPendingToolOpen() {
  if (toolOpenTimer) {
    clearTimeout(toolOpenTimer)
    toolOpenTimer = null
  }
  wrapperFading.value = false
}

function openTool(id) {
  if (toolCloseTimer) {
    clearTimeout(toolCloseTimer)
    toolCloseTimer = null
  }
  if (toolOpenTimer) clearTimeout(toolOpenTimer)
  // 先让整个容器淡出（不改动任何面板的挂载与布局），淡出后再切面板、改窗口尺寸，最后整体淡入。
  // 这样「菜单瞬间消失 + 窗口立刻改尺寸」不会露出来，避免闪一下。
  wrapperFading.value = true
  toolOpenTimer = setTimeout(() => {
    toolOpenTimer = null
    menuTransition.value = ''
    activeTool.value = id
    toolReady.value = true // 内容就位（此时整体仍处于淡出态，看不到旧尺寸渲染）
    noteFullscreen.value = false
    state.value = 'tool'
    // 等窗口改到工具尺寸并完成布局后，再整体淡入
    afterWidgetResized(() => {
      wrapperFading.value = false
    })
  }, 50)
}

function onNoteReady() {
  noteFullscreen.value = true
  window.electron.send('widget-fullscreen')
}

function onNoteShrink() {
  noteFullscreen.value = false
  window.electron.send('widget-restore')
  window.electron.send('widget-resize', [240, 220])
}

function closeToIcon() {
  cancelPendingToolOpen()
  if (state.value === 'tool') {
    // 图标先隐藏，等窗口收缩/归位到位后再淡入，避免图标出现在旧位置又跳位造成的闪。
    fabReady.value = false
    if (noteFullscreen.value) {
      // 全屏注释：直接切换，避免面板淡出时让桌面透过透明窗口闪现
      state.value = 'icon'
      activeTool.value = ''
      return
    }
    // 普通工具：面板先淡出（复用 tool-hidden 的透明度过渡），淡出结束再切回图标。
    // 注意：此处不清空 activeTool，否则退场中的工具面板会立刻变回「功能开发中」占位。
    toolReady.value = false
    if (toolCloseTimer) clearTimeout(toolCloseTimer)
    toolCloseTimer = setTimeout(() => {
      toolCloseTimer = null
      state.value = 'icon'
      activeTool.value = ''
    }, 130)
    return
  }
  state.value = 'icon'
  activeTool.value = ''
}

function onDragMouseDown(e) {
  e.preventDefault()
  const startScreenX = e.screenX
  const startScreenY = e.screenY
  window.electron.send('widget-drag-start', { screenX: startScreenX, screenY: startScreenY })

  const onMouseMove = (e) => {
    window.electron.send('widget-drag-move', { screenX: e.screenX, screenY: e.screenY })
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    window.electron.send('widget-drag-end')
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onFabMouseDown(e) {
  e.preventDefault()
  // 仅左键触发拖拽/菜单切换；右键只走 contextmenu 的「本次退出」原生菜单，不进工具箱菜单
  if (e.button !== 0) return
  let hasMoved = false
  const startScreenX = e.screenX
  const startScreenY = e.screenY
  const startClientX = e.clientX
  const startClientY = e.clientY
  window.electron.send('widget-drag-start', { screenX: startScreenX, screenY: startScreenY })

  const onMouseMove = (e) => {
    if (Math.abs(e.clientX - startClientX) > 3 || Math.abs(e.clientY - startClientY) > 3) {
      hasMoved = true
    }
    window.electron.send('widget-drag-move', { screenX: e.screenX, screenY: e.screenY })
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    window.electron.send('widget-drag-end')
    if (!hasMoved) {
      cancelPendingToolOpen()
      if (state.value === 'menu') {
        state.value = 'icon'
      } else {
        fabReady.value = true
        menuTransition.value = 'toolbox-pop' // 展开工具箱时播放展开动画
        state.value = 'menu'
      }
    }
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 右键浮窗图标：呼出原生右键菜单（当前含「本次退出」）
function onFabContextMenu() {
  window.electron.send('widget-context-menu')
}

// 点击菜单外部区域自动收起菜单
function onDocMouseDown(e) {
  if (state.value !== 'menu') return
  const menuPanel = document.querySelector('.menu-panel')
  const fab = document.querySelector('.fab')
  if (!menuPanel || !fab) return
  if (menuPanel.contains(e.target) || fab.contains(e.target)) return
  cancelPendingToolOpen()
  state.value = 'icon'
}

let blurHandler = null

async function checkToolboxEnabled() {
  try {
    const res = await axios.get('/api/widget-settings')
    if (!res.data.success) return
    // 持久「是否启用工具箱」作为本次会话的默认值，注入一次后即由会话开关独立控制
    const persistent = res.data.data.toolboxEnabled
    let session = await window.electron.invoke('get-session-widget-visible')
    if (session === null) {
      session = persistent
      window.electron.send('widget-set-session-visible', session)
    }
    window.electron.send('widget-set-visible', session)
  } catch (_) {
    // 读取失败则保持默认可见
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
  checkToolboxEnabled()
  blurHandler = window.electron.on('from-main', (data) => {
    if (data && data.type === 'blur' && state.value === 'menu') {
      cancelPendingToolOpen()
      state.value = 'icon'
    }
    if (data && data.type === 'settings-changed') {
      checkToolboxEnabled()
    }
  })
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  if (toolOpenTimer) clearTimeout(toolOpenTimer)
  if (toolCloseTimer) clearTimeout(toolCloseTimer)
  if (blurHandler) {
    window.electron.off('from-main', blurHandler)
  }
})

// 状态变化时自动调整窗口大小和位置
let iconShrinkTimer = null

watch(
  [state, activeTool],
  ([newState, newTool], [oldState, oldTool]) => {
    // 状态再次变化则取消尚未执行的窗口收缩，避免与新的展开动画抢时序
    if (iconShrinkTimer) {
      clearTimeout(iconShrinkTimer)
      iconShrinkTimer = null
    }

    let size
    if (newState === 'icon') {
      if (oldState === 'menu') {
        // 收起工具箱：先让面板播完收起动画，再收缩窗口，否则窗口提前变小会瞬间裁掉面板
        iconShrinkTimer = setTimeout(() => {
          iconShrinkTimer = null
          window.electron.send('widget-resize', [48, 48])
        }, 120)
        return
      }
      size = [48, 48]
      if (oldState === 'tool') {
        // 如果之前是全屏注释工具，先恢复窗口大小
        if (oldTool === 'note') {
          window.electron.send('widget-restore')
        }
        window.electron.send('widget-restore-position')
      }
    } else if (newState === 'menu') {
      fabReady.value = true
      size = [284, 300]
    } else if (newState === 'tool') {
      if (newTool === 'note') {
        // 注释工具：先居中显示小窗口加载，等 Note 准备好再全屏
        size = [220, 200]
        window.electron.send('widget-center')
        window.electron.send('widget-resize', size)
        return
      }
      const toolSizes = {
        timer: [200, 400],
        rollcall: [220, 400],
        screenshot: [250, 400],
      }
      size = toolSizes[newTool] || [200, 300]
      window.electron.send('widget-center')
    }

    window.electron.send('widget-resize', size)
    // 收起工具：等窗口收缩并归位到位后再让图标淡入，避免图标先出现在旧位置再跳位
    if (newState === 'icon' && oldState === 'tool') {
      afterWidgetResized(() => {
        fabReady.value = true
      })
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.widget-wrapper {
  display: flex;
  align-items: flex-start;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  /* 与主进程 WIDGET_SHADOW_MARGIN 保持一致：四周留出阴影绘制空间，
     窗口位置已相应向左上偏移同值，所以图标/面板的屏幕位置不受影响 */
  padding: 16px;
  background: transparent;
  overflow: hidden;
  min-width: 0;
  transition: opacity 0.05s ease; /* 整体淡出/淡入：遮住切面板+改窗口尺寸的过程 */
}

/* 全屏注释：去掉阴影留边，让内容真正铺满整屏 */
.widget-wrapper.no-pad {
  padding: 0;
}

/* 点工具时整体淡出，切完面板、窗口尺寸到位后再整体淡入 */
.widget-wrapper.wrapper-fading {
  opacity: 0;
}

.fab {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--color-primary, #22c55e);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s ease, opacity 0.1s ease;
  user-select: none;
  flex-shrink: 0;
}

.fab.fab-hidden {
  opacity: 0;
  pointer-events: none;
}

.fab:hover {
  transform: scale(1.05);
}

.panel {
  background: var(--color-surface, #ffffff);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
  border: 1px solid var(--color-border, #e5e7eb);
}

.menu-panel {
  width: 228px;
  margin-left: 8px; /* 图标与面板间距：用 margin 而非 wrapper gap，收起时不会瞬间位移 */
  box-sizing: border-box;
  overflow: hidden;
  transform-origin: left center; /* 浮现/收回都以图标一侧为锚点，像从图标里长出来 */
}

/* 展开/收起动画：整体缩放 + 淡入淡出，营造“整块窗口从图标处浮现/收回”的感觉。
   展开走减速回弹曲线，收起走加速曲线；节奏偏快，避免拖沓。 */
.toolbox-pop-enter-active {
  transition:
    transform 0.1s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.1s ease;
}

.toolbox-pop-leave-active {
  transition:
    transform 0.1s cubic-bezier(0.4, 0, 1, 1),
    opacity 0.1s ease;
}

.toolbox-pop-enter-from,
.toolbox-pop-leave-to {
  transform: scale(0.86);
  opacity: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text, #111827);
}

.close-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: var(--color-bg, #f9fafb);
  color: var(--color-text-secondary, #6b7280);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.close-btn:hover {
  background: var(--color-border, #e5e7eb);
}

.menu-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.menu-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px 8px;
  border-radius: 12px;
  border: 1px solid var(--color-border, #e5e7eb);
  background: var(--color-bg, #f9fafb);
  cursor: pointer;
  transition: all 0.2s ease;
}

.menu-item:hover {
  background: var(--color-primary, #22c55e);
  color: white;
  border-color: var(--color-primary, #22c55e);
}

.menu-icon {
  font-size: 24px;
}

.menu-name {
  font-size: 13px;
  font-weight: 500;
}

.drag-bar {
  width: 100%;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  margin-bottom: 4px;
}

.drag-bar:active {
  cursor: grabbing;
}

.drag-indicator {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-text-muted, #d1d5db);
}

.tool-panel {
  width: 100%;
  height: 100%;
  position: relative;
  padding: 12px;
  box-sizing: border-box;
  overflow: hidden;
  min-width: 0;
  transition: opacity 0.12s ease;
}

.tool-hidden {
  opacity: 0;
}

.no-radius {
  border-radius: 0;
  padding: 0;
}

.placeholder-tool {
  text-align: center;
  padding: 24px 0;
}

.placeholder-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.placeholder-text {
  font-size: 14px;
  color: var(--color-text-secondary, #6b7280);
  margin-bottom: 16px;
}

.btn-back {
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid var(--color-border, #e5e7eb);
  background: var(--color-bg, #f9fafb);
  color: var(--color-text, #111827);
  cursor: pointer;
  font-size: 13px;
}

.btn-back:hover {
  background: var(--color-border, #e5e7eb);
}
</style>
