// schema 拆分子文件：请假记录表 + 开始/结束时间历史迁移 + 索引。
const { ensureTableWithMigration } = require('./schema.helpers');

function migrateLeave(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS leave_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER DEFAULT 1,
      student_id INTEGER,
      姓名 TEXT,
      类型 TEXT,
      开始时间 TEXT,
      结束时间 TEXT,
      家长联系电话 TEXT,
      学生联系电话 TEXT,
      状态 TEXT DEFAULT '请假中',
      返校时间 TEXT,
      备注 TEXT,
      created_at TEXT
    );
  `);

  // ======================== 请假表迁移（开始/结束时间） ========================
  ensureTableWithMigration(conn, 'leave_records', `
    CREATE TABLE leave_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER DEFAULT 1,
      student_id INTEGER,
      姓名 TEXT,
      类型 TEXT,
      开始时间 TEXT,
      结束时间 TEXT,
      家长联系电话 TEXT,
      学生联系电话 TEXT,
      状态 TEXT DEFAULT '请假中',
      返校时间 TEXT,
      备注 TEXT,
      created_at TEXT
    );
  `, [
    { column: '开始时间', sql: `"开始时间" TEXT` },
    { column: '结束时间', sql: `"结束时间" TEXT` }
  ]);

  // 优化：请假按学生+状态过滤（看板统计/时段冲突校验）
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_leave_student_status ON leave_records (student_id, 状态);`);
}

module.exports = { migrateLeave };
