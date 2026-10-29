// 审计：<script setup> 组件模板里引用了、但 setup 顶层绑定中不存在的标识符。
// 这类名字会被编译成 _ctx.xxx，运行时从实例上取 —— script setup 的 setupState 只有顶层绑定，
// 取不到就是 undefined，调用即 "xxx is not a function"（Vue 3.5 与 3.6 表现一致）。
// 用法：node template-binding-audit.mjs [vue包目录]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const srcRoot = path.resolve('student-frontend/src')
const vueDir = path.resolve(process.argv[2] ?? 'student-frontend/vue36/node_modules/vue')
const sfc = await import(pathToFileURL(path.join(vueDir, 'compiler-sfc', 'index.mjs')).href)
const { parse, compileScript, compileTemplate } = sfc

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

const findings = []
for (const file of walk(srcRoot)) {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes('<script setup')) continue
  const rel = path.relative(srcRoot, file).split(path.sep).join('/')
  let descriptor, script
  try {
    const parsed = parse(source, { filename: rel })
    descriptor = parsed.descriptor
    if (!descriptor.scriptSetup || !descriptor.template) continue
    script = compileScript(descriptor, { id: rel })
  } catch (err) {
    findings.push({ file: rel, missing: [`<解析失败> ${err.message}`] })
    continue
  }
  const bindings = script.bindings || {}
  let code
  try {
    const tpl = compileTemplate({
      source: descriptor.template.content,
      filename: rel,
      id: rel,
      compilerOptions: { bindingMetadata: bindings },
    })
    code = tpl.code
  } catch (err) {
    findings.push({ file: rel, missing: [`<模板编译失败> ${err.message}`] })
    continue
  }
  // 编译产物里的 _ctx.xxx 就是「模板要、但 setup 里没有」的绑定
  const missing = new Set()
  for (const m of code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)) {
    const name = m[1]
    if (name.startsWith('$')) continue // $slots/$attrs/$emit 等实例内置
    if (name in bindings) continue
    missing.add(name)
  }
  if (missing.size) findings.push({ file: rel, missing: [...missing].sort() })
}

if (!findings.length) {
  console.log('未发现问题：所有模板标识符都有对应的 setup 绑定')
  process.exit(0)
}
console.log(`发现 ${findings.length} 个文件存在「模板引用但 setup 未绑定」的标识符：\n`)
for (const f of findings) console.log(`  ${f.file}\n    ↳ ${f.missing.join(', ')}`)
console.log(`\n合计 ${findings.reduce((n, f) => n + f.missing.length, 0)} 处`)
