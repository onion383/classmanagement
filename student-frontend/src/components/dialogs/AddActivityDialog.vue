<template>
  <DialogShell :visible="visible" :z-index="10001" @overlay="$emit('cancel')">
    <div class="bg-surface p-5 rounded-xl w-[520px] max-w-full shadow-lg dialog-card">
      <h3 class="text-lg font-bold mb-4 text-text">{{ title }}</h3>

      <!-- 时间 + 主题 -->
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-sm text-text-secondary mb-1">时间 <span class="text-danger">*</span></label>
          <input v-model="form.time" type="datetime-local" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">主题 <span class="text-danger">*</span></label>
          <input v-model="form.theme" type="text" placeholder="如：主题班会" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
        </div>
      </div>

      <!-- 地点 -->
      <div class="mb-3">
        <label class="block text-sm text-text-secondary mb-1">地点</label>
        <input v-model="form.location" type="text" placeholder="如：教室 / 操场 / 多媒体室" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
      </div>

      <!-- 参与人员 -->
      <div class="mb-3">
        <label class="block text-sm text-text-secondary mb-1">参与人员</label>
        <input v-model="form.participants" type="text" placeholder="如：全班同学 / 张三、李四" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
      </div>

      <!-- 简介 -->
      <div class="mb-4">
        <label class="block text-sm text-text-secondary mb-1">简介</label>
        <textarea v-model="form.summary" rows="3" placeholder="活动内容简介" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary"></textarea>
      </div>

      <div class="flex justify-end gap-2">
        <button v-if="isEdit" type="button" @click="$emit('delete', editingRecord)" class="mr-auto px-4 py-2 rounded-lg bg-danger text-text-inverse hover:bg-danger-hover transition-theme">删除</button>
        <button type="button" @click="$emit('cancel')" class="px-4 py-2 rounded-lg bg-text-muted text-text-inverse hover:bg-text-secondary transition-theme">取消</button>
        <button type="button" @click="submit" class="px-4 py-2 rounded-lg bg-primary text-text-inverse hover:bg-primary-hover transition-theme">确认保存</button>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'
import { useNotification } from '../../composables/useNotification.js'
import { formatDateTimeLocal } from '../../utils/dateTime.js'

defineOptions({ name: 'AddActivityDialog' })
const props = defineProps({
  visible: { type: Boolean, default: false },
  editingRecord: { type: Object, default: null }
})
const emit = defineEmits(['cancel', 'delete', 'update', 'confirm'])

const form = ref({ time: formatDateTimeLocal(new Date()), theme: '', location: '', participants: '', summary: '' })

const isEdit = computed(() => !!(props.editingRecord && props.editingRecord.id != null))
const title = computed(() => isEdit.value ? '编辑活动' : '新增活动')

watch(() => props.visible, (v) => {
  if (v) {
    if (isEdit.value) presetFromRecord(props.editingRecord)
    else reset()
  }
})

function reset() {
  form.value = { time: formatDateTimeLocal(new Date()), theme: '', location: '', participants: '', summary: '' }
}
function presetFromRecord(r) {
  let time = ''
  if (r.时间) {
    const d = r.时间.includes('T') ? new Date(r.时间) : new Date(r.时间.replace(' ', 'T'))
    if (!isNaN(d.getTime())) time = formatDateTimeLocal(d)
  }
  form.value = {
    time,
    theme: r.主题 || '',
    location: r.地点 || '',
    participants: r.参与人员 || '',
    summary: r.简介 || ''
  }
}
function submit() {
  if (!form.value.time) { useNotification().warning('请选择时间'); return }
  if (!form.value.theme.trim()) { useNotification().warning('请填写主题'); return }
  const payload = {
    时间: form.value.time.replace('T', ' '),
    主题: form.value.theme.trim(),
    地点: form.value.location.trim(),
    参与人员: form.value.participants.trim(),
    简介: form.value.summary.trim()
  }
  if (isEdit.value) {
    emit('update', { id: props.editingRecord.id, ...payload })
  } else {
    emit('confirm', payload)
  }
}
</script>