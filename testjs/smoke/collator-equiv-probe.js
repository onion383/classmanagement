// =========================================================================
// testjs/collator-equiv-probe.js —— 排序等价性 + 性能对比
//
// 用途：验证「localeCompare → 复用的 Intl.Collator」改造后，
//   ① 排序结果与改动前**逐位一致**（最重要：排序变了就是功能回归）
//   ② 性能确实提升
//
// 跑法：node testjs/collator-equiv-probe.js
// =========================================================================

// 复刻 utils/collator.js 的两个比较器（此脚本独立运行，不依赖前端构建）
const zhCollator = new Intl.Collator('zh')
const naturalCollator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

// ---- 改动前的实现（原样复制）----
const oldZh = (a, b) => a.localeCompare(b, 'zh')
const oldNatural = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })

// ---- 改动后的实现 ----
const newZh = (a, b) => zhCollator.compare(a, b)
const newNatural = (a, b) => naturalCollator.compare(String(a || ''), String(b || ''))

let pass = 0, fail = 0
const chk = (ok, label, extra) => {
  if (ok) { pass++; console.log('  ✓', label, extra || '') }
  else { fail++; console.log('  ✗', label, extra || '') }
}

// ============ 1. 中文排序等价性 ============
console.log('=== 1. 中文排序（zh）结果等价性 ===')
const names = []
const chars = '王李张刘陈杨黄赵吴周徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤'
for (let i = 0; i < 200; i++) {
  names.push(chars[i % chars.length] + chars[(i * 7 + 3) % chars.length] + chars[(i * 13 + 5) % chars.length])
}
const a1 = names.slice().sort(oldZh)
const a2 = names.slice().sort(newZh)
chk(JSON.stringify(a1) === JSON.stringify(a2), '200 个中文名排序结果完全一致')

// 边界：空串 / 数字 / 混合 / 英文
const edge = ['', '张三', '123', '李四', 'a', 'ABC', '张三丰', '10', '2', '王', '张', 'z']
const e1 = edge.slice().sort(oldZh)
const e2 = edge.slice().sort(newZh)
chk(JSON.stringify(e1) === JSON.stringify(e2), '边界值排序结果一致', JSON.stringify(e2))

// 数字型（表格里成绩/学号等）
const nums = ['100', '9', '20', '3.5', '-1', '0', '1000']
const n1 = nums.slice().sort(oldZh)
const n2 = nums.slice().sort(newZh)
chk(JSON.stringify(n1) === JSON.stringify(n2), '数字字符串排序结果一致')

// ============ 2. 自然排序等价性 ============
console.log('\n=== 2. 文件名自然排序（zh-Hans-CN + numeric/base）结果等价性 ===')
const files = ['1.jpg', '10.jpg', '2.jpg', 'IMG_001.png', 'img_002.png', 'IMG_1.png', '20.jpg', '3.jpg', 'a.jpg', 'B.jpg']
const f1 = files.slice().sort(oldNatural)
const f2 = files.slice().sort(newNatural)
chk(JSON.stringify(f1) === JSON.stringify(f2), '文件名排序结果完全一致')
console.log('     排序结果:', f2.join(' '))

// ============ 3. 性能对比 ============
console.log('\n=== 3. 性能对比（1000 条 × 20 轮）===')
const big = []
for (let i = 0; i < 1000; i++) big.push(chars[i % chars.length] + chars[(i * 7) % chars.length] + chars[(i * 13) % chars.length] + i)

const bench = (cmp, label) => {
  // 预热
  big.slice().sort(cmp)
  const t0 = process.hrtime.bigint()
  for (let k = 0; k < 20; k++) big.slice().sort(cmp)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`     ${label}: ${ms.toFixed(1)}ms`)
  return ms
}
const tOld = bench(oldZh, '原 localeCompare')
const tNew = bench(newZh, '复用 Collator  ')
console.log(`     → 快 ${(tOld / tNew).toFixed(1)} 倍`)

console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===')
process.exit(fail ? 1 : 0)
