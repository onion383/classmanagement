<template>
  <div class="widget-wrapper" :class="{ 'with-menu': state === 'menu' }">
    <!-- 图标始终显示（工具状态时隐藏） -->
    <div v-if="state !== 'tool'" class="fab" @mousedown="onFabMouseDown">
      🧰
    </div>

    <!-- 功能菜单 -->
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
import Timer from './Timer.vue'
import RollCall from './RollCall.vue'
import Screenshot from './Screenshot.vue'
import Note from './Note.vue'

const state = ref('icon') // 'icon' | 'menu' | 'tool'
const activeTool = ref('')
const toolReady = ref(false)
const noteFullscreen = ref(false)

const tools = [
  { id: 'timer', name: '计时器', icon: '⏱️' },
  { id: 'rollcall', name: '点名器', icon: '🎲' },
  { id: 'screenshot', name: '截图', icon: '📷' },
  { id: 'note', name: '注释', icon: '📝' },
]

function openTool(id) {
  activeTool.value = id
  state.value = 'tool'
  toolReady.value = false
  noteFullscreen.value = false
  setTimeout(() => {
    toolReady.value = true
  }, 150)
}

function onNoteReady() {
  noteFullscreen.value = true
  window.electron.send('widget-fullscreen')
}

function onNoteShrink() {
  noteFullscreen.value = false
  window.electron.send('widget-restore')
  window.electron.send('widget-center')
  window.electron.send('widget-resize', [240, 220])
}

function closeToIcon() {
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
      state.value = state.value === 'menu' ? 'icon' : 'menu'
    }
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 点击菜单外部区域自动收起菜单
function onDocMouseDown(e) {
  if (state.value !== 'menu') return
  const menuPanel = document.querySelector('.menu-panel')
  const fab = document.querySelector('.fab')
  if (!menuPanel || !fab) return
  if (menuPanel.contains(e.target) || fab.contains(e.target)) return
  state.value = 'icon'
}

let blurHandler = null

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
  blurHandler = window.electron.on('from-main', (data) => {
    if (data && data.type === 'blur' && state.value === 'menu') {
      state.value = 'icon'
    }
  })
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  if (blurHandler) {
    window.electron.off('from-main', blurHandler)
  }
})

// 状态变化时自动调整窗口大小和位置
watch(
  [state, activeTool],
  ([newState, newTool], [oldState, oldTool]) => {
    let size
    if (newState === 'icon') {
      size = [48, 48]
      if (oldState === 'tool') {
        // 如果之前是全屏注释工具，先恢复窗口大小
        if (oldTool === 'note') {
          window.electron.send('widget-restore')
        }
        window.electron.send('widget-restore-position')
      }
    } else if (newState === 'menu') {
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
  background: transparent;
  overflow: hidden;
  min-width: 0;
}

.widget-wrapper.with-menu {
  gap: 8px;
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
  transition: transform 0.2s ease;
  user-select: none;
  flex-shrink: 0;
}

.fab:hover {
  transform: scale(1.05);
}

.panel {
  background: var(--color-surface, #ffffff);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  border: 1px solid var(--color-border, #e5e7eb);
}

.menu-panel {
  width: 228px;
  box-sizing: border-box;
  overflow: hidden;
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
  transition: opacity 0.15s ease;
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
