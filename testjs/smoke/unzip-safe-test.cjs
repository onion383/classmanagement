/**
 * unzipSafe 回归（替代 extract-zip 自研解压）
 *
 * 覆盖：正常嵌套目录 / 空目录条目 / 符号链接 / 路径穿越 / 绝对路径 / 反斜杠路径。
 * 样本用 Python zipfile 生成（jszip 造不出 symlink 和恶意路径）。
 *
 * 跑法：node testjs/unzip-safe-test.cjs
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { unzipSafe } = require('../../student-backend/services/unzipSafe')

const TMP = path.join(__dirname, '..', 'tmp', 'unzipsafe')
const PY = process.env.PYTHON || 'python'

// 样本依赖 Python 的 zipfile（jszip 造不出 symlink / 恶意路径）；
// 没装 python 时按「环境不具备」跳过（退出码 3），而不是抛 ENOENT 记成失败。
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
big = 'X' * (512 * 1024)   # 512KB，验证流式不整体读入

# ① 正常包：嵌套目录 + 空目录 + 大文件
with zipfile.ZipFile(os.path.join(d,'ok.zip'),'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('ffmpeg/bin/ffmpeg.exe', big)
    z.writestr('ffmpeg/README.txt', 'hello')
    z.writestr('ffmpeg/empty/', '')
    z.writestr('LICENSE', 'MIT')

# ② 符号链接
with zipfile.ZipFile(os.path.join(d,'symlink.zip'),'w') as z:
    zi = zipfile.ZipInfo('link'); zi.create_system = 3; zi.external_attr = (0o120777 << 16)
    z.writestr(zi, '/etc/passwd')

# ③ 路径穿越
with zipfile.ZipFile(os.path.join(d,'traversal.zip'),'w') as z:
    z.writestr('../../evil.txt', 'x')

# ④ 绝对路径
with zipfile.ZipFile(os.path.join(d,'abs.zip'),'w') as z:
    z.writestr('/tmp/evil.txt', 'x')

# ⑤ 反斜杠路径
with zipfile.ZipFile(os.path.join(d,'backslash.zip'),'w') as z:
    z.writestr('sub\\\\..\\\\..\\\\evil.txt', 'x')
`
  execFileSync(PY, ['-c', code], { stdio: 'inherit' })
}

const cases = [
  ['ok.zip', true],
  ['symlink.zip', false],
  ['traversal.zip', false],
  ['abs.zip', false],
  ['backslash.zip', false],
]

;(async () => {
  if (!pythonAvailable()) {
    console.log('SKIP：未找到 python（可用 PYTHON 环境变量指定），unzipSafe 回归跳过')
    process.exit(3)
  }
  buildSamples()
  let failed = 0

  for (const [file, shouldPass] of cases) {
    const out = path.join(TMP, 'out-' + file.replace('.zip', ''))
    let passed = false
    let msg = ''
    try {
      await unzipSafe(path.join(TMP, file), out)
      passed = true
    } catch (e) {
      msg = e.message
    }
    const ok = passed === shouldPass
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${file.padEnd(16)} 期望${shouldPass ? '成功' : '拒绝'}  实际${passed ? '成功' : '拒绝'}${msg ? '  → ' + msg : ''}`)
  }

  // 正常包的内容完整性
  const base = path.join(TMP, 'out-ok')
  const checks = [
    ['ffmpeg/bin/ffmpeg.exe', 512 * 1024],
    ['ffmpeg/README.txt', 5],
    ['LICENSE', 3],
  ]
  for (const [rel, size] of checks) {
    const p = path.join(base, rel)
    const ok = fs.existsSync(p) && fs.statSync(p).size === size
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} 解压内容 ${rel}（期望 ${size} 字节）`)
  }
  const emptyDirOk = fs.existsSync(path.join(base, 'ffmpeg/empty'))
  if (!emptyDirOk) failed++
  console.log(`${emptyDirOk ? '✓' : '✗'} 空目录条目已创建`)

  // 恶意包不应该在目标目录外产生任何东西（含绝对路径 /tmp 与系统临时目录）
  const leakPaths = [
    path.join(TMP, 'evil.txt'),
    path.join(__dirname, '..', 'tmp', 'evil.txt'),
    path.join(os.tmpdir(), 'evil.txt'),
    path.resolve('/tmp/evil.txt'),
  ]
  const leaked = leakPaths.filter((p) => fs.existsSync(p))
  if (leaked.length) failed++
  console.log(`${leaked.length ? '✗' : '✓'} 目标目录外没有产生文件${leaked.length ? '（发现 ' + leaked.join(',') + '）' : ''}`)

  console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`)
  fs.rmSync(TMP, { recursive: true, force: true })
  process.exit(failed ? 1 : 0)
})()
