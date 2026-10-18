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

const fsp = fs.promises

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

// 遍历 A-Z，返回当前所有存在的盘符集合（fs.access 探测，零依赖）。
// 【为什么是异步】单个盘符的探测交给 libuv 线程池，不占用主进程事件循环。
// 若某个盘符是「存在但不可达」的（断开的网络映射盘、空读卡器槽），Windows 下
// 同步 access 会把主进程整条阻塞数百毫秒 —— 那一瞬间窗口、菜单、IPC 全停。
// 改成异步后，只有这一次探测自己慢，界面照常响应。
// 【为什么串行而不是 Promise.all】并发 26 个会把线程池默认的 4 个槽位占满，
// 反而排挤协议层读文件等其它异步 IO；串行只在「有慢盘符」时才慢，正常机器上全扫不到 1ms。
async function getDriveLetters() {
  const drives = new Set()
  for (let i = 65; i <= 90; i++) {
    const drive = `${String.fromCharCode(i)}:\\`
    try { await fsp.access(drive); drives.add(drive) } catch (_) { /* 不存在或不可达 */ }
  }
  return drives
}

// 基线是否就绪 / 是否有一轮探测正在跑（存在慢盘符时防止探测堆积）
let usbBaselineReady = false
let usbProbing = false

function startUsbWatch() {
  if (usbPollTimer || !usbAutoOpenEnabled) return
  // 用启动瞬间已挂载的盘做基线，避免把「本就在」的 U 盘误打开一次。
  // 基线改为异步获取：取到之前不做比对（否则第一次 tick 会误报）。
  usbBaselineReady = false
  readDriveLettersBaseline()
  usbPollTimer = setInterval(async () => {
    // 基线未就绪、或上一轮还没探完（说明有慢盘符）就跳过本轮，避免并发探测叠加
    if (!usbBaselineReady || usbProbing) return
    usbProbing = true
    try {
      const current = await getDriveLetters()
      for (const drive of current) {
        if (!knownDrives.has(drive)) {
          console.log(`[main] 检测到新存储设备：${drive}，自动打开`)
          shell.openPath(drive)
        }
      }
      knownDrives = current
    } catch (_) { /* 单轮探测异常不影响后续轮询 */ }
    finally { usbProbing = false }
  }, 1500)
}

function readDriveLettersBaseline() {
  getDriveLetters().then((set) => {
    if (!usbPollTimer) return // 期间已被 stop，别覆盖状态
    knownDrives = set
    usbBaselineReady = true
  }).catch(() => { usbBaselineReady = true })
}

function stopUsbWatch() {
  clearInterval(usbPollTimer)
  usbPollTimer = null
  usbBaselineReady = false
  usbProbing = false
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