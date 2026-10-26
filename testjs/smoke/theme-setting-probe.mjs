/**
 * 设置项读取的边界回归
 *
 * 背景：不透明度滑块的 min=0，「完全透明」是合法取值。原来的写法是
 *   `parseFloat(localStorage.getItem(k)) || 默认值`
 * 而 0 在 JS 里是 falsy —— 用户拖到 0 保存后，重载会读回 0.6 / 0.4，
 * 表现为「我明明关掉了遮罩，重启又回来了」。
 *
 * 本脚本用等价函数把「旧写法 vs 新写法」在各类输入下的结果列出来，
 * 作为回归依据（store 依赖 DOM，无法在 Node 里直接 import）。
 *
 * 跑法：node testjs/theme-setting-probe.mjs
 */
const OLD = (raw, dft) => parseFloat(raw) || dft
const NEW = (raw, dft) => {
  const v = parseFloat(raw)
  return Number.isFinite(v) ? v : dft
}

const cases = [
  ['0（滑到底，合法）', '0'],
  ['0.00', '0.00'],
  ['0.45', '0.45'],
  ['1', '1'],
  ['', ''],
  ['abc（写坏）', 'abc'],
  ['null（未设置）', null],
  ['没有这个 key', undefined],
]

console.log('默认值 0.6（背景遮罩不透明度）')
console.log('输入'.padEnd(22), '旧写法 ||'.padEnd(12), '新写法 isFinite'.padEnd(16), '结论')
let bad = 0
for (const [label, raw] of cases) {
  const o = OLD(raw, 0.6)
  const n = NEW(raw, 0.6)
  const same = Object.is(o, n)
  if (!same) bad++
  console.log(label.padEnd(20), String(o).padEnd(12), String(n).padEnd(16), same ? '一致' : '← 旧写法错了')
}
console.log(`\n共 ${bad} 处旧写法会给出错误结果（全是「值为 0」这一类）`)

// JSON 兜底：坏数据不能让 store 初始化抛错
const OLD_JSON = (raw, dft) => JSON.parse(raw || dft)
const NEW_JSON = (raw, dft) => {
  if (!raw) return dft
  try {
    return JSON.parse(raw)
  } catch {
    return dft
  }
}
console.log('\nJSON 设置读取（theme store 初始化路径）')
for (const raw of ['{"a":1}', 'not-json{{{', '']) {
  let oldRes
  try {
    oldRes = JSON.stringify(OLD_JSON(raw, '{}'))
  } catch (e) {
    oldRes = `抛错: ${e.constructor.name}`
  }
  console.log(`  ${JSON.stringify(raw).padEnd(16)} 旧: ${String(oldRes).padEnd(28)} 新: ${JSON.stringify(NEW_JSON(raw, {}))}`)
}
