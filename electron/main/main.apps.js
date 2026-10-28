// =========================================================================
// apps.js —— 桌面小组件·常用软件
//
// 列表已改由后端数据库持久化（/api/widget-settings/apps），主进程仅负责
// 「选择/拖入文件+提取名称图标」和「点击启动」两项平台能力。
// 每项：{ id, name, path, icon }（icon 为提取自 exe/.lnk/文件夹的 dataURL，可为空）。
// 除程序快捷方式外，也接受文件夹与普通文件（拖入添加后均由 shell.openPath 打开）。
//
// 依赖注入：窗口引用由 main.js 注入（主窗口与桌面组件窗口都在主进程里）
// 分别通过 registerAppsIpc 注入（getMainWindow）；
// 上次访问目录复用 dialogs.js 的 getDialogDir/setDialogDir，保持跨对话框一致。
// =========================================================================

const { app, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { getDialogDir, setDialogDir } = require('./main.dialogs')
const { resolveSafeLaunchPath } = require('./main.path-guard')

// 单次拖入最多解析的路径数：只是防呆上限，真正的「最多 8 个」由渲染层与后端共同限制
const MAX_RESOLVE_PATHS = 32

// 窗口引用出口：由 registerAppsIpc 注入
let getMainWindow = () => null

// 解析 .lnk 快捷方式的目标可执行程序路径（仅接受 .exe 目标，供取图标用）
async function resolveLnkTarget(lnkPath) {
  const { execFile } = require('child_process')
  return new Promise((resolve) => {
    const ps = [
      '-NoProfile', '-NonInteractive', '-Command',
      `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}'); if($s.TargetPath){$s.TargetPath}`,
    ]
    execFile('powershell.exe', ps, { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve('')
      const target = (stdout || '').trim()
      resolve(path.extname(target).toLowerCase() === '.exe' ? target : '')
    })
  })
}

// 把「文件 / 文件夹 / 快捷方式」路径解析成常用项：显示名 + 系统图标（dataURL）。
// 名称规则与选择对话框一致：去掉扩展名，避免图标下方出现 .exe/.lnk 小尾巴；
// 文件夹没有扩展名时直接取目录名。图标失败不影响添加，留空走首字母兜底。
async function resolveAppEntry(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const base = path.basename(filePath, ext) || path.basename(filePath) || filePath
  const name = (base || '未命名').slice(0, 30)
  let icon = ''
  try {
    // 快捷方式(.lnk)本身取不到目标程序图标，先解析出目标 exe 再取其图标
    const iconTarget = ext === '.lnk' ? await resolveLnkTarget(filePath) : ''
    const img = await app.getFileIcon(iconTarget || filePath, { size: 'large' })
    icon = img.toDataURL()
  } catch (_) { /* 图标提取失败则留空 */ }
  return { name, path: filePath, icon }
}

function registerAppsIpc(opts = {}) {
  if (typeof opts.getMainWindow === 'function') getMainWindow = opts.getMainWindow

  // 打开"选择软件程序/快捷方式"对话框，并提取其图标为 dataURL 返回
  ipcMain.handle('apps-select-file', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, error: '无主窗口' }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择常用软件',
      properties: ['openFile'],
      defaultPath: getDialogDir() || undefined,
      filters: [
        { name: '可执行程序与快捷方式', extensions: ['exe', 'lnk', 'bat', 'cmd'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const filePath = result.filePaths[0]
    setDialogDir(path.dirname(filePath))
    const entry = await resolveAppEntry(filePath)
    return { canceled: false, filePath, ...entry }
  })

  // 拖拽添加：渲染层把从桌面拖入的文件/文件夹/快捷方式路径一次性发来，
  // 这里统一校验存在性并提取名称/图标。渲染层拿不到真实路径时（旧版 Electron）
  // 会退回本地解析，因此这里静默跳过不存在的路径即可。
  ipcMain.handle('apps-resolve-paths', async (event, paths) => {
    const list = Array.isArray(paths) ? paths.slice(0, MAX_RESOLVE_PATHS) : []
    const out = []
    for (const p of list) {
      if (typeof p !== 'string' || !p) continue
      try {
        if (!fs.existsSync(p)) continue
        out.push(await resolveAppEntry(p))
      } catch (_) { /* 单个路径失败不影响其余项 */ }
    }
    return out
  })

  // 点击启动常用软件（.lnk/.exe/.bat/文件夹/普通文件均可走 shell.openPath）
  ipcMain.handle('apps-launch', (event, filePath) => {
    // 列表由后端持久化，渲染层仍可能被篡改后传入任意路径；
    // 这里只拒绝「不存在」与「系统保护目录」，保留用户自装软件（多在 Program Files）。
    const safe = resolveSafeLaunchPath(filePath)
    if (safe.error) return { error: safe.error }
    shell.openPath(safe.path)
    return {}
  })
}

module.exports = { registerAppsIpc }