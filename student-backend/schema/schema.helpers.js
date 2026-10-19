// schema 拆分子文件：通用建表/迁移工具。
// ======================== 迁移工具 ========================
// 原 schema.js 内 initSchema 的局部函数 ensureTableWithMigration 抽到此处，
// 改为显式接收 conn 参数（行为与原闭包版本完全一致）。

function ensureTableWithMigration(conn, tableName, createSQL, migrations) {
  const exists = conn.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
  if (!exists) {
    conn.exec(createSQL);
  } else if (migrations && migrations.length > 0) {
    const cols = conn.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
    for (const { column, sql } of migrations) {
      if (!cols.includes(column)) {
        conn.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${sql}`).run();
      }
    }
  }
}

module.exports = { ensureTableWithMigration };
