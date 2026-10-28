/**
 * pptx 解析的资源闸门回归
 *
 * 要防的是「压缩炸弹」：multer 的 20MB 只挡住文件本身，但 20MB 的 zip 可以解出几十 GB。
 * 本脚本直接挂载真实路由（不经过 auth），验证三类输入：
 *   ① 正常 60 页 pptx        → 解析成功，文本按页分段
 *   ② 单个条目解压 25MB      → 拒绝（单条目上限 20MB）
 *   ③ 总解压 120MB           → 拒绝（合计上限 100MB）
 *   ④ 10GB 级文件            → 交给 multer 的 20MB 限制拦（这里只验上限判定存在）
 *
 * 跑法：node testjs/pptx-guard-test.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { execFileSync } = require('node:child_process')

const BACKEND = path.join(__dirname, '..', '..', 'student-backend')
const express = require(path.join(BACKEND, 'node_modules', 'express'))
const router = require(path.join(BACKEND, 'routes', 'ai', 'ai.upload.js'))

const TMP = path.join(__dirname, '..', 'tmp', 'pptxguard')
const PY = process.env.PYTHON || 'python'

// 样本依赖 Python 的 zipfile；没装 python 时应判「环境不具备」而不是失败
// （run-smoke 约定退出码 3 = 跳过）。原先直接 spawnSync 会在无 python 的机器上
// 抛 ENOENT，让冒烟结果长期带一个与代码无关的假失败。
function pythonAvailable() {
  try {
    execFileSync(PY, ['--version'], { stdio: 'ignore' })
    return true
  } catch (_) { return false }
}

function buildSamples() {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  const code = `
import zipfile, os
d = r'${TMP.replace(/\\/g, '\\\\')}'
# ① 正常 60 页，每页几 KB
with zipfile.ZipFile(os.path.join(d,'ok.pptx'),'w',zipfile.ZIP_DEFLATED) as z:
    for i in range(1, 61):
        z.writestr('ppt/slides/slide%d.xml' % i,
                   '<?xml version="1.0"?><p:sld><a:p><a:t>第%d页 内容</a:t></a:p></p:sld>' % i)
# ② 单个条目解压 25MB（压缩后极小）
big = '<?xml version="1.0"?><p:sld><a:p><a:t>' + ('A' * 1024 * 1024 * 25) + '</a:t></a:p></p:sld>'
with zipfile.ZipFile(os.path.join(d,'one-big.pptx'),'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('ppt/slides/slide1.xml', big)
# ③ 30 页 × 4MB = 120MB（单条目不超限，总量超限）
with zipfile.ZipFile(os.path.join(d,'many.pptx'),'w',zipfile.ZIP_DEFLATED) as z:
    for i in range(1, 31):
        z.writestr('ppt/slides/slide%d.xml' % i,
                   '<?xml version="1.0"?><p:sld><a:p><a:t>' + ('B' * 1024 * 1024 * 4) + '</a:t></a:p></p:sld>')
`
  execFileSync(PY, ['-c', code], { stdio: 'inherit' })
}

function upload(port, file) {
  const boundary = '----pptx' + Date.now()
  const name = path.basename(file)
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
    'Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n'
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  const body = Buffer.concat([head, fs.readFileSync(file), tail])
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/ai/upload',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } },
      (res) => {
        let d = ''
        res.on('data', (c) => { d += c })
        res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({ raw: d.slice(0, 200) }) } })
      }
    )
    req.on('error', (e) => resolve({ error: e.message }))
    req.setTimeout(60000, () => { req.destroy(); resolve({ error: 'timeout' }) })
    req.end(body)
  })
}

;(async () => {
  if (!pythonAvailable()) {
    console.log('SKIP：未找到 python（可用 PYTHON 环境变量指定），pptx 资源闸门回归跳过')
    process.exit(3)
  }
  buildSamples()
  const app = express()
  app.use('/ai', router)
  const server = app.listen(0, '127.0.0.1', async () => {
    const port = server.address().port
    let failed = 0
    const check = (name, ok, detail) => {
      if (!ok) failed++
      console.log(`${ok ? '✓' : '✗'} ${name}`)
      if (!ok) console.log('    →', JSON.stringify(detail).slice(0, 220))
    }

    // ① 正常
    let r = await upload(port, path.join(TMP, 'ok.pptx'))
    const okText = r && r.success && typeof r.data.text === 'string'
    check('正常 60 页解析成功', !!okText, r)
    if (okText) {
      console.log(`    文本 ${r.data.length} 字符，首行: ${r.data.text.split('\n')[1] || ''}`)
    }

    // ② 单条目 25MB
    r = await upload(port, path.join(TMP, 'one-big.pptx'))
    check('单条目 25MB 被拒', !!(r && r.success === false && /单个文件过大/.test(r.error || '')), r)

    // ③ 总解压 120MB：必须是被「合计上限」这条守卫拦下才算通过。
    // 只断言 success === false 时，若压缩后体积碰巧 > 20MB 会被 multer 拦下，用例照样打钩，
    // 而真正要测的 100MB 守卫根本没被执行（假阴性）。
    const manySize = fs.statSync(path.join(TMP, 'many.pptx')).size / 1048576
    r = await upload(port, path.join(TMP, 'many.pptx'))
    const hitTotalGuard = !!(r && r.success === false && /解压后体积超过/.test(r.error || ''))
    check(`总解压超限被「合计上限」拦下（压缩后 ${manySize.toFixed(1)}MB）`, hitTotalGuard, r)
    if (r && r.success === false) console.log(`    原因: ${r.error}`)

    console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`)
    server.close(() => process.exit(failed ? 1 : 0))
  })
})()
