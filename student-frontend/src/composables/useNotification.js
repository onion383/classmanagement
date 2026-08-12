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
  function show({ type = 'info', message, duration } = {}) {
    const id = ++uid
    const defaultDuration = type === 'error' || type === 'warning' ? 5000 : 3000
    const dur = duration ?? defaultDuration
    const item = reactive({
      id,
      type,
      message,
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
    item.leaving = true
    // 等动画结束后移除
    setTimeout(() => {
      const i = notifications.findIndex(n => n.id === id)
      if (i !== -1) notifications.splice(i, 1)
    }, 300)
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