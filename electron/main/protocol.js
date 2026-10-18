// =========================================================================
// protocol.js —— 渲染层静态资源服务：app:// 协议 + 渲染进程 V8 代码缓存
//
// 打包模式用自定义 app:// 安全协议加载前端，避免 file:// 的「不透明 origin」导致
// localStorage 仅会话内生效、每次重启即清空（表现：重新登录 + 设置还原）。
//
// 注意：协议本身的 registerSchemesAsPrivileged 必须在 app ready 前于入口(main.js)完成，
// 本模块只负责 ready 之后的 protocol.handle 注册与代码缓存目录设置。
// =========================================================================

const { app, session, protocol } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged

// 打包模式静态资源 MIME 表
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
}

// 注册 app:// 协议：从打包产物目录安全地提供静态文件（支持 asar 内 fs 流式读取）。
// 性能要点：不做任何逐请求的同步 fs（原 existsSync+statSync 会阻塞主进程），
// 只在启动时 readdir 一次拿到顶级 html 入口名单，之后纯按路径规则直接流式读盘。
// prod 下也不再逐请求打日志。
const IMMUTABLE_ASSET_RE = /\.(js|css|wasm|png|jpe?g|gif|webp|svg|woff2?)$/i

// 渲染进程 V8 代码缓存：把构建产物的 JS（首屏约 250KB）解析 + 编译结果缓存到磁盘，
// 第 2 次及以后启动直接复用。与主进程的 NODE_COMPILE_CACHE 对称。
// 注意：app:// 属自定义协议，除注册时声明 codeCache:true 外，还需在此显式指定缓存目录；
// 必须在首个页面加载前调用。不可用时静默忽略（退回 Chromium 默认行为）。
// 缓存条目按资源内容哈希命名，应用更新后旧条目永不命中，会随版本累积（实测可达 50MB+）。
// 故按应用版本号做一次性清理：版本未变则零开销直接返回；版本变化时后台异步删除旧条目，
// 不阻塞启动，删除失败（文件被占用）静默忽略，下次启动再试。
// 缓存目录体积上限：超过就把最旧的条目删到只剩 70%。
// 为什么需要：版本号清理只在「应用更新」时生效，同一版本内条目仍会累积
// （开发模式下 Vite 的模块 URL 带 hash、每次改动都产生新条目，实测可达 240MB+）。
// 代码缓存是可再生的（删掉只是下次启动多一次解析），因此按体积兜底清理不影响任何功能。
const CC_MAX_BYTES = 64 * 1024 * 1024
const CC_TARGET_RATIO = 0.7

// 递归算目录体积（字节）。只用于体积兜底判断，失败一律当 0。
async function dirSizeBytes(dir) {
  let total = 0
  let entries = []
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch (_) { return 0 }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    try {
      if (e.isDirectory()) total += await dirSizeBytes(p)
      else total += (await fs.promises.stat(p)).size
    } catch (_) { /* 单条失败忽略 */ }
  }
  return total
}

function pruneOversizeCodeCache(dir) {
  fs.promises.readdir(dir, { withFileTypes: true })
    .then(async (entries) => {
      const items = []
      let total = 0
      for (const e of entries) {
        if (e.name === '.cc-version') continue
        const p = path.join(dir, e.name)
        try {
          const st = await fs.promises.stat(p)
          const size = e.isDirectory() ? await dirSizeBytes(p) : st.size
          total += size
          items.push({ p, size, mtime: st.mtimeMs })
        } catch (_) { /* 忽略单项 */ }
      }
      if (total <= CC_MAX_BYTES) return
      const target = CC_MAX_BYTES * CC_TARGET_RATIO
      items.sort((a, b) => a.mtime - b.mtime) // 最旧的先删
      let cur = total
      for (const it of items) {
        if (cur <= target) break
        await fs.promises.rm(it.p, { recursive: true, force: true }).catch(() => {})
        cur -= it.size
      }
      console.log(`[main] 渲染代码缓存超限，已清理至约 ${Math.round(cur / 1048576)}MB`)
    })
    .catch(() => {})
}

function pruneStaleCodeCache(dir) {
  const marker = path.join(dir, '.cc-version')
  const cur = app.getVersion()
  let prev = ''
  try { prev = fs.readFileSync(marker, 'utf8').trim() } catch (_) {}
  if (prev === cur) return
  fs.promises.readdir(dir, { withFileTypes: true })
    .then((entries) => Promise.all(entries
      .filter((e) => e.name !== '.cc-version')
      .map((e) => fs.promises.rm(path.join(dir, e.name), { recursive: true, force: true }).catch(() => {}))))
    .then(() => fs.promises.writeFile(marker, cur, 'utf8').catch(() => {}))
    .catch(() => {})
}

function setupRendererCodeCache() {
  try {
    const dir = path.join(app.getPath('userData'), 'renderer-code-cache')
    fs.mkdirSync(dir, { recursive: true })
    pruneStaleCodeCache(dir)
    // 体积兜底：延后 8s 再跑。这一步要遍历整个缓存目录（可能上百 MB、上万个文件），
    // 立刻跑会和首屏资源的读取抢线程池 IO；它只是磁盘维护，晚几秒做完全等价。
    setTimeout(() => pruneOversizeCodeCache(dir), 8000)
    session.defaultSession.setCodeCachePath(dir)
  } catch (err) {
    console.error('[main] 渲染进程代码缓存不可用，跳过:', err?.message || err)
  }
}

function setupAppProtocol() {
  if (isDev) return
  const distDir = path.join(__dirname, '../../student-frontend/dist')
  const root = path.normalize(distDir)
  const indexHtml = path.join(root, 'index.html')

  // 顶级 html 入口（index/setup/widget/migration/desktop-widget…），仅枚举一次
  let htmlEntries = new Set()
  try {
    htmlEntries = new Set(fs.readdirSync(distDir).filter((f) => f.endsWith('.html')))
  } catch (_) {
    // dist 缺失时不阻断启动，后续请求走 index.html 回退
  }

  // 懒加载 stream：只有生产模式的静态资源流式返回用得到，挪出主进程启动关键路径
  const { Readable } = require('stream')
  const serveFile = (file, headers) =>
    new Response(Readable.toWeb(fs.createReadStream(file)), { headers })
  const serveIndex = () =>
    serveFile(indexHtml, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' })

  protocol.handle('app', (req) => {
    let p
    let file
    try {
      const url = new URL(req.url)
      p = decodeURIComponent(url.pathname)
      if (p === '/' || p === '') p = '/index.html'
      file = path.normalize(path.join(root, p))
      // 防目录穿越
      if (file !== root && !file.startsWith(root + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }
    } catch (_) {
      return new Response('Not Found', { status: 404 })
    }

    const ext = path.extname(file).toLowerCase()

    // 无扩展名 → 客户端路由（SPA），回退入口 html
    if (ext === '') return serveIndex()

    if (ext === '.html') {
      const name = p.replace(/^\/+/, '')
      // 已登记的顶级入口直接给；其余 html 路径按 SPA 路由回退
      if (!name.includes('/') && htmlEntries.has(name)) {
        return serveFile(file, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' })
      }
      return serveIndex()
    }

    // 其余带扩展名的静态资源（含 hash 命名的 bundle）：直接流式返回。
    // hash 资源可长缓存，让后续启动直接命中 Chromium 磁盘缓存；字体等短名资源不缓存。
    return serveFile(file, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': IMMUTABLE_ASSET_RE.test(file)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    })
  })
}

module.exports = { setupRendererCodeCache, setupAppProtocol }