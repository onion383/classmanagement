// 注释保真审计：把「重构前的文件」与「重构后的文件目录」做注释级对比，
// 区分「文字被改写/换行」与「注释真的丢了」，避免拆分大文件时静默丢掉设计说明。
// 用法（任意 cwd 均可，脚本会自行切到仓库根目录）：
//   node testjs/comment-audit.js
//   AUDIT_BASE=<git ref> node testjs/comment-audit.js   # 默认 HEAD
// 说明：下面的 units 是历次大拆分（SettingsView / ai.tools / electron/main / schema …）
//       的快照清单；新的拆分完成后在数组里追加一条 { name, head, now } 即可复用。
//       全程只读：git show + 读文件，不改动任何代码。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
process.chdir(ROOT);
const BASE = process.env.AUDIT_BASE || 'HEAD';

const readHead = (p) => {
  try {
    // stdio: 只取 stdout，吞掉 git 的 fatal 噪声（文件在该版本不存在属正常情况）
    return execFileSync('git', ['show', `${BASE}:${p}`], { maxBuffer: 1e9, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
  } catch { return null; }
};

function extractComments(src) {
  const out = [];
  const push = (norm) => { const n = norm.replace(/\s+/g, ' ').trim(); if (n) out.push(n); };
  for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) {
    push(m[0].replace(/\/\*+|\*+\//g, ' ').split(/\r?\n/).map(s => s.replace(/^\s*\*?\s?/, '')).join(' '));
  }
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const line of stripped.split(/\r?\n/)) {
    const i = line.indexOf('//');
    if (i < 0) continue;
    push(line.slice(i + 2));
  }
  for (const m of src.matchAll(/<!--[\s\S]*?-->/g)) {
    push(m[0].replace(/<!--|-->/g, ''));
  }
  return out;
}

function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('dist')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|vue|mjs|css)$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const units = [
  { name: 'SettingsView', head: ['student-frontend/src/views/SettingsView.vue'], now: ['student-frontend/src/views/SettingsView'] },
  { name: 'SmartArrangementDialog', head: ['student-frontend/src/components/dialogs/SmartArrangementDialog.vue'], now: ['student-frontend/src/components/dialogs/SmartArrangementDialog'] },
  { name: 'Note', head: ['student-frontend/src/widget/Note.vue'], now: ['student-frontend/src/subwindows/widget'] },
  { name: 'ai.tools（原 tools.js 全量）', head: ['student-backend/routes/ai/tools.js'], now: ['student-backend/routes/ai/ai.tools'] },
  { name: 'electron/main.js', head: ['electron/main.js'], now: ['electron/main'] },
  {
    name: 'subwindows 目录迁移（原 setup/migration/widget/desktop-widget）',
    head: [
      'student-frontend/src/setup/Setup.vue', 'student-frontend/src/setup/main.js',
      'student-frontend/src/migration/Migration.vue', 'student-frontend/src/migration/main.js',
      'student-frontend/src/widget/WidgetApp.vue', 'student-frontend/src/widget/Note.vue',
      'student-frontend/src/widget/Timer.vue', 'student-frontend/src/widget/RollCall.vue',
      'student-frontend/src/widget/Screenshot.vue', 'student-frontend/src/widget/main.js',
      'student-frontend/src/desktop-widget/DesktopWidget.vue', 'student-frontend/src/desktop-widget/main.js',
    ],
    now: ['student-frontend/src/subwindows'],
  },
  { name: 'DynamicTable', head: ['student-frontend/src/components/tables/DynamicTable.vue'], now: ['student-frontend/src/components/tables/DynamicTable'] },
  { name: 'GridView', head: ['student-frontend/src/components/tables/GridView.vue'], now: ['student-frontend/src/components/tables/GridView'] },
  { name: 'ExportExcel', head: ['student-frontend/src/components/import-export/ExportExcel.vue'], now: ['student-frontend/src/components/import-export/ExportExcel'] },
  { name: 'undo', head: ['student-backend/routes/undo.js'], now: ['student-backend/routes/undo'] },
  { name: 'schema', head: ['student-backend/schema.js'], now: ['student-backend/schema'] },
  { name: 'dbManager', head: ['student-backend/dbManager.js'], now: ['student-backend/dbManager'] },
];

const report = [];
for (const u of units) {
  const oldTexts = [];
  for (const h of u.head) { const t = readHead(h); if (t) oldTexts.push(t); }
  if (!oldTexts.length) continue;

  const files = [];
  for (const n of u.now) {
    if (!fs.existsSync(n)) continue;
    if (fs.statSync(n).isDirectory()) files.push(...filesUnder(n));
    else files.push(n);
  }
  if (!files.length) continue;

  const oldC = [], newC = [];
  for (const t of oldTexts) oldC.push(...extractComments(t));
  for (const f of files) newC.push(...extractComments(fs.readFileSync(f, 'utf8')));

  const newSet = new Set(newC);
  const lost = [...new Set(oldC.filter(c => !newSet.has(c)))];

  // 全文（不看注释边界）里做片段搜索，判断是否只是换行/改写导致对不上
  const allText = files.map(f => fs.readFileSync(f, 'utf8')).join('\n').replace(/\s+/g, ' ');
  const reallyLost = [], rewritten = [];
  for (const c of lost) {
    const probe = c.replace(/^[-=*\s]+|[-=*\s]+$/g, '').slice(0, 12);
    if (probe && allText.includes(probe)) rewritten.push(c);
    else reallyLost.push(c);
  }
  report.push({ name: u.name, files: files.length, oldCount: oldC.length, newCount: newC.length, reallyLost, rewritten });
}

let truthLost = 0;
if (!report.length) {
  console.log(`未在 ${BASE} 找到可对比的旧文件。请用 AUDIT_BASE=<拆分前的 commit> 指定基线。`);
}
for (const r of report) {
  console.log(`\n===== ${r.name} =====  HEAD ${r.oldCount} 条 → 现状 ${r.newCount} 条（${r.files} 个文件）`);
  if (!r.reallyLost.length && !r.rewritten.length) { console.log('  ✓ 注释全部保留'); continue; }
  if (r.rewritten.length) {
    console.log(`  ~ 文字有变动（片段仍在，属换行/改写）: ${r.rewritten.length}`);
    r.rewritten.forEach(c => console.log('     ~ ' + c.slice(0, 100)));
  }
  if (r.reallyLost.length) {
    console.log(`  ✗ HEAD 有、现状完全找不到: ${r.reallyLost.length}`);
    r.reallyLost.forEach(c => console.log('     ✗ ' + c.slice(0, 100)));
  }
  truthLost += r.reallyLost.length;
}
console.log(`\n===== 真丢失合计：${truthLost} 条 =====`);
