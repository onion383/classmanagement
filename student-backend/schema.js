// 纯建表结构：可复用于「默认库」和任一「班主任库」。
// 这里只负责表结构与只读默认配置，不含任何业务示例数据、不含账号。

function initSchema(conn) {
  // ======================== 建表 ========================
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
      备注 TEXT
    );

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

    CREATE TABLE IF NOT EXISTS schedule_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      semester_start TEXT NOT NULL DEFAULT '',
      auto_apply INTEGER DEFAULT 1
    );
    INSERT OR IGNORE INTO schedule_settings (id, semester_start) VALUES (1, '');

    CREATE TABLE IF NOT EXISTS master_schedule (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cells TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}'
    );
    INSERT OR IGNORE INTO master_schedule (id, cells, settings) VALUES (1, '[]', '{}');

    CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cells TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}'
    );
    INSERT OR IGNORE INTO schedule (id, cells, settings) VALUES (1, '[]', '{}');

    CREATE TABLE IF NOT EXISTS schedule_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      cells TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS widget_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      toolbox_enabled INTEGER DEFAULT 1,
      note_save_path TEXT DEFAULT '',
      screenshot_save_path TEXT DEFAULT ''
    );
    INSERT OR IGNORE INTO widget_settings (id) VALUES (1);

    -- 班级相册：相册（文件夹）登记表
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT '',
      updated_at TEXT DEFAULT ''
    );

    -- 班级相册：照片索引表（记录源文件绝对路径与时间，用于按日期分组）
    CREATE TABLE IF NOT EXISTS album_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mtime TEXT DEFAULT '',
      photo_date TEXT DEFAULT '',
      thumb_path TEXT DEFAULT '',
      UNIQUE (album_id, file_path)
    );
  `);

  // 存量库迁移：为相册照片表补充 thumb_path 列
  {
    const photoCols = conn.prepare('PRAGMA table_info(album_photos)').all().map(c => c.name);
    if (!photoCols.includes('thumb_path')) {
      conn.exec(`ALTER TABLE album_photos ADD COLUMN thumb_path TEXT DEFAULT ''`);
    }
  }
  // 存量库迁移：为相册表补充 sort_order 列
  {
    const albumCols = conn.prepare('PRAGMA table_info(albums)').all().map(c => c.name);
    if (!albumCols.includes('sort_order')) {
      conn.exec(`ALTER TABLE albums ADD COLUMN sort_order INTEGER DEFAULT 0`);
      // 已有数据按 id 序填充 sort_order
      conn.exec(`UPDATE albums SET sort_order = id WHERE sort_order = 0`);
    }
  }

  // ======================== 元数据默认列 ========================
  const initMeta = conn.prepare(`INSERT OR IGNORE INTO table_meta (table_name, column_name, sort_order) VALUES (?, ?, ?)`);
  ['学号','年级','班级','姓名','年龄','家长联系电话','学生联系电话','备注'].forEach((c, i) => initMeta.run('students', c, i + 1));
  ['收支编码','收支类型','收支金额','收支时间','备注','收据'].forEach((c, i) => initMeta.run('fee_records', c, i + 1));

  // ======================== 迁移工具 ========================
  function ensureTableWithMigration(tableName, createSQL, migrations) {
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

  // ======================== 学生表联系方式迁移 ========================
  ensureTableWithMigration('students', `
    CREATE TABLE students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER DEFAULT 1,
      学号 TEXT,
      年级 TEXT,
      班级 TEXT,
      姓名 TEXT NOT NULL,
      年龄 INTEGER,
      家长联系电话 TEXT,
      学生联系电话 TEXT,
      备注 TEXT
    );
  `, [
    { column: '家长联系电话', sql: `"家长联系电话" TEXT` },
    { column: '学生联系电话', sql: `"学生联系电话" TEXT` }
  ]);

  // ======================== 请假表迁移（开始/结束时间） ========================
  ensureTableWithMigration('leave_records', `
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

  // ======================== 座位表迁移（抽象复用） ========================
  const seatMigrations = [
    { column: 'mode', sql: "mode TEXT NOT NULL DEFAULT 'single'" },
    { column: 'aisle_cols', sql: "aisle_cols TEXT NOT NULL DEFAULT '[]'" },
    { column: 'groups_config', sql: "groups_config TEXT NOT NULL DEFAULT '[]'" }
  ];

  ensureTableWithMigration('seat_layout', `
    CREATE TABLE seat_layout (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'single',
      rows INTEGER NOT NULL DEFAULT 6,
      cols INTEGER NOT NULL DEFAULT 7,
      seats TEXT NOT NULL DEFAULT '[]',
      aisle_cols TEXT NOT NULL DEFAULT '[]',
      groups_config TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}'
    );
    INSERT INTO seat_layout (id) VALUES (1);
  `, seatMigrations);

  ensureTableWithMigration('seat_template', `
    CREATE TABLE seat_template (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'single',
      rows INTEGER NOT NULL DEFAULT 6,
      cols INTEGER NOT NULL DEFAULT 7,
      seats TEXT NOT NULL DEFAULT '[]',
      aisle_cols TEXT NOT NULL DEFAULT '[]',
      groups_config TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}'
    );
    INSERT INTO seat_template (id) VALUES (1);
  `, seatMigrations);

  ensureTableWithMigration('seat_history', `
    CREATE TABLE seat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'single',
      rows INTEGER NOT NULL,
      cols INTEGER NOT NULL,
      seats TEXT NOT NULL DEFAULT '[]',
      aisle_cols TEXT NOT NULL DEFAULT '[]',
      groups_config TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `, seatMigrations);
}

module.exports = { initSchema };