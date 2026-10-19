// schema 拆分子文件：班级活动表 + 倒计时表。
function migrateActivity(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER DEFAULT 1,
      时间 TEXT,
      主题 TEXT,
      地点 TEXT,
      简介 TEXT,
      参与人员 TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS countdowns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER DEFAULT 1,
      名称 TEXT,
      截止日 TEXT,
      包含这一天 INTEGER DEFAULT 0,
      created_at TEXT
    );
  `);
}

module.exports = { migrateActivity };
