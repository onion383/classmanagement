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
  'widget-set-session-visible',
  'widget-context-menu',
  'to-main',
  'to-widget',
  // 无边框自绘标题栏：窗口控制（单向发送）
  'win-minimize',
  'win-maximize-toggle',
  'win-close',
  // 关闭选择弹窗：渲染层把用户选择的关闭范围回传给主进程
  'shutdown-action',
  // 启动失败兜底：用户点「退出应用」
  'quit-app',
  // 原生右键菜单：渲染层在「未被页面自行处理」时请求主进程弹出系统菜单
  'show-native-context-menu',
  // Win11 主题：主窗口窗外亚克力开关
  'theme-chrome',
  // 渲染层回报/切换「桌面小组件」启用状态（主进程据此按需创建/关闭桌面小组件窗口）
  'desktop-widget-enabled',
  // 主窗口渲染层「首帧真正空闲」回报：主进程据此建工具箱浮窗与（如启用）桌面小组件
  'widgets-ready',
  // 数据库迁移进度窗口：渲染层挂载完成回报 / 失败后点击「返回主界面」
  'migration-ready',
  'migration-dismiss',
  // 首次安装引导向导：渲染层挂载完成回报 / 完成引导回报 / 关闭按钮完全退出回报
  'setup-ready',
  'setup-complete',
  'setup-quit',
  // 启动窗口内的低版本系统提示画面：用户点「忽略」（可带「不再提示」勾选）后继续启动 /
  // 用户点「获取最新的 Windows」（默认浏览器打开下载页并退出班集）
  'launch-skip-warn',
  'launch-open-download',
  // 版本更新：用户确认后重启并安装已下载的新版本
  'update-install',
  // INP 归因落盘（仅开发模式）：渲染层探针把交互耗时汇总发主进程，追加写入数据目录 inp.log
  'inp-report',
]

// 白名单：仅允许以下请求-响应式动请求通道（对应 ipcMain.handle）
const validInvokeChannels = [
  'select-folder',
  'select-image-file',
  'save-background-image',
  'save-file',
  'screenshot-capture',
  'note-save',
  'open-file',
  'open-folder',
  'get-session-widget-visible',
  'get-usb-auto-open',
  'set-usb-auto-open',
  'open-external',
  'get-main-token',
  'get-master-key',
  'get-desktop-wallpaper',
  // 桌面小组件·常用软件（选文件/启动；列表读写已改走后端数据库）
  'apps-select-file',
  'apps-launch',
  // 数据目录/缓存目录：读取与搬迁
  'get-data-directories',
  'set-data-dir',
  'set-thumbs-dir',
  // 数据库加密：切换当前账号库的落盘加密方式（复用迁移进度窗口流程）
  'set-db-encryption',
  // 首次安装引导向导：写入初始数据/缓存目录（不重开窗口，仅重启后端）
  'set-initial-data-dir',
  // 首次安装引导向导：读取当前预热进度/完成态（供晚挂载的渲染层补齐）
  'get-setup-warmup',
  // 启动窗口首屏：读取本次启动计划（是否先显示低版本提示 / 是否走引导）
  'launch-plan',
  // 主窗口加载后取走主进程暂存的待展示提示（如「数据库移动成功」）
  'get-pending-notification',
  // 后端就绪状态查询（兜住「先就绪、后注册监听」的竞态）
  'backend-status',
  // 启动阶段状态查询（加载页灰色副标题显示「程序正在干嘛」）
  'boot-status',
  // 启动失败兜底：手动重启后端 / 查询当前是否处于失败态
  'restart-backend',
  'backend-failure',
  // 运行期：请求没拿到响应时，让主进程立刻做一次健康探测（把失败操作变成探针）
  'probe-backend',
  // 性能面板：内存快照 / 重启前端 / 重启小组件 / 手动回收 / 上次启动耗时
  'perf-snapshot',
  'perf-restart-frontend',
  'perf-restart-widget',
  'perf-relaunch-app',
  'perf-gc',
  'perf-startup',
  // 版本更新：取当前版本号 / 主动检查更新
  'get-app-version',
  'update-check',
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