<template>
  <DialogShell :visible="visible" :z-index="10003" @overlay="$emit('close')">
    <div class="bg-surface rounded-xl p-6 w-[760px] max-w-[94vw] max-h-[88vh] flex flex-col border border-border shadow-card dialog-card">
      <div class="flex items-center justify-between mb-4 flex-shrink-0">
        <h3 class="text-lg font-bold text-text">任务管理</h3>
        <button @click="$emit('close')" class="dlg-close">✕</button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto">
        <p v-if="albums.length === 0" class="text-sm text-text-muted py-3">还没有相册，请先在「管理相册」里添加文件夹。</p>

        <!-- 整块任务列表放在一块毛玻璃里（底色取主题 surface 半透明，昼夜自动跟随） -->
        <div v-else class="album-task-glass rounded-xl border overflow-hidden">
          <!-- 第一行：全部相册 -->
          <div class="flex items-center gap-3 px-3 py-2.5 bg-surface-hover border-b border-border">
            <p class="flex-1 min-w-0 font-semibold text-text truncate">更新所有相册照片</p>
            <!-- 操作区固定宽度：所有行的按钮/进度条左端与「停止」右端都对齐 -->
            <div class="task-actions flex items-center justify-end gap-2 flex-shrink-0">
              <template v-if="allRunning || queue.length">
                <div class="flex-1 min-w-0 h-2 bg-bg rounded-full overflow-hidden">
                  <div class="h-full bg-info rounded-full transition-[width] duration-300" :style="{ width: allPercent }"></div>
                </div>
                <span class="text-xs text-text-muted tabular-nums w-[68px] text-right">{{ allProgressText }}</span>
                <button @click="togglePauseAll" class="task-btn bg-surface text-text border border-border">{{ allPaused ? '继续' : '暂停' }}</button>
                <button @click="stopAll" class="task-btn bg-danger hover:bg-danger/80 text-text-inverse transition-theme">停止</button>
              </template>
              <template v-else>
                <button @click="enqueueAll('incremental')" class="task-btn bg-info hover:bg-info-hover text-text-inverse transition-theme">增量更新</button>
                <button @click="enqueueAll('full')" class="task-btn bg-warning hover:bg-warning/80 text-text-inverse transition-theme">全量更新</button>
                <button @click="stopAll" disabled class="task-btn bg-surface text-text border border-border disabled:opacity-40 disabled:cursor-not-allowed">停止</button>
              </template>
            </div>
          </div>

          <!-- 每个相册一行（靠缩进体现层级；名字过长省略，悬停看全名） -->
          <div
            v-for="a in albums" :key="a.id"
            class="flex items-center gap-3 pl-10 pr-3 py-2 border-b border-border last:border-b-0"
          >
            <div class="flex items-center gap-1.5 flex-1 min-w-0">
              <span class="text-sm text-text truncate" :title="a.name">{{ albumLabel(a.name) }}</span>
              <span v-if="isQueued(a.id)" class="text-[11px] text-info flex-shrink-0">排队中</span>
              <span v-else-if="taskOf(a.id)" class="text-[11px] flex-shrink-0" :class="taskOf(a.id).paused ? 'text-warning' : 'text-info'">
                {{ taskOf(a.id).paused ? '已暂停' : modeLabel(taskOf(a.id).mode) }}
              </span>
            </div>
            <div class="task-actions flex items-center justify-end gap-2 flex-shrink-0">
              <template v-if="taskOf(a.id)">
                <div class="flex-1 min-w-0 h-2 bg-bg rounded-full overflow-hidden">
                  <div class="h-full bg-info rounded-full transition-[width] duration-300" :style="{ width: percentOf(taskOf(a.id)) }"></div>
                </div>
                <span class="text-xs text-text-muted tabular-nums w-[68px] text-right">
                  {{ taskOf(a.id).scanned }} / {{ taskOf(a.id).total || '?' }}
                </span>
                <button @click="togglePause(a.id)" :disabled="taskOf(a.id).cancelled" class="task-btn bg-surface text-text border border-border disabled:opacity-50">{{ taskOf(a.id).paused ? '继续' : '暂停' }}</button>
                <button @click="stopRow(a.id)" :disabled="taskOf(a.id).cancelled" class="task-btn bg-danger hover:bg-danger/80 text-text-inverse disabled:opacity-50 transition-theme">停止</button>
              </template>
              <template v-else>
                <button @click="enqueue([{ albumId: a.id, mode: 'incremental' }])" class="task-btn bg-info hover:bg-info-hover text-text-inverse transition-theme">增量更新</button>
                <button @click="enqueue([{ albumId: a.id, mode: 'full' }])" class="task-btn bg-warning hover:bg-warning/80 text-text-inverse transition-theme">全量更新</button>
                <button @click="stopRow(a.id)" :disabled="!isQueued(a.id)" class="task-btn bg-surface text-text border border-border disabled:opacity-40 disabled:cursor-not-allowed">停止</button>
              </template>
            </div>
          </div>
        </div>

        <p class="text-xs text-text-muted mt-3">
          任务一次只跑一个相册：点「更新所有相册照片」会把下面每个相册依次排队执行；运行中可「暂停」并随时「继续」，进度不会丢。软件自动发起的扫描（新建相册、撤销/重做）也会实时显示在对应行。虚拟相册没有文件夹，不参与扫描。
        </p>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import axios from 'axios'
import DialogShell from '../base/DialogShell.vue'
import { useNotification } from '../../composables/useNotification.js'
import { useAlbumScan } from '../../composables/useAlbumScan.js'
import '../../styles/dialog-transition.css'

const props = defineProps({
  visible: { type: Boolean, default: false },
})
// changed：每跑完一个相册通知页面刷新一次（照片数/封面/照片列表会变）
const emit = defineEmits(['close', 'changed'])

const albums = ref([])
// 后端任务表：albumId -> { id, mode, scanning, cancelled, scanned, total, ... }
const tasks = ref({})
// 本地排队：按顺序一个个执行（后端允许并发，但这里刻意串行，避免同时扫多个大相册把机器拖死）
const queue = ref([])
// 「全部暂停」：暂停所有在跑的任务，并且让队列也不再往后推进
const queuePaused = ref(false)

const { waitScan } = useAlbumScan()

let pollTimer = 0
let pumping = false

const token = () => localStorage.getItem('token') || ''
const authHeaders = () => ({ Authorization: 'Bearer ' + token() })

function modeLabel(mode) {
  return mode === 'full' ? '全量更新' : '增量更新'
}

// 行标题：相册名本身可能已经带了「相册」二字，避免出现「XX相册相册照片」
function albumLabel(name) {
  const n = String(name || '')
  return `更新${n}${/相册$/.test(n) ? '' : '相册'}照片`
}

function taskOf(albumId) {
  return tasks.value[albumId] || null
}

function isQueued(albumId) {
  return queue.value.some(it => it.albumId === albumId)
}

function percentOf(t) {
  if (!t || !t.total) return '2%'
  return Math.min(100, Math.round(t.scanned / t.total * 100)) + '%'
}

// 汇总行：把所有正在跑的任务加一起算总进度
const runningTasks = computed(() => Object.values(tasks.value))
const allRunning = computed(() => runningTasks.value.length > 0)
const allPercent = computed(() => {
  if (!allRunning.value) return '2%'
  const scanned = runningTasks.value.reduce((s, t) => s + (t.scanned || 0), 0)
  const total = runningTasks.value.reduce((s, t) => s + (t.total || 0), 0)
  if (!total) return '2%'
  return Math.min(100, Math.round(scanned / total * 100)) + '%'
})
const allProgressText = computed(() => {
  if (!allRunning.value) return queue.value.length ? `排队 ${queue.value.length} 个` : ''
  const scanned = runningTasks.value.reduce((s, t) => s + (t.scanned || 0), 0)
  const total = runningTasks.value.reduce((s, t) => s + (t.total || 0), 0)
  return `${scanned} / ${total || '?'}`
})

// 「继续」还是「暂停」：只要队列被暂停，或所有在跑的任务都处于暂停态，就认为整体是暂停的
const allPaused = computed(() => queuePaused.value || (allRunning.value && runningTasks.value.every(t => t.paused)))

async function loadAlbums() {
  const res = await axios.get('/api/album', { headers: authHeaders() })
  // 虚拟相册没有绑定文件夹、索引来自别的相册，没有可扫描的内容，不参与这里的任务
  albums.value = (res.data.data || []).filter(a => a.kind !== 'virtual')
}

async function fetchTasks() {
  try {
    const res = await axios.get('/api/album/tasks', { headers: authHeaders() })
    const map = {}
    for (const t of (res.data.data || [])) map[t.albumId] = t
    tasks.value = map
  } catch (_) {
    tasks.value = {}
  }
}

function startPolling() {
  stopPolling()
  fetchTasks()
  pollTimer = setInterval(fetchTasks, 800)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = 0 }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// 队列执行器：一次只提交一个相册，等它扫完（任务从后端消失）再提交下一个
async function pump() {
  if (pumping) return
  pumping = true
  try {
    while (queue.value.length) {
      // 整体暂停时连「提交下一个」也停住，恢复后自动继续
      while (queuePaused.value) await sleep(200)
      const item = queue.value[0]
      try {
        await axios.post(`/api/album/${item.albumId}/rescan`, { mode: item.mode }, { headers: authHeaders() })
        await fetchTasks()
        await waitScan(item.albumId)
      } catch (err) {
        // 单个相册失败不影响后续排队
        useNotification().error(err.response?.data?.error || '更新相册照片失败')
      }
      // 按「对象」而不是按下标移除：等待期间用户可能把这行停了、或又排了别的相册
      const idx = queue.value.indexOf(item)
      if (idx !== -1) queue.value.splice(idx, 1)
      emit('changed')
    }
  } finally {
    pumping = false
    queuePaused.value = false
    fetchTasks()
  }
}

function enqueue(items) {
  // 已排队的相册不重复加（同一个相册重新点则替换模式）
  for (const it of items) {
    const idx = queue.value.findIndex(q => q.albumId === it.albumId)
    if (idx !== -1) queue.value.splice(idx, 1)
    queue.value.push(it)
  }
  pump()
}

// 「更新所有相册照片」：按列表顺序把每个相册依次排队
function enqueueAll(mode) {
  if (!albums.value.length) { useNotification().warning('请先添加相册文件夹'); return }
  queue.value = []
  enqueue(albums.value.map(a => ({ albumId: a.id, mode })))
  useNotification().info('已开始' + (mode === 'full' ? '全量' : '增量') + '更新照片索引，将按顺序逐个处理')
}

// 单行暂停/继续：后端在扫描检查点原地等待，进度不丢，任务不消失
async function togglePause(albumId) {
  const t = taskOf(albumId)
  if (!t || t.cancelled) return
  try {
    await axios.post(`/api/album/${albumId}/pause`, { paused: !t.paused }, { headers: authHeaders() })
    fetchTasks()
  } catch (err) {
    useNotification().error(err.response?.data?.error || '暂停失败')
  }
}

// 汇总行暂停/继续：在跑的任务统一下发，同时把队列也冻住
async function togglePauseAll() {
  const next = !allPaused.value
  queuePaused.value = next
  for (const a of albums.value) {
    await axios.post(`/api/album/${a.id}/pause`, { paused: next }, { headers: authHeaders() }).catch(() => {})
  }
  useNotification().info(next ? '已暂停所有扫描任务' : '已继续所有扫描任务')
  fetchTasks()
}

// 停止某一行：排队中→移出队列；正在跑→请求后端停止；两者都不是→按钮本来就是灰的
async function stopRow(albumId) {
  const idx = queue.value.findIndex(it => it.albumId === albumId)
  if (idx !== -1) queue.value.splice(idx, 1)
  if (taskOf(albumId)) {
    await axios.post(`/api/album/${albumId}/stop`, {}, { headers: authHeaders() }).catch(() => {})
  }
  fetchTasks()
}

// 全部停止：清空队列 + 请求所有相册停止（后端无任务时是空操作）
async function stopAll() {
  queue.value = []
  queuePaused.value = false
  for (const a of albums.value) {
    await axios.post(`/api/album/${a.id}/stop`, {}, { headers: authHeaders() }).catch(() => {})
  }
  useNotification().info('已请求停止所有扫描')
  fetchTasks()
}

watch(() => props.visible, async (v) => {
  if (v) {
    // 不清队列：关掉弹窗再打开时，之前没跑完的排队继续生效
    startPolling()
    try { await loadAlbums() } catch (_) { useNotification().error('读取相册列表失败') }
  } else {
    stopPolling()
    tasks.value = {}
  }
}, { immediate: true })

onBeforeUnmount(stopPolling)
</script>

<style scoped>
/* 任务列表整块的毛玻璃底：用主题 surface 色做半透明 + 模糊，
   昼夜/各主题自动跟随（不硬编码白色，避免夜间还要单独覆盖） */
.album-task-glass {
  background-color: color-mix(in srgb, var(--color-surface) 72%, transparent);
  border-color: var(--color-border);
  backdrop-filter: blur(12px) saturate(1.15);
}

/* 操作区固定宽度：让每行的「增量更新 / 全量更新 / 暂停 / 停止」与进度条左右都对齐 */
.task-actions {
  width: 340px;
}

/* 行内按钮统一尺寸，避免不同行宽度不一致导致错位 */
.task-btn {
  width: 76px;
  padding: 4px 0;
  font-size: 12px;
  line-height: 1.4;
  border-radius: var(--radius-control);
  text-align: center;
  white-space: nowrap;
  transition: background-color 0.2s ease;
}
.task-btn:last-child {
  width: 64px;
}
</style>
