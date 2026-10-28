const { contextBridge, ipcRenderer, webUtils } = require('electron')

// 阻止把页面内的链接/图片拖出窗口（拖到桌面/浏览器会生成快捷方式或交给外部程序打开）。
// 仅在拖拽源为 <a> 或 <img>（含其子元素）时取消 dragstart；不影响表格排序等
// 由 mousedown/mousemove 自实现的拖拽交互。
window.addEventListener(
  'dragstart',
  (e) => {
    const t = e.target
    if (!t || typeof t.closest !== 'function') return
    if (t.closest('a, img')) e.preventDefault()
  },
  true
)

// 三份白名单与渲染层共用同一来源 electron/ipc-channels.json：主进程读取该文件后经
// additionalArguments 以 `--ipc-channels=<json>` 注入渲染进程 argv（见 main.web-prefs.js）。
// 注意：preload 运行在 sandbox 里，require 只能加载 electron 等少数内置模块，无法 require
// 本地文件，因此这里从 process.argv 解析，而不是直接 require 该 JSON。
//   send    —— 渲染层 -> 主进程 单向发送
//   invoke  —— 渲染层 -> 主进程 请求-响应（对应 ipcMain.handle）
//   receive —— 主进程 -> 渲染层 推送
function readIpcChannels() {
  const prefix = '--ipc-channels='
  const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith(prefix))
  if (!arg) return { send: [], invoke: [], receive: [] }
  try {
    return JSON.parse(arg.slice(prefix.length))
  } catch (_) {
    return { send: [], invoke: [], receive: [] }
  }
}
const {
  send: validSendChannels = [],
  invoke: validInvokeChannels = [],
  receive: validReceiveChannels = [],
} = readIpcChannels()

// 监听器缓存：channel -> (原始callback -> wrapper)
// 作用：on 注册时保存「用户 callback」与「实际注册到 ipcRenderer 的 wrapper」的映射，
// off 时据此取出真正的 wrapper 才能 removeListener，避免因引用不同而无法解绑（内存泄漏）。
const listenerMap = new Map()

// 渲染进程全局标记：主进程通过 additionalArguments 传入 --secure-channel。
// 前端只在置位后才对业务 JSON API 启用加密传输（见 composables/secureAxios.js）。
contextBridge.exposeInMainWorld('__SECURE_CHANNEL__', process.argv.includes('--secure-channel'))

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
    if (!listenerMap.has(channel)) listenerMap.set(channel, new Map())
    const m = listenerMap.get(channel)
    // 同一 callback 重复 on() 时先摘掉旧 wrapper：否则映射被覆盖后旧监听仍挂在
    // ipcRenderer 上，既重复触发又永远 off 不掉（典型的内存泄漏/重复回调来源）。
    const prev = m.get(callback)
    if (prev) ipcRenderer.removeListener(channel, prev)
    const wrapper = (event, ...args) => callback(...args)
    m.set(callback, wrapper)
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

  // 取拖入文件的真实路径（Electron 32 起 File.path 已移除，必须走 webUtils）。
  // 失败返回空串，调用方回退旧字段 file.path。
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch (_) {
      return ''
    }
  },
})
