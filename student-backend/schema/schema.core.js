// schema 拆分子文件：核心表（学生 / 用户 / 待办 / 表元数据）+ 默认列与索引。
function migrateCore(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER DEFAULT 1,
      学号 TEXT,
      年级 TEXT,
      班级 TEXT,
      姓名 TEXT NOT NULL,
      年龄 INTEGER,
      家长联系电话 TEXT,
      学生联系电话 TEXT,
      备注 TEXT,
      is_provisional INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS table_meta (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      data_type TEXT DEFAULT '文字',
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (table_name, column_name)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'teacher',
      db_slug TEXT DEFAULT '',
      recovery_hash TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS pending_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user TEXT NOT NULL,
      target_table TEXT NOT NULL,
      target_id INTEGER,
      action_type TEXT NOT NULL,
      data TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ======================== 元数据默认列 ========================
  const initMeta = conn.prepare(`INSERT OR IGNORE INTO table_meta (table_name, column_name, sort_order) VALUES (?, ?, ?)`);
  ['学号','年级','班级','姓名','年龄','家长联系电话','学生联系电话','备注'].forEach((c, i) => initMeta.run('students', c, i + 1));
  ['收支编码','收支类型','收支金额','收支时间','备注','收据'].forEach((c, i) => initMeta.run('fee_records', c, i + 1));

  // ======================== 临时学生 ========================
  // is_provisional 是「成员状态」，不是第二套身份：临时学生与正式学生共用 students.id，
  // 转正只是把这一位从 1 改成 0，所有引用（座位/值日/小组…）都不需要重指。
  // 刻意不写进 table_meta：普通学生表格不展示、也不允许直接改它，入口只在「数据管理」。
  const studentCols = conn.prepare('PRAGMA table_info(students)').all().map((c) => c.name);
  if (!studentCols.includes('is_provisional')) {
    conn.exec(`ALTER TABLE students ADD COLUMN is_provisional INTEGER NOT NULL DEFAULT 0`);
  }
  // 临时学生按姓名唯一：同一个名字反复输入只建一条，不会越积越多；
  // 正式学生允许重名，所以只对 is_provisional = 1 建部分唯一索引。
  conn.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_students_provisional_name
             ON students (姓名) WHERE is_provisional = 1;`);

  // 优化：学生按姓名搜索（搜索栏/下拉候选）
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_students_name ON students (姓名);`);
}

module.exports = { migrateCore };
