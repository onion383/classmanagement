<template>
  <span class="ai-stream-tail"><span v-if="base">{{ base }}</span><span v-for="seg in segments" :key="seg.id" class="ai-stream-fade">{{ seg.text }}</span></span>
</template>

<script>
// 流式正文的“未完成行”：把每次新增的片段单独包一层，让新吐出的文字渐入；
// 旧片段会被合并进 base，避免一条长行产生成百上千个节点。
export default {
  name: 'AiStreamTail',
  props: {
    text: { type: String, default: '' },
  },
  data() {
    return {
      base: '',
      segments: [],
      prev: '',
      seq: 0,
    }
  },
  watch: {
    text: {
      immediate: true,
      handler(next) {
        const text = next || ''
        if (!text) {
          this.base = ''
          this.segments = []
          this.prev = ''
          return
        }
        // 正常流式是追加：只把新增的部分做成动画片段
        if (this.prev && text.startsWith(this.prev)) {
          const added = text.slice(this.prev.length)
          if (added) {
            this.segments.push({ id: ++this.seq, text: added })
            this.compact()
          }
        } else if (text !== this.prev) {
          // 换行、重试、内容被重置：整段重新开始，旧状态清空
          this.base = ''
          this.segments = [{ id: ++this.seq, text }]
        }
        this.prev = text
      },
    },
  },
  methods: {
    // 只保留最近 12 个动画片段，更早的合并成纯文本
    compact() {
      if (this.segments.length <= 24) return
      const moved = this.segments.splice(0, this.segments.length - 12)
      this.base += moved.map((s) => s.text).join('')
    },
  },
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
