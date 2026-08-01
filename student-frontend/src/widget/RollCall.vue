<template>
  <div class="roll-call">
    <div class="header">🎲 点名器</div>
    <div class="content">
      <div v-if="error" class="error-area">
        <div class="error-msg">{{ error }}</div>
        <button class="btn-primary" @click="$emit('close')">关闭</button>
      </div>
      <template v-else>
        <div v-if="loading" class="hint">{{ hintText }}</div>
        <div v-else class="result-card">
          <div class="avatar">👤</div>
          <div class="info">
            <div class="row">
              <span class="label">学号：</span>
              <span class="value" :class="{ rolling: isRolling }">{{ truncateStart(currentStudent.学号, 6) }}</span>
            </div>
            <div class="row">
              <span class="label">姓名：</span>
              <span class="value" :class="{ rolling: isRolling }">{{ truncateStart(currentStudent.姓名, 4) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
    <div class="actions">
      <button class="btn-primary" :disabled="isRolling || loading" @click="confirm">完成</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const emit = defineEmits(['close'])

function truncateStart(str, maxLen) {
  const s = String(str || '')
  if (s.length <= maxLen) return s
  return '...' + s.slice(-maxLen)
}

const students = ref([])
const isRolling = ref(false)
const result = ref(null)
const error = ref('')
const loading = ref(true)
const hintText = ref('准备中...')
const currentStudent = ref({ 学号: '----', 姓名: '----' })
let rollInterval = null
let autoCloseTimer = null

async function fetchStudents() {
  const token = localStorage.getItem('token')
  if (!token) throw new Error('未登录，请先登录主应用')
  const res = await axios.get('/students')
  return res.data.data || []
}

function pickRandomStudent() {
  const idx = Math.floor(Math.random() * students.value.length)
  return students.value[idx]
}

async function startRoll() {
  // 加载数据
  if (students.value.length === 0) {
    hintText.value = '加载中...'
    try {
      students.value = await fetchStudents()
    } catch (err) {
      error.value = err.response?.data?.error || err.message || '获取名单失败'
      loading.value = false
      return
    }
    if (students.value.length === 0) {
      error.value = '暂无学生数据'
      loading.value = false
      return
    }
  }

  loading.value = false
  isRolling.value = true
  result.value = null
  let count = 0

  // 开始滚动，学号姓名一起变
  rollInterval = setInterval(() => {
    currentStudent.value = pickRandomStudent()
    count++
    if (count >= 25) {
      clearInterval(rollInterval)
      rollInterval = null
      const finalStudent = pickRandomStudent()
      currentStudent.value = finalStudent
      result.value = finalStudent
      isRolling.value = false
      // 3秒后自动关闭回到图标
      autoCloseTimer = setTimeout(() => {
        emit('close')
      }, 3000)
    }
  }, 80)
}

function confirm() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
  emit('close')
}

// 组件一显示就直接开始，不需要任何按钮
onMounted(startRoll)

onUnmounted(() => {
  if (rollInterval) clearInterval(rollInterval)
  if (autoCloseTimer) clearTimeout(autoCloseTimer)
})
</script>

<style scoped>
.roll-call {
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

.result-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--color-bg, #f9fafb);
  border-radius: 12px;
  padding: 12px 10px;
  border: 1px solid var(--color-border, #e5e7eb);
  height: 72px;
  box-sizing: border-box;
}

.avatar {
  font-size: 32px;
  width: 36px;
  text-align: center;
  flex-shrink: 0;
}

.info {
  text-align: left;
  height: 44px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.row {
  font-size: 13px;
  color: var(--color-text, #111827);
  line-height: 1.5;
  display: flex;
  align-items: center;
  height: 22px;
}

.label {
  color: var(--color-text-secondary, #6b7280);
  width: 44px;
  text-align: justify;
  text-align-last: justify;
  flex-shrink: 0;
}

.value {
  font-size: 16px;
  font-weight: 600;
  display: inline-block;
  width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value.rolling {
  color: var(--color-primary, #22c55e);
}

.hint {
  font-size: 13px;
  color: var(--color-text-muted, #9ca3af);
}

.error-area {
  text-align: center;
}

.error-msg {
  font-size: 13px;
  color: var(--color-danger, #ef4444);
  margin-bottom: 12px;
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
