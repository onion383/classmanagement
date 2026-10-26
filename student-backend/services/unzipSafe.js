/**
 * 安全的流式解压（替代 extract-zip）
 *
 * 为什么自己写：`extract-zip` 存在「zip 内符号链接可写任意路径」的漏洞且有**无修复版本**
 * （GHSA-jmr9-qjv8-65gv / GHSA-7pqw-9j4j-h8q3）。我们用它的场景是解压自己下载的 ffmpeg 包，
 * 风险本来不高，但既然底层 `yauzl` 就在依赖树里（extract-zip 的依赖），自己写 50 行就能
 * 把这个依赖和漏洞一起去掉。
 *
 * 与 extract-zip 的差别：
 *   · **解压前**逐条目检查（符号链接/特殊文件、绝对路径、`..`、反斜杠），而不是解压后再扫
 *   · 流式写盘，内存占用与单个文件大小无关（ffmpeg 包里单个 exe 约 100MB，不能整个读进内存）
 *   · 不做「尽力解压」：遇到可疑条目立即中止并抛错，由调用方清理目录
 *
 * 校验的严格程度刻意比 extract-zip 高：
 *   ① 条目类型必须是普通文件或目录（S_IFMT 判断）
 *   ② 条目名不能是绝对路径 / 含 `..` / 含反斜杠
 *   ③ 拼出的目标路径必须仍在 destDir 内（path.relative 双保险）
 */
const fs = require('fs')
const path = require('path')
const yauzl = require('yauzl')

const UNIX_MADE_BY = 3 // versionMadeBy 高字节：3 = Unix

/** 符号链接等特殊文件返回 true；普通文件 / 目录返回 false */
function isSpecialEntry(entry) {
  if ((entry.versionMadeBy >> 8) !== UNIX_MADE_BY) return false
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff
  const fmt = mode & 0xf000
  return fmt !== 0 && fmt !== 0x8000 && fmt !== 0x4000
}

/** 危险条目名返回 true */
function isUnsafeName(name) {
  if (!name) return true
  if (name.includes('\\')) return true // 反斜杠会被部分解压器当分隔符
  if (name.startsWith('/')) return true
  if (/^[a-zA-Z]:/.test(name)) return true // Windows 盘符
  if (name.split('/').some((seg) => seg === '..')) return true
  return false
}

/**
 * 解压 zipPath 到 destDir（流式、防路径穿越与符号链接）。
 * @param {string} zipPath
 * @param {string} destDir 目标目录（不存在会自动创建）
 * @returns {Promise<void>} 成功 resolve；发现可疑条目 reject（错误信息可直接记录）
 */
function unzipSafe(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(new Error(`压缩包无法读取：${err.message}`))
      if (!zipfile) return reject(new Error('压缩包无法读取'))

      let settled = false
      const fail = (e) => {
        if (settled) return
        settled = true
        try { zipfile.close() } catch (_) { /* 已经关了 */ }
        reject(e)
      }

      zipfile.on('error', (e) => fail(new Error(`压缩包解析失败：${e.message}`)))
      zipfile.on('end', () => {
        if (settled) return
        settled = true
        resolve()
      })

      zipfile.on('entry', (entry) => {
        if (settled) return

        if (isSpecialEntry(entry)) {
          return fail(new Error(`压缩包内含链接/特殊文件，已中止：${entry.fileName}`))
        }
        if (isUnsafeName(entry.fileName)) {
          return fail(new Error(`压缩包内含可疑路径，已中止：${entry.fileName}`))
        }

        const target = path.join(destDir, entry.fileName)
        // 双保险：拼出来的路径必须仍在目标目录内
        const rel = path.relative(destDir, target)
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
          return fail(new Error(`压缩包内含越界路径，已中止：${entry.fileName}`))
        }

        // 目录条目（zip 里以 / 结尾）
        if (entry.fileName.endsWith('/')) {
          fs.mkdir(target, { recursive: true }, (e) => {
            if (e) return fail(e)
            zipfile.readEntry()
          })
          return
        }

        fs.mkdir(path.dirname(target), { recursive: true }, (e) => {
          if (e) return fail(e)
          zipfile.openReadStream(entry, (e2, stream) => {
            if (e2) return fail(e2)
            const ws = fs.createWriteStream(target)
            stream.on('error', fail)
            ws.on('error', fail)
            ws.on('finish', () => zipfile.readEntry())
            stream.pipe(ws)
          })
        })
      })

      zipfile.readEntry()
    })
  })
}

module.exports = { unzipSafe }
