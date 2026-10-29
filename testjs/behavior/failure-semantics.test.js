// =========================================================================
// failure-semantics.test.js —— 写操作失败语义约定（保存/删除链路必须可感知）
//
// 运行：npm run test:behavior
// 背景：catch 静默吞在「用户显式操作链路」上 = 点了没反应、刷新就丢（SeatView
// 的 saveWeight 曾只 console.error，权重改动静默丢失）。约定（见工作日志）：
//   · 空吞/仅 console 只允许出现在：偏好写入、预取/预热、可再生数据、探测类 I/O；
//   · 保存/删除/提交/改名等写操作的失败必须：UI 反馈（notify/showAlert/reportError）
//     或上抛或 return 兜底，或重新拉取回滚。
// 本测试按「函数名含写操作动词 + 体内有真 I/O」抽样钉住这条约定。
// 逃生口：catch 块里写 `behavior-ok` 注释并说明原因。
// =========================================================================
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '../../student-frontend/src')
// 只查前端行为层（views/composables/components）；utils 里纯函数不含 I/O 不受影响
const SCOPE = /student-frontend[\\/]+src[\\/]+(views|composables|components)[\\/]/

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|vue)$/.test(e.name)) out.push(p)
  }
  return out
}

// 写操作动词：函数名命中 + 体内含真 I/O 才进入检查
const WRITE_VERB = /save|persist|delete|remove|submit|rename|restore|recover|write/i
const IO_MARK = /axios\.|fetch\(|apiFetch\(|\.request\(|window\.electron\??\.invoke\(/
// 失败可感知的标记：UI 反馈 / 上抛 / return 兜底 / 回滚重拉 / 写错误态
const FEEDBACK = /notify|showAlert|reportError|useNotification\b|\bthrow\b|\breturn\b|\bload[A-Z]\w*\(|\breload\w*\(|[A-Za-z_]*(error|Error|warn|Warn|fail|Fail|alert|Alert|message|Message)[A-Za-z_]*\.value\s*=/
// 设计性静默的注释豁免：带意图说明的注释吞（预览不阻断/回滚不叠加/持久化不阻塞对话等）
const DOCUMENTED = /behavior-ok|不阻断|不阻塞|不叠加|不影响|回滚|忽略|静默|无从排查|已[^*\\n]{0,15}处理/

// 从 src 中抽取「名字 → 函数体」（function 声明 / const 箭头 / 对象方法简写）
function extractFunctions(src) {
  const out = []
  const patterns = [
    /(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
    /(?:^|\s)(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*\([^)]*\)|\([^)]*\)\s*=>|\w+\s*=>)\s*\{/g,
    /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm,
  ]
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const braceStart = src.indexOf('{', m.index + m[0].length - 1)
      if (braceStart < 0) continue
      // 括号配平切出函数体
      let depth = 0
      let end = braceStart
      for (let i = braceStart; i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') {
          depth--
          if (depth === 0) { end = i; break }
        }
      }
      out.push({ name: m[1], body: src.slice(braceStart, end + 1), index: m.index })
    }
  }
  return out
}

// 取函数体里「顶层」catch 块（嵌套在其它 catch 里的属回滚-of-回滚，豁免）
function topLevelCatches(body) {
  const spans = []
  for (const m of body.matchAll(/catch\s*(?:\([^)]*\))?\s*\{/g)) {
    const start = m.index
    const braceStart = body.indexOf('{', start + m[0].length - 1)
    let depth = 0
    let end = braceStart
    for (let i = braceStart; i < body.length; i++) {
      if (body[i] === '{') depth++
      else if (body[i] === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    spans.push({ start, end, text: body.slice(braceStart, end + 1) })
  }
  // 剔除被其它 catch 包住的
  return spans.filter((s) => !spans.some((o) => o !== s && o.start < s.start && s.end < o.end))
}

function scan() {
  const violations = []
  for (const f of walk(SRC)) {
    if (!SCOPE.test(f)) continue
    let s = fs.readFileSync(f, 'utf8')
    if (f.endsWith('.vue')) s = (s.match(/<script[^>]*>([\s\S]*?)<\/script>/) || [])[1] || ''
    for (const fn of extractFunctions(s)) {
      if (!WRITE_VERB.test(fn.name)) continue
      if (!IO_MARK.test(fn.body)) continue
      for (const c of topLevelCatches(fn.body)) {
        if (/behavior-ok/.test(c.text)) continue // 显式逃生口
        if (DOCUMENTED.test(c.text)) continue // 带意图注释的设计性静默
        if (FEEDBACK.test(c.text)) continue
        const line = s.slice(0, fn.index).split('\n').length
        violations.push(`${path.relative(SRC, f).replace(/\\/g, '/')}:${line} ${fn.name}() 的 catch 无失败反馈`)
      }
      // 链式 .catch( 的处理函数同样要求可感知
      for (const m of fn.body.matchAll(/\.catch\(\s*(?:async\s*)?(?:\([^)]*\)\s*=>|\w+\s*=>|\s*function\s*\([^)]*\))\s*\{([\s\S]*?)\}\s*\)/g)) {
        const text = m[1]
        if (/behavior-ok/.test(text)) continue
        if (DOCUMENTED.test(text)) continue
        if (FEEDBACK.test(text)) continue
        const line = s.slice(0, fn.index).split('\n').length
        violations.push(`${path.relative(SRC, f).replace(/\\/g, '/')}:${line} ${fn.name}() 的 .catch() 无失败反馈`)
      }
    }
  }
  return violations
}

test('失败语义：写操作链路的 catch 必须可感知（notify/报错/兜底/回滚）', () => {
  const v = scan()
  assert.deepEqual(v, [], '以下写操作失败被静默吞（用户会以为已保存）：\n' + v.join('\n'))
})

test('失败语义：扫描器自检——约定覆盖面非空（动词+I/O 命中若干函数）', () => {
  // 保证本测试不是"什么都没查所以通过"
  let hit = 0
  for (const f of walk(SRC)) {
    if (!SCOPE.test(f)) continue
    let s = fs.readFileSync(f, 'utf8')
    if (f.endsWith('.vue')) s = (s.match(/<script[^>]*>([\s\S]*?)<\/script>/) || [])[1] || ''
    for (const fn of extractFunctions(s)) {
      if (WRITE_VERB.test(fn.name) && IO_MARK.test(fn.body)) hit++
    }
  }
  assert.ok(hit >= 10, `写操作函数样本量过少（${hit}），检查匹配规则是否失效`)
})
