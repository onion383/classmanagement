// =========================================================================
// updater.js —— 版本更新（自建：GitHub Releases + Inno Setup 静默升级）
//
// 已移除 electron-updater，改为自建三段式流程：
//   1) 检查：请求 GitHub releases/latest，比较 tag 与当前版本；
//   2) 下载：把 release 里的 Inno 安装包资产下到 userData 临时目录（边下边报进度）；
//   3) 安装：update-install 时用 Inno 静默参数启动安装包并退出本进程（装完自动重启）。
// 主进程是更新状态的唯一权威来源，渲染层通过 from-main{type:'update-state'} 订阅；
// IPC 通道名与状态字段与旧实现完全一致，前端无需任何改动。
//
// 依赖注入：状态广播只发给主窗口，用 sendToMain(payload) 由 main.js 提供
// （内部自带 mainWindow 空判与 isDestroyed 判空，本模块不直接持有窗口引用）。
// =========================================================================

const { app, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { assertHttpsUrl, verifyDownloadedFile } = require('./main.update-integrity')

// GitHub 仓库信息（原先在 electron-builder.json 的 publish 里，现仅保留在代码常量中）
const UPDATE_REPO = { owner: 'onion383', repo: 'classmanagement' }
// Inno 安装包资产名匹配（如「班集-Setup-0.8.0.exe」）
const UPDATE_ASSET_RE = /setup.*\.exe$/i
// 检查超时沿用既有 10s 风格；下载体积较大，整体超时放宽到 5 分钟
const UPDATE_CHECK_TIMEOUT = 10000
const UPDATE_DOWNLOAD_TIMEOUT = 300000

// 更新状态快照：主进程是唯一权威来源，渲染层通过 from-main{type:'update-state'} 订阅
let updateState = {
  status: 'idle', // idle | checking | available | downloading | downloaded | not-available | error
  currentVersion: app.getVersion(),
  latestVersion: null,
  percent: 0,
  error: null,
}

// 已下载到本地的安装包绝对路径（供 update-install 使用）
let downloadedInstallerPath = null
// 流程互斥：避免重复检查 / 并发下载
let updateFlowRunning = false

// 状态广播出口：由 registerUpdateIpc 注入（main.js 提供，内部判空 mainWindow）
let sendToMain = () => {}

function broadcastUpdateState() {
  const payload = { type: 'update-state', state: { ...updateState } }
  sendToMain(payload)
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch }
  broadcastUpdateState()
}

// 版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0
function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

// 把底层报错转成对用户友好的提示
function friendlyUpdateError(err) {
  const msg = (err && err.message) || String(err || '')
  console.log('[update] 检查失败：', msg)
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|fetch failed|network|socket hang up|aborted/i.test(msg)) {
    return '网络连接失败，请检查网络后重试'
  }
  if (/404|not found|no published|cannot find/i.test(msg)) {
    return '未找到可用更新（仓库中暂无发布版本）'
  }
  return msg || '未知错误'
}

// 请求 GitHub Releases 最新发布（带超时中断，失败抛错交由上层映射为友好文案）
async function fetchLatestRelease() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT)
  try {
    const url = `https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'campus-assistant' },
      signal: controller.signal,
    })
    if (!res.ok) {
      const err = new Error(res.status === 404 ? '仓库中暂无发布版本' : `请求失败（HTTP ${res.status}）`)
      err.status = res.status
      throw err
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// 从 release 资产中挑选 Inno 安装包（文件名形如「*-Setup-*.exe」）
function pickSetupAsset(release) {
  const assets = Array.isArray(release && release.assets) ? release.assets : []
  return assets.find((a) => UPDATE_ASSET_RE.test(String((a && a.name) || ''))) || null
}

// 开发/调试路径：仅直连探测 GitHub Releases，不下载、不安装
async function checkUpdateViaGitHub() {
  setUpdateState({ status: 'checking', error: null, percent: 0 })
  try {
    const data = await fetchLatestRelease()
    const latest = String((data && data.tag_name) || '').replace(/^v/i, '')
    const current = app.getVersion()
    if (latest && compareVersions(latest, current) > 0) {
      setUpdateState({ status: 'available', latestVersion: latest, error: null })
    } else {
      setUpdateState({ status: 'not-available', latestVersion: latest || current, percent: 0, error: null })
    }
  } catch (err) {
    setUpdateState({ status: 'error', error: friendlyUpdateError(err) })
  }
}

// 下载安装包到 userData/update-cache 并推送 downloading 进度；失败时清理半成品并抛出
async function downloadInstaller(asset, version) {
  const { Readable } = require('stream')
  const { pipeline } = require('stream/promises')
  const dir = path.join(app.getPath('userData'), 'update-cache')
  fs.mkdirSync(dir, { recursive: true })
  const fileName = String((asset && asset.name) || `班集-Setup-${version}.exe`)
  const target = path.join(dir, fileName)
  try { fs.rmSync(target, { force: true }) } catch (_) { /* 清理旧文件失败忽略 */ }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPDATE_DOWNLOAD_TIMEOUT)
  try {
    // 下载地址必须是 HTTPS：否则 release 资产可被替换成明文/本地地址
    const downloadUrl = String(asset.browser_download_url || '')
    assertHttpsUrl(downloadUrl)
    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'campus-assistant' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
    // 重定向后的最终地址同样必须是 HTTPS（GitHub 会跳到 objects.githubusercontent.com）
    if (res.url) assertHttpsUrl(res.url)
    const expectedSize = Number(asset.size) || Number(res.headers.get('content-length')) || 0
    let received = 0
    // Node fetch 返回 web ReadableStream，转成 Node 流后边写边算百分比
    const nodeStream = Readable.fromWeb(res.body)
    nodeStream.on('data', (chunk) => {
      received += chunk.length
      if (expectedSize > 0) setUpdateState({ status: 'downloading', percent: Math.round((received / expectedSize) * 100) })
    })
    await pipeline(nodeStream, fs.createWriteStream(target))
    // 完整性校验：大小 +（发布方提供时）SHA-256。原先只比 Content-Length，
    // 既挡不住资产被替换，也挡不住中间劫持（B01-12）。
    const verified = await verifyDownloadedFile({ filePath: target, expectedSize, digest: asset.digest })
    if (!verified.ok) throw new Error(verified.error)
    if (verified.verified === 'size-only') {
      console.warn('[update] 发布资产未提供 digest，本次仅按大小校验：', fileName)
    }
    downloadedInstallerPath = target
  } catch (err) {
    try { fs.rmSync(target, { force: true }) } catch (_) { /* 忽略 */ }
    downloadedInstallerPath = null
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// 打包环境完整流程：checking → （无更新）not-available / （有更新）available → downloading → downloaded
async function runUpdateFlow() {
  if (!app.isPackaged || updateFlowRunning) return
  updateFlowRunning = true
  // 同步先推 checking（在首个 await 之前，保证 update-check 返回的快照即 checking）
  setUpdateState({ status: 'checking', error: null, percent: 0 })
  try {
    const release = await fetchLatestRelease()
    const latest = String((release && release.tag_name) || '').replace(/^v/i, '')
    const current = app.getVersion()
    if (!latest || compareVersions(latest, current) <= 0) {
      setUpdateState({ status: 'not-available', latestVersion: latest || current, percent: 0, error: null })
      return
    }
    setUpdateState({ status: 'available', latestVersion: latest, error: null, percent: 0 })
    const asset = pickSetupAsset(release)
    if (!asset) {
      setUpdateState({ status: 'error', error: '未找到安装包（发布资产中缺少 Setup 安装程序）' })
      return
    }
    await downloadInstaller(asset, latest)
    setUpdateState({ status: 'downloaded', latestVersion: latest, percent: 100, error: null })
  } catch (err) {
    setUpdateState({ status: 'error', error: friendlyUpdateError(err) })
  } finally {
    updateFlowRunning = false
  }
}

// 启动时清理 update-cache：安装包下载完就交给 Inno 安装器并退出本进程，退出前没机会删它，
// 于是每次更新都会在 userData 里留下一个上百 MB 的安装包（文件名带版本号，会逐版本累积）。
// 更新状态只存在内存里（重启后必然重新检查并按需重下），故启动时清空整个目录是安全的。
function pruneUpdateCache() {
  try {
    const dir = path.join(app.getPath('userData'), 'update-cache')
    if (!fs.existsSync(dir)) return
    let freed = 0
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      try {
        const st = fs.statSync(p)
        if (st.isFile()) freed += st.size
        fs.rmSync(p, { recursive: true, force: true })
      } catch (_) { /* 单个条目失败忽略 */ }
    }
    if (freed > 0) console.log(`[updater] 已清理上次遗留的更新安装包，释放 ${(freed / 1048576).toFixed(1)} MB`)
  } catch (_) { /* 清理失败不影响更新功能 */ }
}

// 注册版本更新相关的 IPC 通道。send(payload) 由 main.js 提供，用于向主窗口推 update-state。
function registerUpdateIpc(send) {
  if (typeof send === 'function') sendToMain = send

  pruneUpdateCache()

  ipcMain.handle('get-app-version', () => app.getVersion())

  // 检查更新：进入「关于」页 / 手动点击触发；立即返回当前状态快照，后续变化走 from-main 广播
  ipcMain.handle('update-check', async () => {
    if (app.isPackaged) {
      // 打包环境：后台走完整「检查 + 下载」流程（立即返回，结果靠事件推送）
      runUpdateFlow()
      return { ...updateState }
    }
    // 未打包（开发/调试）：仅直连探测，不下载、不安装
    await checkUpdateViaGitHub()
    return { ...updateState }
  })

  // 用户确认后：以 Inno 静默参数启动已下载的安装包，随后退出本进程（安装器装完会自动重启）
  ipcMain.on('update-install', () => {
    if (!app.isPackaged) return
    if (!downloadedInstallerPath || !fs.existsSync(downloadedInstallerPath)) {
      setUpdateState({ status: 'error', error: '安装包尚未下载完成' })
      return
    }
    try {
      const { spawn } = require('child_process')
      // Inno 静默安装参数：
      //   /SILENT             无界面安装
      //   /CLOSEAPPLICATIONS  自动关闭占用目标文件的旧进程
      //   /RESTARTAPPLICATIONS 安装完成后自动重启被关闭的应用
      const child = spawn(downloadedInstallerPath, ['/SILENT', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      // 置退出标志（跳过「关闭确认/托盘存活」逻辑）并退出，释放单实例锁供安装器替换文件
      app.isQuitting = true
      setTimeout(() => app.quit(), 500)
    } catch (err) {
      setUpdateState({ status: 'error', error: friendlyUpdateError(err) })
    }
  })
}

module.exports = { registerUpdateIpc, runUpdateFlow }