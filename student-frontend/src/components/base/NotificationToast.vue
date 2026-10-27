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
            <div class="nt-head">
              <span class="nt-title">{{ titles[item.type] }}</span>
              <span v-if="item.count > 1" class="nt-badge">×{{ item.count }}</span>
            </div>
            <span class="nt-msg">{{ item.message }}</span>
          </div>

          <!-- 动作按钮（如「撤销」）：放在消息右侧而不是下方。
               配色**复用操作列「修改」按钮的那套类**（bg-info + text-text-inverse），
               不自己写 background —— glass / win11 主题对 `button.bg-info.text-text-inverse`
               有 !important 覆盖（半透明淡蓝底 + 深蓝字），直写 var(--color-info) 会吃不到那层。 -->
          <button v-if="item.action" type="button" class="nt-action bg-info text-text-inverse" @click="onAction(item)">
            {{ item.action.label }}
          </button>

          <!-- 关闭按钮：方形毛玻璃外观统一走全局 .dlg-close -->
          <button class="dlg-close" @click="remove(item.id)">&times;</button>

          <!-- 进度条（从左往右消失）；合并后通过 _barKey 重播 -->
          <span
            v-if="item._originalDuration > 0"
            :key="item._barKey"
            class="nt-bar"
            :class="{ 'nt-bar-paused': item._paused }"
            :style="{ animationDuration: item._originalDuration + 'ms' }"
          />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { useNotification } from '../../composables/useNotification'

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

// 动作按钮（如「撤销」）：先收掉提示条再执行，避免用户连点撤两次
function onAction(item) {
  const action = item.action
  remove(item.id)
  if (!action || typeof action.onClick !== 'function') return
  try {
    const ret = action.onClick()
    if (ret && typeof ret.catch === 'function') ret.catch(err => console.error('[通知动作]', err))
  } catch (err) {
    console.error('[通知动作]', err)
  }
}
</script>

<style>
.nt-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483000;
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
  border-radius: var(--radius-surface);
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

/* 标题 + 计数徽标 */
.nt-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.nt-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--color-text, #111827);
}
.nt-badge {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 2px 7px;
  border-radius: 999px;
  color: #fff;
  background: var(--color-primary, #2563eb);
}

/* 消息内容 */
.nt-msg {
  font-size: 13px;
  line-height: 1.4;
  color: var(--color-text-secondary, #4b5563);
  word-break: break-word;
  white-space: pre-line;
}

/* 动作按钮（撤销）：只负责尺寸和排布，**底色/文字色交给 bg-info / text-text-inverse 类**，
   这样与表格操作列的「修改」按钮逐像素一致（包括 glass / win11 主题对
   button.bg-info.text-text-inverse 的那层 !important 覆盖）。
   垂直居中而不是贴顶：它和两行文字的消息块并排，贴顶会显得吊在半空 */
.nt-action {
  flex-shrink: 0;
  align-self: center;
  /* 尺寸对齐操作列按钮的 py-0.5 px-2 rounded（2px / 8px / 4px），只有字号明确写死 13px ——
     它的父级是提示条（正文 13px），继承下来正好，不会比消息文字还大 */
  padding: 2px 8px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  line-height: 1.4;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: filter 0.15s ease;
}
.nt-action:hover { filter: brightness(1.08); }
.nt-action:active { filter: brightness(0.96); }
.nt-action:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--color-info, #3b82f6) 60%, transparent);
  outline-offset: 2px;
}

/* 关闭按钮：方形毛玻璃外观统一走全局 .dlg-close（见 styles/utilities.css），
   这里只按吐司的紧凑尺寸收小一档（22px，与左侧图标同高）。 */
.nt-toast .dlg-close {
  width: 22px;
  height: 22px;
  margin-top: 1px;
  font-size: 15px;
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

/* ========== 进出动画（保持原样：从右侧滑入/滑出）========== */
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