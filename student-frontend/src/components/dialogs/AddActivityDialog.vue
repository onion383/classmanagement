<template>
  <Teleport to="body">
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001] pointer-events-auto" @click.self="$emit('cancel')">
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
        <button v-if="isEdit" type="button" @click="$emit('delete', editingRecord)" class="mr-auto px-4 py-2 rounded-lg bg-danger text-text-inverse hover:bg-danger-hover">删除</button>
        <button type="button" @click="$emit('cancel')" class="px-4 py-2 rounded-lg bg-text-muted text-text-inverse hover:bg-text-secondary">取消</button>
        <button type="button" @click="submit" class="px-4 py-2 rounded-lg bg-primary text-text-inverse hover:bg-primary-hover">确认保存</button>
      </div>
    </div>
  </div>
  </Transition>
  </Teleport>
</template>

<script>
import '../../styles/dialog-transition.css'
import { useNotification } from '../../composables/useNotification.js'

function fmtDateTime(dt) {
  const p = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`
}

export default {
  name: 'AddActivityDialog',
  props: {
    visible: { type: Boolean, default: false },
    editingRecord: { type: Object, default: null }
  },
  data() {
    return {
      form: { time: fmtDateTime(new Date()), theme: '', location: '', participants: '', summary: '' }
    }
  },
  computed: {
    isEdit() { return !!(this.editingRecord && this.editingRecord.id != null) },
    title() { return this.isEdit ? '编辑活动' : '新增活动' }
  },
  watch: {
    visible(v) {
      if (v) {
        if (this.isEdit) this.presetFromRecord(this.editingRecord)
        else this.reset()
      }
    }
  },
  methods: {
    reset() {
      this.form = { time: fmtDateTime(new Date()), theme: '', location: '', participants: '', summary: '' }
    },
    presetFromRecord(r) {
      let time = ''
      if (r.时间) {
        const d = r.时间.includes('T') ? new Date(r.时间) : new Date(r.时间.replace(' ', 'T'))
        if (!isNaN(d.getTime())) time = fmtDateTime(d)
      }
      this.form = {
        time,
        theme: r.主题 || '',
        location: r.地点 || '',
        participants: r.参与人员 || '',
        summary: r.简介 || ''
      }
    },
    submit() {
      if (!this.form.time) { useNotification().warning('请选择时间'); return }
      if (!this.form.theme.trim()) { useNotification().warning('请填写主题'); return }
      const payload = {
        时间: this.form.time.replace('T', ' '),
        主题: this.form.theme.trim(),
        地点: this.form.location.trim(),
        参与人员: this.form.participants.trim(),
        简介: this.form.summary.trim()
      }
      if (this.isEdit) {
        this.$emit('update', { id: this.editingRecord.id, ...payload })
      } else {
        this.$emit('confirm', payload)
      }
    }
  }
}
</script>