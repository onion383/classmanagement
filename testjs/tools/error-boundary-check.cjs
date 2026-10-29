#!/usr/bin/env node
// =========================================================================
// error-boundary-check.cjs —— 错误处理边界扫描
//
// 只做两件事：
//   1) 找出「空 catch / 静默 .catch(()=>{})」，要求同一行或上一行写 `// best-effort: 原因`；
//   2) 统计 catch / console.error 数量，给评审一个可对比的基线。
//
// 默认只报告（exit 0）；加 --strict 时，存在未标注的静默捕获就 exit 1。
// 不扫描 node_modules / release / dist / .vite。
// =========================================================================
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const TARGETS = ['electron', 'student-backend', path.join('student-frontend', 'src')]
const EXTS = new Set(['.js', '.cjs', '.mjs', '.vue'])
// release4 为旧产物目录名，保留跳过避免历史目录被误扫
const SKIP_DIRS = new Set(['node_modules', 'release', 'release36', 'release4', 'dist', '.vite', '.git'])

const args = new Set(process.argv.slice(2))
const strict = args.has('--strict')

function walk(dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (_) {
    return
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue
      walk(path.join(dir, ent.name), out)
    } else if (EXTS.has(path.extname(ent.name).toLowerCase())) {
      out.push(path.join(dir, ent.name))
    }
  }
}

const files = []
for (const t of TARGETS) walk(path.join(ROOT, t), files)

const EMPTY_CATCH = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/
const EMPTY_CATCH_ARROW = /\.catch\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*\}\s*\)/
const HAS_MARK = /best-effort/i

let catchCount = 0
let consoleErrorCount = 0
const violations = []

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    catchCount += (line.match(/\bcatch\s*\(/g) || []).length
    consoleErrorCount += (line.match(/console\.error/g) || []).length
    if (!EMPTY_CATCH.test(line) && !EMPTY_CATCH_ARROW.test(line)) return
    const prev = i > 0 ? lines[i - 1] : ''
    if (HAS_MARK.test(line) || HAS_MARK.test(prev)) return
    violations.push({ file: path.relative(ROOT, file), line: i + 1, code: line.trim() })
  })
}

console.log('错误处理边界扫描')
console.log(`  文件：${files.length}  catch：${catchCount}  console.error：${consoleErrorCount}`)
console.log(`  未标注的静默捕获：${violations.length}`)
if (violations.length) {
  const limit = strict ? violations.length : Math.min(violations.length, 30)
  for (const v of violations.slice(0, limit)) {
    console.log(`    ${v.file}:${v.line}  ${v.code}`)
  }
  if (!strict && violations.length > limit) console.log(`    …… 其余 ${violations.length - limit} 条`)
  console.log('\n处理方式：给 best-effort 捕获补 `// best-effort: 原因`；业务路径不要静默吞错。')
}

if (strict && violations.length) process.exit(1)
