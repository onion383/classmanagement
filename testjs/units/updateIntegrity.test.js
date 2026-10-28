// 更新包完整性校验（P1-16 / B01-12）：HTTPS + 大小 + SHA-256
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const fsp = fs.promises
const crypto = require('node:crypto')
const test = require('node:test')
const assert = require('node:assert/strict')

const { assertHttpsUrl, sha256File, verifyDownloadedFile } = require('../../electron/main/main.update-integrity')

const tmpDir = path.join(os.tmpdir(), 'update-integrity-' + process.pid)

test('assertHttpsUrl：只接受 https，拒绝 http/file 与非法串', () => {
  assert.ok(assertHttpsUrl('https://example.com/a.exe'))
  assert.throws(() => assertHttpsUrl('http://example.com/a.exe'), /HTTPS/)
  assert.throws(() => assertHttpsUrl('file:///C:/a.exe'), /HTTPS/)
  assert.throws(() => assertHttpsUrl('not a url'), /无效/)
  assert.throws(() => assertHttpsUrl(''), /无效/)
})

test('verifyDownloadedFile：大小与 sha256 校验，缺 digest 时降级为仅大小校验', async () => {
  await fsp.mkdir(tmpDir, { recursive: true })
  const file = path.join(tmpDir, 'setup.exe')
  const data = Buffer.from('fake-installer-bytes')
  await fsp.writeFile(file, data)
  const digest = 'sha256:' + crypto.createHash('sha256').update(data).digest('hex')
  const size = data.length

  assert.deepEqual(
    await verifyDownloadedFile({ filePath: file, expectedSize: size, digest }),
    { ok: true, verified: 'sha256' }
  )
  assert.equal((await verifyDownloadedFile({ filePath: file, expectedSize: size + 1 })).ok, false)

  const bad = await verifyDownloadedFile({ filePath: file, expectedSize: size, digest: 'sha256:' + '0'.repeat(64) })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /SHA-256/)

  assert.deepEqual(
    await verifyDownloadedFile({ filePath: file, expectedSize: size, digest: '' }),
    { ok: true, verified: 'size-only' }
  )
  assert.equal(await sha256File(file), digest.slice('sha256:'.length))

  await fsp.rm(tmpDir, { recursive: true, force: true })
})
