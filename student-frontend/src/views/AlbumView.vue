<template>
  <div class="h-full flex flex-col">
    <!-- 顶部标题栏 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-6 py-5 border border-border">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-text">📷 班级相册</h1>
        <div class="flex gap-3">
          <button @click="openAdd" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme">添加文件夹</button>
          <button @click="openManage" class="bg-surface-hover hover:bg-surface-hover text-text px-4 py-2 rounded transition-theme">管理</button>
          <button @click="refreshAll" :disabled="busyScan || manageScanning" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50">
            {{ busyScan || manageScanning ? (scanMode === 'full' ? '完全更新中…' : '刷新中…') : '刷新' }}
          </button>
        </div>
      </div>
      <p v-if="busyScan" class="text-xs mt-3 px-4 py-2 bg-bg rounded text-text-secondary">正在更新照片索引…（可在设置页任务管理中停止）</p>
    </div>

    <!-- 相册切换条 -->
    <div v-if="albums.length > 1" class="flex gap-2 mb-4 flex-wrap">
      <button
        v-for="a in albums" :key="a.id"
        @click="selectAlbum(a.id)"
        class="px-4 py-2 rounded transition-theme text-sm"
        :class="activeAlbumId === a.id ? 'bg-primary text-text-inverse' : 'bg-surface text-text border border-border hover:bg-surface-hover'"
      >
        {{ a.name }}（{{ a.photo_count }}）
      </button>
    </div>

    <!-- 空状态 -->
    <div v-if="!activeAlbum" class="bg-surface rounded-xl border border-border p-12 text-center text-text-muted">
      <p class="text-lg mb-2">还没有相册</p>
      <p class="text-sm">点击「添加文件夹」选择照片所在文件夹，系统会自动扫描并建立索引。</p>
    </div>

    <!-- 照片按日期分组（网格窗口化虚拟滚动） -->
    <div v-else class="flex-1 min-h-0 flex flex-col">
      <p v-if="groups.length === 0" class="bg-surface rounded-xl border border-border p-12 text-center text-text-muted">
        当前相册暂无照片，点击「刷新」或到设置页「更新文件夹照片」重新扫描。
      </p>

      <!-- 虚拟滚动容器：只挂载视口附近的分组，外部用总高度撑起滚动条 -->
      <div v-else ref="containerRef" class="flex-1 overflow-auto min-h-0 album-scroll" @scroll="onScroll">
        <div class="relative" :style="{ height: totalH + 'px' }">
          <div
            v-for="v in visibleGroups"
            :key="v.g.date"
            class="absolute left-0 right-0 mb-8 album-group"
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
                @click="viewPhoto(p)"
                class="rounded-lg overflow-hidden bg-surface border border-border cursor-pointer group relative photo-cell"
                :style="cellStyle"
              >
                <VideoThumb v-if="isVideo(p)" :src="thumbSrc(p)" />
                <img v-else :src="thumbSrc(p)" :alt="p.file_name" class="w-full h-full object-cover" loading="lazy" />
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-theme"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加相册弹窗 -->
    <div v-if="showAdd" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10003]" @click.self="showAdd = false">
      <div class="bg-surface p-6 rounded-xl w-96 shadow-card">
        <h3 class="text-lg font-bold text-text mb-4">添加文件夹</h3>
        <label class="block text-sm text-text-secondary mb-1">相册名称</label>
        <input v-model="newName" placeholder="如：文艺晚会" class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4" />
        <label class="block text-sm text-text-secondary mb-1">文件夹路径</label>
        <div class="flex gap-2 mb-4">
          <input v-model="newPath" placeholder="点击右侧按钮选择文件夹" class="border border-border bg-surface text-text px-3 py-2 rounded flex-1 min-w-0" readonly @click="pickFolder" />
          <button @click="pickFolder" class="bg-surface-hover hover:bg-surface-hover text-text px-4 py-2 rounded transition-theme whitespace-nowrap">选择文件夹</button>
        </div>
        <p class="text-xs text-text-muted mb-4">系统会递归读取该文件夹及所有子目录下的照片并建立索引。</p>
        <div class="flex gap-2 justify-end">
          <button @click="showAdd = false" class="bg-surface-hover px-4 py-2 rounded">取消</button>
          <button @click="addAlbum" :disabled="busyAdd" class="bg-primary text-text-inverse px-4 py-2 rounded disabled:opacity-50">
            {{ busyAdd ? '添加中…' : '添加并扫描' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 管理弹窗（相册管理 + 任务管理） -->
    <Transition name="dialog">
    <div v-if="showManage" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10003]" @click.self="showManage = false">
      <div class="bg-surface rounded-xl p-6 w-[820px] max-w-[94vw] flex flex-col border border-border shadow-card dialog-card">
        <div class="flex items-center justify-between mb-4 flex-shrink-0">
          <h3 class="text-lg font-bold text-text">相册管理</h3>
          <button @click="showManage = false" class="text-text-muted hover:text-text text-lg leading-none px-2">✕</button>
        </div>

        <!-- 添加文件夹 -->
        <div class="flex items-end gap-2 mb-4 flex-shrink-0">
          <input v-model="newName" placeholder="相册名称，如：文艺晚会" class="border border-border bg-surface text-text px-3 py-2 rounded w-36 flex-shrink-0" />
          <div class="flex gap-1 flex-1 min-w-0">
            <input v-model="newPath" placeholder="点击右侧选择文件夹" readonly @click="pickFolder" class="border border-border bg-surface text-text px-3 py-2 rounded flex-1 min-w-0" />
            <button @click="pickFolder" class="bg-surface-hover hover:bg-surface-hover text-text px-3 py-2 rounded whitespace-nowrap transition-theme">选择文件夹</button>
          </div>
          <button @click="addAlbum" :disabled="busyAdd" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap disabled:opacity-50">
            {{ busyAdd ? '添加中…' : '添加' }}
          </button>
        </div>

        <!-- 文件夹列表（可滚动区域，可拖拽排序） -->
        <div class="flex-1 min-h-0 overflow-y-auto">
          <p v-if="albums.length === 0" class="text-sm text-text-muted py-3">暂无相册文件夹，请在上面添加。</p>
          <div v-else ref="albumListRef" class="space-y-2 mb-4">
            <div v-for="a in albums" :key="a.id" class="flex items-center gap-1 border border-border rounded-lg p-2.5 album-sort-item">
              <span class="drag-handle cursor-grab active:cursor-grabbing text-text-muted hover:text-text flex-shrink-0 select-none" title="拖拽排序">⠿</span>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-text">{{ a.name }}</p>
                <p class="text-xs text-text-muted truncate">{{ a.folder_path }} · {{ a.photo_count || 0 }} 项</p>
              </div>
              <button @click="openFolder(a)" class="text-text-muted hover:text-text px-2 py-1 text-sm flex-shrink-0" title="在文件管理器中打开">📂 打开文件夹</button>
              <button @click="confirmRemove(a)" class="bg-danger hover:bg-danger/80 text-text-inverse text-sm px-3 py-1.5 rounded flex-shrink-0 ml-4">删除</button>
            </div>
          </div>
        </div>

        <!-- 任务管理 -->
        <div class="border-t border-border pt-4 flex-shrink-0">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="font-medium text-text">更新文件夹照片</p>
              <p class="text-xs text-text-muted mt-0.5">重新扫描所有相册文件夹及其子目录，同步最新的照片与视频索引</p>
            </div>
            <div class="flex gap-2 flex-shrink-0">
              <button @click="rescanAll('incremental')" :disabled="manageScanning" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded whitespace-nowrap transition-theme disabled:opacity-50">
                {{ manageScanning ? '更新中…' : '增量更新' }}
              </button>
              <button @click="rescanAll('full')" :disabled="manageScanning" class="bg-warning hover:bg-warning/80 text-text-inverse px-4 py-2 rounded whitespace-nowrap transition-theme disabled:opacity-50">
                {{ manageScanning ? '更新中…' : '完全更新' }}
              </button>
              <button @click="stopScan" class="bg-danger hover:bg-danger/80 text-text-inverse px-4 py-2 rounded whitespace-nowrap transition-theme">停止</button>
            </div>
          </div>
          <!-- 进度条 -->
          <div v-if="manageScanning" class="mt-3">
            <div class="flex items-center gap-2 text-xs text-text-muted mb-1.5">
              <span class="tabular-nums">{{ scanProgress.scanned }}</span>
              <span class="text-text-muted">/</span>
              <span class="tabular-nums">{{ scanProgress.total || '?' }}</span>
            </div>
            <div class="w-full h-2 bg-bg rounded-full overflow-hidden">
              <div
                class="h-full bg-info rounded-full transition-all duration-300"
                :style="{ width: scanProgress.total > 0 ? Math.min(100, scanProgress.scanned / scanProgress.total * 100) + '%' : '2%' }"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Transition>

    <!-- 删除确认弹窗 -->
    <Transition name="dialog">
    <div v-if="confirmDelete" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10004]" @click.self="confirmDelete = null">
      <div class="bg-surface p-5 rounded-lg min-w-[300px] text-center shadow-card dialog-card">
        <p class="mb-3">确定删除相册「<strong>{{ confirmDelete.name }}</strong>」吗？<br><span class="text-xs text-text-muted">仅删除索引，不删除磁盘照片</span></p>
        <div class="flex gap-2 justify-center">
          <button @click="doRemove" class="bg-danger text-text-inverse px-4 py-1.5 rounded">确定删除</button>
          <button @click="confirmDelete = null" class="bg-surface-hover px-4 py-1.5 rounded">取消</button>
        </div>
      </div>
    </div>
    </Transition>

    <!-- 媒体查看器（图片 / 视频） -->
    <Transition name="preview">
    <div v-if="viewer" class="fixed inset-0 bg-black/90 z-[10004] flex flex-col" @click.self="closeViewer">
      <!-- 关闭按钮（右上角） -->
      <button @click="closeViewer" class="z-20 w-10 h-10 rounded-full bg-white/10 hover:bg-white/25 text-white text-lg flex items-center justify-center" style="position:absolute!important;top:16px!important;right:16px!important;" title="关闭">✕</button>
      <!-- 上一张（左侧边缘居中） -->
      <button @click="prevPhoto" class="z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white text-xl flex items-center justify-center" style="position:absolute!important;left:16px!important;top:50%!important;transform:translateY(-50%)!important;" title="上一张">‹</button>
      <!-- 下一张（右侧边缘居中） -->
      <button @click="nextPhoto" class="z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white text-xl flex items-center justify-center" style="position:absolute!important;right:16px!important;top:50%!important;transform:translateY(-50%)!important;" title="下一张">›</button>
      <!-- 视频播放区 -->
      <div v-if="isVideo(viewer)" class="flex-1 flex items-center justify-center p-6 overflow-hidden preview-media">
        <video
          ref="videoEl"
          class="max-w-full max-h-full bg-black outline-none"
          :src="photoSrc(viewer)"
          @timeupdate="onTimeupdate"
          @loadedmetadata="onLoadedmetadata"
          @play="playing = true"
          @pause="playing = false"
          @ended="playing = false"
        ></video>
      </div>
      <!-- 图片查看区 -->
      <div v-else class="flex-1 flex items-center justify-center p-6 overflow-hidden preview-media" @wheel.prevent="onZoomWheel">
        <img
          :src="photoSrc(viewer)"
          class="max-w-full max-h-full select-none transition-transform duration-100"
          :style="viewerStyle"
          @wheel.prevent="onZoomWheel"
          draggable="false"
        />
      </div>
      <!-- 底部工具条 -->
      <div class="flex items-center justify-center gap-3 p-4 bg-black/40 flex-wrap">
        <!-- 视频控制 -->
        <template v-if="isVideo(viewer)">
          <button @click="togglePlay" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm" :title="playing ? '暂停' : '播放'">{{ playing ? '⏸' : '▶' }}</button>
          <button @click="skip(-10)" class="h-10 px-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs" title="后退 10 秒">« -10s</button>
          <div class="flex items-center gap-2 min-w-[260px] max-w-full">
            <span class="text-white text-xs tabular-nums w-12 text-right">{{ fmtTime(currentTime) }}</span>
            <input
              type="range"
              class="flex-1 accent-info"
              min="0"
              :max="duration || 0"
              step="0.1"
              :value="currentTime"
              @input="onSeekInput"
              @pointerdown="dragging = true"
              @pointerup="dragging = false"
            />
            <span class="text-white text-xs tabular-nums w-12">{{ fmtTime(duration) }}</span>
          </div>
          <button @click="skip(10)" class="h-10 px-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs" title="前进 10 秒">+10s »</button>
          <select v-model="playbackRate" @change="changeRate" class="bg-black/40 text-white text-xs px-2 py-2 rounded outline-none" title="播放倍数">
            <option :value="0.5">0.5x</option>
            <option :value="0.75">0.75x</option>
            <option :value="1">1x</option>
            <option :value="1.25">1.25x</option>
            <option :value="1.5">1.5x</option>
            <option :value="2">2x</option>
          </select>
          <span class="text-white/30">|</span>
        </template>
        <!-- 图片控制 -->
        <template v-else>
          <button @click="rotate(-1)" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm">⟲</button>
          <button @click="rotate(1)" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm">⟳</button>
          <button @click="zoomOut" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white">−</button>
          <span class="text-white text-xs w-14 text-center">{{ Math.round(zoom * 100) }}%</span>
          <button @click="zoomIn" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white">＋</button>
          <button @click="resetView" class="px-3 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs">复位</button>
          <span class="text-white/30">|</span>
        </template>
        <button @click="saveAs(viewer)" class="px-4 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm">另存</button>
        <button @click="openFolderViewer" class="px-4 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm">打开文件夹</button>
        <button @click="deletePhoto(viewer)" class="px-4 h-10 rounded-full bg-danger hover:bg-danger/80 text-white text-sm">删除（回收站）</button>
      </div>
    </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import axios from 'axios'
import { useNotification } from '../composables/useNotification.js'
import VideoThumb from '../components/VideoThumb.vue'
import Sortable from 'sortablejs'
import { resourceUrl } from '../utils/apiUrl'

const albums = ref([])
const activeAlbumId = ref(null)
const groups = ref([])
const busyScan = ref(false)
const busyAdd = ref(false)

// 管理弹窗
const showManage = ref(false)
const manageScanning = ref(false)
const scanProgress = ref({ scanned: 0, total: 0 })
const scanMode = ref('incremental')
const albumListRef = ref(null)
const confirmDelete = ref(null)
let sortableInstance = null

// 添加弹窗
const showAdd = ref(false)
const newName = ref('')
const newPath = ref('')

// 查看器
const viewer = ref(null)
const rotation = ref(0)
const zoom = ref(1)

// 视频播放状态
const videoEl = ref(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const playbackRate = ref(1)
const dragging = ref(false)

const token = () => localStorage.getItem('token') || ''
const authHeaders = () => ({ Authorization: 'Bearer ' + token() })

const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv|m4v|ogv)$/i
function isVideo(p) {
  return p && VIDEO_RE.test(p.file_name || '')
}

// 用 id 动态拉取源文件（图片/视频），避免直接暴露绝对路径，也保持鉴权。
// 用稳定 URL（不带时间戳），让浏览器能正常缓存，避免每次渲染整批重载。
// 生产模式 file:// 协议下需补完整后端地址（apiUrl），否则 /api 会被解析到磁盘根目录。
// <img> 无法携带 Authorization 头，故用 resourceUrl 追加 ?token= 查询参数通过鉴权。
function photoSrc(p) {
  return resourceUrl(`/api/album/photo/${p.id}/file`)
}

// 视频缩略图用稳定 URL（不带时间戳），便于 VideoThumb 按 URL 缓存封面
// 指向服务端 /thumb 小图接口（首帧封面 / 图片缩略图），稳定 URL 便于浏览器缓存
function thumbSrc(p) {
  return resourceUrl(`/api/album/photo/${p.id}/thumb`)
}

function fmtTime(t) {
  if (!isFinite(t) || t < 0) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const activeAlbum = computed(() => albums.value.find(a => a.id === activeAlbumId.value))
const viewerStyle = computed(() => {
  const base = (viewer.value && viewer.value._rot) || 0
  return { transform: `rotate(${base}deg) scale(${zoom.value})` }
})

/* ===== 网格窗口化虚拟滚动 =====
 * 以“日期分组”为窗口单元：外部用总高度撑起滚动条，
 * 内部只挂载视口附近（含缓冲）的分组，其余用绝对定位占位。
 * 分组内部 grid 用固定尺寸的方形格子（flex-wrap），
 * 列数/格子尺寸由容器宽度实时计算，保证各分组高度可精确预算，无需测量。 */
const containerRef = ref(null)
const scrollTop = ref(0)
const clientH = ref(0)
const viewW = ref(0)
const cols = ref(5)
const cell = ref(150)
let rafId = 0

const GAP = 12        // 格子间距（与模板 gap-3 一致）
const HEADER = 40     // 分组日期标题高度约值
const GROUP_GAP = 32  // 组间距（与模板 mb-8 一致）
const BUFFER = 900    // 上下预留缓冲，提前渲染避免闪过空白

function measure() {
  const el = containerRef.value
  if (!el) return
  viewW.value = el.clientWidth
  clientH.value = el.clientHeight
  // 固定一行 6 张，把剩余宽度分给每格，让格子尽量铺满容器（仍是正方形）
  cols.value = 6
  cell.value = cols.value > 1 ? Math.floor((viewW.value - (cols.value - 1) * GAP) / cols.value) : viewW.value
}

const cellStyle = computed(() => ({ width: cell.value + 'px', height: cell.value + 'px' }))

function groupHeight(g) {
  const n = g.photos ? g.photos.length : 0
  const rows = n ? Math.ceil(n / cols.value) : 0
  return HEADER + (rows ? rows * cell.value + (rows - 1) * GAP : 0)
}

const layout = computed(() => {
  let offset = 0
  const items = []
  for (const g of groups.value) {
    const h = groupHeight(g)
    items.push({ g, offset, h })
    offset += h + GROUP_GAP
  }
  return { total: offset, items }
})

const totalH = computed(() => layout.value.total)

const visibleGroups = computed(() => {
  const top = scrollTop.value - BUFFER
  const bottom = scrollTop.value + clientH.value + BUFFER
  return layout.value.items
    .filter(v => v.offset + v.h >= top && v.offset <= bottom)
    .map(v => ({ g: v.g, offset: v.offset }))
})

function onScroll() {
  const el = containerRef.value
  if (!el) return
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    scrollTop.value = el.scrollTop
    clientH.value = el.clientHeight
  })
}

function onResize() {
  measure()
}

async function loadAlbums(first = true) {
  const res = await axios.get('/api/album', { headers: authHeaders() })
  albums.value = res.data.data || []
  // 保持选中；相册被删则切到第一个
  if (!albums.value.find(a => a.id === activeAlbumId.value)) {
    activeAlbumId.value = albums.value.length ? albums.value[0].id : null
  }
  if (activeAlbumId.value) await loadPhotos(first)
}

async function loadPhotos(first = true) {
  if (!activeAlbumId.value) { groups.value = []; return }
  const res = await axios.get(`/api/album/${activeAlbumId.value}/photos`, { headers: authHeaders() })
  groups.value = res.data.data || []
  if (first) {
    // 切换相册/刷新后回到顶部并重新计量
    scrollTop.value = 0
    await nextTick()
    const el = containerRef.value
    if (el) el.scrollTop = 0
    measure()
  }
}

function selectAlbum(id) {
  activeAlbumId.value = id
  loadPhotos()
}

function openAdd() {
  newName.value = ''
  newPath.value = ''
  showAdd.value = true
}

async function pickFolder() {
  if (!window.electron || typeof window.electron.invoke !== 'function') {
    useNotification().warning('请使用桌面客户端选择文件夹')
    return
  }
  try {
    const result = await window.electron.invoke('select-folder')
    if (result && result.filePaths && result.filePaths.length > 0) {
      newPath.value = result.filePaths[0]
      // 相册名缺省取文件夹名
      if (!newName.value) newName.value = result.filePaths[0].split(/[\\/]/).filter(Boolean).pop() || ''
    }
  } catch (_) {
    useNotification().error('选择文件夹失败')
  }
}

async function addAlbum() {
  if (!newName.value) { useNotification().warning('请输入相册名称'); return }
  if (!newPath.value) { useNotification().warning('请输入文件夹路径'); return }
  busyAdd.value = true
  try {
    const res = await axios.post('/api/album', { name: newName.value, folder_path: newPath.value }, { headers: authHeaders() })
    showAdd.value = false
    useNotification().success('相册已添加，正在后台扫描照片…')
    await loadAlbums()
    activeAlbumId.value = res.data.id
    // 扫描是后台任务，稍后拉取
    setTimeout(refreshAll, 1500)
  } catch (err) {
    useNotification().error(err.response?.data?.error || '添加失败')
  } finally { busyAdd.value = false }
}

function openManage() {
  showManage.value = true
  loadAlbums()
  nextTick(() => initSortable())
}

function initSortable() {
  destroySortable()
  const el = albumListRef.value
  if (!el) return
  // 渲染后给每个子元素设置 data-id
  const children = el.children
  for (let i = 0; i < children.length; i++) {
    children[i].dataset.id = String(albums.value[i]?.id || '')
  }
  sortableInstance = new Sortable(el, {
    handle: '.drag-handle',
    animation: 200,
    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    onEnd: () => {
      const childIds = []
      for (const child of el.children) {
        const aid = Number(child.dataset?.id || '')
        if (aid) childIds.push(aid)
      }
      if (childIds.length === albums.value.length) {
        reorderAlbums(childIds)
      }
    }
  })
}

function destroySortable() {
  if (sortableInstance) {
    sortableInstance.destroy()
    sortableInstance = null
  }
}

async function reorderAlbums(ids) {
  try {
    await axios.put('/api/album/reorder', { ids }, { headers: authHeaders() })
    // 按新顺序重新排列本地数据
    const map = new Map(albums.value.map(a => [a.id, a]))
    albums.value = ids.map(id => map.get(id)).filter(Boolean)
  } catch (err) {
    useNotification().error(err.response?.data?.error || '排序更新失败')
    loadAlbums()
  }
}

async function refreshAll() {
  if (!activeAlbumId.value) return
  busyScan.value = true
  // 顶部刷新用增量模式，瞬间完成，不渐进显示
  try {
    await axios.post(`/api/album/${activeAlbumId.value}/rescan`, { mode: 'incremental' }, { headers: authHeaders() })
    useNotification().info('已开始增量更新照片索引…')
    await pollScan(true)
    await loadAlbums()
    useNotification().success('照片索引已更新')
  } catch (err) {
    useNotification().error(err.response?.data?.error || '刷新失败')
  } finally { busyScan.value = false }
}

function pollScan(progressive = false) {
  const id = activeAlbumId.value
  return new Promise(resolve => {
    const timer = setInterval(async () => {
      try {
        const res = await axios.get(`/api/album/${id}/status`, { headers: authHeaders() })
        if (res.data.scanning) {
          // 渐进刷新：扫描中逐步显示已索引的照片（同时刷新相册数字）
          if (progressive && activeAlbumId.value === id) {
            await loadAlbums(false)
          }
        } else {
          clearInterval(timer); resolve()
        }
      } catch (_) { clearInterval(timer); resolve() }
    }, 800)
  })
}

// ---- 相册管理 / 任务管理 ----
function confirmRemove(a) {
  confirmDelete.value = a
}

async function doRemove() {
  const a = confirmDelete.value
  if (!a) return
  confirmDelete.value = null
  try {
    await axios.delete(`/api/album/${a.id}`, { headers: authHeaders() })
    useNotification().success('相册已删除')
    await loadAlbums()
  } catch (err) {
    useNotification().error(err.response?.data?.error || '删除失败')
  }
}

async function openFolder(a) {
  if (!window.electron || typeof window.electron.invoke !== 'function') {
    useNotification().warning('请使用桌面客户端打开文件夹')
    return
  }
  try {
    await window.electron.invoke('open-folder', a.folder_path)
  } catch (_) {
    useNotification().error('打开文件夹失败')
  }
}

function openFolderViewer() {
  if (!viewer.value) return
  // 从 viewer 的 file_path 提取目录
  const fp = viewer.value.file_path || ''
  const idx = Math.max(fp.lastIndexOf('\\'), fp.lastIndexOf('/'))
  if (idx === -1) { useNotification().error('无法获取文件路径'); return }
  const dir = fp.substring(0, idx)
  if (!window.electron || typeof window.electron.invoke !== 'function') {
    useNotification().warning('请使用桌面客户端打开文件夹')
    return
  }
  window.electron.invoke('open-folder', dir).catch(() => useNotification().error('打开文件夹失败'))
}

async function rescanAll(mode = 'incremental') {
  if (albums.value.length === 0) { useNotification().warning('请先添加相册文件夹'); return }
  manageScanning.value = true
  scanProgress.value = { scanned: 0, total: 0 }
  scanMode.value = mode
  // 全量更新：先清空前端网格，扫描中逐步显示新索引的照片
  if (mode === 'full') groups.value = []
  try {
    for (const a of albums.value) {
      await axios.post(`/api/album/${a.id}/rescan`, { mode }, { headers: authHeaders() })
    }
    useNotification().info('已开始' + (mode === 'full' ? '完全' : '增量') + '更新照片索引…')
    await Promise.all(albums.value.map(a => pollScanFor(a.id, mode === 'full')))
    await loadAlbums()
    useNotification().success('照片索引已更新')
  } catch (err) {
    useNotification().error(err.response?.data?.error || '更新失败')
  } finally { manageScanning.value = false }
}

function pollScanFor(id, progressive = false) {
  return new Promise(resolve => {
    const timer = setInterval(async () => {
      try {
        const res = await axios.get(`/api/album/${id}/status`, { headers: authHeaders() })
        if (res.data.scanning) {
          scanProgress.value = { scanned: res.data.scanned || 0, total: res.data.total || 0 }
          // 渐进刷新：全量更新时逐步显示已索引的照片（同时刷新相册数字）
          if (progressive && activeAlbumId.value === id) {
            await loadAlbums(false)
          }
        } else {
          clearInterval(timer); resolve()
        }
      } catch (_) { clearInterval(timer); resolve() }
    }, 800)
  })
}

async function stopScan() {
  for (const a of albums.value) {
    await axios.post(`/api/album/${a.id}/stop`, {}, { headers: authHeaders() }).catch(() => {})
  }
  useNotification().info('已请求停止扫描')
}

// 当前相册的扁平照片列表（按日期分组展开），用于上下张切换
const allPhotos = computed(() => {
  const arr = []
  for (const g of groups.value) arr.push(...(g.photos || []))
  return arr
})

// ---- 查看器操作 ----
function viewPhoto(p) {
  rotation.value = 0
  zoom.value = 1
  // 视频状态复位
  currentTime.value = 0
  duration.value = 0
  playing.value = false
  playbackRate.value = 1
  dragging.value = false
  viewer.value = { ...p, _rot: 0 }
}
// 在扁平列表中平移当前项，首尾循环
function stepPhoto(dir) {
  const list = allPhotos.value
  if (!list.length || !viewer.value) return
  const idx = list.findIndex(p => p.id === viewer.value.id)
  if (idx === -1) return
  viewPhoto(list[(idx + dir + list.length) % list.length])
}
function prevPhoto() { stepPhoto(-1) }
function nextPhoto() { stepPhoto(1) }
function rotate(dir) {
  if (!viewer.value) return
  viewer.value._rot = ((viewer.value._rot + dir * 90) % 360 + 360) % 360
}
function zoomIn() { zoom.value = Math.min(5, zoom.value + 0.25) }
function zoomOut() { zoom.value = Math.max(0.2, zoom.value - 0.25) }
function resetView() {
  if (viewer.value) { viewer.value._rot = 0 }
  zoom.value = 1
}
function onZoomWheel(e) {
  zoom.value = Math.min(5, Math.max(0.2, zoom.value + (e.deltaY < 0 ? 0.1 : -0.1)))
}
function closeViewer() { viewer.value = null }

// ---- 视频控制 ----
function onLoadedmetadata() {
  const v = videoEl.value
  if (!v) return
  duration.value = v.duration || 0
  currentTime.value = v.currentTime || 0
}
function onTimeupdate() {
  const v = videoEl.value
  if (!v || dragging.value) return
  currentTime.value = v.currentTime || 0
}
function togglePlay() {
  const v = videoEl.value
  if (!v) return
  if (v.paused) {
    v.play()
  } else {
    v.pause()
  }
}
function skip(sec) {
  const v = videoEl.value
  if (!v) return
  const max = v.duration || 0
  v.currentTime = Math.max(0, Math.min(max, (v.currentTime || 0) + sec))
  currentTime.value = v.currentTime || 0
}
function onSeekInput(e) {
  const v = videoEl.value
  if (!v) return
  const t = Number(e.target.value) || 0
  v.currentTime = t
  currentTime.value = t
}
function changeRate() {
  const v = videoEl.value
  if (v) v.playbackRate = playbackRate.value
}

async function saveAs(p) {
  try {
    // 触发浏览器下载（另存为）
    const resp = await axios.get(`/api/album/photo/${p.id}/save-as`, { headers: authHeaders(), responseType: 'blob' })
    const url = URL.createObjectURL(resp.data)
    const a = document.createElement('a')
    a.href = url
    a.download = p.file_name
    a.click()
    URL.revokeObjectURL(url)
    useNotification().success('已开始另存')
  } catch (err) {
    useNotification().error(err.response?.data?.error || '另存失败')
  }
}

async function deletePhoto(p) {
  if (!confirm(`确定把「${p.file_name}」移入回收站吗？（可还源）`)) return
  try {
    await axios.delete(`/api/album/photo/${p.id}`, { headers: authHeaders() })
    viewer.value = null
    useNotification().success('已移入回收站')
    loadPhotos()
  } catch (err) {
    useNotification().error(err.response?.data?.error || '删除失败')
  }
}

onMounted(async () => {
  window.addEventListener('resize', onResize)
  await loadAlbums()
  await nextTick()
  measure()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
})
</script>

<style scoped>
/* ===== 网格窗口化虚拟滚动 =====
 * 外层以“日期分组”为窗口单元做 JS 虚拟滚动（只挂载视口附近分组）。
 * 分组内部：超大单日分组仍可能出现大量格子，这里再用 content-visibility
 * 跳过离屏格子布局/绘制，作为兜底，进一步降低大分组滚动卡顿。 */
.photo-cell {
  content-visibility: auto;
  contain-intrinsic-size: auto 1px 150px;
}

/* 隐藏相册主列表滚动条（滚动能力保留） */
.album-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.album-scroll::-webkit-scrollbar {
  display: none;
  width: 0;
}

/* ===== 媒体预览动画：淡入 + 缩放（从较明显放大到原始） ===== */
.preview-enter-active {
  transition: opacity 0.35s ease;
}
.preview-enter-active .preview-media {
  animation: previewMediaIn 0.35s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.preview-leave-active {
  transition: opacity 0.22s ease;
}
.preview-enter-from,
.preview-leave-to {
  opacity: 0;
}
.preview-leave-active .preview-media {
  animation: previewMediaOut 0.22s ease forwards;
}
@keyframes previewMediaIn {
  0% {
    opacity: 0;
    transform: scale(0.82);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes previewMediaOut {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.9);
  }
}
</style>