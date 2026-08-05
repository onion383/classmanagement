<template>
  <div class="note-root">
    <!-- ====== 加载界面 ====== -->
    <div v-if="noteState === 'loading'" class="screenshot">
      <div class="header">📝 屏幕注释</div>
      <div class="content">
        <div class="result-area">
          <div class="icon-wrapper">
            <div class="spinner"></div>
          </div>
          <div class="status-text">注释加载中...</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn-primary" @click="close">取消</button>
      </div>
    </div>

    <!-- ====== 保存中 / 已保存 ====== -->
    <div v-else-if="noteState === 'saving' || noteState === 'saved' || noteState === 'saveError'" class="screenshot">
      <div class="header">📝 屏幕注释</div>
      <div class="content">
        <div class="result-area">
          <div class="icon-wrapper">
            <div v-if="noteState === 'saving'" class="spinner"></div>
            <span v-else class="status-icon">{{ saveStatusIcon }}</span>
          </div>
          <div class="status-text">{{ saveStatusText }}</div>
          <div class="file-path" :title="saveFilePath">{{ saveDisplayPath }}</div>
        </div>
      </div>
      <div class="actions">
        <button
          class="btn-primary"
          :disabled="noteState === 'saving'"
          @click="confirmSave"
        >完成</button>
      </div>
    </div>

    <!-- ====== 编辑界面 ====== -->
    <template v-else>
      <div class="canvas-area" ref="canvasArea" @mousedown="onCanvasMouseDown">
        <canvas ref="bgCanvas" class="bg-canvas"></canvas>
        <canvas
          ref="drawCanvas"
          class="draw-canvas"
          :style="{ cursor: eraserCursor }"
          @mousedown="onMouseDown"
          @mousemove="onMouseMove"
          @mouseup="onMouseUp"
          @mouseleave="onMouseUp"
        ></canvas>
      </div>

      <!-- 浮动工具栏 -->
      <div
        class="note-toolbar"
        ref="toolbarRef"
        :style="{ left: toolbarPos.x + 'px', top: toolbarPos.y + 'px' }"
      >
        <div class="tb-drag-bar" @mousedown="onToolbarDragStart">
          <div class="tb-drag-dot"></div>
        </div>
        <div class="tb-body">
          <!-- 主按钮行 -->
          <div class="tb-group">
            <button
              class="tb-btn"
              :class="{ active: !isEraser }"
              @click.stop="toggleSub('brush')"
            >
              <span class="tb-icon">🖊️</span>
              <span class="tb-label">画笔</span>
            </button>
            <div class="tb-div"></div>
            <button
              class="tb-btn"
              :class="{ active: isEraser }"
              @click.stop="toggleSub('eraser')"
            >
              <span class="tb-icon">🧹</span>
              <span class="tb-label">橡皮擦</span>
            </button>
            <div class="tb-div"></div>
            <button class="tb-btn" @click="startSave">
              <span class="tb-icon">💾</span>
              <span class="tb-label">保存</span>
            </button>
            <div class="tb-div"></div>
            <button class="tb-btn" @click="close">
              <span class="tb-icon">✕</span>
              <span class="tb-label">关闭</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 浮动二级菜单（悬浮在工具栏上方） -->
      <div
        v-if="subTool"
        class="tb-sub-float"
        ref="subRef"
        :style="subStyle"
        @mousedown.stop
      >
        <!-- 画笔二级菜单 -->
        <template v-if="subTool === 'brush'">
          <div class="tb-sub-row">
            <button
              v-for="t in brushTools"
              :key="t.id"
              class="tb-btn-sub"
              :class="{ active: currentTool === t.id }"
              @click="currentTool = t.id"
            >
              <span class="tb-icon-sm">{{ t.icon }}</span>
              <span class="tb-label">{{ t.name }}</span>
            </button>
          </div>
          <div class="tb-sub-row">
            <ColorSwatch v-model="brushColor" :presetColors="['#ef4444', '#000000', '#3b82f6']" />
            <button class="tb-btn-confirm" @click="subTool = null">确定</button>
          </div>
        </template>

        <!-- 橡皮擦二级菜单 -->
        <template v-if="subTool === 'eraser'">
          <div class="tb-sub-row">
            <span class="tb-sub-label">大小</span>
            <input type="range" min="5" max="40" v-model.number="eraserSize" class="tb-slider" />
            <span class="tb-size">{{ eraserSize }}</span>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import ColorSwatch from '../components/ColorSwatch.vue'

const emit = defineEmits(['close', 'ready', 'shrink'])
const canvasArea = ref(null)
const bgCanvas = ref(null)
const drawCanvas = ref(null)
const toolbarRef = ref(null)
const subRef = ref(null)
const toolbarPos = reactive({ x: 20, y: Math.max(0, window.innerHeight - 60 - 20) })

const noteState = ref('loading')
const saveFilePath = ref('')
const saveError = ref('')
let autoCloseTimer = null

const saveStatusIcon = computed(() => {
  if (noteState.value === 'saveError') return '❌'
  return '✅'
})

const saveStatusText = computed(() => {
  if (noteState.value === 'saving') return '正在保存...'
  if (noteState.value === 'saveError') return saveError.value || '保存失败'
  return '注释已保存'
})

const saveDisplayPath = computed(() => {
  if (saveFilePath.value) {
    const parts = saveFilePath.value.split(/[\\/]/)
    if (parts.length <= 3) return saveFilePath.value
    return '...' + parts.slice(-2).join('/')
  }
  return '保存至：图片/screenshots/'
})

const currentTool = ref('ballpoint')
const brushColor = ref('#ef4444')
const eraserSize = ref(20)
const subTool = ref(null) // null | 'brush' | 'eraser'

const isEraser = computed(() => currentTool.value === 'eraser')

// 橡皮擦光标：灰色半透明圆形
const eraserCursor = computed(() => {
  if (!isEraser.value) return 'crosshair'
  const s = Math.max(eraserSize.value, 12)
  const r = s / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${r}" cy="${r}" r="${r - 1}" fill="rgba(128,128,128,0.2)" stroke="rgba(128,128,128,0.4)" stroke-width="1"/></svg>`
  return `url(data:image/svg+xml;base64,${btoa(svg)}) ${r} ${r}, auto`
})

const brushTools = [
  { id: 'ballpoint', name: '圆珠笔', icon: '🖊️' },
  { id: 'pen', name: '钢笔', icon: '✒️' },
  { id: 'highlighter', name: '荧光笔', icon: '🖍️' },
]

// 二级菜单悬浮样式：位于工具栏上方，用 bottom 定位避免遮挡
const subStyle = computed(() => {
  if (!toolbarRef.value) return { display: 'none' }
  const tbW = toolbarRef.value.offsetWidth
  const gap = 8
  return {
    left: toolbarPos.x + 'px',
    bottom: (window.innerHeight - toolbarPos.y + gap) + 'px',
    minWidth: tbW + 'px',
  }
})

function toggleSub(tool) {
  if (tool === 'eraser') {
    currentTool.value = 'eraser'
  } else if (currentTool.value === 'eraser') {
    currentTool.value = 'ballpoint'
  }
  subTool.value = subTool.value === tool ? null : tool
}

let isDrawing = false
let lastX = 0, lastY = 0, lastTime = 0, lastWidth = 0
let bgImage = null
let canvasW = 0, canvasH = 0

// 工具栏拖拽
let tbDragging = false, tbStart = { x: 0, y: 0 }, tbPosStart = { x: 0, y: 0 }
let toolbarPlaced = false

function onToolbarDragStart(e) {
  if (e.target.tagName === 'INPUT') return
  e.preventDefault()
  tbDragging = true
  tbStart = { x: e.clientX, y: e.clientY }
  tbPosStart = { x: toolbarPos.x, y: toolbarPos.y }
  const onMove = (ev) => {
    if (!tbDragging || !toolbarRef.value) return
    const w = toolbarRef.value.offsetWidth
    const h = toolbarRef.value.offsetHeight
    let nx = tbPosStart.x + ev.clientX - tbStart.x
    let ny = tbPosStart.y + ev.clientY - tbStart.y
    nx = Math.max(0, Math.min(nx, window.innerWidth - w))
    ny = Math.max(0, Math.min(ny, window.innerHeight - h))
    toolbarPos.x = nx
    toolbarPos.y = ny
  }
  const onUp = () => {
    tbDragging = false
    toolbarPlaced = true
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// 绘制
function toolCfg() {
  const s = eraserSize.value
  switch (currentTool.value) {
    case 'ballpoint': return { w: 3, minW: 3, maxW: 3, color: brushColor.value, alpha: 1 }
    case 'pen': return { w: 4, minW: 1, maxW: 8, color: brushColor.value, alpha: 1 }
    case 'highlighter': return { w: 16, minW: 16, maxW: 16, color: brushColor.value, alpha: 0.35 }
    case 'eraser': return { w: s, minW: s, maxW: s, color: '#000', alpha: 1, isEraser: true }
    default: return { w: 3, minW: 3, maxW: 3, color: '#000', alpha: 1 }
  }
}

function calcW(speed, cfg) {
  if (cfg.minW === cfg.maxW) return cfg.w
  return cfg.maxW - (cfg.maxW - cfg.minW) * Math.min(speed / 5, 1)
}

function pos(e) {
  const r = drawCanvas.value.getBoundingClientRect()
  const cssX = e.clientX - r.left
  const cssY = e.clientY - r.top
  // CSS 显示尺寸和 canvas 内部分辨率可能不同，需要缩放坐标
  return {
    x: cssX * (canvasW / r.width),
    y: cssY * (canvasH / r.height)
  }
}

function onMouseDown(e) {
  if (!bgImage) return
  const p = pos(e)
  isDrawing = true
  lastX = p.x; lastY = p.y; lastTime = Date.now()
  lastWidth = toolCfg().w
  const ctx = drawCanvas.value.getContext('2d')
  const cfg = toolCfg()
  if (cfg.isEraser) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(p.x, p.y, lastWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  } else {
    ctx.beginPath()
    ctx.globalAlpha = cfg.alpha
    ctx.fillStyle = cfg.color
    ctx.arc(p.x, p.y, lastWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

function onMouseMove(e) {
  if (!isDrawing || !bgImage) return
  const p = pos(e)
  const now = Date.now()
  const dt = Math.max(now - lastTime, 1)
  const dist = Math.hypot(p.x - lastX, p.y - lastY)
  const speed = dist / dt
  const cfg = toolCfg()
  const width = calcW(speed, cfg)
  const ctx = drawCanvas.value.getContext('2d')
  ctx.lineJoin = 'round'
  ctx.lineCap = currentTool.value === 'highlighter' ? 'butt' : 'round'

  if (cfg.isEraser) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = 'rgba(0,0,0,1)'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = cfg.color
    ctx.globalAlpha = cfg.alpha
  }

  const mx = (lastX + p.x) / 2, my = (lastY + p.y) / 2
  const aw = (lastWidth + width) / 2
  ctx.lineWidth = aw
  ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.quadraticCurveTo(lastX, lastY, mx, my); ctx.stroke()

  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
  lastX = mx; lastY = my; lastTime = now; lastWidth = width
}

function onMouseUp() { isDrawing = false }

// 点击画布区域关闭二级菜单
function onCanvasMouseDown(e) {
  if (toolbarRef.value && toolbarRef.value.contains(e.target)) return
  if (subRef.value && subRef.value.contains(e.target)) return
  subTool.value = null
}

// 保存流程
async function startSave() {
  if (!bgImage) return
  // 先收缩回小窗口，再显示保存界面
  emit('shrink')
  await new Promise(r => setTimeout(r, 200))
  noteState.value = 'saving'
  try {
    const tc = document.createElement('canvas')
    tc.width = canvasW; tc.height = canvasH
    const tctx = tc.getContext('2d')
    tctx.drawImage(bgImage, 0, 0, canvasW, canvasH)
    tctx.drawImage(drawCanvas.value, 0, 0)
    const blob = await new Promise(r => tc.toBlob(r, 'image/png'))
    if (!blob) {
      saveError.value = '保存失败：画布未初始化'
      noteState.value = 'saveError'
      return
    }
    const buf = await blob.arrayBuffer()
    const arr = new Uint8Array(buf)
    const res = await window.electron.invoke('note-save', Array.from(arr))
    if (res.success) {
      saveFilePath.value = res.filePath
      noteState.value = 'saved'
      autoCloseTimer = setTimeout(() => emit('close'), 3000)
    } else {
      saveError.value = '保存失败，请重试'
      noteState.value = 'saveError'
    }
  } catch (err) {
    saveError.value = err.message || '保存失败'
    noteState.value = 'saveError'
  }
}

function confirmSave() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
  emit('close')
}

function close() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
  emit('close')
}

// 加载截图
async function loadScreenshot() {
  await new Promise(resolve => setTimeout(resolve, 500))
  const res = await window.electron.invoke('screenshot-capture')
  if (!res.success || !res.dataUrl) {
    noteState.value = 'saveError'
    saveError.value = '截屏失败，请重试'
    return
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = async () => {
      bgImage = img
      emit('ready')
      // 先在小窗口渲染 canvas，ResizeObserver 会在全屏扩展后自动重绘
      noteState.value = 'editing'
      await nextTick()
      await new Promise(r => requestAnimationFrame(r))
      fitCanvas()
      await nextTick()
      placeToolbar()
      resolve()
    }
    img.onerror = () => {
      noteState.value = 'saveError'
      saveError.value = '图片加载失败'
      reject(new Error('Image load failed'))
    }
    img.src = res.dataUrl
  })
}

function fitCanvas() {
  if (!canvasArea.value || !bgImage) return
  const iw = bgImage.naturalWidth
  const ih = bgImage.naturalHeight
  const area = canvasArea.value
  const aw = area.clientWidth, ah = area.clientHeight

  // canvas 内部分辨率 = 截图原始分辨率（保证清晰度）
  canvasW = iw
  canvasH = ih

  // CSS 显示尺寸 = 等比缩放到适配窗口
  const scale = Math.min(aw / iw, ah / ih)
  const displayW = Math.floor(iw * scale)
  const displayH = Math.floor(ih * scale)
  const ox = Math.floor((aw - displayW) / 2)
  const oy = Math.floor((ah - displayH) / 2)

  ;[bgCanvas.value, drawCanvas.value].forEach(c => {
    if (!c) return
    c.width = canvasW
    c.height = canvasH
    c.style.width = displayW + 'px'
    c.style.height = displayH + 'px'
    c.style.left = ox + 'px'
    c.style.top = oy + 'px'
  })
  bgCanvas.value.getContext('2d').drawImage(bgImage, 0, 0, canvasW, canvasH)
}

function placeToolbar() {
  if (toolbarPlaced || !toolbarRef.value) return
  const w = toolbarRef.value.offsetWidth
  const h = toolbarRef.value.offsetHeight
  toolbarPos.x = 20
  toolbarPos.y = Math.max(0, window.innerHeight - h - 20)
  toolbarPlaced = true
}

let ro = null
onMounted(async () => {
  await loadScreenshot()
  if (canvasArea.value) {
    ro = new ResizeObserver(() => {
      if (bgImage) fitCanvas()
      placeToolbar()
    })
    ro.observe(canvasArea.value)
  }
})
onUnmounted(() => {
  if (ro) ro.disconnect()
  if (autoCloseTimer) clearTimeout(autoCloseTimer)
})
</script>

<style scoped>
.note-root {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  overflow: hidden;
  border-radius: 16px;
}

/* ====== 和截屏一模一样的加载 / 保存界面 ====== */
.screenshot {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  overflow: hidden;
  background: var(--color-surface, #ffffff);
}

.header {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text, #111827);
  margin-bottom: 10px;
}

.content {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
  width: 100%;
}

.result-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.icon-wrapper {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--color-border, #e5e7eb);
  border-top-color: var(--color-primary, #22c55e);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.status-icon {
  font-size: 36px;
  line-height: 44px;
}

.status-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text, #111827);
  height: 20px;
  line-height: 20px;
}

.file-path {
  font-size: 11px;
  color: var(--color-text-muted, #9ca3af);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--color-bg, #f9fafb);
  padding: 4px 8px;
  border-radius: 6px;
  height: 24px;
  line-height: 16px;
  box-sizing: border-box;
}

.actions {
  display: flex;
  justify-content: center;
}

.btn-primary {
  padding: 6px 20px;
  border-radius: 8px;
  border: none;
  background: var(--color-primary, #22c55e);
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:disabled {
  background: var(--color-text-muted, #9ca3af);
  cursor: not-allowed;
  opacity: 0.7;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

/* ====== 编辑界面 ====== */
.canvas-area {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  overflow: hidden;
  background: #000;
}

.bg-canvas,
.draw-canvas {
  position: absolute;
}

.draw-canvas {
  z-index: 2;
}

/* ====== 工具栏 ====== */
.note-toolbar {
  position: fixed;
  z-index: 100;
  background: var(--color-surface, #fff);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.35);
  border: 1px solid var(--color-border, #e5e7eb);
  user-select: none;
}

.tb-drag-bar {
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  padding-top: 4px;
}
.tb-drag-bar:active { cursor: grabbing; }
.tb-drag-dot {
  width: 28px; height: 3px;
  border-radius: 2px;
  background: var(--color-text-muted, #d1d5db);
}

.tb-body {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
}

.tb-group { display: flex; align-items: center; gap: 4px; }

.tb-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  min-width: 44px;
}
.tb-btn:hover { background: var(--color-bg, #f9fafb); }
.tb-btn.active { background: var(--color-primary, #22c55e); border-color: var(--color-primary, #22c55e); }
.tb-btn.active .tb-icon,
.tb-btn.active .tb-label { color: #fff; }

.tb-icon { font-size: 16px; line-height: 1; }
.tb-label { font-size: 10px; color: var(--color-text-secondary, #6b7280); white-space: nowrap; }

.tb-div {
  width: 1px; height: 28px;
  background: var(--color-border, #e5e7eb);
  margin: 0 4px; flex-shrink: 0;
}

/* ====== 浮动二级菜单 ====== */
.tb-sub-float {
  position: fixed;
  z-index: 101;
  background: var(--color-surface, #fff);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.35);
  border: 1px solid var(--color-border, #e5e7eb);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  user-select: none;
}

.tb-sub-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tb-btn-sub {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  min-width: 36px;
}
.tb-btn-sub:hover { background: var(--color-bg, #f9fafb); }
.tb-btn-sub.active { background: var(--color-primary, #22c55e); border-color: var(--color-primary, #22c55e); }
.tb-btn-sub.active .tb-icon-sm,
.tb-btn-sub.active .tb-label { color: #fff; }

.tb-icon-sm { font-size: 14px; line-height: 1; }

.tb-sub-label {
  font-size: 11px;
  color: var(--color-text-secondary, #6b7280);
  white-space: nowrap;
}

.tb-size {
  font-size: 11px;
  color: var(--color-text-secondary, #6b7280);
  min-width: 20px;
  text-align: center;
}

.tb-slider {
  width: 80px; height: 4px;
  accent-color: var(--color-primary, #22c55e);
  cursor: pointer;
}

.tb-btn-confirm {
  padding: 3px 10px;
  border-radius: 6px;
  border: none;
  background: var(--color-primary, #22c55e);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  margin-left: 4px;
}
.tb-btn-confirm:hover {
  opacity: 0.85;
}
</style>
