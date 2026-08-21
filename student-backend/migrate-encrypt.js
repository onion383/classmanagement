/**
 * 一次性迁移脚本：将明文 database.db 迁移为 SQLCipher 加密库。
 * 明文与加密各用一个独立连接（SQLCipher 的 key 按连接生效，不能跨连接 ATTACH），
 * 按表复制 schema + 数据 + 索引 + 自增序列，校验通过后再替换原文件。
 * 用法：node migrate-encrypt.js
 * 需先配置 DB_KEY（环境变量或 student-backend/.env）。
 */
const fs = require('fs');
const path = require('path');
const D = require('better-sqlite3-multiple-ciphers');

// 加载 .env
const envFile = path.join(__dirname, '.env');
try {
  const content = fs.readFileSync(envFile, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
} catch (_) { /* ignore */ }

const DB_KEY = process.env.DB_KEY;
if (!DB_KEY) {
  console.error('✗ 未配置 DB_KEY（环境变量或 student-backend/.env）');
  process.exit(1);
}

const dataDir = path.join(__dirname, 'data');
const srcPath = path.join(dataDir, 'database.db');
const encPath = path.join(dataDir, 'database.enc.db');
const bakPath = path.join(dataDir, 'database.plain.bak');

if (!fs.existsSync(srcPath)) {
  console.error('✗ 未找到明文数据库 ' + srcPath);
  process.exit(1);
}
if (fs.existsSync(encPath)) fs.unlinkSync(encPath);

const sqlKey = DB_KEY.replace(/'/g, "''");
let src = null;
let enc = null;

try {
  // 1. 明文连接（只读）
  src = new D(srcPath, { readonly: true });
  // 2. 加密连接（新库）
  enc = new D(encPath);
  enc.pragma(`key = '${sqlKey}'`);

  // 3. 遍历表：复制 schema 与数据
  const tables = src.prepare(
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  ).all();
  for (const t of tables) {
    enc.exec(t.sql); // 建表
    const cols = src.prepare(`PRAGMA table_info("${t.name}")`).all().map(c => c.name);
    const colSql = cols.map(c => `"${c}"`).join(', ');
    const ph = cols.map(() => '?').join(', ');
    const rows = src.prepare(`SELECT ${colSql} FROM "${t.name}"`).all();
    const ins = enc.prepare(`INSERT INTO "${t.name}" (${colSql}) VALUES (${ph})`);
    const copyTx = enc.transaction((list) => { for (const r of list) ins.run(...cols.map(c => r[c])); });
    copyTx(rows);
    const cnt = rows.length;
    const after = enc.prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get().c;
    console.log(`  ${t.name}: ${cnt} 行 => ${after} 行`);
    if (cnt !== after) throw new Error(`表 ${t.name} 数据行数不一致`);
  }

  // 4. 复制索引
  const indexes = src.prepare(
    `SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`
  ).all();
  for (const i of indexes) enc.exec(i.sql);
  console.log(`  已复制 ${indexes.length} 个索引`);

  // 5. 复制自增序列
  try {
    const seq = src.prepare(`SELECT name, seq FROM sqlite_sequence`).all();
    for (const s of seq) {
      enc.prepare(`INSERT OR IGNORE INTO sqlite_sequence (name, seq) VALUES (?, ?)`).run(s.name, s.seq);
    }
    console.log(`  已复制自增序列 ${seq.length} 条`);
  } catch (_) { /* 无自增序列则忽略 */ }

  enc.pragma('journal_mode = DELETE');

  // 6. 关闭后用密钥重新打开校验
  src.close();
  enc.close();
  enc = new D(encPath);
  enc.pragma(`key = '${sqlKey}'`);
  const studentCnt = enc.prepare(`SELECT COUNT(*) c FROM students`).get().c;
  src = new D(srcPath, { readonly: true });
  const srcStudentCnt = src.prepare(`SELECT COUNT(*) c FROM students`).get().c;
  if (studentCnt !== srcStudentCnt) throw new Error('校验失败：students 行数不一致');
  console.log(`  校验通过：students ${studentCnt} 行一致`);
  src.close();
  enc.close();
  src = null;
  enc = null;

  // 7. 备份明文并替换
  if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
  fs.renameSync(srcPath, bakPath);
  for (const suf of ['-wal', '-shm']) {
    const f = srcPath + suf;
    if (fs.existsSync(f)) fs.renameSync(f, bakPath + suf);
  }
  fs.renameSync(encPath, srcPath);
  console.log('✔ 迁移完成：明文已备份为 data/database.plain.bak，数据库现已加密');
} catch (err) {
  console.error('✗ 迁移失败：', err.message);
  try { if (enc && enc.open) enc.close(); } catch (_) {}
  // 清理可能产生的半成品加密库
  try { if (fs.existsSync(encPath)) fs.unlinkSync(encPath); } catch (_) {}
  process.exit(1);
}