// =========================================================================
// pathGuard.test.js —— 主进程 IPC 路径守卫单测
//
// 覆盖 electron/main/main.path-guard.js：
//   · 只接受绝对路径（拒绝相对路径、空串、NUL）
//   · 拒绝盘符根与系统保护目录（SystemRoot / 注入目录）
//   · open-file 只允许打开「本进程写过」的文件，且拒绝可执行扩展名
//   · apps-launch 要求路径真实存在
//   · 外链只放行 http/https
// =========================================================================

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const g = require('../../electron/main/main.path-guard')

const isWin = process.platform === 'win32'
const SYS_ROOT = isWin ? (process.env.SystemRoot || process.env.windir || 'C:\\Windows') : '/etc'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pathguard-'))
}

test.after(() => {
  g.setProtectedRoots([])
})

test('normalizeAbsolute：只接受绝对路径，拒绝空串/NUL/相对路径', () => {
  assert.equal(g.normalizeAbsolute(''), null)
  assert.equal(g.normalizeAbsolute('   '), null)
  assert.equal(g.normalizeAbsolute(null), null)
  assert.equal(g.normalizeAbsolute(123), null)
  assert.equal(g.normalizeAbsolute('a\0b'), null)
  assert.equal(g.normalizeAbsolute('relative/path'), null)
  assert.equal(g.normalizeAbsolute('./relative/path'), null)
  if (isWin) {
    assert.equal(g.normalizeAbsolute('C:\\a\\b'), path.normalize('C:\\a\\b'))
    assert.equal(g.normalizeAbsolute('C:\\a\\..\\b'), path.normalize('C:\\b'))
  } else {
    assert.equal(g.normalizeAbsolute('/a/b'), '/a/b')
  }
})

test('resolveSafeFolder：放行普通目录，拒绝文件/盘符根/不存在', () => {
  const dir = tempDir()
  const file = path.join(dir, 'a.txt')
  fs.writeFileSync(file, 'x')

  assert.equal(g.resolveSafeFolder(dir).path, dir)
  assert.match(g.resolveSafeFolder(file).error, /不是目录/)
  assert.match(g.resolveSafeFolder(path.parse(dir).root).error, /盘符根/)
  assert.match(g.resolveSafeFolder(path.join(dir, 'missing')).error, /不存在/)
  assert.match(g.resolveSafeFolder('relative/dir').error, /绝对路径/)
})

test('resolveSafeFolder / resolveSafeWriteDir / resolveSafeLaunchPath：拒绝系统保护目录', () => {
  g.setProtectedRoots([])
  assert.match(g.resolveSafeFolder(SYS_ROOT).error, /系统保护目录/)
  assert.match(g.resolveSafeWriteDir(SYS_ROOT, SYS_ROOT).error, /系统保护目录/)
  assert.match(g.resolveSafeLaunchPath(SYS_ROOT).error, /系统保护目录/)

  // 注入的自定义保护目录同样生效（模拟安装目录）
  const appDir = tempDir()
  fs.writeFileSync(path.join(appDir, 'app.exe'), 'x')
  g.setProtectedRoots([appDir])
  assert.match(g.resolveSafeFolder(appDir).error, /系统保护目录/)
  assert.match(g.resolveSafeWriteDir(path.join(appDir, 'out'), appDir).error, /系统保护目录/)
  assert.match(g.resolveSafeLaunchPath(path.join(appDir, 'app.exe')).error, /系统保护目录/)
  g.setProtectedRoots([])
})

test('resolveSafeWriteDir：空 saveDir 回退默认目录；允许尚不存在的目录；拒绝文件', () => {
  const dir = tempDir()
  // 传入空串 → 用 fallback
  assert.equal(g.resolveSafeWriteDir('', dir).path, dir)
  assert.equal(g.resolveSafeWriteDir(undefined, dir).path, dir)
  // 尚不存在的子目录：mkdirl 由调用方负责，守卫放行
  assert.equal(g.resolveSafeWriteDir(path.join(dir, 'new-sub'), dir).path, path.join(dir, 'new-sub'))
  // 指向文件 → 拒绝
  const file = path.join(dir, 'x.png')
  fs.writeFileSync(file, 'x')
  assert.match(g.resolveSafeWriteDir(file, dir).error, /指向的是文件/)
  // 盘符根 → 拒绝
  assert.match(g.resolveSafeWriteDir(path.parse(dir).root, dir).error, /盘符根/)
})

test('resolveSafeOpenFile：只放行本进程写过的文件，且拒绝可执行扩展名', () => {
  const dir = tempDir()
  const xlsx = path.join(dir, '成绩.xlsx')
  const exe = path.join(dir, 'evil.exe')
  fs.writeFileSync(xlsx, 'x')
  fs.writeFileSync(exe, 'x')

  // 未登记 → 拒绝
  assert.match(g.resolveSafeOpenFile(xlsx).error, /只允许打开本应用刚保存的文件/)
  // save-file 写入后登记 → 放行
  g.markFileWritten(xlsx)
  assert.equal(g.resolveSafeOpenFile(xlsx).path, xlsx)
  // 即使登记过，可执行文件也拒绝
  g.markFileWritten(exe)
  assert.match(g.resolveSafeOpenFile(exe).error, /可执行/)

  g._resetWrittenFiles()
})

test('resolveSafeLaunchPath：要求路径存在', () => {
  const dir = tempDir()
  const file = path.join(dir, 'app.lnk')
  fs.writeFileSync(file, 'x')
  assert.equal(g.resolveSafeLaunchPath(file).path, file)
  assert.match(g.resolveSafeLaunchPath(path.join(dir, 'missing.exe')).error, /不存在/)
  assert.match(g.resolveSafeLaunchPath('').error, /绝对路径/)
})

test('isHttpUrl：只放行 http/https，拒绝本地协议与畸形串', () => {
  assert.equal(g.isHttpUrl('https://example.com/a?b=1'), true)
  assert.equal(g.isHttpUrl('http://127.0.0.1:3000/x'), true)
  assert.equal(g.isHttpUrl('  https://example.com  '), true)
  assert.equal(g.isHttpUrl('file:///C:/Windows/System32/calc.exe'), false)
  assert.equal(g.isHttpUrl('javascript:alert(1)'), false)
  assert.equal(g.isHttpUrl('ms-msdt:/id'), false)
  assert.equal(g.isHttpUrl('data:text/html,<script>'), false)
  assert.equal(g.isHttpUrl('http://'), false)
  assert.equal(g.isHttpUrl('not a url'), false)
  assert.equal(g.isHttpUrl(null), false)
})

test('sanitizeSuggestedName：把 ../ 与盘符路径压平成纯文件名（B11-10）', () => {
  // 正常文件名原样保留
  assert.equal(g.sanitizeSuggestedName('成绩导出.xlsx'), '成绩导出.xlsx')
  // 目录穿越片段：只留最后一段，不残留任何路径分隔符
  assert.equal(g.sanitizeSuggestedName('../x.xlsx'), 'x.xlsx')
  assert.equal(g.sanitizeSuggestedName('../../etc/passwd'), 'passwd')
  // Windows 非法字符被替换（结果里不能出现 : < > | ? *）
  assert.equal(g.sanitizeSuggestedName('a<b>:c.xlsx'), 'a_b__c.xlsx')
  // 空/纯点名称回退到默认名
  assert.equal(g.sanitizeSuggestedName(''), '导出文件')
  assert.equal(g.sanitizeSuggestedName('..'), '导出文件')
  assert.equal(g.sanitizeSuggestedName(null), '导出文件')
  if (isWin) {
    assert.equal(g.sanitizeSuggestedName('C:\\Windows\\evil.exe'), 'evil.exe')
    assert.equal(g.sanitizeSuggestedName('..\\..\\x.xlsx'), 'x.xlsx')
    assert.equal(g.sanitizeSuggestedName('导出.csv '), '导出.csv')
  }
})
