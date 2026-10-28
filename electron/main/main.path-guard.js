// =========================================================================
// path-guard.js —— 主进程 IPC 路径 / URL 白名单
//
// 背景：渲染层一旦被注入（XSS、恶意扩展、被篡改的本地页面），所有以
// 「路径参数」为输入的 IPC 都会变成「执行任意系统操作」的入口：
//   open-file / open-folder / screenshot-capture / note-save / apps-launch
// 都能被用来打开可执行文件、把任意字节写到任意目录。
//
// 本模块只做纯路径判定，不依赖 electron，便于单测直接覆盖：
//   · 只接受绝对路径，拒绝空串与 NUL 字节；
//   · 拒绝盘符根目录（避免 `shell.openPath('C:\\')` 这类整盘遍历）；
//   · 拒绝系统保护目录（Windows / System32 / WindowsApps 等）；
//   · 打开文件只允许「本进程刚写过」的路径（save-file 写入后登记）；
//   · 外链只放行 http/https。
//
// 注意：这里不是「允许目录白名单」（用户可能在任意盘符/自定义目录保存），
// 而是在「可写任意位置」与「完全不破坏既有功能」之间取的折中边界。
// =========================================================================

const path = require('path')
const fs = require('fs')

// 打开类通道（open-file）拒绝的可执行/脚本扩展名。
// open-file 只服务「导出后立即打开」，产物是 xlsx/pdf 等文档，不应出现这些后缀。
const DANGEROUS_EXTS = new Set([
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.scr',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.msi', '.reg', '.lnk',
])

// 额外保护目录（由 main.js 初始化时注入：安装目录、userData 等）
let extraProtectedRoots = []

function setProtectedRoots(list) {
  extraProtectedRoots = (Array.isArray(list) ? list : [])
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => path.normalize(p))
}

function systemProtectedRoots() {
  const roots = []
  if (process.platform === 'win32') {
    const winDir = process.env.SystemRoot || process.env.windir
    if (winDir) roots.push(winDir)
    const pf = process.env.ProgramFiles
    const pf86 = process.env['ProgramFiles(x86)']
    // WindowsApps 是系统托管目录：写入/启动都可能破坏系统应用
    if (pf) roots.push(path.join(pf, 'WindowsApps'))
    if (pf86) roots.push(path.join(pf86, 'WindowsApps'))
  } else {
    roots.push('/etc', '/usr', '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys')
    if (process.platform === 'darwin') roots.push('/System', '/Library')
  }
  return roots
}

// Windows 路径大小写不敏感：统一小写再比较，避免 `C:\WINDOWS` 绕过
function lower(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

function isWithin(child, root) {
  const rel = path.relative(lower(root), lower(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// 解析真实路径：用于阻断「junction / 符号链接指向保护目录」的绕过。
// 目标可能尚不存在（如新建保存目录），因此向上找到最近的已存在祖先再 realpath；
// 只要这个祖先落在保护根内，整条路径就不可用。
function realPathForCheck(p) {
  let cur = p
  for (let i = 0; i < 40; i++) {
    try {
      return fs.realpathSync(cur)
    } catch (_) {
      const parent = path.dirname(cur)
      if (parent === cur) break
      cur = parent
    }
  }
  return p
}

// 返回命中的保护根目录（未命中返回 null）
function matchProtectedRoot(p) {
  const real = realPathForCheck(p)
  for (const root of systemProtectedRoots().concat(extraProtectedRoots)) {
    if (!root) continue
    const realRoot = realPathForCheck(root)
    if (isWithin(p, root) || isWithin(real, root) || isWithin(real, realRoot)) return root
  }
  return null
}

function isDriveRoot(p) {
  return path.parse(p).root === p
}

// 绝对路径归一化：失败返回 null（调用方统一转成用户可读错误）
function normalizeAbsolute(input) {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw || raw.includes('\0')) return null
  if (!path.isAbsolute(raw)) return null
  return path.normalize(raw)
}

// ---------- open-folder ----------
// 必须是「已存在且确实是目录」的路径；拒绝盘符根与系统保护目录。
function resolveSafeFolder(input) {
  const p = normalizeAbsolute(input)
  if (!p) return { error: '路径无效：需要绝对路径' }
  if (isDriveRoot(p)) return { error: '不允许直接打开盘符根目录' }
  let st
  try {
    st = fs.statSync(p)
  } catch (_) {
    return { error: '目录不存在' }
  }
  if (!st.isDirectory()) return { error: '目标不是目录' }
  const protectedRoot = matchProtectedRoot(p)
  if (protectedRoot) return { error: `不允许打开系统保护目录：${protectedRoot}` }
  return { path: p }
}

// ---------- screenshot-capture / note-save 的写入目录 ----------
// 目录可以尚不存在（会自动 mkdir）；若已存在则必须是目录。
// fallback 由调用方传入（Pictures/screenshots），空 saveDir 时使用它。
function resolveSafeWriteDir(input, fallback) {
  const chosen = (typeof input === 'string' && input.trim()) ? input : fallback
  const p = normalizeAbsolute(chosen)
  if (!p) return { error: '保存目录无效：需要绝对路径' }
  if (isDriveRoot(p)) return { error: '不允许直接写入盘符根目录' }
  const protectedRoot = matchProtectedRoot(p)
  if (protectedRoot) return { error: `不允许写入系统保护目录：${protectedRoot}` }
  let st
  try {
    st = fs.statSync(p)
  } catch (_) {
    st = null
  }
  if (st && !st.isDirectory()) return { error: '保存目录指向的是文件' }
  return { path: p }
}

// ---------- apps-launch ----------
// 常用软件允许 .exe/.lnk/文件夹/普通文件，所以不按扩展名拦截；
// 只拒绝「不存在的路径」与系统保护目录（System32 / WindowsApps 等）。
function resolveSafeLaunchPath(input) {
  const p = normalizeAbsolute(input)
  if (!p) return { error: '路径无效：需要绝对路径' }
  try {
    fs.statSync(p)
  } catch (_) {
    return { error: '程序路径不存在' }
  }
  const protectedRoot = matchProtectedRoot(p)
  if (protectedRoot) return { error: `不允许启动系统保护目录中的程序：${protectedRoot}` }
  return { path: p }
}

// ---------- open-file ----------
// 只允许打开「本进程通过 save-file 写过」的文件：
// 渲染层即使被注入，也无法把任意 .exe 交给 shell.openPath。
const writtenFiles = new Map()
// 连续导出场景下 64 太小：同一会话导出超过 64 个文件后，最早的文件会被误判为「未写过」。
// 这里只做内存登记，200 个路径的开销可忽略。
const MAX_WRITTEN = 200

function markFileWritten(filePath) {
  const p = normalizeAbsolute(filePath)
  if (!p) return
  writtenFiles.delete(lower(p))
  writtenFiles.set(lower(p), p)
  if (writtenFiles.size > MAX_WRITTEN) {
    const oldest = writtenFiles.keys().next().value
    writtenFiles.delete(oldest)
  }
}

function resolveSafeOpenFile(input) {
  const p = normalizeAbsolute(input)
  if (!p) return { error: '路径无效：需要绝对路径' }
  if (DANGEROUS_EXTS.has(path.extname(p).toLowerCase())) {
    return { error: '不允许打开可执行/脚本文件' }
  }
  if (!writtenFiles.has(lower(p))) {
    return { error: '只允许打开本应用刚保存的文件' }
  }
  const protectedRoot = matchProtectedRoot(p)
  if (protectedRoot) return { error: `不允许打开系统保护目录中的文件：${protectedRoot}` }
  return { path: p }
}

// ---------- save-file 的「建议文件名」 ----------
// 渲染层可能把 `../x`、`C:\Windows\evil.exe` 之类当成 defaultName 传进来：
// 这里压平成「纯文件名」，避免 path.join 后跳出上次目录，也避免出现 Windows 非法字符。
// 只影响对话框里预填的名字，用户仍可自行改名。
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
function sanitizeSuggestedName(input, fallback = '导出文件') {
  const raw = typeof input === 'string' ? input : ''
  // 先取 basename 丢掉目录部分（含 ../ 与盘符路径），再替换残留的非法字符
  const base = path.basename(raw).replace(ILLEGAL_NAME_CHARS, '_').replace(/[. ]+$/, '').trim()
  return base || fallback
}

// ---------- 外链 ----------
// 只放行 http/https：显式排除 file: / javascript: / ms-msdt: 等可触发本地行为的协议。
function isHttpUrl(input) {
  if (typeof input !== 'string') return false
  try {
    const parsed = new URL(input.trim())
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname
  } catch (_) {
    return false
  }
}

module.exports = {
  setProtectedRoots,
  normalizeAbsolute,
  resolveSafeFolder,
  resolveSafeWriteDir,
  resolveSafeLaunchPath,
  resolveSafeOpenFile,
  markFileWritten,
  sanitizeSuggestedName,
  isHttpUrl,
  // 仅测试使用：清空「已写文件」登记
  _resetWrittenFiles: () => writtenFiles.clear(),
}
