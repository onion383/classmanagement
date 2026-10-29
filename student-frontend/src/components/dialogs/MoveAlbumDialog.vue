<template>
  <DialogShell :visible="visible" :z-index="10003" @overlay="$emit('close')">
    <div class="bg-surface rounded-xl p-6 w-[540px] max-w-full flex flex-col border border-border shadow-card dialog-card">
      <div class="flex items-center justify-between mb-4 flex-shrink-0">
        <h3 class="text-lg font-bold text-text">移动到其他相册</h3>
        <button @click="$emit('close')" class="dlg-close">✕</button>
      </div>

      <p class="text-sm text-text-secondary mb-4">
        已选择 <span class="text-text font-semibold tabular-nums">{{ photoIds.length }}</span> 张照片。
      </p>

      <!-- 选择移动到的相册：只列虚拟相册，且排除当前所在相册 -->
      <label class="block text-sm text-text-secondary mb-1">选择移动到的相册</label>
      <AppSelect v-model="targetId" :options="options" class="w-full mb-2" placeholder="选择相册" />
      <p v-if="!options.length" class="text-xs text-warning mb-2">
        没有可用的目标相册：只能用「其他相册」创建的虚拟相册承接照片，请先用「新建相册 → 其他相册」新建一个。
      </p>

      <ul class="text-xs text-text-muted leading-relaxed mb-4 space-y-1">
        <li>· 文件夹相册与磁盘文件夹一一对应，数量始终等于文件夹里的文件数，不支持移入照片。</li>
        <li>· 来源是虚拟相册时索引会从来源移走（来源减少、目标增加）；来源是文件夹相册时来源数量不变。</li>
        <li>· 全程只更新照片索引，不会移动、修改或删除磁盘上的任何文件。</li>
      </ul>

      <div class="flex justify-end gap-2">
        <button @click="$emit('close')" class="px-4 py-2 rounded bg-surface-hover text-text border border-border transition-theme">取消</button>
        <button @click="submit" :disabled="busy || !targetId" class="px-4 py-2 rounded bg-primary text-text-inverse hover:bg-primary-hover transition-theme disabled:opacity-50">
          {{ busy ? '移动中…' : '确定' }}
        </button>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import { getToken } from '../../utils/authStorage.js'
import { reportError } from '../../utils/reportError.js'
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import DialogShell from '../base/DialogShell.vue'
import AppSelect from '../base/AppSelect.vue'
import { useNotification } from '../../composables/useNotification.js'
import { pushUndo } from '../../api/undo'
import { warnUndoFailed } from '../../composables/useUndo.js'
import '../../styles/dialog-transition.css'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 已有相册（目标下拉用）
  albums: { type: Array, default: () => [] },
  // 当前所在相册：不列进目标（不可能移动到自己）
  currentAlbumId: { type: [Number, String, null], default: null },
  // 选中的照片索引 id
  photoIds: { type: Array, default: () => [] },
})
// moved：移动完成，把后端返回的统计交给页面刷新
const emit = defineEmits(['close', 'moved'])

const targetId = ref(null)
const busy = ref(false)

const token = () => getToken() || ''
const authHeaders = () => ({ Authorization: 'Bearer ' + token() })

// 目标只能是虚拟相册：文件夹相册受磁盘目录内容约束，不能塞进别的相册的索引
const options = computed(() =>
  props.albums
    .filter(a => a.kind === 'virtual' && a.id !== props.currentAlbumId)
    .map(a => ({ value: a.id, label: `${a.name}（${a.photo_count || 0}）` }))
)

watch(() => props.visible, (v) => {
  if (!v) return
  targetId.value = null
  busy.value = false
}, { immediate: true })

async function submit() {
  if (!targetId.value) { useNotification().warning('请选择要移动到的相册'); return }
  if (!props.photoIds.length) { useNotification().warning('请先选择要移动的照片'); return }
  busy.value = true
  try {
    const res = await axios.post('/api/album/photos/move', {
      photo_ids: props.photoIds,
      target_album_id: targetId.value,
    }, { headers: authHeaders() })
    const data = res.data || {}
    // 记录「移动照片索引」撤销：undo 把索引搬回来源、redo 再搬过去（只动索引，不动文件）
    pushUndo({
      key: 'album',
      type: 'album_photo_move',
      label: `移动照片到「${data.target_album_name || ''}」`,
      payload: {
        target_album_id: data.target_album_id,
        target_album_name: data.target_album_name || '',
        records: data.photos || [],
      },
    }).catch(() => warnUndoFailed('移动照片'))
    useNotification().success(data.message || '已移动')
    emit('moved', data)
  } catch (err) {
    reportError(err, { action: '移动' })
  } finally {
    busy.value = false
  }
}
</script>
