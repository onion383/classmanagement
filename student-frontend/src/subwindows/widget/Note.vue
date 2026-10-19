<template>
  <div class="note-root">
    <!-- ====== 加载界面 ====== -->
    <div v-if="noteState === 'loading'" class="screenshot">
      <div class="header">
        <IconGlyph name="note" :size="16" />
        <span>屏幕注释</span>
      </div>
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
      <div class="header">
        <IconGlyph name="note" :size="16" />
        <span>屏幕注释</span>
      </div>
      <div class="content">
        <div class="result-area">
          <div class="icon-wrapper">
            <div v-if="noteState === 'saving'" class="spinner"></div>
            <svg v-else-if="noteState === 'saved'" class="status-icon flat-check" viewBox="0 0 24 24" width="36" height="36">
              <path fill="none" stroke="var(--color-primary, #22c55e)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M4 12.5l5 5L20 6.5" />
            </svg>
            <IconGlyph v-else name="error" :size="36" class="status-icon" />
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
        <canvas ref="hlCanvas" class="hl-canvas"></canvas>
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
              <IconGlyph name="brush" :size="16" class="tb-icon" />
              <span class="tb-label">画笔</span>
            </button>
            <button
              class="tb-btn"
              :class="{ active: isEraser }"
              @click.stop="toggleSub('eraser')"
            >
              <IconGlyph name="eraser" :size="16" class="tb-icon" />
              <span class="tb-label">橡皮擦</span>
            </button>
            <button class="tb-btn" @click="startSave">
              <IconGlyph name="save" :size="16" class="tb-icon" />
              <span class="tb-label">保存</span>
            </button>
            <button class="tb-btn" @click="close">
              <IconGlyph name="close" :size="16" class="tb-icon" />
              <span class="tb-label">关闭</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 浮动二级菜单（悬浮在工具栏上方，从工具栏一侧浮现/收回） -->
      <Transition name="tb-sub-pop">
      <div
        v-if="subTool"
        :key="subTool"
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
              <IconGlyph :name="t.id" :size="14" class="tb-icon-sm" />
              <span class="tb-label">{{ t.name }}</span>
            </button>
          </div>
          <div class="tb-sub-row">
            <span class="tb-sub-label">粗细</span>
            <input type="range" min="1" max="30" v-model.number="brushSize" class="tb-slider" />
            <span class="tb-size">{{ brushSize }}</span>
          </div>
          <div class="tb-sub-row">
            <ColorSwatch v-model="brushColor" :presetColors="['#ef4444', '#000000', '#3b82f6']" />
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
      </Transition>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import ColorSwatch from '../../components/base/ColorSwatch.vue'
import IconGlyph from '../../components/base/IconGlyph.vue'
import axios from 'axios'
import { calcW, drawCurveSegment } from './Note.curve.js'
import { INVOKE } from '../../electronChannels.js'

const emit = defineEmits(['close', 'ready', 'shrink'])
const canvasArea = ref(null)
const bgCanvas = ref(null)
const hlCanvas = ref(null)
const drawCanvas = ref(null)
const toolbarRef = ref(null)
const subRef = ref(null)
const toolbarPos = reactive({ x: 20, y: Math.max(0, window.innerHeight - 60 - 20) })

const noteState = ref('loading')
const saveFilePath = ref('')
const saveError = ref('')
let autoCloseTimer = null

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
const brushSize = ref(3)
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

// id 同时作为 IconGlyph 的图标 key（见 IconGlyph.vue 的 MAP）
const brushTools = [
  { id: 'ballpoint', name: '圆珠笔' },
  { id: 'pen', name: '钢笔' },
  { id: 'highlighter', name: '荧光笔' },
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
let pointBuffer = [] // Catmull-Rom 点缓冲 [{x, y, w, time}]
let widthSmooth = [] // 宽度平滑缓冲，减少钢笔笔锋抖动
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
  const b = brushSize.value
  switch (currentTool.value) {
    case 'ballpoint': return { w: b, minW: b, maxW: b, color: brushColor.value, alpha: 1 }
    case 'pen': return { w: b, minW: Math.max(1, b / 4), maxW: b, color: brushColor.value, alpha: 1 }
    case 'highlighter': return { w: b, minW: b, maxW: b, color: brushColor.value, alpha: 1 }
    case 'eraser': return { w: s, minW: s, maxW: s, color: '#000', alpha: 1, isEraser: true }
    default: return { w: 3, minW: 3, maxW: 3, color: '#000', alpha: 1 }
  }
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
  const cfg = toolCfg()
  const width = cfg.w
  // 初始化点缓冲和宽度平滑
  const now = Date.now()
  pointBuffer = [
    { x: p.x, y: p.y, w: width, time: now },
    { x: p.x, y: p.y, w: width, time: now }
  ]
  widthSmooth = [width]
  const isHL = currentTool.value === 'highlighter'
  const ctx = (isHL ? hlCanvas.value : drawCanvas.value).getContext('2d')

  if (cfg.isEraser) {
    ;[drawCanvas.value, hlCanvas.value].forEach(c => {
      const ec = c.getContext('2d')
      ec.globalCompositeOperation = 'destination-out'
      ec.beginPath()
      ec.arc(p.x, p.y, width / 2, 0, Math.PI * 2)
      ec.fill()
      ec.globalCompositeOperation = 'source-over'
    })
  } else {
    ctx.beginPath()
    ctx.fillStyle = cfg.color
    ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2)
    ctx.fill()
  }
}

function onMouseMove(e) {
  if (!isDrawing || !bgImage) return
  const p = pos(e)
  const now = Date.now()
  const lastPt = pointBuffer[pointBuffer.length - 1]
  const dt = Math.max(now - lastPt.time, 1)
  // canvas 内部分辨率 = 截图原始分辨率，高分辨率下坐标被放大，
  // 若直接用画布像素算速度，测得的速度会被放大数十倍，钢笔笔锋会立刻衰减到最细，
  // 高 DPI 下画成亚像素细线（观感上像断线）。这里统一换算回 CSS 像素再算速度。
  const drawRect = drawCanvas.value.getBoundingClientRect()
  const canvasScale = drawRect.width > 0 ? canvasW / drawRect.width : 1
  const dist = Math.hypot(p.x - lastPt.x, p.y - lastPt.y) / canvasScale
  const speed = dist / dt
  const cfg = toolCfg()
  let width = calcW(speed, cfg)

  // 宽度平滑：移动平均，减少速度突变导致的笔锋抖动
  widthSmooth.push(width)
  if (widthSmooth.length > 4) widthSmooth.shift()
  width = widthSmooth.reduce((a, b) => a + b, 0) / widthSmooth.length
  const isHL = currentTool.value === 'highlighter'
  const ctx = (isHL ? hlCanvas.value : drawCanvas.value).getContext('2d')
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'

  // 追加采样点到缓冲
  pointBuffer.push({ x: p.x, y: p.y, w: width, time: now })

  // 缓冲满 4 个点时，用 Catmull-Rom 绘制倒数第 3→倒数第 2 点之间的平滑曲线
  if (pointBuffer.length >= 4) {
    const n = pointBuffer.length
    const p0 = pointBuffer[n - 4], p1 = pointBuffer[n - 3]
    const p2 = pointBuffer[n - 2], p3 = pointBuffer[n - 1]

    if (cfg.isEraser) {
      ;[drawCanvas.value, hlCanvas.value].forEach(c => {
        const ec = c.getContext('2d')
        ec.globalCompositeOperation = 'destination-out'
        ec.strokeStyle = 'rgba(0,0,0,1)'
        ec.lineCap = 'round'; ec.lineJoin = 'round'
        drawCurveSegment(ec, p0, p1, p2, p3)
        ec.globalCompositeOperation = 'source-over'
      })
    } else {
      ctx.strokeStyle = cfg.color
      ctx.globalAlpha = cfg.alpha
      drawCurveSegment(ctx, p0, p1, p2, p3)
      ctx.globalAlpha = 1
    }
  }
}

function onMouseUp() {
  if (!isDrawing) return
  const n = pointBuffer.length
  if (n < 3) { isDrawing = false; return }

  const cfg = toolCfg()
  const isHL = currentTool.value === 'highlighter'
  const ctx = (isHL ? hlCanvas.value : drawCanvas.value).getContext('2d')
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'

  // 用最后 3 个点绘制末尾曲线段，P3 镜像 P2 作为终点
  const p0 = pointBuffer[n - 3], p1 = pointBuffer[n - 2], p2 = pointBuffer[n - 1]

  if (cfg.isEraser) {
    ;[drawCanvas.value, hlCanvas.value].forEach(c => {
      const ec = c.getContext('2d')
      ec.globalCompositeOperation = 'destination-out'
      ec.strokeStyle = 'rgba(0,0,0,1)'
      ec.lineCap = 'round'; ec.lineJoin = 'round'
      drawCurveSegment(ec, p0, p1, p2, p2)
      ec.globalCompositeOperation = 'source-over'
    })
  } else {
    ctx.strokeStyle = cfg.color
    ctx.globalAlpha = cfg.alpha
    drawCurveSegment(ctx, p0, p1, p2, p2)
    ctx.globalAlpha = 1
  }

  isDrawing = false
  pointBuffer = []
}

// 点击画布区域关闭二级菜单
function onCanvasMouseDown(e) {
  if (toolbarRef.value && toolbarRef.value.contains(e.target)) return
  if (subRef.value && subRef.value.contains(e.target)) return
  subTool.value = null
}

// 保存流程
async function startSave() {
  if (!bgImage) return
  // 先提取画布数据（此时编辑模板还在，canvas 引用有效）
  const tc = document.createElement('canvas')
  tc.width = canvasW; tc.height = canvasH
  const tctx = tc.getContext('2d')
  tctx.drawImage(bgImage, 0, 0, canvasW, canvasH)
  tctx.drawImage(hlCanvas.value, 0, 0)
  tctx.drawImage(drawCanvas.value, 0, 0)

  // 切换到保存界面（白色），再收缩窗口，避免黑色 canvas 闪现
  noteState.value = 'saving'
  emit('shrink')
  await new Promise(r => setTimeout(r, 200))

  try {
    const blob = await new Promise(r => tc.toBlob(r, 'image/png'))
    if (!blob) {
      saveError.value = '保存失败：画布未初始化'
      noteState.value = 'saveError'
      return
    }
    const buf = await blob.arrayBuffer()
    const arr = new Uint8Array(buf)

    // 获取自定义保存路径
    let saveDir = ''
    try {
      const settingsRes = await axios.get('/api/widget-settings')
      if (settingsRes.data.success) {
        saveDir = settingsRes.data.data.noteSavePath
      }
    } catch (_) { /* 读取设置失败则使用默认路径 */ }

    // 直接传 Uint8Array：IPC 走结构化克隆的二进制路径（内存紧凑），
    // 避免 Array.from 将每个字节装箱成 Number（全屏 PNG 会膨胀 8~16 倍）。
    const res = await window.electron.invoke(INVOKE.NOTE_SAVE, arr, { saveDir })
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
  const res = await window.electron.invoke(INVOKE.SCREENSHOT_CAPTURE)
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

  ;[bgCanvas.value, hlCanvas.value, drawCanvas.value].forEach(c => {
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
/* 作为 .tool-panel（纵向 flex）的弹性子项：加载/保存卡片（.screenshot）因此被限制在
   面板内，与其它小工具一致——能透出面板的背景图/模糊与白色薄纱，圆角随面板一起裁切。
   编辑态的画布与工具栏都是 position:fixed 的独立层（相对视口），不依赖这里的定位。 */
.note-root {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/* ====== 和截屏一模一样的加载 / 保存界面 ====== */
.screenshot {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 与截屏窗口保持一致：标题贴顶、按钮贴底，各与毛玻璃上下边界留出固定内边距 */
  justify-content: space-between;
  /* 撑满面板剩余高度（父级 .tool-panel 已是纵向 flex），避免 height:100% 把拖动条算进去 */
  flex: 1 1 auto;
  min-height: 0;
  padding: 16px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--color-surface, #ffffff);
}

.header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
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
.hl-canvas,
.draw-canvas {
  position: absolute;
}

.hl-canvas {
  z-index: 2;
  opacity: 0.35;
  pointer-events: none;
}

.draw-canvas {
  z-index: 3;
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
  /* 浮现/收回以贴着工具栏的下边为锚点，从工具栏一侧长出来 */
  transform-origin: bottom left;
}

/* 二级菜单浮现 / 收回：直接复用工具箱面板的弹出动画（同曲线、同缩放 0.86），
   只是锚点放在下边，让菜单从工具栏一侧向上长出来 */
.tb-sub-pop-enter-active {
  transition:
    transform 0.1s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.1s ease;
}
.tb-sub-pop-leave-active {
  transition:
    transform 0.1s cubic-bezier(0.4, 0, 1, 1),
    opacity 0.1s ease;
}
.tb-sub-pop-enter-from,
.tb-sub-pop-leave-to {
  transform: scale(0.86);
  opacity: 0;
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
</style>
