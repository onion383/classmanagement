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
const { resolveDataDir, resolveThumbsDir, resolveSkillsDir } = require('./main.config')
const {
  resolveSafeFolder,
  resolveSafeWriteDir,
  resolveSafeOpenFile,
  markFileWritten,
  sanitizeSuggestedName,
} = require('./main.path-guard')

const fsp = fs.promises

const isDev = !app.isPackaged

// 渲染层 → 主进程 → 写盘通道的统一体积上限：避免超大 payload 在主进程再复制一份。
const MAX_WRITE_BYTES = 50 * 1024 * 1024
// save-file 只服务导出类文件；扩展名由用户可在对话框里改，因此最终路径还要再校验一次。
const ALLOWED_SAVE_EXTS = new Set([
  '.html', '.htm', '.xlsx', '.csv', '.md', '.txt', '.json', '.png', '.pdf',
])

// 上次访问的目录（跨各对话框共享）
let lastDialogDir = null
function getDialogDir() { return lastDialogDir }
function setDialogDir(dir) { lastDialogDir = dir }

// 窗口引用出口：由 registerDialogsIpc 注入
let getMainWindow = () => null
let getWidgetWindow = () => null
// widget 的「点击穿透」态只能记在 widget 模块里（Electron 无 getter），这里注入读取器：
// 截屏会把 widget 临时隐藏，结束后必须还原成进入前的状态，而不是一律恢复成可点击。
let isWidgetIgnoreMouse = () => false

function registerDialogsIpc(opts = {}) {
  if (typeof opts.getMainWindow === 'function') getMainWindow = opts.getMainWindow
  if (typeof opts.getWidgetWindow === 'function') getWidgetWindow = opts.getWidgetWindow
  if (typeof opts.isWidgetIgnoreMouse === 'function') isWidgetIgnoreMouse = opts.isWidgetIgnoreMouse

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
    // 渲染层传什么路径都不能直接交给系统：只放行已存在、非盘符根、非系统保护目录的绝对路径
    const safe = resolveSafeFolder(folderPath)
    if (safe.error) return { error: safe.error }
    shell.openPath(safe.path)
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
      // 与「选择图片」路径对齐的 50MB 上限：base64 入口原先没有大小校验，
      // 一次超大 payload 就会在主进程里解码出数倍内存（B01-09）。
      // 与 note-save/save-file 共用同一个 50MB 上限，避免三处各写一份常量
      if (typeof base64 !== 'string' || base64.length === 0) {
        return { success: false, error: '缺少图片数据' }
      }
      // 先按 base64 长度粗判（约为原始字节的 4/3），避免把超大字符串解码进内存
      if (base64.length > Math.ceil(MAX_WRITE_BYTES / 3) * 4) {
        return { success: false, error: '背景图片不能超过 50MB' }
      }
      const bgDir = path.join(app.getPath('userData'), 'data', 'uploads', 'background')
      // mkdir recursive 在目录已存在时不报错，省掉一次 existsSync 同步探测
      await fsp.mkdir(bgDir, { recursive: true })
      // 扩展名来自渲染层传入的文件名：只接受图片扩展，其余统一按 .png 落盘，
      // 避免把 IPC 当任意扩展名写盘入口使用
      const ALLOWED_BG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
      let ext = name ? path.extname(String(name)).toLowerCase() : ''
      if (!ALLOWED_BG_EXT.has(ext)) ext = '.png'
      const fileName = `bg_${Date.now()}${ext}`
      const destPath = path.join(bgDir, fileName)
      // 将 base64 写入文件
      const buffer = Buffer.from(base64, 'base64')
      if (buffer.length > MAX_WRITE_BYTES) {
        return { success: false, error: '背景图片不能超过 50MB' }
      }
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
  ipcMain.handle('save-file', async (event, { defaultName, data } = {}) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true }
    // 数据体积先判：字符串按 UTF-8 字节数，ArrayBuffer/TypedArray 按 byteLength。
    // Buffer.from 会在主进程再持有一份等量内存，不设上限等于把 IPC 当内存放大器。
    const dataBytes = typeof data === 'string'
      ? Buffer.byteLength(data, 'utf8')
      : (data && typeof data.byteLength === 'number' ? data.byteLength : -1)
    if (dataBytes < 0) return { canceled: true, error: '文件数据格式无效' }
    if (dataBytes > MAX_WRITE_BYTES) return { canceled: true, error: '导出文件不能超过 50MB' }
    // 建议文件名来自渲染层（可能被注入成 ../x 这类串）：统一压平成纯文件名再拼进 defaultPath
    const name = sanitizeSuggestedName(defaultName)
    const ext = path.extname(name).toLowerCase()
    if (ext && !ALLOWED_SAVE_EXTS.has(ext)) {
      return { canceled: true, error: '不支持保存为该文件类型' }
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: lastDialogDir ? path.join(lastDialogDir, name) : name,
      filters: ext ? [{ name: '文件', extensions: [ext.replace('.', '')] }] : undefined
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    // 用户可在保存对话框里改扩展名：落盘前按最终路径再校验一次，防止把 save-file 当任意写盘入口
    const targetExt = path.extname(result.filePath).toLowerCase()
    if (!ALLOWED_SAVE_EXTS.has(targetExt)) {
      return { canceled: true, error: '不支持保存为该文件类型' }
    }
    try {
      const buffer = Buffer.from(data)
      // 异步写：导出的 xlsx/pdf 可能几十 MB，同步写会让窗口在写盘期间完全无响应
      await fsp.writeFile(result.filePath, buffer)
      lastDialogDir = path.dirname(result.filePath)
      // 登记「本应用写过的文件」：open-file 只允许打开这里登记过的路径，
      // 防止渲染层被注入后把任意 exe 交给 shell.openPath。
      markFileWritten(result.filePath)
      return { canceled: false, filePath: result.filePath }
    } catch (err) {
      return { canceled: true, error: err.message }
    }
  })

  // 导出文件保存后：用系统默认应用打开
  ipcMain.handle('open-file', async (event, { filePath }) => {
    if (!filePath) return { success: false, error: 'no filePath' }
    const safe = resolveSafeOpenFile(filePath)
    if (safe.error) return { success: false, error: safe.error }
    try {
      const error = await shell.openPath(safe.path)
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
    // 进入前的穿透态：截屏结束后要原样还回去
    let wasIgnoreMouse = false
    if (hideWidget && widgetWindow && !widgetWindow.isDestroyed()) {
      wasVisible = widgetWindow.isVisible()
      wasIgnoreMouse = isWidgetIgnoreMouse()
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

      const defaultSaveDir = path.join(app.getPath('pictures'), 'screenshots')
      // saveDir 来自设置页（可自定义），不能直接 mkdir/write：只接受非盘符根、非系统保护目录
      const safeDir = resolveSafeWriteDir(options?.saveDir, defaultSaveDir)
      if (safeDir.error) return { success: false, error: safeDir.error }
      const saveDir = safeDir.path
      // 整屏 PNG 常有几 MB～十几 MB，写盘走异步，避免截图瞬间主进程冻结
      await fsp.mkdir(saveDir, { recursive: true })

      // 精度必须到毫秒：只到秒时 1 秒内连存两次会生成同名文件，writeFile 直接把上一次的覆盖掉（静默丢数据）
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
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
        // 恢复鼠标事件：必须还原成进入前的穿透态，不能一律 setIgnoreMouseEvents(false)。
        // 原来无条件取消穿透，会让设计成「点击穿透桌面」的浮窗截屏后开始吞掉桌面点击。
        widgetWindow.setIgnoreMouseEvents(wasIgnoreMouse, { forward: true })
        // 穿透态下不该抢焦点（否则又把焦点从用户正在用的窗口拿走）
        if (!wasIgnoreMouse) widgetWindow.focus()
      }
    }
  })

  // ===== 截屏选区（AI 对话里「截屏发图」用）=====
  // 三步配合完成「主窗口保持可见 → 框选区域 → 确定/取消」：
  //   1) screenshot-region：主窗口保持可见（截屏画面带上应用界面），仅把工具箱临时透明后截取主屏，返回冻结画面
  //   2) screenshot-region-show：渲染层画好冻结画面后，主窗口铺满整屏并置顶，作为选区遮罩
  //   3) screenshot-region-end：把主窗口还原到截屏前的尺寸/层级
  // 主窗口上的 AI 浮窗由渲染层在调用前先收起，避免浮窗被截进画面。
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
      // 1. 主窗口保持可见（截屏画面带上应用界面），只有工具箱（若可见）会进入截图，先临时透明；
      //    等一帧让合成器更新
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
    if (!uint8Array || typeof uint8Array.byteLength !== 'number') {
      return { success: false, error: '缺少截图数据' }
    }
    if (uint8Array.byteLength > MAX_WRITE_BYTES) {
      return { success: false, error: '截图不能超过 50MB' }
    }
    const buffer = Buffer.from(uint8Array)
    const defaultSaveDir = path.join(app.getPath('pictures'), 'screenshots')
    // 与截图保存同一条边界：noteSavePath 由用户配置，渲染层仍可能被篡改，
    // 不允许把任意字节写进 System32/Windows 这类目录。
    const safeDir = resolveSafeWriteDir(options?.saveDir, defaultSaveDir)
    if (safeDir.error) return { success: false, error: safeDir.error }
    const saveDir = safeDir.path
    await fsp.mkdir(saveDir, { recursive: true })
    // 精度必须到毫秒：只到秒时 1 秒内连存两次会生成同名文件，writeFile 直接把上一次的覆盖掉（静默丢数据）
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
    const filePath = path.join(saveDir, `note_${timestamp}.png`)
    await fsp.writeFile(filePath, buffer)
    return { success: true, filePath }
  })
}

module.exports = { registerDialogsIpc, getDialogDir, setDialogDir }