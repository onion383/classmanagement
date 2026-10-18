<template>
  <!-- Markdown 文件编辑窗口：文件名（输入框）+ 内容（大输入框），底部 取消 / 保存 -->
  <Teleport to="body">
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="cancel">
    <div class="bg-surface rounded-lg border border-border shadow-card dialog-card md-card flex flex-col p-5">
      <h3 class="text-lg font-bold mb-4">{{ isNew ? '新增 Markdown 文件' : '编辑 Markdown 文件' }}</h3>

      <label class="block mb-1.5 text-sm font-semibold">文件名</label>
      <input
        v-model="name"
        :disabled="nameDisabled"
        class="md-input border border-border bg-surface text-text p-2 w-full !rounded-[12px] disabled:opacity-60"
        placeholder="输入文件名（无需 .md 后缀）"
      />
      <p v-if="nameDisabled" class="text-xs text-text-muted mt-1">此文件的名称固定，不可修改</p>

      <label class="block mt-4 mb-1.5 text-sm font-semibold">内容</label>
      <textarea
        v-model="content"
        class="md-textarea flex-1 border border-border bg-surface text-text p-3 w-full !rounded-[12px] font-mono text-sm leading-relaxed"
        placeholder="在此编写 Markdown 内容…"
      ></textarea>

      <div class="text-right mt-4">
        <button @click="cancel" class="bg-surface-hover text-text border border-border px-4 py-1.5 rounded-lg mr-2 cursor-pointer">取消</button>
        <button @click="save" :disabled="!name.trim()" class="bg-info text-text-inverse border-none px-4 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">保存</button>
      </div>
    </div>
  </div>
  </Transition>
  </Teleport>
</template>

<script>
import '../../styles/dialog-transition.css'

export default {
  name: 'MarkdownEditDialog',
  props: {
    visible: { type: Boolean, default: false },
    // isNew=true 为「新增文件」；否则为编辑既有文件（原文件名 originalName 用于后端重命名）
    isNew: { type: Boolean, default: false },
    // 文件名是否只读（如「AI 记忆文件」名称固定，不可改名）
    nameDisabled: { type: Boolean, default: false },
    originalName: { type: String, default: '' },
    initialName: { type: String, default: '' },
    initialContent: { type: String, default: '' },
  },
  emits: ['update:visible', 'save'],
  data() {
    return { name: '', content: '' }
  },
  watch: {
    visible: {
      immediate: true,
      handler(v) {
        if (v) {
          this.name = this.initialName || ''
          this.content = this.initialContent || ''
        }
      },
    },
  },
  methods: {
    cancel() { this.$emit('update:visible', false) },
    save() {
      const name = this.name.trim()
      if (!name) return
      this.$emit('save', { original: this.originalName, name, content: this.content })
    },
  },
}
</script>

<style scoped>
.md-card {
  width: 760px;
  max-width: 92vw;
  height: 660px;
  max-height: 90vh;
}
.md-textarea {
  resize: none;
  min-height: 0;
}
.md-input,
.md-textarea {
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.md-input:focus,
.md-textarea:focus {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.28) !important;
  outline: none;
}
</style>
