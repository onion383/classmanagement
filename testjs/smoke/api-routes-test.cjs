/**
 * api-routes-test.cjs —— 真实路由 + 隔离加密库的接口级回归
 *
 * 覆盖台账「待验证清单」里能脚本化的几条（不靠人手点界面）：
 *   · B02-07 畸形 Range 头：必须 416，不能把 start/end 传反后进 createReadStream
 *   · B04-07 值日 cells 的落盘结构：保存后是否已是 {daily,big} 按模式打包
 *   · B09-04 /api/ai/models/discover：表单没填密钥时是否复用同服务商已存密钥
 *   · B03-02 快照还原后 AI 列缓存是否失效（还原把表结构退回旧版，缓存不能停在旧结构）
 *   · B03-07 上游 SSE 尾块不带换行时，consumeStream 不能丢掉最后一帧
 *   · P0-05 album_delete.undo 是否保留 kind='virtual'（虚拟相册撤销后仍是虚拟相册）
 *
 * 做法：不启动完整后端（那需要真实的 userData 和数据目录），而是
 *   ① 用临时 DATA_DIR + 测试主密钥建一个**真实加密库**（dbManager.createTeacher）；
 *   ② 把真实路由挂在最小 Express 上，用 dbManager.withDb 绑定 ALS 上下文（等价于 auth 中间件）；
 *   ③ 走真实 HTTP 请求 / 真实 SQL，断言落盘结果。
 *
 * 跑法：node testjs/smoke/api-routes-test.cjs
 * 退出码：0 = 全部通过；1 = 有断言失败
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')

const ROOT = path.join(__dirname, '..', '..')
const BACKEND = path.join(ROOT, 'student-backend')
const BACKEND_MODULES = path.join(BACKEND, 'node_modules')

// 隔离环境：必须在 require dbManager 之前设置（dbManager.base 在加载时校验主密钥）
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'banji-api-routes-'))
process.env.DB_MASTER_KEY = 'api-routes-smoke-master-key'
process.env.DATA_DIR = DATA_DIR
process.env.ALBUM_THUMBS_DIR = path.join(DATA_DIR, 'album-thumbs')

const express = require(path.join(BACKEND_MODULES, 'express'))
const dbManager = require(path.join(BACKEND, 'dbManager', 'dbManager'))
const helpers = require(path.join(BACKEND, 'routes', 'ai', 'ai.helpers'))
const { executors } = require(path.join(BACKEND, 'routes', 'undo', 'undo.executors'))
const { consumeStream } = require(path.join(BACKEND, 'routes', 'ai', 'ai.llm'))

const albumRouter = require(path.join(BACKEND, 'routes', 'album'))
const dutyRouter = require(path.join(BACKEND, 'routes', 'duty'))
const seatsRouter = require(path.join(BACKEND, 'routes', 'seats'))
const accountRouter = require(path.join(BACKEND, 'routes', 'account'))
const { auth, SECRET } = require(path.join(BACKEND, 'middleware', 'auth'))
const sessions = require(path.join(BACKEND, 'services', 'sessions'))
const jwt = require(path.join(BACKEND_MODULES, 'jsonwebtoken'))
const aiConfigRouter = require(path.join(BACKEND, 'routes', 'ai', 'ai.config'))
const aiDataRouter = require(path.join(BACKEND, 'routes', 'ai', 'ai.dataRoutes'))
const { SEAT_MAX_ROWS, SEAT_MAX_COLS } = require(path.join(BACKEND, 'services', 'sanitize'))

const USERNAME = 'api-routes-smoke'
const { slug } = dbManager.createTeacher(USERNAME, 'not-a-real-hash', 'teacher')

// ---------- 断言收集器 ----------
let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok && detail !== undefined) {
    console.log('    →', typeof detail === 'string' ? detail.slice(0, 300) : JSON.stringify(detail).slice(0, 300))
  }
}

// ---------- HTTP 工具 ----------
function request(port, { method = 'GET', path: reqPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let len = 0
      let text = ''
      res.on('data', (c) => { len += c.length; if (text.length < 4000) text += c.toString('utf8') })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(text) } catch (_) { /* 非 JSON（如 206 的二进制体） */ }
        resolve({ status: res.statusCode, headers: res.headers, bodyLen: len, json, text })
      })
    })
    req.on('error', (e) => resolve({ status: 0, error: e.message }))
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }) })
    if (body !== undefined) req.write(body)
    req.end()
  })
}

const postJson = (port, reqPath, obj) => request(port, {
  method: 'POST',
  path: reqPath,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj || {}),
})

// ---------- 造数据：相册照片（源文件 + 索引行） ----------
const MEDIA_SIZE = 4096
const mediaPath = path.join(DATA_DIR, 'clip.mp4')
fs.writeFileSync(mediaPath, Buffer.alloc(MEDIA_SIZE, 7))

dbManager.withDb(slug, () => {
  const conn = dbManager.current()
  conn.prepare('INSERT INTO albums (id, name, folder_path, kind) VALUES (?, ?, ?, ?)')
    .run(1, '冒烟相册', DATA_DIR, 'virtual')
  conn.prepare('INSERT INTO album_photos (id, album_id, file_path, file_name, file_size) VALUES (?, ?, ?, ?, ?)')
    .run(1, 1, mediaPath, 'clip.mp4', MEDIA_SIZE)
})

// ---------- 最小 Express：真实路由 + ALS 绑定 ----------
const app = express()
app.use(express.json({ limit: '4mb' }))
// 等价于 auth 中间件：写入 req.user（AI 路由从这里取 dbSlug）并绑定当前库的 ALS 上下文
const bind = (req, res, next) => {
  req.user = { username: USERNAME, role: 'teacher', dbSlug: slug }
  dbManager.withDb(slug, () => next())
}
app.use('/api/album', bind, albumRouter)
app.use('/api/duty', bind, dutyRouter)
app.use('/api/seats', bind, seatsRouter)
// 账号路由自带 auth()，直接挂载（用真实 token 走鉴权，不用 bind 旁路）
app.use('/api/account', accountRouter)
// P0-01 探针：一个受 auth() 保护的普通业务接口，用来验证恢复态 token 不能越权
app.get('/api/recover-probe', auth(['teacher']), (req, res) => res.json({ ok: true }))
app.use('/api/ai', bind, aiConfigRouter)
app.use('/api/ai', bind, aiDataRouter)

// ---------- 上游模型 mock：/models 与 /chat/completions ----------
let seenAuth = ''
let sseMode = 'content-tailed'
// 命中记录：断言失败时能直接看出「请求到底有没有到 mock」
const mockHits = []
const mockHandler = (req, res) => {
  const url = req.url || ''
  mockHits.push(`${req.method} ${url} auth=${req.headers.authorization || '-'}`)
  // POST 带 body 时必须把请求体读掉，否则 keep-alive 连接上残留数据会影响后续请求
  req.resume()
  if (url.includes('/models')) {
    seenAuth = req.headers.authorization || ''
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ data: [{ id: 'mock-model-1' }] }))
  }
  if (url.includes('/chat/completions')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
    if (sseMode === 'content-tailed') {
      // 第一帧正常换行结尾，最后一帧（内容块）故意不带换行 —— 上游常见行为
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '你' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '好' } }] })}`)
    } else {
      // 只带用量的尾块也不带换行
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '好' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ usage: { total_tokens: 7 } })}`)
    }
    return res.end()
  }
  res.writeHead(404)
  res.end()
}

// 用 http.Server 包一层：Express 的 app.listen 不返回句柄，收尾时没法主动关闭
const listen = (handler) => {
  const server = http.createServer(handler)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })))
}

;(async () => {
  const { server, port } = await listen(app)
  const { server: mock, port: mockPort } = await listen(mockHandler)
  const mockBase = `http://127.0.0.1:${mockPort}/v1`

  // ===== B02-07 畸形 / 越界 Range =====
  console.log('== B02-07 Range 头校验 ==')
  let r = await request(port, { path: '/api/album/photo/1/file', headers: { Range: 'bytes=500-100' } })
  check('start > end（bytes=500-100）→ 416', r.status === 416, r)
  r = await request(port, { path: '/api/album/photo/1/file', headers: { Range: 'bytes=abc' } })
  check('非数字 Range（bytes=abc）→ 416', r.status === 416, r)
  r = await request(port, { path: '/api/album/photo/1/file', headers: { Range: `bytes=${MEDIA_SIZE}-` } })
  check('start 越界（=文件大小）→ 416', r.status === 416, r)
  r = await request(port, { path: '/api/album/photo/1/file', headers: { Range: 'bytes=0-99' } })
  check('合法区间 bytes=0-99 → 206 且只回 100 字节', r.status === 206 && r.bodyLen === 100, r)
  r = await request(port, { path: '/api/album/photo/1/file', headers: { Range: 'bytes=-100' } })
  check('后缀区间 bytes=-100 → 206 且只回 100 字节', r.status === 206 && r.bodyLen === 100, r)
  r = await request(port, { path: '/api/album/photo/1/file' })
  check('不带 Range → 200 且回整文件', r.status === 200 && r.bodyLen === MEDIA_SIZE, r)
  r = await request(port, { path: '/api/album/photo/1/file', headers: { Range: `bytes=0-${MEDIA_SIZE + 500}` } })
  check('end 超出文件末尾 → 206 且被夹到文件末', r.status === 206 && r.bodyLen === MEDIA_SIZE, r)

  // ===== B04-07 值日 cells 的落盘结构 =====
  console.log('\n== B04-07 值日 cells 结构 ==')
  const putDaily = await request(port, {
    method: 'PUT',
    path: '/api/duty?mode=daily',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cells: {}, settings: {} }),
  })
  const putBig = await request(port, {
    method: 'PUT',
    path: '/api/duty?mode=big',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cells: {}, settings: {} }),
  })
  check('按模式保存 daily / big 均成功', putDaily.status === 200 && putBig.status === 200, { putDaily, putBig })
  const cellsKeys = dbManager.withDb(slug, () => {
    const row = dbManager.current().prepare('SELECT cells FROM duty_layout WHERE id = 1').get()
    if (!row || !row.cells) return []
    try { return Object.keys(JSON.parse(row.cells)).sort() } catch (_) { return ['<非法 JSON>'] }
  })
  check('落盘后 cells 已是 {daily,big} 分模式结构', cellsKeys.join(',') === 'big,daily', cellsKeys.join(','))

  // ===== P0-06 座位单格 PATCH 的坐标边界 =====
  console.log('\n== P0-06 座位坐标边界 ==')
  const patchCell = (reqPath, obj) => request(port, {
    method: 'PATCH',
    path: reqPath,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  })
  r = await patchCell('/api/seats/cell', { row: SEAT_MAX_ROWS, col: 0, value: 1 })
  check(`行坐标 = 上限（${SEAT_MAX_ROWS}）→ 400`, r.status === 400, r.json || r.text)
  r = await patchCell('/api/seats/cell', { row: 0, col: SEAT_MAX_COLS, value: 1 })
  check(`列坐标 = 上限（${SEAT_MAX_COLS}）→ 400`, r.status === 400, r.json || r.text)
  r = await patchCell('/api/seats/cell', { row: -1, col: 0, value: 1 })
  check('负坐标 → 400', r.status === 400, r.json || r.text)
  r = await patchCell('/api/seats/cell', { row: 0.5, col: 0, value: 1 })
  check('小数坐标 → 400', r.status === 400, r.json || r.text)
  r = await patchCell('/api/seats/master/cell', { row: SEAT_MAX_ROWS, col: 0, value: 1 })
  check('模板表越界坐标 → 400', r.status === 400, r.json || r.text)
  r = await patchCell('/api/seats/cell', { row: 0, col: 0, value: null })
  check('合法坐标（0,0）→ 200', r.status === 200 && !!r.json && r.json.message === '已更新', r.json || r.text)

  // ===== B09-04 discover 复用已存密钥 =====
  console.log('\n== B09-04 discover 密钥复用 ==')
  dbManager.withDb(slug, () => {
    dbManager.current()
      .prepare('INSERT INTO ai_models (name, provider, base_url, model, api_key, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run('冒烟模型', 'custom', mockBase, 'mock-1', 'stored-key')
  })
  seenAuth = ''
  mockHits.length = 0
  r = await postJson(port, '/api/ai/models/discover', { provider: 'custom', base_url: mockBase })
  check('表单未填密钥时 discover 成功', r.status === 200 && r.json && r.json.success === true, r.json || r.text)
  check('复用的是同服务商已存密钥（Authorization: Bearer stored-key）', seenAuth === 'Bearer stored-key', seenAuth)
  check('返回了 mock 服务商的模型列表', !!r.json && Array.isArray(r.json.models) && r.json.models.includes('mock-model-1'), r.json)
  if (mockHits.length === 0) console.log('    mock 未收到任何请求（上游 fetch 没发出去）')
  else console.log('    mock 命中：', mockHits.join(' | '))

  // ===== B03-07 SSE 尾块不带换行 =====
  console.log('\n== B03-07 SSE 尾帧解析 ==')
  const cfg = { provider: 'custom', base_url: mockBase, model: 'mock-1', api_key: 'k' }
  // 额外传一个 10s 的 clientSignal：mock 没响应时快速失败，不让冒烟卡在上游 120s 超时
  const stream = (mode) => {
    sseMode = mode
    return consumeStream(cfg, [{ role: 'user', content: 'hi' }], null, null, AbortSignal.timeout(10000), [])
      .then((o) => ({ out: o }))
      .catch((e) => ({ err: e }))
  }
  mockHits.length = 0
  let res1 = await stream('content-tailed')
  check('内容尾帧无换行时不丢字（应为「你好」）', !!res1.out && res1.out.text === '你好', res1.err ? res1.err.message : res1.out.text)
  let res2 = await stream('usage-tailed')
  check('用量尾帧无换行时仍被解析（total_tokens=7）', !!res2.out && !!res2.out.usage && res2.out.usage.total_tokens === 7,
    res2.err ? res2.err.message : res2.out.usage)
  if (mockHits.length === 0) console.log('    mock 未收到任何请求（上游 fetch 没发出去）')
  else console.log('    mock 命中：', mockHits.join(' | '))

  // ===== B03-02 快照还原后列缓存失效 =====
  console.log('\n== B03-02 还原后列缓存 ==')
  const snap = await postJson(port, '/api/ai/snapshot', {})
  check('创建快照成功', snap.status === 200 && snap.json && snap.json.ok === true, snap.json || snap.text)
  // 模拟「快照之后库结构变了」：加一列，并把 AI 的列缓存预热成含该列的版本
  const primed = dbManager.withDb(slug, () => {
    dbManager.current().exec('ALTER TABLE students ADD COLUMN 曾用名 TEXT')
    return helpers.tableColumns('students')
  })
  check('预热缓存已包含新增列「曾用名」', primed.includes('曾用名'), primed)
  const restored = await postJson(port, '/api/ai/snapshot/restore', { snapshot: snap.json && snap.json.snapshot })
  check('还原快照成功', restored.status === 200 && restored.json && restored.json.ok === true, restored.json || restored.text)
  const afterRestore = dbManager.withDb(slug, () => helpers.tableColumns('students'))
  const realCols = dbManager.withDb(slug, () => dbManager.current()
    .prepare('PRAGMA table_info(students)').all().map((c) => c.name))
  check('还原后真实表结构已退回（无「曾用名」）', !realCols.includes('曾用名'), realCols.join(','))
  check('还原后 AI 列缓存同步失效（不含「曾用名」）', !afterRestore.includes('曾用名'), afterRestore.join(','))

  // ===== P0-05 album_delete.undo 保留 kind='virtual' =====
  console.log('\n== P0-05 虚拟相册撤销 ==')
  const undoRes = await (async () => {
    try {
      // executors 走 db 代理，必须在请求上下文（ALS）里调用
      await dbManager.withDb(slug, () => executors.album_delete.undo({
        album: { id: 9, name: '虚拟相册', folder_path: '', kind: 'virtual', sort_order: 1 },
        photos: [{ id: 91, file_path: path.join(DATA_DIR, 'not-exist.jpg'), file_name: 'a.jpg' }],
      }))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })()
  check('album_delete.undo 执行成功', undoRes.ok, undoRes.error)
  const kindRow = dbManager.withDb(slug, () => dbManager.current()
    .prepare('SELECT kind FROM albums WHERE id = 9').get())
  check('撤销后相册 kind 仍是 virtual', !!kindRow && kindRow.kind === 'virtual', kindRow)
  const photoRow = dbManager.withDb(slug, () => dbManager.current()
    .prepare('SELECT COUNT(*) AS n FROM album_photos WHERE album_id = 9').get())
  check('撤销后照片索引一并恢复', !!photoRow && photoRow.n === 1, photoRow)

  // ===== P0-01「本机信息恢复」token 的权限边界 =====
  console.log('\n== P0-01 恢复态 token 边界 ==')
  const authHeader = (token) => ({ Authorization: `Bearer ${token}` })
  const sid = sessions.create(1)
  const recoverToken = jwt.sign(
    { userId: 1, username: USERNAME, role: 'teacher', dbSlug: slug, sid, recover: true },
    SECRET,
    { expiresIn: '1h' },
  )
  r = await request(port, { path: '/api/recover-probe', headers: authHeader(recoverToken) })
  check('恢复态 token 调普通业务接口 → 401 且 code=RECOVER_SCOPE_ONLY',
    r.status === 401 && !!r.json && r.json.code === 'RECOVER_SCOPE_ONLY', r.json || r.text)
  r = await request(port, {
    method: 'PUT',
    path: '/api/account/password',
    headers: { 'Content-Type': 'application/json', ...authHeader(recoverToken) },
    body: JSON.stringify({ newPassword: 'recover123456' }),
  })
  check('恢复态 token 免旧密码即可设置新密码', r.status === 200 && !!r.json, r.json || r.text)
  const freshToken = r.json && r.json.token
  const freshPayload = freshToken ? jwt.decode(freshToken) : null
  check('改密后换发不含 recover 的新 token，且换了新 sid',
    !!freshPayload && freshPayload.recover !== true && freshPayload.sid !== sid, freshPayload)
  r = await request(port, { path: '/api/recover-probe', headers: authHeader(recoverToken) })
  check('旧恢复态 token 立即失效（旧 sid 已吊销）', r.status === 401, r.json || r.text)
  r = await request(port, { path: '/api/recover-probe', headers: authHeader(freshToken) })
  check('新 token 可正常调用业务接口', r.status === 200 && !!r.json && r.json.ok === true, r.json || r.text)

  // ---------- 收尾 ----------
  await Promise.all([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => mock.close(resolve)),
  ])
  console.log(`\n${failed ? `${failed} 项断言失败` : '全部断言通过'}`)
  // 关闭库连接与临时目录（Windows 下句柄未关会删不掉，失败可忽略）
  try { dbManager.evictConn(slug) } catch (_) { /* 忽略 */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }) } catch (_) { /* 忽略 */ }
  process.exit(failed ? 1 : 0)
})().catch((err) => {
  console.error('冒烟异常：', err && err.stack || err)
  process.exit(1)
})
