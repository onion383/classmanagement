const { contextBridge, ipcRenderer } = require('electron')

const validSendChannels = [
  'widget-resize',
  'widget-drag-start',
  'widget-drag-move',
  'widget-drag-end',
  'widget-move-to',
  'widget-center',
  'widget-restore-position',
  'widget-set-ignore-mouse',
  'to-main',
  'to-widget',
]

const validReceiveChannels = [
  'from-main',
  'from-widget',
]

contextBridge.exposeInMainWorld('electron', {
  // 向主进程发送消息
  send: (channel, ...args) => {
    if (validSendChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args)
    }
  },

  // 接收主进程消息
  on: (channel, callback) => {
    if (validReceiveChannels.includes(channel)) {
      const wrapper = (event, ...args) => callback(...args)
      ipcRenderer.on(channel, wrapper)
      // 返回 wrapper 以便取消监听
      return wrapper
    }
    return null
  },

  // 取消监听
  off: (channel, callback) => {
    if (validReceiveChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, callback)
    }
  },

  // 一次性监听
  once: (channel, callback) => {
    if (validReceiveChannels.includes(channel)) {
      ipcRenderer.once(channel, (event, ...args) => callback(...args))
    }
  },

  // 请求-响应式 IPC（对应 ipcMain.handle）
  invoke: (channel, ...args) => {
    return ipcRenderer.invoke(channel, ...args)
  },
})
