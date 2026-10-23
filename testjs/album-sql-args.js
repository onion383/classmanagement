// =========================================================================
// album-sql-args.js —— 静态核对 album_photos 的 INSERT/UPDATE 占位符与实参个数
//
// 为什么需要：album_photos 的 INSERT 语句被复制到很多处（虚拟相册复制、移动照片、
// 4 处 undo/redo），每加一列（本次加了 exif_date / date_src）都要同步改所有调用点。
// better-sqlite3 少传参数只在**运行到那一行**时才抛「Too few parameter values
// were provided」，而这些分支（尤其 undo 的 redo）平时根本不跑，漏了测不出来。
// 所以在提交前静态对一遍：占位符个数必须等于顶层实参个数。
//
// 用法：node testjs/album-sql-args.js
// 只做静态配对检查，不连库、不改文件。退出码 0 = 全部配对正确。
// =========================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'student-backend/albumScan.js',
  'student-backend/routes/album.js',
  'student-backend/routes/undo/undo.executors.js',
];

// 数出表达式里的顶层实参个数（忽略字符串内的逗号与嵌套括号内的逗号）
function countArgs(src) {
  let depth = 0, n = 1, quote = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) n++;
  }
  return n;
}

// 扫出所有针对 album_photos 的 prepare 语句，同时取到「持有它的变量名」
function findStatements(src) {
  const out = [];
  const re = /prepare\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const sql = m[2];
    if (!/INTO album_photos|UPDATE album_photos/.test(sql)) continue;
    const before = src.slice(0, m.index);
    // 变量名与这个 prepare 同属一条声明：从 prepare 往前回溯到最近的
    // `const|let|var <name> =`，且中间不能跨过 `;`（跨过就是另一条语句了）。
    const cut = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}'));
    const seg = before.slice(cut + 1);
    const decl = seg.match(/(?:const|let|var)\s+(\w+)\s*=\s*[A-Za-z_$][\w.$]*\s*$/);
    // 声明行的缩进（单行写法）；声明本身跨多行时，声明行的缩进才是作用域基准
    const declLine = seg.slice(seg.lastIndexOf('\n') + 1);
    out.push({
      line: src.slice(0, m.index).split('\n').length,
      name: decl ? decl[1] : null,
      q: (sql.match(/\?/g) || []).length,
      end: m.index + m[0].length,
      // 作用域边界：同名变量常在不同函数里各声明一次（如三个 executor 都有
      // `const ins`），跨函数配对会张冠李戴。限定查找范围。
      scopeStart: m.index,
      scopeEnd: findScopeEnd(src, m.index, declIndentFor(src, m.index, declLine)),
    });
  }
  return out;
}

// 声明行（seg 里最后一行）的缩进宽度
function declIndentFor(src, idx, declLine) {
  const line = declLine !== undefined ? declLine
    : src.slice(src.lastIndexOf('\n', idx) + 1, src.indexOf('\n', idx));
  return (line.match(/^[ \t]*/)[0] || '').length;
}

/* 作用域结束位置：从声明处往后找下一个**缩进严格小于声明行**的行。
 * 用「严格小于」而不是「小于等于」：声明行本身（如 `      const ins = ...`，
 * 6 空格）之后，函数体内的 `        ins.run(...)` 是 8 空格（更深，属于同一作用域），
 * 而下一个函数头的 `    async redo(...)` 是 4 空格（更浅，才是边界）。
 * 同级的下一个函数若恰好与声明行同缩进（顶层 `const x = ...`），
 * 则退化为「遇到下一个同级声明即出作用域」。 */
function findScopeEnd(src, idx, indent) {
  let i = src.indexOf('\n', idx);
  if (i < 0) return src.length;
  while (i < src.length) {
    const lineStart = i + 1;
    const lineEnd = src.indexOf('\n', lineStart);
    const line = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd);
    if (line.trim()) {
      const ind = line.match(/^[ \t]*/)[0].length;
      if (ind < indent) return lineStart;      // 更外层 → 出作用域
      if (ind === indent && /^\s*(?:const|let|var|function|async)\b/.test(line)) {
        // 同级且是新的声明/函数：同名变量会被重新绑定，不能再往后配对
        const redecl = line.match(/(?:const|let|var)\s+(\w+)/);
        return lineStart;
      }
    }
    if (lineEnd < 0) return src.length;
    i = lineEnd;
  }
  return src.length;
}

// 找出该语句之后该变量的所有 .run( 调用（限定在 scopeEnd 之内，避免跨函数串味）
function findRuns(src, name, afterIdx, scopeEnd) {
  const runs = [];
  if (!name) return runs;
  const limit = scopeEnd === undefined ? src.length : scopeEnd;
  // 参数表里不会出现分号 —— 用 [^;]*? 收敛，否则 `)` 后面跟的是 `,` 或换行而非
  // `;` 时会一路吞到下一个 `);`，数出几百个「参数」（全是误报）。
  const re = new RegExp(name.replace(/\$/g, '\\$') + '\\.run\\(([^;]*?)\\)\\s*(?:;|,|\\n)', 'g');
  let m;
  while ((m = re.exec(src))) {
    if (m.index < afterIdx || m.index > limit) continue;
    runs.push({
      line: src.slice(0, m.index).split('\n').length,
      args: countArgs(m[1]),
    });
  }
  return runs;
}

/* 有一类写法是**不赋给变量**、当场 prepare 当场 run：
 *   db.prepare('INSERT ...').run(a, b, c)
 *   db.prepare(`...`).run(...)
 * 上面那套按变量名找调用的逻辑对它完全失效（会误跳过）。这里单独处理，
 * 直接匹配 `<conn>.prepare(<sql>).run(<args>)` 的紧邻形态。 */
function findInlineRuns(src, afterIdx, endIdx) {
  const re = /prepare\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*\)\s*\.\s*run\(([^;]*?)\)\s*(?:;|,|\n)/g;
  const runs = [];
  let m;
  while ((m = re.exec(src))) {
    if (!/INTO album_photos|UPDATE album_photos/.test(m[2])) continue;
    runs.push({
      line: src.slice(0, m.index).split('\n').length,
      args: countArgs(m[3]),
      q: (m[2].match(/\?/g) || []).length,
      sql: m[2].replace(/\s+/g, ' ').trim(),
    });
  }
  return runs;
}

let bad = 0;
for (const f of FILES) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) { console.log('跳过（不存在）', f); continue; }
  const src = fs.readFileSync(full, 'utf8');
  console.log('== ' + f);

  // 1) 先处理「当场 prepare 当场 run」的写法
  const inline = findInlineRuns(src);
  const inlineRanges = [];
  for (const r of inline) {
    if (r.args !== r.q) {
      console.log(`   ✗ 行${r.line} 占位符=${r.q}，但同一句的 .run 只给了 ${r.args} 个参数`);
      console.log(`     ${r.sql.slice(0, 90)}…`);
      bad++;
    } else {
      console.log(`   ✓ 行${r.line} 占位符=${r.q} → 紧邻 .run 的 ${r.args} 个参数匹配（当场 prepare/run）`);
    }
  }

  // 2) 再处理「prepare 赋值给变量、之后 .run」的写法
  for (const st of findStatements(src)) {
    // 已被上面当场 prepare/run 覆盖的，跳过
    if (inline.some(r => r.line === st.line)) continue;
    const runs = findRuns(src, st.name, st.end, st.scopeEnd);
    if (!runs.length) {
      console.log(`   · 行${st.line} 占位符=${st.q} 变量=${st.name || '?'}（未找到调用点，跳过）`);
      continue;
    }
    for (const r of runs) {
      if (r.args !== st.q) {
        console.log(`   ✗ 行${st.line} 语句占位符=${st.q}，但 行${r.line} 的 ${st.name}.run 只给了 ${r.args} 个参数`);
        bad++;
      }
    }
    console.log(`   ✓ 行${st.line} 占位符=${st.q} 变量=${st.name} → ${runs.length} 处调用全部匹配`);
  }
}

if (bad) {
  console.log(`\n发现 ${bad} 处占位符/实参不匹配`);
  process.exit(1);
}
console.log('\n全部配对正确');