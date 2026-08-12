<template>
  <Teleport to="body">
    <div class="nt-container">
      <TransitionGroup name="nt">
        <div
          v-for="item in notifications"
          :key="item.id"
          :class="['nt-toast', `nt-${item.type}`]"
          @mouseenter="onHover(item)"
          @mouseleave="onLeave(item)"
        >
          <!-- 图标 -->
          <span class="nt-icon">{{ icons[item.type] }}</span>

          <!-- 消息内容 -->
          <div class="nt-body">
            <span class="nt-title">{{ titles[item.type] }}</span>
            <span class="nt-msg">{{ item.message }}</span>
          </div>

          <!-- 关闭按钮 -->
          <button class="nt-close" @click="remove(item.id)">&times;</button>

          <!-- 进度条（从左往右消失） -->
          <span v-if="item._originalDuration > 0" class="nt-bar" :class="{ 'nt-bar-paused': item._paused }" :style="{ animationDuration: item._originalDuration + 'ms' }" />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { useNotification } from '../composables/useNotification'

const { notifications, remove } = useNotification()

const icons = {
  success: '\u2714',
  error:   '\u2716',
  warning: '\u26A0',
  info:    '\u2139'
}

const titles = {
  success: '操作成功',
  error:   '操作失败',
  warning: '请注意',
  info:    '提示信息'
}

function onHover(item) {
  item._paused = true
  clearTimeout(item.timer)
  // 计算已用时间，保存剩余时间
  const elapsed = Date.now() - item._startTime
  item._remaining = Math.max(0, item._originalDuration - elapsed)
}

function onLeave(item) {
  item._paused = false
  // 用剩余时间重新开始计时器
  item._startTime = Date.now()
  item.timer = setTimeout(() => remove(item.id), item._remaining)
}
</script>

<style scoped>
.nt-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.nt-toast {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 300px;
  max-width: 420px;
  padding: 14px 16px;
  background: var(--color-surface, #fff);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06);
  border: 1px solid var(--color-border, #e5e7eb);
  pointer-events: auto;
  overflow: hidden;
}

/* 类型着色（左侧边框） */
.nt-success { border-left: 4px solid var(--color-success, #22c55e); }
.nt-error   { border-left: 4px solid var(--color-danger, #ef4444);  }
.nt-warning { border-left: 4px solid var(--color-warning, #f59e0b); }
.nt-info    { border-left: 4px solid var(--color-info, #3b82f6);    }

/* 图标 */
.nt-icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}
.nt-success .nt-icon { background: var(--color-success, #22c55e); }
.nt-error   .nt-icon { background: var(--color-danger, #ef4444);  }
.nt-warning .nt-icon { background: var(--color-warning, #f59e0b); }
.nt-info    .nt-icon { background: var(--color-info, #3b82f6);    }

/* 消息体 */
.nt-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* 标题 */
.nt-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--color-text, #111827);
}

/* 消息内容 */
.nt-msg {
  font-size: 13px;
  line-height: 1.4;
  color: var(--color-text-secondary, #4b5563);
  word-break: break-word;
  white-space: pre-line;
}

/* 关闭按钮 */
.nt-close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  color: var(--color-text-muted, #6b7280);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.nt-close:hover {
  background: var(--color-surface-hover, #f3f4f6);
  color: var(--color-text, #111827);
}

/* 进度条（从右定位，向左收缩 = 从左往右消失） */
.nt-bar {
  position: absolute;
  bottom: 0;
  right: 0;
  height: 3px;
  animation: nt-shrink linear forwards;
}
.nt-bar-paused {
  animation-play-state: paused;
}
.nt-success .nt-bar { background: var(--color-success, #22c55e); }
.nt-error   .nt-bar { background: var(--color-danger, #ef4444);  }
.nt-warning .nt-bar { background: var(--color-warning, #f59e0b); }
.nt-info    .nt-bar { background: var(--color-info, #3b82f6);    }

@keyframes nt-shrink {
  from { width: 100%; }
  to   { width: 0%;   }
}

/* ========== 进出动画 ========== */
.nt-enter-active {
  transition: all 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.nt-leave-active {
  transition: all 0.25s ease-in;
}

.nt-enter-from {
  opacity: 0;
  transform: translateX(60px) scale(0.92);
}
.nt-leave-to {
  opacity: 0;
  transform: translateX(60px) scale(0.92);
}
</style>