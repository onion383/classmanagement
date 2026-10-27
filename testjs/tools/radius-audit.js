// 圆角审计：检查圆角体系是否健全，防止回归。
// 用法：node testjs/tools/radius-audit.js
// 检查四项：
//   ① 各主题尺寸档严格单调递增（不得层级倒挂）
//   ② @theme 桥接完整（Tailwind rounded-* 全部跟随主题，不得有档位漏桥）
//   ③ 组件/样式里不得有硬编码 px 圆角（999px/50% 等特殊形状除外）
//   ④ 角色别名在各主题均有定义（不得回落到 fallback 链）
// 全程只读，不改动任何文件。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'student-frontend/src');
const STYLES = path.join(SRC, 'styles');

const SCALE = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];
const THEMES = {
  base: 'theme-base.css',
  glass: 'theme-glass.css',
  glass2: 'theme-glass2.css',
  win11: 'theme-win11.css',
  minimal: 'theme-minimal.css',
};
const ROLES = ['control', 'card', 'surface', 'table'];

let errors = 0;
const fail = (msg) => { console.log('  ✗ ' + msg); errors++; };
const ok = (msg) => console.log('  ✓ ' + msg);

// ---------- 解析主题文件里的 --radius-* 声明 ----------
function parseTheme(file) {
  const css = fs.readFileSync(path.join(STYLES, file), 'utf8');
  const vars = {};
  const re = /--radius-([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(css))) vars[m[1]] = m[2].trim();
  return vars;
}

/** 把 var(--radius-xx) / calc(...) 链解析成最终 px 数；解析不出返回 null */
function resolve(vars, expr, depth = 0) {
  if (depth > 6) return null;
  expr = expr.trim();
  const direct = expr.match(/^(-?[\d.]+)px$/);
  if (direct) return parseFloat(direct[1]);
  const zero = expr.match(/^(-?[\d.]+)px$/);
  if (zero) return parseFloat(zero[1]);
  const ref = expr.match(/^var\(--radius-([a-z0-9-]+)\)$/);
  if (ref) {
    const v = vars[ref[1]];
    return v === undefined ? null : resolve(vars, v, depth + 1);
  }
  // calc(A - B) / calc(A + B)，其中 A/B 可为 px 或 var()
  const calc = expr.match(/^calc\((.+)\)$/);
  if (calc) {
    const inner = calc[1];
    const m2 = inner.match(/^(.+?)\s*([+-])\s*(.+)$/);
    if (m2) {
      const a = resolve(vars, m2[1], depth + 1);
      const b = resolve(vars, m2[3], depth + 1);
      if (a === null || b === null) return null;
      return m2[2] === '+' ? a + b : a - b;
    }
    return null;
  }
  return null;
}

// ---------- ① 尺寸档单调性 ----------
console.log('① 各主题尺寸档单调性（xs < sm < md < lg < xl < 2xl < 3xl）');
for (const [theme, file] of Object.entries(THEMES)) {
  const vars = parseTheme(file);
  const vals = SCALE.map((k) => [k, resolve(vars, vars[k] ?? '')]);
  const missing = vals.filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) { fail(`${theme}: 档位缺失或无法解析: ${missing.join(', ')}`); continue; }
  // 全 0 是「直角主题」的设计（极简主题刻意如此），不算倒挂
  if (vals.every(([, v]) => v === 0)) {
    ok(`${theme}: 全档归零（直角主题）`);
    continue;
  }
  let inverted = null;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][1] <= vals[i - 1][1]) {
      inverted = `${vals[i - 1][0]}(${vals[i - 1][1]}px) >= ${vals[i][0]}(${vals[i][1]}px)`;
      break;
    }
  }
  if (inverted) fail(`${theme}: 层级倒挂 → ${inverted}`);
  else ok(`${theme}: ${vals.map(([k, v]) => k + '=' + v).join(' ')}`);
}

// ---------- ② @theme 桥接完整性 ----------
console.log('\n② @theme 桥接完整性（Tailwind rounded-* 必须全部跟随主题）');
const indexCss = fs.readFileSync(path.join(STYLES, 'index.css'), 'utf8');
// @theme 块内的 {} 可能嵌套（:root{...}），需做括号配平后取完整块
function extractBlock(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  let depth = 0, started = false;
  for (let j = i + header.length - 1; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}
const themeBlock = extractBlock(indexCss, '@theme');
if (!themeBlock) fail('index.css 里找不到 @theme 块');
else {
  const bridged = new Set();
  // 两种桥接写法都要认：
  //   --radius-lg: var(--radius-lg)      ← 自引用，桥接同名的尺寸档
  //   --radius: var(--radius-control)     ← bare `rounded` 用的 --radius，桥到角色
  const re = /--radius-([a-z0-9-]+)\s*:\s*var\(--radius-/g;
  let m;
  while ((m = re.exec(themeBlock))) bridged.add(m[1]);
  if (/--radius\s*:\s*var\(--radius-/.test(themeBlock)) bridged.add('');
  const need = [...SCALE, 'card', 'full', ''];  // '' 对应 bare `rounded` 的 --radius
  const missing = need.filter((k) => !bridged.has(k));
  if (missing.length) {
    fail(`未桥接的档位: ${missing.map((k) => k || '(bare rounded / --radius)').join(', ')}`);
  } else {
    ok(`${need.length} 个档位全部桥接（含 bare rounded）`);
  }
}

// ---------- ③ 硬编码 px 圆角 ----------
console.log('\n③ 硬编码 px 圆角扫描（999px / 50% 等特殊形状除外）');
// 白名单：这些是「与卡片圆角体系无关」的特殊形状，保留写死是合理的
//   999px/9999px → 胶囊（进度条、滑块）
//   50%          → 正圆（图标、头像、色板）
//   0            → 直角
//   1px/3px      → 半高圆角（勾选标记 2px 高、滚动条滑块 6px 宽，各取自身高度/宽度的一半）
const ALLOWED = /^\s*(999px|9999px|50%|0|1px|3px)\s*(!important)?\s*;?\s*$/;
const hits = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!/\.(vue|css)$/.test(name)) continue;
    const src = fs.readFileSync(p, 'utf8');
    src.split('\n').forEach((line, i) => {
      const m = line.match(/border-radius:\s*([^;]+);/);
      if (!m) return;
      const val = m[1].trim();
      // 剥掉 !important 后再判断（多值形式里它跟在最后一段后面）
      const clean = val.replace(/\s*!important\s*$/i, '').trim();
      const isToken = (seg) => {
        if (seg === 'inherit') return true;
        // var(--radius-xxx) / var(--radius-xxx, <fallback>) —— fallback 是兜底值，
        // 变量本身已定义时不会用到，不算硬编码逃逸。
        if (/^var\(--radius-[a-z0-9-]+(,\s*.+)?\)$/.test(seg)) return true;
        // calc(var(--radius-a) - var(--radius-b)) 这类同心表达式
        if (/^calc\(.+\)$/.test(seg) && seg.includes('var(--radius-')) return true;
        return /^(999px|9999px|50%|0|1px|3px)$/.test(seg);
      };
      // 分段时不能按空格硬切：calc(...) 与 var(..., fallback) 内部都含空格。
      // 改为括号感知切分，把括号内的内容视为整体。
      const parts = [];
      {
        let buf = '', depth = 0;
        for (const ch of clean) {
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
          if (depth === 0 && /\s/.test(ch)) {
            if (buf) { parts.push(buf); buf = ''; }
            continue;
          }
          buf += ch;
        }
        if (buf) parts.push(buf);
      }
      const allOk = parts.every(isToken);
      if (allOk) return;
      hits.push(`${path.relative(ROOT, p)}:${i + 1}  → ${val}`);
    });
  }
}
walk(SRC);
if (hits.length) {
  fail(`发现 ${hits.length} 处硬编码圆角：`);
  hits.slice(0, 20).forEach((h) => console.log('      ' + h));
  if (hits.length > 20) console.log(`      …还有 ${hits.length - 20} 处`);
} else {
  ok('无硬编码圆角，全部走令牌');
}

// ---------- ④ 角色别名完整性 ----------
console.log('\n④ 角色别名定义完整性（各主题不得缺角色）');
for (const [theme, file] of Object.entries(THEMES)) {
  const vars = parseTheme(file);
  const missing = ROLES.filter((r) => vars[r] === undefined);
  if (missing.length) fail(`${theme}: 缺少角色定义 ${missing.join(', ')}`);
  else ok(`${theme}: ${ROLES.map((r) => r + '=' + vars[r]).join(' ')}`);
}

console.log('\n' + (errors ? `✗ ${errors} 项未通过` : '✓ 全部检查通过'));
process.exit(errors ? 1 : 0);
