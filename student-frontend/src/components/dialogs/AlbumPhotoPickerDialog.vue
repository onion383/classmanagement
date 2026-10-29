<template>
  <DialogShell :visible="visible" :z-index="10004" @overlay="$emit('close')">
    <div class="bg-surface rounded-xl w-[1100px] max-w-[96vw] h-[88vh] flex flex-col border border-border shadow-card dialog-card overflow-hidden">
      <!-- 标题 -->
      <div class="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
        <h3 class="text-lg font-bold text-text truncate">选择 {{ albumName || '相册' }} 的照片</h3>
        <button @click="$emit('close')" class="dlg-close">✕</button>
      </div>

      <!-- 选择工具条 -->
      <div class="flex items-center gap-3 px-6 pb-3 flex-shrink-0">
        <button @click="selectAll" class="bg-surface-hover hover:bg-surface-hover text-text px-3 py-1.5 rounded border border-border text-sm transition-theme">全选</button>
        <button @click="clearSelection" class="bg-surface-hover hover:bg-surface-hover text-text px-3 py-1.5 rounded border border-border text-sm transition-theme">取消选择</button>
        <span class="text-sm text-text-secondary ml-auto">
          已经选择 <span class="text-text font-semibold tabular-nums">{{ selectedCount }}</span> 张
        </span>
      </div>

      <!-- 照片时间轴（按日期分组 + 窗口化虚拟滚动，与相册页同一套逻辑） -->
      <div class="flex-1 min-h-0 px-6">
        <p v-if="loading" class="text-sm text-text-muted py-6 text-center">正在读取照片…</p>
        <p v-else-if="!groups.length" class="text-sm text-text-muted py-6 text-center">这个相册里没有照片。</p>
        <div v-else ref="containerRef" class="h-full overflow-auto min-h-0 album-scroll" @scroll="onScroll">
          <div class="relative" :style="{ height: totalH + 'px' }">
            <div
              v-for="v in visibleGroups"
              :key="v.g.date"
              class="absolute left-0 right-0 mb-8"
              :style="{ top: v.offset + 'px' }"
            >
              <h2 class="text-lg font-semibold text-text mb-3 flex items-center gap-2">
                <span class="px-2 py-0.5 bg-info/10 text-info rounded text-sm">{{ v.g.date }}</span>
                <span class="text-xs text-text-muted">{{ v.g.photos.length }} 张</span>
              </h2>
              <div class="flex flex-wrap gap-3">
                <div
                  v-for="p in v.g.photos"
                  :key="p.id"
                  @click="toggle(p)"
                  class="rounded-lg overflow-hidden bg-bg border cursor-pointer group relative picker-cell"
                  :class="isSelected(p.id) ? 'border-info ring-2 ring-info' : 'border-border'"
                  :style="cellStyle"
                >
                  <VideoThumb v-if="isVideo(p)" :src="thumbSrc(p)" />
                  <img v-else :src="thumbSrc(p)" :alt="p.file_name" class="w-full h-full object-cover" loading="lazy" decoding="async" @error="onThumbError" />
                  <div class="picker-mask" :class="{ 'picker-mask--sel': isSelected(p.id) }"></div>
                  <!-- 左上角单选框 -->
                  <span
                    class="absolute top-1.5 left-1.5 w-5 h-5 rounded-md border-2 flex items-center justify-center text-[11px] leading-none"
                    :class="isSelected(p.id) ? 'bg-info border-info text-text-inverse' : 'bg-black/25 border-white/85 text-transparent'"
                  >✓</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部 -->
      <div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-border flex-shrink-0 mt-2">
        <button @click="$emit('close')" class="px-4 py-2 rounded bg-surface-hover text-text border border-border transition-theme">取消</button>
        <button @click="confirm" :disabled="selectedCount === 0" class="px-4 py-2 rounded bg-primary text-text-inverse hover:bg-primary-hover transition-theme disabled:opacity-50">
          确认选择
        </button>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import { getToken } from '../../utils/authStorage.js'
import { reportError } from '../../utils/reportError.js'
import { ref, computed, nextTick, watch } from 'vue'
import axios from 'axios'
import DialogShell from '../base/DialogShell.vue'
import VideoThumb from '../import-export/VideoThumb.vue'
import { usePhotoTimeline } from '../../composables/usePhotoTimeline.js'
import { useThumbBatch } from '../../composables/useThumbBatch.js'
import { albumThumbUrl } from '../../utils/albumMedia'
import '../../styles/dialog-transition.css'

const props = defineProps({
  visible: { type: Boolean, default: false },
  albumId: { type: [Number, String, null], default: null },
  albumName: { type: String, default: '' },
  // 上次已选的照片 id：再次打开同一相册时恢复勾选状态
  initialIds: { type: Array, default: () => [] },
})
// confirm：把选中的照片对象数组交回给「新建相册」弹窗
const emit = defineEmits(['close', 'confirm'])

const loading = ref(false)
const groups = ref([])
// 选中的照片 id 集合；同时保留 id → 照片对象，确认时按选择顺序无关地取对象
const selected = ref(new Set())
const photoMap = new Map()

const { containerRef, cellStyle, totalH, visibleGroups, onScroll, reset } = usePhotoTimeline(groups)

/* 缩略图批量预取：可视区照片 id 变化时一次批量取回（少几百次 HTTP 往返），
 * 批量没取到的自动回落到单张 /thumb 接口，功能不变。 */
const visiblePhotoIds = computed(() => {
  const out = []
  for (const v of visibleGroups.value) {
    for (const p of (v.g.photos || [])) out.push(p.id)
  }
  return out
})
const {
  thumbUrlFor: batchThumbUrl,
  refresh: refreshThumbBatch,
  clear: clearThumbBatch,
} = useThumbBatch(() => visiblePhotoIds.value)

const token = () => getToken() || ''
const authHeaders = () => ({ Authorization: 'Bearer ' + token() })

const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv|m4v|ogv)$/i
function isVideo(p) {
  return p && VIDEO_RE.test(p.file_name || '')
}
function thumbSrc(p) {
  return batchThumbUrl(p.id) || albumThumbUrl(p.id)
}
const THUMB_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="#f3f4f6"/><g fill="none" stroke="#d1d5db" stroke-width="4"><circle cx="80" cy="70" r="18"/><path d="M30 132 Q52 96 82 118 T160 100" fill="none"/></g></svg>`
)
function onThumbError(e) {
  if (e.target && e.target.src !== THUMB_PLACEHOLDER) e.target.src = THUMB_PLACEHOLDER
}

const allPhotos = computed(() => groups.value.flatMap(g => g.photos || []))
const selectedCount = computed(() => selected.value.size)

function isSelected(id) {
  return selected.value.has(id)
}

function toggle(p) {
  const next = new Set(selected.value)
  if (next.has(p.id)) next.delete(p.id)
  else next.add(p.id)
  selected.value = next
}

function selectAll() {
  const next = new Set()
  for (const p of allPhotos.value) next.add(p.id)
  selected.value = next
}

function clearSelection() {
  selected.value = new Set()
}

async function load() {
  if (!props.albumId) { groups.value = []; return }
  loading.value = true
  // 换了相册 → 旧的 objectURL 全作废（照片 id 不同，留着会显示错图）
  clearThumbBatch()
  try {
    const res = await axios.get(`/api/album/${props.albumId}/photos`, { headers: authHeaders() })
    groups.value = res.data.data || []
    photoMap.clear()
    for (const g of groups.value) for (const p of g.photos || []) photoMap.set(p.id, p)
    // 恢复上次在这个相册里勾过的照片（只保留仍然存在的）
    const keep = new Set()
    for (const id of props.initialIds) if (photoMap.has(id)) keep.add(id)
    selected.value = keep
    await nextTick()
    reset()
    // 列表就绪 → 立即触发一次批量预取（不等滚动）
    refreshThumbBatch()
  } catch (err) {
    groups.value = []
    reportError(err, { action: '读取照片' })
  } finally {
    loading.value = false
  }
}

function confirm() {
  const picked = [...selected.value].map(id => photoMap.get(id)).filter(Boolean)
  emit('confirm', picked)
}

// immediate：弹窗随 v-if 挂载时 visible 直接为 true，不 immediate 会漏掉首次加载
watch(() => [props.visible, props.albumId], ([v]) => {
  if (v) load()
}, { immediate: true })
</script>

<style scoped>
/* 格子不再用 content-visibility 拆层：与毛玻璃主题的 backdrop-filter 叠加会触发
   「按 1x 光栅化再按 DPR 放大」，表现为图片清晰但显示发虚。可视区格子数量本来就有限。 */
/* 选中/悬停遮罩：不用 inset-0 + bg-black/* 工具类，避免被全局「弹窗遮罩模糊」规则命中
   （那条规则会给它加 backdrop-filter: blur，把下面的照片虚化） */
.picker-mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: transparent;
  transition: background-color 0.2s ease;
  pointer-events: none;
}
.group:hover .picker-mask {
  background-color: rgba(0, 0, 0, 0.14);
}
.picker-mask--sel {
  background-color: color-mix(in srgb, var(--color-info, #38bdf8) 16%, transparent);
}

/* 隐藏滚动条（滚动能力保留），与相册页一致 */
.album-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.album-scroll::-webkit-scrollbar {
  display: none;
  width: 0;
}
</style>
