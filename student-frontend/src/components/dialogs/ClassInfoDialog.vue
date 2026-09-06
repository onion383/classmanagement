<template>
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001] pointer-events-auto" @click.self="$emit('cancel')">
    <div class="bg-surface p-5 rounded-xl w-[440px] max-w-full shadow-lg dialog-card">
      <h3 class="text-lg font-bold mb-4 text-text">班级信息设置</h3>

      <div class="space-y-3 mb-5">
        <div>
          <label class="block text-sm text-text-secondary mb-1">班级名称</label>
          <input v-model="form.name" type="text" placeholder="如：初三七班" maxlength="50"
            class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">班级口号</label>
          <textarea v-model="form.motto" rows="2" placeholder="填写班级口号"
            class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary resize-y" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">班风</label>
          <textarea v-model="form.mottoStyle" rows="2" placeholder="填写班风"
            class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary resize-y" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">学风</label>
          <textarea v-model="form.xuefeng" rows="2" placeholder="填写学风"
            class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary resize-y" />
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button type="button" @click="$emit('cancel')" class="px-4 py-2 rounded-lg bg-text-muted text-text-inverse hover:bg-text-secondary">取消</button>
        <button type="button" @click="submit" class="px-4 py-2 rounded-lg bg-primary text-text-inverse hover:bg-primary-hover">保存</button>
      </div>
    </div>
  </div>
  </Transition>
</template>

<script>
import '../../styles/dialog-transition.css'

export default {
  name: 'ClassInfoDialog',
  props: {
    visible: { type: Boolean, default: false },
    classData: { type: Object, default: () => ({}) }
  },
  emits: ['confirm', 'cancel'],
  data() {
    return { form: { name: '', motto: '', mottoStyle: '', xuefeng: '' } }
  },
  watch: {
    visible(v) {
      if (v) {
        this.form = {
          name: this.classData.name || '',
          motto: this.classData.motto || '',
          mottoStyle: this.classData.mottoStyle || '',
          xuefeng: this.classData.xuefeng || ''
        }
      }
    }
  },
  methods: {
    submit() {
      this.$emit('confirm', { ...this.form })
    }
  }
}
</script>