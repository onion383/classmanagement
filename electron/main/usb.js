// =========================================================================
// usb.js —— U盘自动打开
//
// 检测到新 U 盘插入时，自动用文件资源管理器打开它（仅 Windows 生效）。
// 开关持久化在 userData/usb-auto-open.json，与后端业务数据库解耦，主进程启动即可读到。
//
// 叶子模块：仅依赖 electron(app, shell, ipcMain) 与 path/fs，不反向依赖其它业务模块。
// =========================================================================

const { app, shell, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

let usbAutoOpenEnabled = false
let usbPollTimer = null
let knownDrives = new Set()

function getUsbConfigPath() {
  return path.join(app.getPath('userData'), 'usb-auto-open.json')
}

function loadUsbAutoOpenConfig() {
  try {
    usbAutoOpenEnabled = !!JSON.parse(fs.readFileSync(getUsbConfigPath(), 'utf8')).enabled
  } catch (_) {
    usbAutoOpenEnabled = false
  }
}

function saveUsbAutoOpenConfig(enabled) {
  try { fs.writeFileSync(getUsbConfigPath(), JSON.stringify({ enabled })) } catch (_) {}
}

// 遍历 A-Z，返回当前所有存在的盘符集合（fs.access 探测，零依赖）
function getDriveLetters() {
  const drives = new Set()
  for (let i = 65; i <= 90; i++) {
    const drive = `${String.fromCharCode(i)}:\\`
    try { fs.accessSync(drive); drives.add(drive) } catch (_) {}
  }
  return drives
}

function startUsbWatch() {
  if (usbPollTimer || !usbAutoOpenEnabled) return
  // 用启动瞬间已挂载的盘做基线，避免把「本就在」的 U 盘误打开一次
  knownDrives = getDriveLetters()
  usbPollTimer = setInterval(() => {
    const current = getDriveLetters()
    for (const drive of current) {
      if (!knownDrives.has(drive)) {
        console.log(`[main] 检测到新存储设备：${drive}，自动打开`)
        shell.openPath(drive)
      }
    }
    knownDrives = current
  }, 1500)
}

function stopUsbWatch() {
  clearInterval(usbPollTimer)
  usbPollTimer = null
}

// 当前开关状态（供 whenReady 启动监听 / 设置页初始化）
function isUsbAutoOpenEnabled() {
  return usbAutoOpenEnabled
}

// 注册 U盘自动打开相关的请求-响应式 IPC 通道
function registerUsbIpc() {
  // 读取开关状态（供设置页初始化）
  ipcMain.handle('get-usb-auto-open', () => ({ enabled: usbAutoOpenEnabled }))

  // 设置开关：持久化并实时启停监听
  ipcMain.handle('set-usb-auto-open', (event, enabled) => {
    usbAutoOpenEnabled = !!enabled
    saveUsbAutoOpenConfig(usbAutoOpenEnabled)
    if (usbAutoOpenEnabled) startUsbWatch()
    else stopUsbWatch()
    return { enabled: usbAutoOpenEnabled }
  })
}

module.exports = { registerUsbIpc, loadUsbAutoOpenConfig, startUsbWatch, isUsbAutoOpenEnabled }