<template>
  <DialogShell :visible="visible" :z-index="10003" @overlay="$emit('close')">
    <div class="bg-surface rounded-xl p-6 w-[560px] max-w-full flex flex-col border border-border shadow-card dialog-card">
      <div class="flex items-center justify-between mb-4 flex-shrink-0">
        <h3 class="text-lg font-bold text-text">新建相册</h3>
        <button @click="$emit('close')" class="dlg-close">✕</button>
      </div>

      <!-- 从哪里新建（下拉选择，不用分段切换组件） -->
      <div class="flex items-center gap-3 mb-4 flex-shrink-0">
        <span class="text-sm text-text-secondary flex-shrink-0">从那里新建相册</span>
        <AppSelect v-model="kind" :options="KIND_OPTIONS" class="w-36" />
      </div>

      <!-- 相册名称 -->
      <label class="block text-sm text-text-secondary mb-1">相册名称</label>
      <input
        v-model="name"
        :placeholder="kind === 'folder' ? '默认取文件夹名' : '如：文艺晚会精选'"
        class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4"
      />

      <!-- 文件夹相册：选一个文件夹（递归扫描，含所有子文件夹） -->
      <template v-if="kind === 'folder'">
        <label class="block text-sm text-text-secondary mb-1">选择文件夹路径</label>
        <div class="flex gap-2 mb-2">
          <input v-model="folderPath" placeholder="点击右侧按钮选择文件夹" readonly @click="pickFolder" class="border border-border bg-surface text-text px-3 py-2 rounded flex-1 min-w-0" />
          <button @click="pickFolder" class="bg-surface-hover hover:bg-surface-hover text-text px-4 py-2 rounded transition-theme whitespace-nowrap border border-border">选择文件夹</button>
        </div>
        <p class="text-xs text-text-muted mb-4">递归读取该文件夹及其所有子文件夹里的照片/视频。系统也不会移动或修改文件夹里的任何文件。</p>
      </template>

      <!-- 虚拟相册：从已有相册里挑照片，只复制索引，不动磁盘文件 -->
      <template v-else>
        <label class="block text-sm text-text-secondary mb-1">选择相册照片</label>
        <div class="flex gap-2 mb-2">
          <AppSelect v-model="sourceAlbumId" :options="albumOptions" class="flex-1 min-w-0" placeholder="选择相册" />
          <button
            @click="openPicker"
            :disabled="!sourceAlbumId"
            class="bg-surface-hover hover:bg-surface-hover text-text px-4 py-2 rounded transition-theme whitespace-nowrap border border-border disabled:opacity-50"
          >选择照片</button>
        </div>
        <p class="text-xs text-text-muted mb-4">
          已选择 <span class="text-text font-semibold tabular-nums">{{ picked.length }}</span> 张。
          只复制照片索引、不改动任何磁盘文件；如果来源本身是虚拟相册，这些照片会从来源相册移走（来源是文件夹相册时不会减少）。
        </p>
      </template>

      <div class="flex justify-end gap-2 mt-2">
        <button @click="$emit('close')" class="px-4 py-2 rounded bg-surface-hover text-text border border-border transition-theme">取消</button>
        <button @click="submit" :disabled="busy" class="px-4 py-2 rounded bg-primary text-text-inverse hover:bg-primary-hover transition-theme disabled:opacity-50">
          {{ busy ? '创建中…' : '创建相册' }}
        </button>
      </div>
    </div>
  </DialogShell>

  <!-- 选照片弹窗 -->
  <AlbumPhotoPickerDialog
    v-if="pickerMounted"
    :visible="pickerVisible"
    :album-id="sourceAlbumId"
    :album-name="sourceAlbumName"
    :initial-ids="picked.map(p => p.id)"
    @close="pickerVisible = false"
    @confirm="onPicked"
  />
</template>

<script setup>
import { reportError } from '../../utils/reportError.js'
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import DialogShell from '../base/DialogShell.vue'
import AppSelect from '../base/AppSelect.vue'
import AlbumPhotoPickerDialog from './AlbumPhotoPickerDialog.vue'
import { useNotification } from '../../composables/useNotification.js'
import { pushUndo } from '../../api/undo'
import { warnUndoFailed } from '../../composables/useUndo.js'
import { INVOKE } from '../../electronChannels.js'
import '../../styles/dialog-transition.css'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 已有相册（虚拟相册的来源下拉用）
  albums: { type: Array, default: () => [] },
})
// created：创建成功，把新相册 id 交给页面刷新
const emit = defineEmits(['close', 'created'])

const KIND_OPTIONS = [
  { value: 'folder', label: '文件夹' },
  { value: 'virtual', label: '其他相册' },
]

const kind = ref('folder')
const name = ref('')
const folderPath = ref('')
const sourceAlbumId = ref(null)
const picked = ref([])
const busy = ref(false)

const pickerVisible = ref(false)
const pickerMounted = ref(false)

const token = () => localStorage.getItem('token') || ''
const authHeaders = () => ({ Authorization: 'Bearer ' + token() })

const albumOptions = computed(() => props.albums.map(a => ({ value: a.id, label: a.name })))
const sourceAlbumName = computed(() => props.albums.find(a => a.id === sourceAlbumId.value)?.name || '')

watch(() => props.visible, (v) => {
  if (!v) return
  pickerVisible.value = false
  kind.value = 'folder'
  name.value = ''
  folderPath.value = ''
  sourceAlbumId.value = null
  picked.value = []
}, { immediate: true })

// 切换来源相册时清空已选照片（不同相册的照片 id 不能混）
watch(sourceAlbumId, (v, old) => {
  if (old !== null && v !== old) picked.value = []
})

async function pickFolder() {
  if (!window.electron || typeof window.electron.invoke !== 'function') {
    useNotification().warning('请使用桌面客户端选择文件夹')
    return
  }
  try {
    const result = await window.electron.invoke(INVOKE.SELECT_FOLDER)
    if (result && result.filePaths && result.filePaths.length > 0) {
      folderPath.value = result.filePaths[0]
      // 相册名缺省取文件夹名（加「相册」后缀，和任务管理里的行标题一致）
      if (!name.value) {
        const base = result.filePaths[0].split(/[\\/]/).filter(Boolean).pop() || ''
        name.value = base ? (/相册$/.test(base) ? base : base + '相册') : ''
      }
    }
  } catch (_) {
    useNotification().error('选择文件夹失败')
  }
}

function openPicker() {
  if (!sourceAlbumId.value) { useNotification().warning('请先选择一个相册'); return }
  pickerMounted.value = true
  pickerVisible.value = true
}

function onPicked(photos) {
  picked.value = photos || []
  pickerVisible.value = false
}

async function submit() {
  if (kind.value === 'folder') {
    if (!folderPath.value) { useNotification().warning('请选择文件夹路径'); return }
    const base = folderPath.value.split(/[\\/]/).filter(Boolean).pop() || ''
    const finalName = (name.value || '').trim() || (/相册$/.test(base) ? base : base + '相册')
    busy.value = true
    try {
      const res = await axios.post('/api/album', { kind: 'folder', name: finalName, folder_path: folderPath.value }, { headers: authHeaders() })
      // 记录「添加相册」撤销：undo 删除索引与缩略图，redo 重新加入文件夹并重扫
      // （虚拟相册不记录：它的照片来自别的相册，重做无法还原索引，记了反而误导）
      pushUndo({
        key: 'album',
        type: 'album_add',
        label: `添加相册：${finalName}`,
        payload: {
          album: { id: res.data.id, name: finalName, folder_path: folderPath.value, kind: 'folder', sort_order: res.data.id, created_at: '', updated_at: '' }
        }
      }).catch(() => warnUndoFailed('添加相册'))
      useNotification().success('相册已创建，正在后台扫描照片索引…')
      emit('created', res.data.id)
      emit('close')
    } catch (err) {
      reportError(err, { action: '创建' })
    } finally { busy.value = false }
    return
  }

  // 虚拟相册
  if (!picked.value.length) { useNotification().warning('请先选择照片'); return }
  if (!name.value.trim()) { useNotification().warning('请输入相册名称'); return }
  busy.value = true
  try {
    const res = await axios.post('/api/album', {
      kind: 'virtual',
      name: name.value.trim(),
      photos: picked.value.map(p => ({ photo_id: p.id })),
    }, { headers: authHeaders() })
    useNotification().success('虚拟相册已创建')
    emit('created', res.data.id)
    emit('close')
  } catch (err) {
    reportError(err, { action: '创建' })
  } finally { busy.value = false }
}
</script>
