<template>
  <span class="ai-stream-tail"><span v-if="base">{{ base }}</span><span v-for="seg in segments" :key="seg.id" class="ai-stream-fade">{{ seg.text }}</span></span>
</template>

<script setup>
// 流式正文的“未完成行”：把每次新增的片段单独包一层，让新吐出的文字渐入；
// 旧片段会被合并进 base，避免一条长行产生成百上千个节点。
import { ref, watch } from 'vue'

defineOptions({ name: 'AiStreamTail' })
const props = defineProps({
  text: { type: String, default: '' },
})
const base = ref('')
const segments = ref([])
const prev = ref('')
const seq = ref(0)

watch(
  () => props.text,
  (next) => {
    const text = next || ''
    if (!text) {
      base.value = ''
      segments.value = []
      prev.value = ''
      return
    }
    // 正常流式是追加：只把新增的部分做成动画片段
    if (prev.value && text.startsWith(prev.value)) {
      const added = text.slice(prev.value.length)
      if (added) {
        segments.value.push({ id: ++seq.value, text: added })
        compact()
      }
    } else if (text !== prev.value) {
      // 换行、重试、内容被重置：整段重新开始，旧状态清空
      base.value = ''
      segments.value = [{ id: ++seq.value, text }]
    }
    prev.value = text
  },
  { immediate: true }
)

// 超过 24 个片段时把最早的合并成纯文本，只保留最近 12 个动画片段（24 是触发压缩的阈值）
function compact() {
  if (segments.value.length <= 24) return
  const moved = segments.value.splice(0, segments.value.length - 12)
  base.value += moved.map((s) => s.text).join('')
}
</script>

<style scoped>
.ai-stream-fade {
  animation: ai-stream-in 240ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

@keyframes ai-stream-in {
  from {
    opacity: 0;
    filter: blur(1.5px);
  }
  to {
    opacity: 1;
    filter: blur(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-stream-fade { animation: none; }
}
</style>
