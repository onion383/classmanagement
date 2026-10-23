<template>
  <!-- 年份刻度尺：贴在照片网格右侧的细长滚动条。
       刻度按「内容高度占比」定位，所以照片越多的年份分到的刻度间距越大；
       拖动手柄时容器同步滚动，旁边浮出精确到日的日期提示，松手吸附到最近的那一天。 -->
  <div ref="trackRef" class="album-ruler select-none" @pointerdown="onTrackPointerDown">
    <!-- 轨道底色 -->
    <div class="album-ruler-track"></div>

    <!-- 年份刻度：短线 + 年份文字（间距够大才显示文字） -->
    <div
      v-for="m in yearMarks"
      :key="m.year"
      class="album-ruler-tick"
      :style="{ top: m.top + 'px', height: m.len + 'px' }"
    >
      <span v-if="m.showLabel" class="album-ruler-label">{{ m.year }}</span>
    </div>

    <!-- 手柄：高度与可视区占比一致，宽度固定细条 -->
    <div
      class="album-ruler-thumb"
      :class="{ 'album-ruler-thumb--active': dragging }"
      :style="{ top: thumbTop + 'px', height: thumbH + 'px' }"
      @pointerdown.stop="onThumbPointerDown"
    ></div>

    <!-- 拖动时的日期提示（精确到日） -->
    <Transition name="ruler-tip">
      <div v-if="dragging && tipText" class="album-ruler-tip" :style="{ top: thumbTop + thumbH / 2 + 'px' }">
        {{ tipText }}
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  // 时间轴分组的偏移表 [{ date, offset }]，与 usePhotoTimeline 的 layout 同源
  items: { type: Array, default: () => [] },
  // 内容总高度
  total: { type: Number, default: 0 },
  // 当前滚动位置与视口高度（由容器的 onScroll 驱动）
  scrollTop: { type: Number, default: 0 },
  clientH: { type: Number, default: 0 },
})
const emit = defineEmits(['seek'])

const MIN_THUMB = 28   // 手柄最小高度（px），太矮不好抓
const MAX_TRACK = 420  // 刻度尺最大高度（px），窗口再高也不无限拉长
const MIN_GAP = 26     // 低于这个间距（px）的年份不显示文字

const trackRef = ref(null)
const trackH = ref(0)
const dragging = ref(false)

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

const maxScroll = computed(() => Math.max(0, (props.total || 0) - (props.clientH || 0)))

// 手柄高度：可视区占总内容的比例（内容不足一屏时给一个固定高度）
const thumbH = computed(() => {
  const h = trackH.value
  if (!h || !props.total) return MIN_THUMB
  return clamp((props.clientH / props.total) * h, MIN_THUMB, h)
})

// 手柄位置：滚动进度 → 轨道可用区间
const thumbTop = computed(() => {
  const range = Math.max(0, trackH.value - thumbH.value)
  if (!range || !maxScroll.value) return 0
  return clamp((props.scrollTop / maxScroll.value) * range, 0, range)
})

// 当前视口顶部所在的那一组（取偏移不超过 scrollTop 的最后一组）
const currentItem = computed(() => {
  const list = props.items || []
  if (!list.length) return null
  let hit = list[0]
  for (const it of list) {
    if (it.offset <= props.scrollTop) hit = it
    else break
  }
  return hit
})

const tipText = computed(() => (currentItem.value ? currentItem.value.date : ''))

/* 年份刻度：按内容高度占比定位（照片多的年份自然占更大间距），
   刻度长度与自身间距成正比 —— 间距越大（照片越多）刻度画得越长。 */
const yearMarks = computed(() => {
  const list = props.items || []
  const total = props.total || 0
  const h = trackH.value
  if (!list.length || !total || !h) return []
  const range = Math.max(0, h - thumbH.value)
  const posOf = (offset) => (offset / total) * range + thumbH.value / 2
  const marks = []
  let cur = null
  for (const it of list) {
    const d = String(it.date || '')
    // 「未知时间」组不是年份，它的刻度直接沿用后端给的标签
    const year = /^\d{4}/.test(d) ? d.slice(0, 4) : (d || '未知')
    if (year === cur) continue
    cur = year
    marks.push({ year, top: posOf(it.offset), label: it.date })
  }
  for (let i = 0; i < marks.length; i++) {
    const bottom = i + 1 < marks.length ? marks[i + 1].top : trackH.value
    const gap = Math.max(0, bottom - marks[i].top)
    marks[i].len = clamp(6 + gap * 0.12, 6, 18)
    marks[i].showLabel = gap >= MIN_GAP
  }
  return marks
})

function measure() {
  const el = trackRef.value
  if (!el) return
  trackH.value = Math.min(el.clientHeight, MAX_TRACK)
}

/* 轨道点击 / 拖动：按指针纵向位置换算成滚动位置 */
function applyFromEvent(e) {
  const el = trackRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const range = Math.max(0, trackH.value - thumbH.value)
  const center = e.clientY - rect.top
  const ratio = range > 0 ? clamp((center - thumbH.value / 2) / range, 0, 1) : 0
  emit('seek', ratio * maxScroll.value)
}

function onTrackPointerDown(e) {
  if (e.button !== 0) return
  startDrag()
  applyFromEvent(e)
}

function onThumbPointerDown(e) {
  if (e.button !== 0) return
  startDrag()
}

function startDrag() {
  dragging.value = true
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e) {
  if (!dragging.value) return
  applyFromEvent(e)
}

// 松手吸附：滚到离当前位置最近的那一天
function onPointerUp() {
  if (!dragging.value) return
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  const list = props.items || []
  if (!list.length) return
  let best = list[0]
  let bestD = Infinity
  for (const it of list) {
    const d = Math.abs(it.offset - props.scrollTop)
    if (d < bestD) { bestD = d; best = it }
  }
  emit('seek', best.offset)
}

function onResize() {
  measure()
}

onMounted(() => {
  measure()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
})

// 数据到位 / 布局重算后轨道高度可能才拿到，补测一次
watch(() => [props.items.length, props.total], () => {
  requestAnimationFrame(measure)
})
</script>

<style scoped>
.album-ruler {
  position: relative;
  width: 26px;
  flex-shrink: 0;
  cursor: pointer;
  touch-action: none;
}

.album-ruler-track {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-border, #d1d5db) 70%, transparent);
}

/* 年份刻度线：紧贴轨道左侧，短横线；间距越大线越长 */
.album-ruler-tick {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-text-muted, #9ca3af) 65%, transparent);
  pointer-events: none;
}

.album-ruler-label {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  color: var(--color-text-muted, #9ca3af);
}

/* 手柄：细长条，hover / 拖动时加宽并高亮 */
.album-ruler-thumb {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  min-height: 28px;
  width: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary, #3b82f6) 75%, transparent);
  transition: width 0.15s ease, background-color 0.15s ease;
  cursor: grab;
}
.album-ruler-thumb:hover,
.album-ruler-thumb--active {
  width: 12px;
  background: var(--color-primary, #3b82f6);
}
.album-ruler-thumb--active {
  cursor: grabbing;
}

/* 日期提示：显示在手柄左侧，垂直居中 */
.album-ruler-tip {
  position: absolute;
  right: 30px;
  transform: translateY(-50%);
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  color: var(--color-text-inverse, #fff);
  background: color-mix(in srgb, var(--color-text, #111827) 88%, transparent);
  box-shadow: var(--shadow-card, 0 4px 12px rgba(0, 0, 0, 0.18));
  pointer-events: none;
}

.ruler-tip-enter-active,
.ruler-tip-leave-active {
  transition: opacity 0.15s ease;
}
.ruler-tip-enter-from,
.ruler-tip-leave-to {
  opacity: 0;
}
</style>