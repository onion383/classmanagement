<template>
  <DialogShell :visible="visible" :z-index="10003" @overlay="$emit('close')">
    <div class="bg-surface rounded-xl p-6 w-[820px] max-w-[94vw] max-h-[88vh] flex flex-col border border-border shadow-card dialog-card">
      <div class="flex items-center justify-between mb-4 flex-shrink-0">
        <h3 class="text-lg font-bold text-text">管理相册</h3>
        <button @click="$emit('close')" class="dlg-close">✕</button>
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
              <p class="font-medium text-text flex items-center gap-1.5">
                <span class="truncate">{{ a.name }}</span>
                <span v-if="a.kind === 'virtual'" class="text-[11px] font-normal text-info flex-shrink-0 px-1.5 py-0.5 rounded bg-info/10">虚拟</span>
              </p>
              <p class="text-xs text-text-muted truncate">
                <template v-if="a.kind === 'virtual'">虚拟相册 · {{ a.photo_count || 0 }} 项（索引来自其他相册）</template>
                <template v-else>{{ a.folder_path }} · {{ a.photo_count || 0 }} 项</template>
              </p>
            </div>
            <button v-if="a.kind !== 'virtual'" @click="openFolder(a)" class="text-text-muted hover:text-text px-2 py-1 text-sm flex-shrink-0" title="在文件管理器中打开">📂 打开文件夹</button>
            <button @click="confirmDelete = a" class="bg-danger hover:bg-danger/80 text-text-inverse text-sm px-3 py-1.5 rounded flex-shrink-0 ml-4 transition-theme">删除</button>
          </div>
        </div>
      </div>

      <!-- 扫描任务已独立入口：页面上的「任务管理」弹窗（AlbumTaskDialog） -->
      <p class="text-xs text-text-muted pt-3 border-t border-border flex-shrink-0">更新文件夹照片（增量/全量/暂停/停止）已移到「任务管理」弹窗；要从其他相册挑照片建相册，请用页面上的「新建相册」。</p>
    </div>
  </DialogShell>

  <!-- 删除确认弹窗（复用通用确认框） -->
  <ConfirmDialog
    :visible="!!confirmDelete"
    :message="`确定删除相册「${confirmDelete?.name || ''}」吗？\n仅删除索引，不删除磁盘照片`"
    confirm-text="确定删除"
    show-cancel
    @confirm="doRemove"
    @cancel="confirmDelete = null"
  />
</template>

<script setup>
import { ref, nextTick, watch, onBeforeUnmount } from 'vue'
import axios from 'axios'
import DialogShell from '../base/DialogShell.vue'
import ConfirmDialog from '../base/ConfirmDialog.vue'
import { useNotification } from '../../composables/useNotification.js'
import { pushUndo } from '../../api/undo'
import { warnUndoFailed } from '../../composables/useUndo.js'
import { INVOKE } from '../../electronChannels.js'
import '../../styles/dialog-transition.css'

const props = defineProps({
  visible: { type: Boolean, default: false },
})
// changed：相册增删/排序后通知页面重新拉取相册列表与照片
const emit = defineEmits(['close', 'changed'])

const albums = ref([])
const newName = ref('')
const newPath = ref('')
const busyAdd = ref(false)
const confirmDelete = ref(null)
const albumListRef = ref(null)
let sortableInstance = null

const token = () => localStorage.getItem('token') || ''
const authHeaders = () => ({ Authorization: 'Bearer ' + token() })

async function loadAlbums() {
  const res = await axios.get('/api/album', { headers: authHeaders() })
  albums.value = res.data.data || []
}

// 打开时重新拉一次列表（页面上可能刚加过相册），并初始化拖拽排序
// immediate：首次打开时组件是随 v-if 一起挂载的（visible 直接为 true），不 immediate 会漏掉这次加载
watch(() => props.visible, async (v) => {
  if (!v) { destroySortable(); return }
  confirmDelete.value = null
  try { await loadAlbums() } catch (_) { useNotification().error('读取相册列表失败') }
  nextTick(() => initSortable())
}, { immediate: true })

async function pickFolder() {
  if (!window.electron || typeof window.electron.invoke !== 'function') {
    useNotification().warning('请使用桌面客户端选择文件夹')
    return
  }
  try {
    const result = await window.electron.invoke(INVOKE.SELECT_FOLDER)
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
    useNotification().success('相册已添加，正在后台扫描照片…')
    // 记录「添加相册」撤销：undo 撤销添加（删索引+缩略图），redo 重新添加
    pushUndo({
      key: 'album',
      type: 'album_add',
      label: `添加相册：${newName.value}`,
      payload: {
        album: { id: res.data.id, name: newName.value, folder_path: newPath.value, sort_order: res.data.id, created_at: '', updated_at: '' }
      }
    }).catch(() => warnUndoFailed('添加相册'))
    newName.value = ''
    newPath.value = ''
    await loadAlbums()
    nextTick(() => initSortable())
    emit('changed')
  } catch (err) {
    useNotification().error(err.response?.data?.error || '添加失败')
  } finally { busyAdd.value = false }
}

async function initSortable() {
  destroySortable()
  const el = albumListRef.value
  if (!el) return
  // 渲染后给每个子元素设置 data-id
  const children = el.children
  for (let i = 0; i < children.length; i++) {
    children[i].dataset.id = String(albums.value[i]?.id || '')
  }
  const Sortable = await import('sortablejs').then(m => m.default || m)
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
  const oldOrder = albums.value.map(a => a.id)
  try {
    await axios.put('/api/album/reorder', { ids }, { headers: authHeaders() })
    // 记录相册排序撤销（顺序确有变化才记录）
    if (oldOrder.length && JSON.stringify(oldOrder) !== JSON.stringify(ids)) {
      pushUndo({
        key: 'album',
        type: 'album_order',
        label: '相册排序更新',
        payload: { oldOrder, newOrder: ids }
      }).catch(() => warnUndoFailed('相册排序更新'))
    }
    // 按新顺序重新排列本地数据
    const map = new Map(albums.value.map(a => [a.id, a]))
    albums.value = ids.map(id => map.get(id)).filter(Boolean)
    emit('changed')
  } catch (err) {
    useNotification().error(err.response?.data?.error || '排序更新失败')
    loadAlbums()
  }
}

async function doRemove() {
  const a = confirmDelete.value
  if (!a) return
  confirmDelete.value = null
  try {
    // 删除前抓取相册照片索引，供撤销时还原
    let albumPhotos = []
    try {
      const pr = await axios.get(`/api/album/${a.id}/photos`, { headers: authHeaders() })
      for (const g of (pr.data.data || [])) {
        for (const x of (g.photos || [])) {
          albumPhotos.push({ id: x.id, album_id: a.id, file_path: x.file_path, file_name: x.file_name, file_size: x.file_size, mtime: x.mtime, photo_date: x.photo_date, exif_date: x.exif_date, date_src: x.date_src })
        }
      }
    } catch (_) { /* 抓取失败不阻塞删除 */ }
    await axios.delete(`/api/album/${a.id}`, { headers: authHeaders() })
    // 记录「删除相册」撤销：undo 还原相册+照片索引，redo 再次删除
    pushUndo({
      key: 'album',
      type: 'album_delete',
      label: `删除相册：${a.name}`,
      payload: {
        album: { id: a.id, name: a.name, folder_path: a.folder_path, sort_order: a.sort_order, created_at: a.created_at, updated_at: a.updated_at },
        photos: albumPhotos
      }
    }).catch(() => warnUndoFailed('删除相册'))
    useNotification().success('相册已删除')
    await loadAlbums()
    nextTick(() => initSortable())
    emit('changed')
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
    await window.electron.invoke(INVOKE.OPEN_FOLDER, a.folder_path)
  } catch (_) {
    useNotification().error('打开文件夹失败')
  }
}

onBeforeUnmount(() => {
  destroySortable()
})
</script>
