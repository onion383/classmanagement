<template>
  <div class="timer">
    <div class="timer-tabs">
      <button
        :class="['tab', { active: mode === 'countup' }]"
        @click="switchMode('countup')"
      >
        正计时
      </button>
      <button
        :class="['tab', { active: mode === 'countdown' }]"
        @click="switchMode('countdown')"
      >
        倒计时
      </button>
    </div>

    <div class="time-display">
      <div class="time-unit">
        <button
          v-if="showArrows"
          class="arrow"
          @click="adjustTime('hours', 1)"
        >
          ▲
        </button>
        <div v-else class="arrow-placeholder"></div>
        <div class="digit">{{ formatDigit(display.hours) }}</div>
        <button
          v-if="showArrows"
          class="arrow"
          @click="adjustTime('hours', -1)"
        >
          ▼
        </button>
        <div v-else class="arrow-placeholder"></div>
        <div class="unit-label">时</div>
      </div>

      <div class="separator">:</div>

      <div class="time-unit">
        <button
          v-if="showArrows"
          class="arrow"
          @click="adjustTime('minutes', 1)"
        >
          ▲
        </button>
        <div v-else class="arrow-placeholder"></div>
        <div class="digit">{{ formatDigit(display.minutes) }}</div>
        <button
          v-if="showArrows"
          class="arrow"
          @click="adjustTime('minutes', -1)"
        >
          ▼
        </button>
        <div v-else class="arrow-placeholder"></div>
        <div class="unit-label">分</div>
      </div>

      <div class="separator">:</div>

      <div class="time-unit">
        <button
          v-if="showArrows"
          class="arrow"
          @click="adjustTime('seconds', 1)"
        >
          ▲
        </button>
        <div v-else class="arrow-placeholder"></div>
        <div class="digit">{{ formatDigit(display.seconds) }}</div>
        <button
          v-if="showArrows"
          class="arrow"
          @click="adjustTime('seconds', -1)"
        >
          ▼
        </button>
        <div v-else class="arrow-placeholder"></div>
        <div class="unit-label">秒</div>
      </div>
    </div>

    <div class="timer-controls">
      <button v-if="!running" class="btn-primary" @click="start">开始</button>
      <button v-else class="btn-warning" @click="pause">暂停</button>
      <button class="btn-secondary" @click="reset">重置</button>
      <button class="btn-secondary" @click="$emit('close')">关闭</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'

const emit = defineEmits(['close'])

const mode = ref('countup') // 'countup' | 'countdown'
const running = ref(false)

// 倒计时设置值
const settings = ref({ hours: 0, minutes: 5, seconds: 0 })
// 正计时累计秒数 / 倒计时剩余秒数
const totalSeconds = ref(0)

let interval = null

const display = computed(() => {
  const t = totalSeconds.value
  return {
    hours: Math.floor(t / 3600),
    minutes: Math.floor((t % 3600) / 60),
    seconds: t % 60,
  }
})

const showArrows = computed(() => mode.value === 'countdown' && !running.value)

function formatDigit(n) {
  return String(n).padStart(2, '0')
}

function switchMode(newMode) {
  if (running.value) pause()
  mode.value = newMode
  if (newMode === 'countup') {
    totalSeconds.value = 0
  } else {
    totalSeconds.value =
      settings.value.hours * 3600 +
      settings.value.minutes * 60 +
      settings.value.seconds
  }
}

function adjustTime(unit, delta) {
  if (running.value) return
  let val = settings.value[unit] + delta
  if (unit === 'hours') {
    val = Math.max(0, Math.min(99, val))
  } else {
    val = Math.max(0, Math.min(59, val))
  }
  settings.value[unit] = val
  totalSeconds.value =
    settings.value.hours * 3600 +
    settings.value.minutes * 60 +
    settings.value.seconds
}

function start() {
  if (running.value) return
  running.value = true

  if (mode.value === 'countdown' && totalSeconds.value <= 0) {
    running.value = false
    return
  }

  interval = setInterval(() => {
    if (mode.value === 'countup') {
      totalSeconds.value++
    } else {
      totalSeconds.value--
      if (totalSeconds.value <= 0) {
        totalSeconds.value = 0
        pause()
      }
    }
  }, 1000)
}

function pause() {
  running.value = false
  if (interval) {
    clearInterval(interval)
    interval = null
  }
}

function reset() {
  pause()
  if (mode.value === 'countup') {
    totalSeconds.value = 0
  } else {
    totalSeconds.value =
      settings.value.hours * 3600 +
      settings.value.minutes * 60 +
      settings.value.seconds
  }
}

onUnmounted(() => {
  pause()
})
</script>

<style scoped>
.timer {
  text-align: center;
  overflow: hidden;
}

.timer-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  background: var(--color-bg, #f9fafb);
  border-radius: 10px;
  padding: 4px;
}

.tab {
  flex: 1;
  padding: 6px 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary, #6b7280);
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.tab.active {
  background: var(--color-primary, #22c55e);
  color: white;
}

.time-display {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  margin-bottom: 20px;
}

.time-unit {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.arrow {
  width: 24px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--color-text-muted, #9ca3af);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.arrow:hover {
  background: var(--color-bg, #f9fafb);
  color: var(--color-primary, #22c55e);
}

.arrow-placeholder {
  width: 24px;
  height: 20px;
}

.digit {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text, #111827);
  font-family: 'Courier New', monospace;
  line-height: 1.2;
}

.unit-label {
  font-size: 11px;
  color: var(--color-text-muted, #9ca3af);
  margin-top: 2px;
}

.separator {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-muted, #9ca3af);
  padding-bottom: 14px;
}

.timer-controls {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  justify-content: center;
}

.timer-controls button {
  padding: 5px 8px;
  border-radius: 8px;
  border: none;
  font-size: 12px;
  cursor: pointer;
  font-weight: 500;
  transition: opacity 0.2s;
  white-space: nowrap;
}

.btn-primary {
  background: var(--color-primary, #22c55e);
  color: white;
}

.btn-warning {
  background: var(--color-warning, #f59e0b);
  color: white;
}

.btn-secondary {
  background: var(--color-bg, #f9fafb);
  color: var(--color-text, #111827);
  border: 1px solid var(--color-border, #e5e7eb);
}

.timer-controls button:hover {
  opacity: 0.85;
}
</style>
