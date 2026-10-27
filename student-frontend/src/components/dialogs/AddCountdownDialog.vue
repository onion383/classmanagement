<template>
  <DialogShell :visible="visible" :z-index="10001" @overlay="$emit('cancel')">
    <div class="bg-surface p-5 rounded-xl w-[520px] max-w-full shadow-lg dialog-card">
      <h3 class="text-lg font-bold mb-4 text-text">{{ title }}</h3>

      <!-- 名称 + 截止日 -->
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-sm text-text-secondary mb-1">名称 <span class="text-danger">*</span></label>
          <input v-model="form.name" type="text" placeholder="如：期末考试 / 放假 / 高考" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">截止日 <span class="text-danger">*</span></label>
          <input v-model="form.deadline" type="date" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
        </div>
      </div>

      <!-- 包含这一天 -->
      <div class="mb-3">
        <label class="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" v-model="form.includeDay" />
          包含截止日当天（勾选后当天视为剩余 1 天）
        </label>
      </div>

      <div class="flex justify-end gap-2">
        <button v-if="isEdit" type="button" @click="$emit('delete', editingRecord)" class="mr-auto px-4 py-2 rounded-lg bg-danger text-text-inverse hover:bg-danger-hover transition-theme">删除</button>
        <button type="button" @click="$emit('cancel')" class="px-4 py-2 rounded-lg bg-text-muted text-text-inverse hover:bg-text-secondary transition-theme">取消</button>
        <button type="button" @click="submit" class="px-4 py-2 rounded-lg bg-primary text-text-inverse hover:bg-primary-hover transition-theme">确认保存</button>
      </div>
    </div>
  </DialogShell>
</template>

<script>
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'
import { useNotification } from '../../composables/useNotification.js'
import { formatDate } from '../../utils/dateTime.js'

export default {
  name: 'AddCountdownDialog',
  components: { DialogShell },
  props: {
    visible: { type: Boolean, default: false },
    editingRecord: { type: Object, default: null }
  },
  data() {
    return {
      form: { name: '', deadline: formatDate(new Date()), includeDay: false }
    }
  },
  computed: {
    isEdit() { return !!(this.editingRecord && this.editingRecord.id != null) },
    title() { return this.isEdit ? '编辑倒计时' : '添加倒计时' }
  },
  watch: {
    visible(v) {
      if (v) this.form = this.isEdit ? this.presetFromRecord(this.editingRecord) : this.reset()
    }
  },
  methods: {
    reset() {
      return { name: '', deadline: formatDate(new Date()), includeDay: false }
    },
    presetFromRecord(r) {
      return {
        name: r.名称 || '',
        deadline: r.截止日 || '',
        includeDay: !!r.包含这一天
      }
    },
    submit() {
      if (!this.form.name.trim()) { useNotification().warning('请填写名称'); return }
      if (!this.form.deadline) { useNotification().warning('请选择截止日'); return }
      const payload = {
        名称: this.form.name.trim(),
        截止日: this.form.deadline,
        包含这一天: this.form.includeDay ? 1 : 0
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