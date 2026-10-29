<template>
  <DialogShell :visible="visible" :z-index="70" overlay-class="bg-black/30">
      <div class="bg-surface rounded-lg p-5 shadow-card dialog-card" style="width: 380px; max-width: 90vw;">
        <h4 class="text-base font-bold mb-3">发现有新同学</h4>
        <p class="text-sm text-text-secondary mb-3">表格里有{{ names.length }}个名字不在班级学生信息表中，是否参与{{ action }}？</p>
        <div class="flex flex-wrap gap-1 mb-4">
          <span v-for="n in names" :key="n" class="px-2 py-0.5 rounded bg-info/15 text-info text-sm">{{ n }}</span>
        </div>
        <div class="flex justify-end gap-2">
          <button @click="$emit('not')" class="bg-surface-hover border border-border px-4 py-2 rounded text-text">不参与</button>
          <button @click="$emit('participate')" class="bg-primary text-text-inverse px-4 py-2 rounded border-none">参与</button>
        </div>
      </div>
  </DialogShell>
</template>

<script setup>
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'

defineOptions({ name: 'NewComerConfirm' })
defineProps({
  visible: Boolean,
  names: { type: Array, default: () => [] },
  action: { type: String, default: '排表' }
})
defineEmits(['participate', 'not'])
</script>