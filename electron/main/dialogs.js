// =========================================================================
// dialogs.js —— 文件/文件夹对话框与本地文件读写类 IPC
//
// 汇总主进程里「弹系统对话框 + 读写本地文件」的一组请求-响应通道：
//   select-folder / open-folder / select-image-file / save-background-image /
//   save-file / open-file / screenshot-capture / note-save / get-data-directories
//
// 记忆上次访问目录：Electron 43 起未传 defaultPath 时对话框默认打开「下载」目录，
// 且系统不再记忆上次访问目录（43.0 breaking change）；这里自行记忆并回填，恢复旧体验。
//
// 依赖注入：窗口引用由 main.js 通过 registerDialogsIpc 注入（getMainWindow / getWidgetWindow），
// 本模块不直接持有窗口变量；lastDialogDir 作为本模块内部状态并提供 getter/setter 供 apps.js 复用。
// =========================================================================

const { app, BrowserWindow, ipcMain, desktopCapturer, screen, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { resolveDataDir, resolveThumbsDir, resolveSkillsDir } = require('./config')

const fsp = fs.promises

const isDev = !app.isPackaged

// 上次访问的目录（跨各对话框共享）
let lastDialogDir = null
function getDialogDir() { return lastDialogDir }
function setDialogDir(dir) { lastDialogDir = dir }

// 窗口引用出口：由 registerDialogsIpc 注入
let getMainWindow = () => null
let getWidgetWindow = () => null

function registerDialogsIpc(opts = {}) {
  if (typeof opts.getMainWindow === 'function') getMainWindow = opts.getMainWindow
  if (typeof opts.getWidgetWindow === 'function') getWidgetWindow = opts.getWidgetWindow

  // 选择文件夹对话框
  ipcMain.handle('select-folder', async (event) => {
    // 以调用方所在窗口为父窗口：首次安装引导期还没有主窗口，此时用引导窗口作父窗口，
    // 否则（mainWindow 为空）会直接返回空数组，导致引导里的「修改」按钮点了没反应。
    const senderWin = BrowserWindow.fromWebContents(event.sender)
    const mainWindow = getMainWindow()
    const parent = (senderWin && !senderWin.isDestroyed())
      ? senderWin
      : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)
    const opts = {
      properties: ['openDirectory'],
      defaultPath: lastDialogDir || undefined,
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    if (!result.canceled && result.filePaths.length > 0) {
      lastDialogDir = result.filePaths[0]
    }
    return result
  })

  // 在文件管理器中打开指定文件夹
  ipcMain.handle('open-folder', async (event, folderPath) => {
    if (!folderPath) return { error: '路径为空' }
    shell.openPath(folderPath)
    return {}
  })

  // ========== 数据目录 / 缓存目录（可自定义，含整体搬迁） ==========
  // 当前数据目录与缓存目录信息（供设置页展示）
  ipcMain.handle('get-data-directories', () => {
    return {
      dataDir: resolveDataDir(),
      thumbsDir: resolveThumbsDir(),
      skillsDir: resolveSkillsDir(),
      defaultDataDir: path.join(app.getPath('userData'), 'data'),
      screenshotDir: path.join(app.getPath('pictures'), 'screenshots'),
    }
  })

  // 选择图片文件对话框（用于背景图片）
  ipcMain.handle('select-image-file', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, filePaths: [] }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      defaultPath: lastDialogDir || undefined,
      filters: [
        { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      lastDialogDir = path.dirname(result.filePaths[0])
      const filePath = result.filePaths[0]
      // 检查文件大小（限制 50MB）
      const fileStat = await fsp.stat(filePath)
      const maxSize = 50 * 1024 * 1024 // 50MB
      if (fileStat.size > maxSize) {
        return { canceled: true, error: '图片大小超过 50MB，请选择更小的图片' }
      }
      // 将文件复制到后端 uploads/background 目录
      // 打包后 __dirname 位于只读 asar 内，必须写到 userData/data/uploads/background（与后端 DATA_DIR 一致）
      const bgDir = path.join(app.getPath('userData'), 'data', 'uploads', 'background')
      // mkdir recursive 在目录已存在时不报错，省掉一次 existsSync 同步探测
      await fsp.mkdir(bgDir, { recursive: true })
      const fileName = `bg_${Date.now()}${path.extname(filePath)}`
      const destPath = path.join(bgDir, fileName)
      // 异步复制：最大允许 50MB，同步复制会让主进程在复制期间完全无响应
      await fsp.copyFile(filePath, destPath)
      // 根据环境返回不同的 URL
      let imageUrl
      if (isDev) {
        // 开发模式：通过 Vite 代理访问 /api/background
        imageUrl = `/api/background/${fileName}`
      } else {
        // 生产模式：直接请求后端 API
        imageUrl = `http://localhost:3000/api/background/${fileName}`
      }
      return { canceled: false, filePath: destPath, fileUrl: imageUrl, originalName: path.basename(filePath) }
    }
    return result
  })

  // 保存背景图片（用于大图片，前端传入 base64）
  // 写盘改成异步：背景图动辄几 MB，writeFileSync 会把主进程阻塞到写完为止。
  ipcMain.handle('save-background-image', async (event, { name, base64 }) => {
    try {
      const bgDir = path.join(app.getPath('userData'), 'data', 'uploads', 'background')
      // mkdir recursive 在目录已存在时不报错，省掉一次 existsSync 同步探测
      await fsp.mkdir(bgDir, { recursive: true })
      // 从原始文件名获取扩展名
      const ext = name ? path.extname(name) || '.png' : '.png'
      const fileName = `bg_${Date.now()}${ext}`
      const destPath = path.join(bgDir, fileName)
      // 将 base64 写入文件
      const buffer = Buffer.from(base64, 'base64')
      await fsp.writeFile(destPath, buffer)
      // 根据环境返回不同的 URL
      let imageUrl
      if (isDev) {
        imageUrl = `/api/background/${fileName}`
      } else {
        imageUrl = `http://localhost:3000/api/background/${fileName}`
      }
      return { success: true, url: imageUrl, fileName }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 导出文件保存对话框：用户确认保存后才写入文件并返回
  ipcMain.handle('save-file', async (event, { defaultName, data }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true }
    const ext = path.extname(defaultName) || ''
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: lastDialogDir ? path.join(lastDialogDir, defaultName) : defaultName,
      filters: ext ? [{ name: '文件', extensions: [ext.replace('.', '')] }] : undefined
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    try {
      const buffer = Buffer.from(data)
      // 异步写：导出的 xlsx/pdf 可能几十 MB，同步写会让窗口在写盘期间完全无响应
      await fsp.writeFile(result.filePath, buffer)
      lastDialogDir = path.dirname(result.filePath)
      return { canceled: false, filePath: result.filePath }
    } catch (err) {
      return { canceled: true, error: err.message }
    }
  })

  // 导出文件保存后：用系统默认应用打开
  ipcMain.handle('open-file', async (event, { filePath }) => {
    if (!filePath) return { success: false, error: 'no filePath' }
    try {
      const error = await shell.openPath(filePath)
      return { success: !error, error: error || null }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 一键截屏：截取整个屏幕并保存到本地
  // options.hideWidget: 是否隐藏 widget 窗口（默认 true）。截屏工具传 false 以保持 spinner 可见
  ipcMain.handle('screenshot-capture', async (event, options) => {
    const widgetWindow = getWidgetWindow()
    const hideWidget = options?.hideWidget !== false
    let wasVisible = false
    if (hideWidget && widgetWindow && !widgetWindow.isDestroyed()) {
      wasVisible = widgetWindow.isVisible()
      if (wasVisible) widgetWindow.setOpacity(0)
      // 等待一帧确保窗口已隐藏
      await new Promise(resolve => setTimeout(resolve, 150))
    }

    try {
      const primaryDisplay = screen.getPrimaryDisplay()
      const { width, height } = primaryDisplay.size
      const scaleFactor = primaryDisplay.scaleFactor || 1

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(width * scaleFactor), height: Math.round(height * scaleFactor) }
      })

      const primarySource = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0]
      const image = primarySource.thumbnail.toPNG()

      const saveDir = options?.saveDir || path.join(app.getPath('pictures'), 'screenshots')
      // 整屏 PNG 常有几 MB～十几 MB，写盘走异步，避免截图瞬间主进程冻结
      await fsp.mkdir(saveDir, { recursive: true })

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const filePath = path.join(saveDir, `screenshot_${timestamp}.png`)
      await fsp.writeFile(filePath, image)

      // dataUrl 仅按需生成：整屏 PNG base64 在主进程/IPC/渲染进程各持一份，
      // 内存开销大。默认生成以兼容旧调用；调用方（Screenshot.vue）不需要时可关闭。
      const withDataUrl = options?.withDataUrl !== false
      const dataUrl = withDataUrl ? `data:image/png;base64,${image.toString('base64')}` : ''
      return { success: true, filePath, dataUrl }
    } finally {
      // 恢复 widget 窗口透明度
      if (wasVisible && widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.setOpacity(1)
        // 显式恢复鼠标事件和焦点，避免 setOpacity 后透明窗口丢失交互
        widgetWindow.setIgnoreMouseEvents(false)
        widgetWindow.focus()
      }
    }
  })

  // ===== 截屏选区（AI 对话里「截屏发图」用）=====
  // 三步配合完成「主窗口消失 → 框选区域 → 确定/取消」：
  //   1) screenshot-region：把主窗口/工具箱临时透明后截取主屏，返回冻结画面（此时不显示窗口，避免闪一下原界面）
  //   2) screenshot-region-show：渲染层画好冻结画面后，主窗口铺满整屏并置顶，作为选区遮罩
  //   3) screenshot-region-end：把主窗口还原到截屏前的尺寸/层级/不透明度
  // 裁剪由渲染层用 canvas 完成，不必把整屏数据再传回主进程。
  let regionState = null

  function setWinOpacity(win, opacity) {
    if (win && !win.isDestroyed()) {
      try { win.setOpacity(opacity) } catch (_) { /* 忽略 */ }
    }
  }

  // 还原截屏前的窗口状态：正常结束与异常兜底共用
  function restoreAfterRegion() {
    const st = regionState
    regionState = null
    if (!st) return
    const win = st.window
    if (win && !win.isDestroyed()) {
      // 先透明，再改回原尺寸/层级，最后恢复不透明：遮住尺寸变化过程
      setWinOpacity(win, 0)
      try { win.setAlwaysOnTop(st.alwaysOnTop) } catch (_) { /* 忽略 */ }
      try {
        if (st.maximized) win.maximize()
        else win.setBounds(st.bounds)
      } catch (_) { /* 忽略 */ }
      setWinOpacity(win, 1)
      win.show()
      win.focus()
    }
    // 工具箱恢复可见
    if (st.widgetWasVisible) setWinOpacity(getWidgetWindow(), 1)
  }

  ipcMain.handle('screenshot-region', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: '主窗口不可用' }
    if (regionState) return { success: false, error: '已有截屏进行中' }

    const widgetWindow = getWidgetWindow()
    const display = screen.getPrimaryDisplay()
    regionState = {
      window: mainWindow,
      bounds: mainWindow.getBounds(),
      maximized: mainWindow.isMaximized(),
      alwaysOnTop: mainWindow.isAlwaysOnTop(),
      widgetWasVisible: !!(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.getOpacity() > 0),
    }

    try {
      // 1. 常驻屏幕上的窗口会进入截图，先让主窗口与工具箱临时透明，等一帧让合成器更新
      setWinOpacity(mainWindow, 0)
      if (regionState.widgetWasVisible) setWinOpacity(widgetWindow, 0)
      await new Promise((resolve) => setTimeout(resolve, 150))

      // 2. 截取整个主屏（物理像素，供渲染层按显示尺寸比例裁剪）
      const { width, height } = display.size
      const scaleFactor = display.scaleFactor || 1
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(width * scaleFactor), height: Math.round(height * scaleFactor) },
      })
      const primarySource = sources.find((s) => s.display_id === String(display.id)) || sources[0]
      const image = primarySource.thumbnail.toPNG()
      return { success: true, dataUrl: `data:image/png;base64,${image.toString('base64')}` }
    } catch (err) {
      restoreAfterRegion()
      return { success: false, error: err.message || '截屏失败' }
    }
  })

  ipcMain.handle('screenshot-region-show', async () => {
    const st = regionState
    if (!st || !st.window || st.window.isDestroyed()) return { success: false }
    const display = screen.getPrimaryDisplay()
    // 铺满整屏并置顶作为选区遮罩；渲染层此时已画好冻结画面，再恢复不透明度就不会露出原界面
    st.window.setBounds({
      x: display.bounds.x, y: display.bounds.y,
      width: display.bounds.width, height: display.bounds.height,
    })
    st.window.setAlwaysOnTop(true)
    setWinOpacity(st.window, 1)
    st.window.show()
    st.window.focus()
    return { success: true }
  })

  ipcMain.handle('screenshot-region-end', async () => {
    restoreAfterRegion()
    return { success: true }
  })

  // 保存注释后的截图
  ipcMain.handle('note-save', async (event, uint8Array, options) => {
    const buffer = Buffer.from(uint8Array)
    const saveDir = options?.saveDir || path.join(app.getPath('pictures'), 'screenshots')
    await fsp.mkdir(saveDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = path.join(saveDir, `note_${timestamp}.png`)
    await fsp.writeFile(filePath, buffer)
    return { success: true, filePath }
  })
}

module.exports = { registerDialogsIpc, getDialogDir, setDialogDir }