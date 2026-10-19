// schema 拆分子文件：加分/扣分记录表 + 存量库补表迁移 + 索引。
const { ensureTableWithMigration } = require('./schema.helpers');

function migrateScore(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS score_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      姓名 TEXT,
      学号 TEXT,
      类型 TEXT,
      项目 TEXT,
      分值 REAL,
      原因 TEXT,
      加分时间 TEXT,
      created_at TEXT,
      source TEXT DEFAULT 'personal',
      group_name TEXT,
      成员数 INTEGER DEFAULT 0
    );
  `);

  // ======================== 加分记录表迁移（存量库补表） ========================
  ensureTableWithMigration(conn, 'score_records', `
    CREATE TABLE score_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      姓名 TEXT,
      学号 TEXT,
      类型 TEXT,
      项目 TEXT,
      分值 REAL,
      原因 TEXT,
      加分时间 TEXT,
      created_at TEXT,
      source TEXT DEFAULT 'personal',
      group_name TEXT,
      成员数 INTEGER DEFAULT 0
    );
  `, [
    { column: '学号', sql: `"学号" TEXT` },
    { column: '原因', sql: `"原因" TEXT` },
    { column: 'source', sql: `"source" TEXT DEFAULT 'personal'` },
    { column: 'group_name', sql: `"group_name" TEXT` },
    { column: '成员数', sql: `"成员数" INTEGER DEFAULT 0` }
  ]);

  // 优化：加分按学生过滤 + 时间排序展示
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_score_student_time ON score_records (student_id, 加分时间);`);
}

module.exports = { migrateScore };
