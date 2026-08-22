<template>
  <div class="screenshot">
    <div class="header">📷 一键截屏</div>
    <div class="content">
      <div class="result-area">
        <div class="icon-wrapper">
          <div v-if="capturing" class="spinner"></div>
          <svg v-else-if="result" class="status-icon flat-check" viewBox="0 0 24 24" width="36" height="36">
            <path fill="none" stroke="var(--color-primary, #22c55e)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M4 12.5l5 5L20 6.5" />
          </svg>
          <span v-else class="status-icon">{{ statusIcon }}</span>
        </div>
        <div class="status-text">{{ statusText }}</div>
        <div class="file-path" :title="filePath">{{ filePath }}</div>
      </div>
    </div>
    <div class="actions">
      <button class="btn-primary" :disabled="capturing" @click="confirm">完成</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const emit = defineEmits(['close'])

const capturing = ref(true)
const result = ref(null)
const error = ref('')
let autoCloseTimer = null

const statusIcon = computed(() => {
  if (error.value) return '❌'
  return '⏳'
})

const statusText = computed(() => {
  if (error.value) return error.value
  if (result.value) return '截屏已保存'
  return '正在截屏...'
})

const filePath = computed(() => {
  if (result.value) return result.value.filePath
  return '保存至：图片/screenshots/'
})

function truncatePath(fullPath) {
  const parts = fullPath.split(/[\\/]/)
  if (parts.length <= 3) return fullPath
  return '...' + parts.slice(-2).join('/')
}

async function capture() {
  try {
    // 获取自定义保存路径
    let saveDir = ''
    try {
      const settingsRes = await axios.get('/api/widget-settings')
      if (settingsRes.data.success) {
        saveDir = settingsRes.data.data.screenshotSavePath
      }
    } catch (_) { /* 读取设置失败则使用默认路径 */ }

    // 只保存文件，不回传整屏 base64（本组件只用 filePath，省掉一大块内存）
    const res = await window.electron.invoke('screenshot-capture', { hideWidget: false, saveDir, withDataUrl: false })
    if (res.success) {
      result.value = res
    } else {
      error.value = '截屏失败，请重试'
    }
  } catch (err) {
    error.value = err.message || '截屏失败'
  } finally {
    capturing.value = false
  }

  if (result.value) {
    autoCloseTimer = setTimeout(() => {
      emit('close')
    }, 3000)
  }
}

function confirm() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
  emit('close')
}

onMounted(capture)

onUnmounted(() => {
  if (autoCloseTimer) clearTimeout(autoCloseTimer)
})
</script>

<style scoped>
.screenshot {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  overflow: hidden;
}

.header {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text, #111827);
  margin-bottom: 10px;
}

.content {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
  width: 100%;
}

.result-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.icon-wrapper {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--color-border, #e5e7eb);
  border-top-color: var(--color-primary, #22c55e);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.status-icon {
  font-size: 36px;
  line-height: 44px;
}

.status-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text, #111827);
  height: 20px;
  line-height: 20px;
}

.file-path {
  font-size: 11px;
  color: var(--color-text-muted, #9ca3af);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--color-bg, #f9fafb);
  padding: 4px 8px;
  border-radius: 6px;
  height: 24px;
  line-height: 16px;
  box-sizing: border-box;
}

.actions {
  display: flex;
  justify-content: center;
}

.btn-primary {
  padding: 6px 20px;
  border-radius: 8px;
  border: none;
  background: var(--color-primary, #22c55e);
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:disabled {
  background: var(--color-text-muted, #9ca3af);
  cursor: not-allowed;
  opacity: 0.7;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}
</style>