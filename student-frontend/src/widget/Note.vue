<template>
  <div class="note-container">
    <!-- 画布区域 -->
    <div class="canvas-area" ref="canvasArea">
      <canvas ref="bgCanvas" class="bg-canvas"></canvas>
      <canvas
        ref="drawCanvas"
        class="draw-canvas"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
      ></canvas>
      <div v-if="loading" class="loading-overlay">
        <div class="spinner"></div>
        <div class="loading-text">正在截屏...</div>
      </div>
    </div>

    <!-- 浮动工具栏 -->
    <div
      class="toolbar"
      ref="toolbarRef"
      :style="{ left: toolbarPos.x + 'px', top: toolbarPos.y + 'px' }"
    >
      <div class="toolbar-drag-bar" @mousedown="onToolbarDragStart">
        <div class="drag-indicator"></div>
      </div>
      <div class="toolbar-body">
        <!-- 画笔工具 -->
        <div class="tool-group">
          <button
            v-for="tool in brushTools"
            :key="tool.id"
            class="tool-btn"
            :class="{ active: currentTool === tool.id }"
            @click="selectTool(tool.id)"
            :title="tool.name"
          >
            <span class="tool-icon">{{ tool.icon }}</span>
            <span class="tool-label">{{ tool.name }}</span>
          </button>
        </div>

        <div class="tool-divider"></div>

        <!-- 橡皮擦 -->
        <div class="tool-group">
          <button
            class="tool-btn"
            :class="{ active: currentTool === 'eraser' }"
            @click="selectTool('eraser')"
            title="橡皮擦"
          >
            <span class="tool-icon">🧹</span>
            <span class="tool-label">橡皮擦</span>
          </button>
          <input
            v-if="currentTool === 'eraser'"
            type="range"
            min="5"
            max="40"
            v-model.number="eraserSize"
            class="size-slider"
            title="橡皮擦大小"
          />
        </div>

        <div class="tool-divider"></div>

        <!-- 颜色选择（画笔工具时显示） -->
        <div v-if="currentTool !== 'eraser'" class="tool-group">
          <ColorSwatch v-model="brushColor" :presetColors="['#ef4444', '#000000', '#3b82f6']" />
        </div>

        <div class="tool-divider"></div>

        <!-- 保存 & 关闭 -->
        <div class="tool-group">
          <button class="tool-btn" @click="save" title="保存">
            <span class="tool-icon">💾</span>
            <span class="tool-label">保存</span>
          </button>
          <button class="tool-btn" @click="close" title="关闭">
            <span class="tool-icon">✕</span>
            <span class="tool-label">关闭</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue'
import ColorSwatch from '../components/ColorSwatch.vue'

const emit = defineEmits(['close'])

// 画布
const canvasArea = ref(null)
const bgCanvas = ref(null)
const drawCanvas = ref(null)
const loading = ref(true)

// 工具栏
const toolbarRef = ref(null)
const toolbarPos = reactive({ x: 0, y: 0 })

// 工具状态
const currentTool = ref('ballpoint') // 'ballpoint' | 'pen' | 'highlighter' | 'eraser'
const brushColor = ref('#ef4444')
const eraserSize = ref(20)

// 画笔工具定义
const brushTools = [
  { id: 'ballpoint', name: '圆珠笔', icon: '🖊️' },
  { id: 'pen', name: '钢笔', icon: '✒️' },
  { id: 'highlighter', name: '荧光笔', icon: '🖍️' },
]

// 绘制状态
let isDrawing = false
let lastX = 0
let lastY = 0
let lastTime = 0
let lastWidth = 0
let bgImage = null
let canvasW = 0
let canvasH = 0
let hasDrawn = false

// 工具栏拖拽
let toolbarDragging = false
let toolbarDragStart = { x: 0, y: 0 }
let toolbarPosStart = { x: 0, y: 0 }

function selectTool(id) {
  currentTool.value = id
}

// 工具配置
function getToolConfig() {
  switch (currentTool.value) {
    case 'ballpoint':
      return { baseWidth: 3, minWidth: 3, maxWidth: 3, color: brushColor.value, globalAlpha: 1 }
    case 'pen':
      return { baseWidth: 4, minWidth: 1, maxWidth: 8, color: brushColor.value, globalAlpha: 1 }
    case 'highlighter':
      return { baseWidth: 16, minWidth: 16, maxWidth: 16, color: brushColor.value, globalAlpha: 0.35 }
    case 'eraser':
      return { baseWidth: eraserSize.value, minWidth: eraserSize.value, maxWidth: eraserSize.value, color: brushColor.value, globalAlpha: 1, isEraser: true }
    default:
      return { baseWidth: 3, minWidth: 3, maxWidth: 3, color: '#000000', globalAlpha: 1 }
  }
}

// 计算画笔宽度（基于移动速度）
function calcWidth(speed, config) {
  if (config.minWidth === config.maxWidth) return config.baseWidth
  const maxSpeed = 5
  const t = Math.min(speed / maxSpeed, 1)
  return config.maxWidth - (config.maxWidth - config.minWidth) * t
}

// 绘制事件
function getCanvasPos(e) {
  const rect = drawCanvas.value.getBoundingClientRect()
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  }
}

function onMouseDown(e) {
  if (loading.value) return
  const pos = getCanvasPos(e)
  isDrawing = true
  lastX = pos.x
  lastY = pos.y
  lastTime = Date.now()
  lastWidth = getToolConfig().baseWidth

  const ctx = drawCanvas.value.getContext('2d')
  ctx.beginPath()
  ctx.fillStyle = getToolConfig().color
  ctx.arc(pos.x, pos.y, lastWidth / 2, 0, Math.PI * 2)
  ctx.fill()
  hasDrawn = true
}

function onMouseMove(e) {
  if (!isDrawing || loading.value) return
  const pos = getCanvasPos(e)
  const now = Date.now()
  const dt = Math.max(now - lastTime, 1)
  const dx = pos.x - lastX
  const dy = pos.y - lastY
  const dist = Math.sqrt(dx * dx + dy * dy)
  const speed = dist / dt // px/ms

  const config = getToolConfig()
  const width = calcWidth(speed, config)

  const ctx = drawCanvas.value.getContext('2d')
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (config.isEraser) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = 'rgba(0,0,0,1)'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = config.color
    ctx.globalAlpha = config.globalAlpha
  }

  // 绘制平滑的贝塞尔曲线
  const midX = (lastX + pos.x) / 2
  const midY = (lastY + pos.y) / 2
  const avgWidth = (lastWidth + width) / 2

  ctx.lineWidth = avgWidth
  ctx.beginPath()
  ctx.moveTo(lastX, lastY)
  ctx.quadraticCurveTo(lastX, lastY, midX, midY)
  ctx.stroke()

  // 钢笔笔锋：绘制渐变宽度的线段
  if (currentTool.value === 'pen') {
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(midX, midY)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
  }

  // 重置
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  lastX = pos.x
  lastY = pos.y
  lastTime = now
  lastWidth = width
  hasDrawn = true
}

function onMouseUp() {
  isDrawing = false
}

// 工具栏拖拽
function onToolbarDragStart(e) {
  if (e.target.tagName === 'INPUT') return
  e.preventDefault()
  toolbarDragging = true
  toolbarDragStart = { x: e.clientX, y: e.clientY }
  toolbarPosStart = { x: toolbarPos.x, y: toolbarPos.y }

  const onMove = (e) => {
    if (!toolbarDragging) return
    const dx = e.clientX - toolbarDragStart.x
    const dy = e.clientY - toolbarDragStart.y
    toolbarPos.x = toolbarPosStart.x + dx
    toolbarPos.y = toolbarPosStart.y + dy
  }

  const onUp = () => {
    toolbarDragging = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// 保存
async function save() {
  if (!bgImage) return

  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = canvasW
  tempCanvas.height = canvasH
  const tctx = tempCanvas.getContext('2d')

  // 先画背景截图
  tctx.drawImage(bgImage, 0, 0, canvasW, canvasH)
  // 再画标注层
  tctx.drawImage(drawCanvas.value, 0, 0)

  const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'))
  const arrayBuffer = await blob.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  const result = await window.electron.invoke('note-save', Array.from(uint8Array))
  if (result.success) {
    emit('close')
  }
}

function close() {
  emit('close')
}

// 加载截图
async function loadScreenshot() {
  try {
    const res = await window.electron.invoke('screenshot-capture')
    if (!res.success) {
      loading.value = false
      return
    }

    const img = new Image()
    img.onload = async () => {
      bgImage = img
      await nextTick()
      resizeCanvas()
      loading.value = false
      // 初始化工具栏位置到右下角
      await nextTick()
      positionToolbar()
    }
    img.src = 'file://' + res.filePath
  } catch {
    loading.value = false
  }
}

function resizeCanvas() {
  if (!canvasArea.value || !bgImage) return
  const area = canvasArea.value
  const areaW = area.clientWidth
  const areaH = area.clientHeight
  const imgW = bgImage.naturalWidth
  const imgH = bgImage.naturalHeight

  // 按比例缩放以适应画布区域
  const scale = Math.min(areaW / imgW, areaH / imgH)
  canvasW = Math.floor(imgW * scale)
  canvasH = Math.floor(imgH * scale)

  ;[bgCanvas.value, drawCanvas.value].forEach(c => {
    c.width = canvasW
    c.height = canvasH
    c.style.width = canvasW + 'px'
    c.style.height = canvasH + 'px'
  })

  const bgCtx = bgCanvas.value.getContext('2d')
  bgCtx.drawImage(bgImage, 0, 0, canvasW, canvasH)
}

function positionToolbar() {
  if (!canvasArea.value || !toolbarRef.value) return
  const areaRect = canvasArea.value.getBoundingClientRect()
  const tbW = toolbarRef.value.offsetWidth
  const tbH = toolbarRef.value.offsetHeight
  toolbarPos.x = areaRect.width - tbW - 12
  toolbarPos.y = areaRect.height - tbH - 12
}

// 窗口大小变化时更新画布
let resizeObserver = null

onMounted(async () => {
  await loadScreenshot()
  if (canvasArea.value) {
    resizeObserver = new ResizeObserver(() => {
      if (bgImage) resizeCanvas()
    })
    resizeObserver.observe(canvasArea.value)
  }
})

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect()
})
</script>

<style scoped>
.note-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: var(--color-bg, #f9fafb);
  border-radius: 12px;
}

.canvas-area {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.bg-canvas,
.draw-canvas {
  position: absolute;
  border-radius: 4px;
}

.draw-canvas {
  cursor: crosshair;
  z-index: 2;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--color-bg, #f9fafb);
  z-index: 10;
  border-radius: 12px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border, #e5e7eb);
  border-top-color: var(--color-primary, #22c55e);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 13px;
  color: var(--color-text-secondary, #6b7280);
}

/* 工具栏 */
.toolbar {
  position: absolute;
  z-index: 20;
  background: var(--color-surface, #ffffff);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  border: 1px solid var(--color-border, #e5e7eb);
  min-width: 280px;
  user-select: none;
}

.toolbar-drag-bar {
  width: 100%;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  padding-top: 4px;
}

.toolbar-drag-bar:active {
  cursor: grabbing;
}

.toolbar-drag-bar .drag-indicator {
  width: 28px;
  height: 3px;
  border-radius: 2px;
  background: var(--color-text-muted, #d1d5db);
}

.toolbar-body {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 10px;
  flex-wrap: wrap;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  min-width: 44px;
}

.tool-btn:hover {
  background: var(--color-bg, #f9fafb);
}

.tool-btn.active {
  background: var(--color-primary, #22c55e);
  border-color: var(--color-primary, #22c55e);
}

.tool-btn.active .tool-icon,
.tool-btn.active .tool-label {
  color: #fff;
}

.tool-icon {
  font-size: 16px;
  line-height: 1;
}

.tool-label {
  font-size: 10px;
  color: var(--color-text-secondary, #6b7280);
  white-space: nowrap;
}

.tool-divider {
  width: 1px;
  height: 28px;
  background: var(--color-border, #e5e7eb);
  margin: 0 4px;
  flex-shrink: 0;
}

.size-slider {
  width: 60px;
  height: 4px;
  accent-color: var(--color-primary, #22c55e);
  cursor: pointer;
}
</style>