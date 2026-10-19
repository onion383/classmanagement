<template>
  <div class="widget-wrapper" :class="{ 'wrapper-fading': wrapperFading, 'no-pad': noteFullscreen }">
    <!-- 图标始终显示（工具状态时隐藏）。左键切换菜单，右键呼出「本次退出」等菜单 -->
    <div v-if="state !== 'tool'" class="fab" :class="{ 'fab-hidden': !fabReady }" @mousedown="onFabMouseDown" @contextmenu.prevent="onFabContextMenu">
      <IconGlyph name="toolbox" :size="24" />
    </div>

    <!-- 功能菜单：展开/收起用 Transition 做宽度过渡，从图标右侧展开、收拢回图标 -->
    <Transition :name="menuTransition">
      <div v-if="state === 'menu'" class="panel menu-panel">
        <div class="drag-bar" @mousedown="onDragMouseDown">
          <div class="drag-indicator"></div>
        </div>
        <div class="panel-header">
          <span class="title">工具箱</span>
          <button class="close-btn" @click="closeToIcon"><IconGlyph name="close" :size="14" tint="current" /></button>
        </div>
        <div class="menu-grid">
          <div
            v-for="tool in tools"
            :key="tool.id"
            class="menu-item"
            @click="openTool(tool.id)"
          >
            <IconGlyph :name="tool.id" :size="24" class="menu-icon" />
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
        <div class="placeholder-icon"><IconGlyph name="developing" :size="32" /></div>
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
import IconGlyph from '../../components/base/IconGlyph.vue'

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

// 四个工具：id 同时作为 IconGlyph 的图标 key（见 IconGlyph.vue 的 MAP）
const tools = [
  { id: 'timer', name: '计时器' },
  { id: 'rollcall', name: '点名器' },
  { id: 'screenshot', name: '截图' },
  { id: 'note', name: '注释' },
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
        screenshot: [250, 450],
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
  /* 浮窗图标固定用淡黄色，不再跟随主题主色 */
  background: #ffe08a;
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
  /* 竖排弹性布局：顶部拖动条占固定高度，工具内容自动收缩占满剩余空间。
     否则工具根元素 height:100% 会连拖动条一起算进去，向下溢出约 20px，
     被面板 overflow 裁掉后底部毛玻璃内边距变成 0（上下内边距不一致）。 */
  display: flex;
  flex-direction: column;
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

<!-- 主题玻璃观感：底色/文字/边框等已由主题变量（--color-surface / --color-text / --color-border）
     自动跟随（含夜间），这里只补三件事：
     1) 毛玻璃特有的一层——背景模糊与亮边。模糊只加在菜单面板上：工具面板内可能有
        position:fixed 的全屏层（如注释工具），backdrop-filter 会为其建立包含块，
        导致那些固定层不再铺满窗口。
     2) 与主窗口一致的图片背景（自选图，或 glass 的内置日/夜底图），铺在工具面板上。
     3) 菜单项与其选中/悬停态：改成透亮的毛玻璃，而不是不透明色块 / 纯主色填充。
     4) 二级页面（四个小工具内部）的色块：同样换成透亮玻璃块，别把面板背景图盖死。 -->
<style>
/* ---- 1. 亮边与背景模糊 ---- */
/* 毛玻璃主题（glass / win11）：与主界面卡片同一套配方 */
:root:is([data-theme="glass"], [data-theme="win11"]) .panel {
  border-color: rgba(255, 255, 255, 0.35);
}
:root:is([data-theme="glass"], [data-theme="win11"]) .menu-panel {
  backdrop-filter: blur(20px) saturate(1.1);
}
/* 夜间不出现亮边（与 theme-night.css 的约定一致），改回主题边框色 */
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="win11"]) .panel {
  border-color: var(--color-border, rgba(255, 255, 255, 0.08));
}
/* 新毛玻璃主题（glass2）：亮边与模糊强度都走它自己的玻璃配方变量，夜间自动变暗 */
:root[data-theme="glass2"] .panel {
  border-color: var(--g2-line, rgba(255, 255, 255, 0.7));
}
:root[data-theme="glass2"] .menu-panel {
  backdrop-filter: blur(var(--g2-blur, 18px)) saturate(var(--g2-saturate, 175%));
}

/* ---- 2. 图片背景 ---- */
/* 面板上的遮罩色与各主题 body 上那层保持一致（glass 走 --bg-mask-color 变量，随日/夜与
   「夜间内置底图」自动变化；glass2 没有这个变量，日/夜各给一档） */
:root:is([data-theme="glass"], [data-theme="win11"]) {
  --panel-bg-mask: var(--bg-mask-color, rgba(240, 244, 248, var(--bg-mask-opacity, 0.6)));
}
:root[data-theme="glass2"] {
  --panel-bg-mask: rgba(238, 241, 248, var(--bg-mask-opacity, 0.6));
}
:root[data-mode="night"][data-theme="glass2"] {
  --panel-bg-mask: rgba(15, 21, 38, var(--bg-mask-opacity, 0.6));
}
/* 白色薄纱的不透明度：日间更亮更“奶”。深色模式直接去掉——主窗口的玻璃底图配方
   本身只有「遮罩 + 底图」两层（见 theme-glass.css 的 body::before），工具箱面板额外
   叠的这层白纱在夜间会把内置深色底图（glass-bg-night.webp）洗成灰白，看着像「没有
   图片背景」，也与「深色模式禁止额外白色提亮」的约定冲突。 */
:root {
  --panel-white-opacity: 0.5;
}
:root[data-mode="night"] {
  --panel-white-opacity: 0;
}
/* 有背景图时：图放到面板内单独一层（::before）再整体模糊，观感对齐引导页的磨砂玻璃卡片。
   模糊半径加大到 28px（引导页是 14px，这里更“全局模糊”）；图向外多留 2 倍半径，
   避免模糊后边缘露白，面板自身的 overflow:hidden 会把它裁成圆角。
   三层由下到上：背景图 → 主题遮罩色 → 白色薄纱（提亮）。
   isolation 只让这一层落在「面板背景」与「面板内容」之间（不会糊到菜单文字），
   也不会为工具面板内 position:fixed 的全屏层（如注释工具）建立包含块。 */
:root.has-bg-image .panel {
  position: relative;
  isolation: isolate;
  background-image: none;
}
:root.has-bg-image .panel::before {
  content: '';
  position: absolute;
  inset: -56px;
  z-index: -1;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255, 255, 255, var(--panel-white-opacity, 0.34)), rgba(255, 255, 255, var(--panel-white-opacity, 0.34))),
    linear-gradient(var(--panel-bg-mask, rgba(255, 255, 255, 0.6)), var(--panel-bg-mask, rgba(255, 255, 255, 0.6))),
    var(--bg-image);
  background-size: cover, cover, cover;
  background-position: center, center, center;
  background-repeat: no-repeat, no-repeat, no-repeat;
  filter: blur(28px) saturate(1.15);
}

/* ---- 3. 菜单项：玻璃块 + 亮一档的选中态 ---- */
/* 基础态：由不透明色块改为半透明玻璃，让面板底色/背景图透出来 */
:root:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .menu-item {
  background: color-mix(in srgb, var(--color-surface, #ffffff) 70%, transparent);
  border-color: rgba(255, 255, 255, 0.45);
}
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .menu-item {
  border-color: var(--color-border, rgba(255, 255, 255, 0.12));
}
/* 选中/悬停：在玻璃块上再提亮一档（日间白霜更实，夜间只提亮不刺眼），不再用纯主色填充 */
:root:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .menu-item:hover {
  background: color-mix(in srgb, var(--color-surface, #ffffff) 34%, rgba(255, 255, 255, 0.7));
  border-color: rgba(255, 255, 255, 0.75);
  color: var(--color-primary, #3b82f6);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 2px 10px rgba(0, 0, 0, 0.12);
}
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .menu-item:hover {
  background: color-mix(in srgb, var(--color-surface, #ffffff) 44%, rgba(255, 255, 255, 0.34));
  border-color: rgba(255, 255, 255, 0.26);
  color: var(--color-text, #e6ecf5);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    0 2px 10px rgba(0, 0, 0, 0.3);
}

/* ---- 4. 二级页面（四个小工具内部）---- */
/* 工具页里的色块原本是不透明底色（--color-bg / --color-surface），会把面板的
   背景图整个盖住。这里统一换成「透亮玻璃块」：半透明的主题表面色 + 一层白霜 +
   柔和亮边，让面板那层模糊背景图透出来（同菜单项的配方）。
   注：面板背景本身已整体模糊过，这里的 backdrop-filter 只是补齐毛玻璃质感；
   这些元素内部都没有 position:fixed 的后代，不会破坏注释工具的全屏层。 */
:root {
  --tool-glass-white: rgba(255, 255, 255, 0.36);
  --tool-glass-hover: rgba(255, 255, 255, 0.42);
}
:root[data-mode="night"] {
  --tool-glass-white: rgba(255, 255, 255, 0.1);
  --tool-glass-hover: rgba(255, 255, 255, 0.16);
}
:root:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .tool-panel :is(.timer-tabs, .result-card, .file-path, .btn-secondary, .note-toolbar, .tb-sub-float, .screenshot) {
  background-color: color-mix(in srgb, var(--color-surface, #ffffff) 42%, transparent);
  background-image: linear-gradient(var(--tool-glass-white, rgba(255, 255, 255, 0.36)), var(--tool-glass-white, rgba(255, 255, 255, 0.36)));
  backdrop-filter: blur(16px) saturate(1.15);
  border-color: rgba(255, 255, 255, 0.5);
}
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .tool-panel :is(.timer-tabs, .result-card, .file-path, .btn-secondary, .note-toolbar, .tb-sub-float, .screenshot) {
  border-color: var(--color-border, rgba(255, 255, 255, 0.12));
}
/* 一键截屏 / 注释加载保存页的内层玻璃块是整块铺满的方形，自身没有圆角，
   与面板的圆角不匹配（看着像直角块被裁在里面）。这里补上圆角。 */
:root:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .tool-panel .screenshot {
  border-radius: 12px;
}
/* 悬停：改为半透明白，替代原来的不透明底色 */
:root:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .tool-panel :is(.arrow, .tb-btn, .tb-btn-sub):hover {
  background: var(--tool-glass-hover, rgba(255, 255, 255, 0.42));
}
/* 选中态：提亮一档的亮玻璃，替代原来的纯主色填充 */
:root:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .tool-panel :is(.tab, .tb-btn, .tb-btn-sub).active {
  background-color: color-mix(in srgb, var(--color-surface, #ffffff) 26%, transparent);
  background-image: linear-gradient(var(--tool-glass-hover, rgba(255, 255, 255, 0.42)), var(--tool-glass-hover, rgba(255, 255, 255, 0.42)));
  border-color: rgba(255, 255, 255, 0.75);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
}
/* 选中态的图标/文字：亮玻璃底上白色看不见，改用主色 */
:root:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .tool-panel .tab.active {
  color: var(--color-primary, #3b82f6);
}
:root:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .tool-panel .tb-btn.active :is(.tb-icon, .tb-label),
:root:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .tool-panel .tb-btn-sub.active :is(.tb-icon-sm, .tb-label) {
  color: var(--color-primary, #3b82f6);
}
</style>
