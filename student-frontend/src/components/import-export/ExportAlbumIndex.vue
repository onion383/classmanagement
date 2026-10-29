<template>
  <!-- 导出相册索引：复用 ExportExcel 弹窗（格式 / 文件名 / 保存对话框都沿用），
       只把「选择要导出的列 / 导出行」换成相册索引专用选项。 -->
  <ExportExcel
    v-if="everOpened"
    :is-visible="isVisible"
    :rows="rows"
    :fields="INDEX_FIELDS"
    :default-filename="defaultFilename"
    title="导出相册索引"
    :exclude-formats="['image']"
    :disable-export="loading"
    hide-field-picker
    @update:is-visible="$emit('update:isVisible', $event)"
  >
    <template #extraOptions>
      <div class="mb-4">
        <p class="font-semibold mb-1">选择相册：</p>
        <AppSelect v-model="albumId" :options="albumOptions" class="w-full" />
      </div>
      <div class="mb-4 flex gap-3">
        <div class="flex-1 min-w-0">
          <p class="font-semibold mb-1">索引分组：</p>
          <AppSelect v-model="groupMode" :options="GROUP_OPTIONS" class="w-full" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold mb-1">顺序：</p>
          <AppSelect v-model="order" :options="ORDER_OPTIONS" class="w-full" />
        </div>
      </div>
      <p v-if="loading" class="text-xs text-text-muted mb-3">正在读取照片索引…</p>
    </template>
  </ExportExcel>
</template>

<script setup>
import { getToken } from '../../utils/authStorage.js'
import { reportError } from '../../utils/reportError.js'
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import AppSelect from '../base/AppSelect.vue'
import ExportExcel from './ExportExcel/ExportExcel.vue'
import { useSeq } from '../../composables/useSeq.js'
import { INDEX_FIELDS, buildIndexRows } from './ExportAlbumIndex.builder.js'

const props = defineProps({
  isVisible: { type: Boolean, default: false },
  // 相册列表（GET /api/album 的 data），用于「选择相册」下拉
  albums: { type: Array, default: () => [] },
})
defineEmits(['update:isVisible'])

const GROUP_OPTIONS = [
  { value: 'day', label: '按天分组' },
  { value: 'month', label: '按月分组' },
  { value: 'year', label: '按年分组' },
  { value: 'none', label: '文件顺序（不分组）' },
]
const ORDER_OPTIONS = [
  { value: 'asc', label: '正序' },
  { value: 'desc', label: '倒序' },
]

const albumId = ref('all')
const groupMode = ref('day')
const order = ref('asc')
const loading = ref(false)
const rows = ref([])
// 首次打开后才挂载 ExportExcel：懒加载该组件，且再次打开时保留上次的选择
const everOpened = ref(false)
// 相册照片按相册 id 缓存，切换分组/顺序时不必重复请求
const photoCache = new Map()

const albumOptions = computed(() => [
  { value: 'all', label: '全部相册' },
  ...props.albums.map(a => ({ value: a.id, label: `${a.name}（${a.photo_count || 0}）` })),
])

const defaultFilename = computed(() => {
  if (albumId.value === 'all') return '相册索引'
  const a = props.albums.find(x => x.id === albumId.value)
  return a ? `相册索引_${a.name}` : '相册索引'
})

const token = () => getToken() || ''
const authHeaders = () => ({ Authorization: 'Bearer ' + token() })

// 拉一个相册的全部照片（把按日期分组的返回拍平）
async function fetchPhotos(id) {
  if (photoCache.has(id)) return photoCache.get(id)
  const res = await axios.get(`/api/album/${id}/photos`, { headers: authHeaders() })
  const photos = []
  for (const g of (res.data.data || [])) photos.push(...(g.photos || []))
  photoCache.set(id, photos)
  return photos
}

// 相册增删后缓存失效，由父组件重建组件或再次打开时刷新
function clearCache() { photoCache.clear() }

// 重建序号：切换相册/分组方式/排序时旧请求可能后到，旧结果不能覆盖新结果（B11-04）
const rebuildSeq = useSeq()

async function rebuild() {
  const my = rebuildSeq.take()
  const targets = albumId.value === 'all' ? props.albums : props.albums.filter(a => a.id === albumId.value)
  if (!targets.length) { rows.value = []; loading.value = false; return }
  loading.value = true
  try {
    // 逐个取（不要改成 Promise.all）：实测 30 个相册串行 63ms、并行 60ms —— 请求都打在
    // 127.0.0.1 上，没有 I/O 等待可重叠，并行只多出调度开销，反而更难读。
    const data = []
    for (const a of targets) {
      data.push({ id: a.id, name: a.name, photos: await fetchPhotos(a.id) })
    }
    // 期间又触发了重建（切相册/改分组/改排序）：丢弃这一批，避免旧结果覆盖
    if (!rebuildSeq.isLatest(my)) return
    rows.value = buildIndexRows(data, groupMode.value, order.value)
  } catch (err) {
    if (!rebuildSeq.isLatest(my)) return
    rows.value = []
    reportError(err, { action: '读取照片索引' })
  } finally {
    // 只由最新一次重建关闭 loading
    if (rebuildSeq.isLatest(my)) loading.value = false
  }
}

// immediate：首次打开时组件是随 v-if 一起挂载的，此时 isVisible 直接就是 true，
// 不 immediate 的话第一次打开不会触发加载，导出按钮拿到空行。
watch(() => props.isVisible, (v) => {
  if (!v) return
  everOpened.value = true
  clearCache()
  rebuild()
}, { immediate: true })

watch([albumId, groupMode, order], () => { if (props.isVisible) rebuild() })

defineExpose({ clearCache })
</script>
