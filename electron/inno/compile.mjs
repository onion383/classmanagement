// 「班集」Inno Setup 编译辅助脚本
// 作用：定位本机 Inno Setup 6 的编译器 ISCC.exe，并把 electron/inno/setup.iss 编译为安装包。
// 定位顺序：环境变量 INNO_SETUP_ISCC → PATH 中的 iscc → 常见安装目录 → 注册表 InstallLocation。
// 由 package.json 的 build:win:inno 调用；找不到 ISCC 时给出中文提示与下载地址。

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const issFile = path.join(here, 'setup.iss')

// 在 PATH 中查找 iscc（Windows 用 where，其它平台回退 command -v）
function findOnPath() {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  const res = spawnSync(cmd, ['iscc'], { encoding: 'utf8' })
  if (res.status === 0) {
    const first = String(res.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
    if (first && existsSync(first)) return first
  }
  return null
}

// 枚举各卸载表中所有 Inno Setup 项，读取其 InstallLocation（兼容 6 / 7 / 装在任意盘符）
function findFromRegistry() {
  const parents = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]
  for (const parent of parents) {
    const list = spawnSync('reg', ['query', parent], { encoding: 'utf8' })
    if (list.status !== 0) continue
    const subkeys = String(list.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^HKEY/i.test(s))
    for (const sub of subkeys) {
      const info = spawnSync('reg', ['query', sub], { encoding: 'utf8' })
      if (info.status !== 0) continue
      const out = String(info.stdout || '')
      if (!/Inno Setup/i.test(out)) continue
      const m = out.match(/InstallLocation\s+REG_SZ\s+(.+)/i)
      if (!m) continue
      const candidate = path.join(m[1].trim(), 'ISCC.exe')
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function resolveIscc() {
  if (process.env.INNO_SETUP_ISCC && existsSync(process.env.INNO_SETUP_ISCC)) {
    return process.env.INNO_SETUP_ISCC
  }
  const onPath = findOnPath()
  if (onPath) return onPath
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const candidates = [
    path.join(pf86, 'Inno Setup 6', 'ISCC.exe'),
    path.join(pf, 'Inno Setup 6', 'ISCC.exe'),
    path.join(pf86, 'Inno Setup 7', 'ISCC.exe'),
    path.join(pf, 'Inno Setup 7', 'ISCC.exe'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return findFromRegistry()
}

const iscc = resolveIscc()
if (!iscc) {
  console.error(
    '\n[inno] 未找到 Inno Setup 编译器 ISCC.exe。\n' +
      '请先安装 Inno Setup（6 或 7 均可）：https://jrsoftware.org/isdl.php\n' +
      '安装后可用以下任一方式让本脚本找到它：\n' +
      '  - 将 ISCC.exe 所在目录加入 PATH；或\n' +
      '  - 设置环境变量 INNO_SETUP_ISCC 指向 ISCC.exe 的完整路径。\n'
  )
  process.exit(1)
}

console.log(`[inno] 使用编译器：${iscc}`)
console.log(`[inno] 编译脚本：${issFile}`)
const result = spawnSync(iscc, [issFile], { stdio: 'inherit' })
process.exit(result.status == null ? 1 : result.status)