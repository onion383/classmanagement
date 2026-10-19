// schema 拆分子文件：班费收支表 + 按时间排序索引。
function migrateFee(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS fee_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER DEFAULT 1,
      收支编码 TEXT,
      收支类型 TEXT,
      收支金额 REAL,
      收支时间 TEXT,
      备注 TEXT,
      收据 TEXT
    );
  `);

  // 优化：收支按时间排序展示
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_fee_time ON fee_records (收支时间);`);
}

module.exports = { migrateFee };
