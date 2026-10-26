/**
 * body-parser 升级（2.3.0 → 2.4.0）后的请求体解析冒烟
 *
 * 这次安全补丁修的正是「压缩请求体带尾部多余字节」的 DoS 路径，所以冒烟要覆盖：
 *   ① 普通 JSON
 *   ② urlencoded（表单）
 *   ③ gzip 压缩体（漏洞涉及的分支）
 *   ④ 压缩体带尾部垃圾字节（原漏洞触发姿势）—— 应正常解析或干净报错，不能挂住
 *   ⑤ 超大体积被 limit 拦截
 *
 * 不启动真实后端（那需要 DB_MASTER_KEY 和数据目录），只用一个最小 Express app。
 *
 * 跑法：node testjs/api-smoke.cjs
 */
const http = require('node:http')
const zlib = require('node:zlib')
const path = require('node:path')
// 相对 __dirname 解析（原先是相对 cwd 的 '../student-backend'，移动目录后会失效）
const BACKEND = path.join(__dirname, '..', '..', 'student-backend', 'node_modules')
const express = require(`${BACKEND}/express`)
const multer = require(`${BACKEND}/multer`)

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))
app.post('/echo', (req, res) => res.json({ ok: true, body: req.body }))
// multer 这次也顺带从 2.4.0 升到 2.5.0，一并冒烟（文件上传走 AI 附件 / Excel 导入 / 相册）
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })
app.post('/upload', upload.single('file'), (req, res) => {
  res.json({ ok: true, name: req.file && req.file.originalname, size: req.file && req.file.size })
})
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ ok: false, code: err.type || err.name, message: err.message })
})

function request(port, { method = 'POST', path = '/echo', headers = {}, body }) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = data.slice(0, 80) }
        resolve({ status: res.statusCode, body: parsed })
      })
    })
    req.on('error', (e) => resolve({ status: 0, body: e.message }))
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }) })
    if (body) req.write(body)
    req.end()
  })
}

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  const results = []
  const check = (name, ok, detail) => {
    results.push({ name, ok })
    console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`)
  }

  // ① 普通 JSON
  let r = await request(port, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 姓名: '张伟', 分数: 95 }),
  })
  check('JSON 解析', r.status === 200 && r.body.body && r.body.body.姓名 === '张伟', r)

  // ② urlencoded
  r = await request(port, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=li&n=2',
  })
  check('urlencoded 解析', r.status === 200 && r.body.body && r.body.body.name === 'li', r)

  // ③ gzip 压缩体
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ a: 1, b: '压' })))
  r = await request(port, {
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': gz.length },
    body: gz,
  })
  check('gzip 压缩体解析', r.status === 200 && r.body.body && r.body.body.a === 1, r)

  // ④ 压缩体 + 尾部垃圾字节（原漏洞触发姿势）
  const gzDirty = Buffer.concat([gz, Buffer.from('GARBAGE-TRAILING-BYTES')])
  r = await request(port, {
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': gzDirty.length },
    body: gzDirty,
  })
  // 期望：要么正常解析（忽略尾部），要么干净地 400；不能 500 挂住或超时
  check('压缩体带尾部垃圾不挂死', r.status === 200 || r.status === 400, r)

  // ⑤ 超限体积
  r = await request(port, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ big: 'x'.repeat(2 * 1024 * 1024) }),
  })
  check('超限被拦（413）', r.status === 413, r)

  // ⑥ multipart 文件上传（multer 2.4.0 → 2.5.0）
  const boundary = '----smoke' + Date.now()
  const fileContent = '姓名,分数\n张伟,95\n'
  const multipart = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file"; filename="t.csv"\r\n' +
    'Content-Type: text/csv\r\n\r\n' +
    fileContent +
    `\r\n--${boundary}--\r\n`,
    'utf8'
  )
  r = await request(port, {
    path: '/upload',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': multipart.length },
    body: multipart,
  })
  check('multipart 上传', r.status === 200 && r.body.ok && r.body.name === 't.csv', r)

  const failed = results.filter((x) => !x.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  server.close(() => process.exit(failed.length ? 1 : 0))
})
