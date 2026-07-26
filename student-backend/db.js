const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'database.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ======================== 原有建表 ========================
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position INTEGER DEFAULT 1,
    学号 TEXT,
    年级 TEXT,
    班级 TEXT,
    姓名 TEXT NOT NULL,
    年龄 INTEGER,
    备注 TEXT
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
    role TEXT NOT NULL DEFAULT 'teacher'
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
`);

// ======================== 初始化元数据 ========================
const initMeta = db.prepare(`INSERT OR IGNORE INTO table_meta (table_name, column_name, sort_order) VALUES (?, ?, ?)`);
['学号','年级','班级','姓名','年龄','备注'].forEach((c,i) => initMeta.run('students', c, i+1));
['收支编码','收支类型','收支金额','收支时间','备注','收据'].forEach((c,i) => initMeta.run('fee_records', c, i+1));

// ======================== 示例数据 ========================
if (db.prepare('SELECT COUNT(*) AS cnt FROM students').get().cnt === 0) {
  db.prepare(`INSERT INTO students (学号,年级,班级,姓名,年龄,备注,position) VALUES ('2024001','大三','计算机1班','张三',20,'班长',1)`).run();
}
if (db.prepare('SELECT COUNT(*) AS cnt FROM fee_records').get().cnt === 0) {
  db.prepare(`INSERT INTO fee_records (收支编码,收支类型,收支金额,收支时间,备注,收据,position) VALUES ('SZ-2024001','收入',500.00,'2024-01-15','班费收缴','[]',1)`).run();
}

// ======================== 默认账号 ========================
const bcrypt = require('bcryptjs');
const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)');
const hashedPassword = bcrypt.hashSync('123456', 10);
insertUser.run('admin', hashedPassword, 'teacher');

// ======================== 座位表相关迁移 ========================
// 座位布局表（当前座位）
const seatLayoutExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='seat_layout'").get();
if (!seatLayoutExists) {
  db.exec(`
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
  `);
} else {
  const cols = db.prepare("PRAGMA table_info(seat_layout)").all().map(c => c.name);
  if (!cols.includes('mode')) db.prepare("ALTER TABLE seat_layout ADD COLUMN mode TEXT NOT NULL DEFAULT 'single'").run();
  if (!cols.includes('aisle_cols')) db.prepare("ALTER TABLE seat_layout ADD COLUMN aisle_cols TEXT NOT NULL DEFAULT '[]'").run();
  if (!cols.includes('groups_config')) db.prepare("ALTER TABLE seat_layout ADD COLUMN groups_config TEXT NOT NULL DEFAULT '[]'").run();
}

// 座位模板表
const seatTemplateExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='seat_template'").get();
if (!seatTemplateExists) {
  db.exec(`
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
  `);
} else {
  const cols = db.prepare("PRAGMA table_info(seat_template)").all().map(c => c.name);
  if (!cols.includes('mode')) db.prepare("ALTER TABLE seat_template ADD COLUMN mode TEXT NOT NULL DEFAULT 'single'").run();
  if (!cols.includes('aisle_cols')) db.prepare("ALTER TABLE seat_template ADD COLUMN aisle_cols TEXT NOT NULL DEFAULT '[]'").run();
  if (!cols.includes('groups_config')) db.prepare("ALTER TABLE seat_template ADD COLUMN groups_config TEXT NOT NULL DEFAULT '[]'").run();
}

// 座位历史快照表
const seatHistoryExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='seat_history'").get();
if (!seatHistoryExists) {
  db.exec(`
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
  `);
} else {
  const cols = db.prepare("PRAGMA table_info(seat_history)").all().map(c => c.name);
  if (!cols.includes('mode')) db.prepare("ALTER TABLE seat_history ADD COLUMN mode TEXT NOT NULL DEFAULT 'single'").run();
  if (!cols.includes('aisle_cols')) db.prepare("ALTER TABLE seat_history ADD COLUMN aisle_cols TEXT NOT NULL DEFAULT '[]'").run();
  if (!cols.includes('groups_config')) db.prepare("ALTER TABLE seat_history ADD COLUMN groups_config TEXT NOT NULL DEFAULT '[]'").run();
}

// ======================== 工具函数 ========================
function getFields(tableName) {
  return db.prepare(`SELECT column_name AS name, data_type AS type FROM table_meta WHERE table_name = ? ORDER BY sort_order`).all(tableName);
}

function renumber(tableName) {
  const rows = db.prepare(`SELECT id FROM ${tableName} ORDER BY position, id`).all();
  const stmt = db.prepare(`UPDATE ${tableName} SET position = ? WHERE id = ?`);
  rows.forEach((r, i) => stmt.run(i + 1, r.id));
}

module.exports = { db, getFields, renumber };