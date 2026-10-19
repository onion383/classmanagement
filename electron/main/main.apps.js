// =========================================================================
// apps.js —— 桌面小组件·常用软件
//
// 列表已改由后端数据库持久化（/api/widget-settings/apps），主进程仅负责
// 「选择软件文件+提取图标」和「点击启动」两项平台能力。
// 每项：{ id, name, path, icon }（icon 为提取自 exe/.lnk 图标的 dataURL，可为空）。
//
// 依赖注入：主窗口引用由 main.js 通过 registerAppsIpc 注入（getMainWindow）；
// 上次访问目录复用 dialogs.js 的 getDialogDir/setDialogDir，保持跨对话框一致。
// =========================================================================

const { app, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const { getDialogDir, setDialogDir } = require('./main.dialogs')

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
    const ext = path.extname(filePath).toLowerCase()
    let name = path.basename(filePath, ext) || filePath
    // bat/cmd 显示名字会带扩展名，去掉小尾巴，更整洁
    if (['.bat', '.cmd'].includes(ext)) name = path.basename(filePath, ext)
    let icon = ''
    try {
      // 快捷方式(.lnk)本身取不到目标程序图标，先解析出目标 exe 再取其图标
      const iconTarget = ext === '.lnk' ? await resolveLnkTarget(filePath) : ''
      const img = await app.getFileIcon(iconTarget || filePath, { size: 'large' })
      icon = img.toDataURL()
    } catch (_) { /* 图标提取失败则留空 */ }
    return { canceled: false, filePath, name, icon }
  })

  // 点击启动常用软件（.lnk/.exe/.bat 均可走 shell.openPath）
  ipcMain.handle('apps-launch', (event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { error: '路径为空' }
    shell.openPath(filePath)
    return {}
  })
}

module.exports = { registerAppsIpc }