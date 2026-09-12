import { reactive } from 'vue'

let uid = 0

// 全局共享的通知列表（所有调用者共享同一实例）
const notifications = reactive([])

export function useNotification() {
  /**
   * 显示通知
   * @param {Object} options
   * @param {'success'|'error'|'warning'|'info'} options.type - 消息类型
   * @param {string} options.message - 消息内容
   * @param {number} [options.duration] - 自动关闭时间（毫秒），默认 success/info 3000ms，warning/error 5000ms
   */
  // 是否合并相同内容的重复提示（默认合并），可被设置项「提示合并」切换
function isMergeEnabled() {
  try {
    return localStorage.getItem('mergeNotifications') !== '0'
  } catch (_) {
    return true
  }
}

function show({ type = 'info', message, duration } = {}) {
    const defaultDuration = type === 'error' || type === 'warning' ? 5000 : 3000
    const dur = duration ?? defaultDuration

    // 合并相同内容：相同类型+消息且尚未离开的通知复用同一条，计数 +1 并重置自动关闭时间
    if (isMergeEnabled()) {
      const existing = notifications.find(n => !n.leaving && n.type === type && n.message === message)
      if (existing) {
        existing.count++
        existing._barKey = (existing._barKey || 1) + 1 // 让进度条重播
        if (existing._paused) {
          existing._remaining = dur
          existing._startTime = Date.now()
        } else {
          clearTimeout(existing.timer)
          existing._startTime = Date.now()
          existing._remaining = null
          existing.timer = setTimeout(() => remove(existing.id), dur)
        }
        return existing.id
      }
    }

    const id = ++uid
    const item = reactive({
      id,
      type,
      message,
      count: 1,
      _barKey: 1,
      duration: dur,
      _originalDuration: dur,
      _startTime: Date.now(),
      _remaining: null,
      _paused: false,
      timer: null,
      leaving: false
    })

    notifications.push(item)

    // 自动关闭
    if (item.duration > 0) {
      item.timer = setTimeout(() => remove(id), item.duration)
    }

    return id
  }

  function remove(id) {
    const idx = notifications.findIndex(n => n.id === id)
    if (idx === -1) return
    const item = notifications[idx]
    clearTimeout(item.timer)
    // TransitionGroup 在 splice 移除时会自动触发离开动画，无需额外延迟
    notifications.splice(idx, 1)
  }

  function success(message, duration) {
    return show({ type: 'success', message, duration })
  }

  function error(message, duration) {
    return show({ type: 'error', message, duration })
  }

  function warning(message, duration) {
    return show({ type: 'warning', message, duration })
  }

  function info(message, duration) {
    return show({ type: 'info', message, duration })
  }

  return { notifications, show, remove, success, error, warning, info }
}