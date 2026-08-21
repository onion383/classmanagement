const { contextBridge, ipcRenderer } = require('electron')

// 白名单：仅允许以下单向发送通道
const validSendChannels = [
  'widget-resize',
  'widget-drag-start',
  'widget-drag-move',
  'widget-drag-end',
  'widget-move-to',
  'widget-center',
  'widget-restore-position',
  'widget-fullscreen',
  'widget-restore',
  'widget-set-ignore-mouse',
  'widget-set-visible',
  'to-main',
  'to-widget',
]

// 白名单：仅允许以下请求-响应式动请求通道（对应 ipcMain.handle）
const validInvokeChannels = [
  'select-folder',
  'select-image-file',
  'save-background-image',
  'save-file',
  'screenshot-capture',
  'note-save',
]

// 白名单：仅允许以下主进程 -> 渲染进程推送通道
const validReceiveChannels = [
  'from-main',
  'from-widget',
]

// 监听器缓存：channel -> (原始callback -> wrapper)
// 作用：on 注册时保存「用户 callback」与「实际注册到 ipcRenderer 的 wrapper」的映射，
// off 时据此取出真正的 wrapper 才能 removeListener，避免因引用不同而无法解绑（内存泄漏）。
const listenerMap = new Map()

contextBridge.exposeInMainWorld('electron', {
  // 向主进程发送消息（单向）
  send: (channel, ...args) => {
    if (validSendChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args)
    }
  },

  // 接收主进程消息。返回 wrapper 供上层等值调用 off。
  on: (channel, callback) => {
    if (!validReceiveChannels.includes(channel) || typeof callback !== 'function') return null
    const wrapper = (event, ...args) => callback(...args)
    if (!listenerMap.has(channel)) listenerMap.set(channel, new Map())
    listenerMap.get(channel).set(callback, wrapper)
    ipcRenderer.on(channel, wrapper)
    return wrapper
  },

  // 取消监听。兼容两种调用：传入 on() 返回的 wrapper，或传入原始 callback。
  off: (channel, callback) => {
    if (!validReceiveChannels.includes(channel)) return
    const m = listenerMap.get(channel)
    if (!m) return
    let orig = callback
    let wrapper = m.get(callback)
    if (!wrapper) {
      // 上层传入的可能是 wrapper 本身，换算回原始 callback
      for (const [o, w] of m) {
        if (w === callback) { orig = o; wrapper = w; break }
      }
    }
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper)
      m.delete(orig)
      if (m.size === 0) listenerMap.delete(channel)
    }
  },

  // 一次性监听（仅白名单内通道启用）
  once: (channel, callback) => {
    if (validReceiveChannels.includes(channel) && typeof callback === 'function') {
      ipcRenderer.once(channel, (event, ...args) => callback(...args))
    }
  },

  // 请求-响应式 IPC（对应 ipcMain.handle）。白名单外的通道一律拒绝调用。
  invoke: (channel, ...args) => {
    if (!validInvokeChannels.includes(channel)) {
      return Promise.reject(new Error(`Invalid invoke channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
})