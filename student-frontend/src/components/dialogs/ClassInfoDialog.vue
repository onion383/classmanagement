<template>
  <DialogShell :visible="visible" :z-index="10001" @overlay="$emit('cancel')">
    <div class="bg-surface p-5 rounded-xl w-[440px] max-w-full shadow-lg dialog-card" @keydown="onKeydown">
      <h3 class="text-lg font-bold mb-4 text-text">班级信息设置</h3>

      <div class="space-y-3 mb-5">
        <div>
          <label class="block text-sm text-text-secondary mb-1">班级名称</label>
          <input ref="nameInput" v-model="form.name" type="text" placeholder="如：初三七班" maxlength="50"
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
        <button type="button" @click="$emit('cancel')" class="px-4 py-2 rounded-lg glass-cancel">取消</button>
        <button type="button" @click="submit" class="px-4 py-2 rounded-lg bg-primary text-text-inverse hover:bg-primary-hover transition-theme">保存</button>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import '../../styles/dialog-transition.css'
import { ref, watch, nextTick } from 'vue'
import DialogShell from '../base/DialogShell.vue'

defineOptions({ name: 'ClassInfoDialog' })

const props = defineProps({
  visible: { type: Boolean, default: false },
  classData: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['confirm', 'cancel'])

const form = ref({ name: '', motto: '', mottoStyle: '', xuefeng: '' })
const nameInput = ref(null)

watch(() => props.visible, (v) => {
  if (v) {
    form.value = {
      name: props.classData.name || '',
      motto: props.classData.motto || '',
      mottoStyle: props.classData.mottoStyle || '',
      xuefeng: props.classData.xuefeng || ''
    }
    // 打开后聚焦「班级名称」，便于直接回车保存
    nextTick(() => { nameInput.value?.focus() })
  }
})

// 回车确定：textarea 内回车用于换行、输入法合成态回车不上屏，均不触发保存
function onKeydown(e) {
  if (e.key !== 'Enter' || e.isComposing) return
  if (e.target && e.target.tagName === 'TEXTAREA') return
  e.preventDefault()
  submit()
}
function submit() {
  emit('confirm', { ...form.value })
}
</script>

<style scoped>
/* 取消按钮毛玻璃适配：半透明白遮罩 + 背景模糊 + 无边框 */
.glass-cancel {
  border: none !important;
  border-width: 0 !important;
  box-shadow: none !important;
  background-color: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(12px) saturate(1.3);
  color: var(--color-text);
  transition: background-color 0.15s ease;
}
.glass-cancel::before {
  display: none !important;
}
.glass-cancel:hover {
  background-color: rgba(255, 255, 255, 0.56);
}
</style>