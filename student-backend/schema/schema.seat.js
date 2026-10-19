// schema 拆分子文件：座位表（当前/模板/草稿/权重/历史）+ 几何列迁移 + 存量快照回填。
const { ensureTableWithMigration } = require('./schema.helpers');

function migrateSeat(conn) {
  // ======================== 座位表迁移（抽象复用） ========================
  const seatMigrations = [
    { column: 'mode', sql: "mode TEXT NOT NULL DEFAULT 'single'" },
    { column: 'aisle_cols', sql: "aisle_cols TEXT NOT NULL DEFAULT '[]'" },
    { column: 'groups_config', sql: "groups_config TEXT NOT NULL DEFAULT '[]'" }
  ];

  ensureTableWithMigration(conn, 'seat_layout', `
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

  ensureTableWithMigration(conn, 'seat_template', `
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

  // 草稿表：智能排表弹窗「保存草稿」的落库目标（单独一张表，不影响正式座位表/模板表）。
  // 除与座位表一致的字段外，多存 conditions（本次排表的条件列表）与 saved_at（保存时间）。
  // 没有草稿时 saved_at 为空串，接口据此判断是否存在草稿。
  ensureTableWithMigration(conn, 'seat_draft', `
    CREATE TABLE seat_draft (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'single',
      rows INTEGER NOT NULL DEFAULT 6,
      cols INTEGER NOT NULL DEFAULT 7,
      seats TEXT NOT NULL DEFAULT '[]',
      aisle_cols TEXT NOT NULL DEFAULT '[]',
      groups_config TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}',
      conditions TEXT NOT NULL DEFAULT '[]',
      saved_at TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO seat_draft (id) VALUES (1);
  `, []);

  // 座位位置权重表：与座位布局共用几何（rows/cols/mode/showAisle），单独存数字矩阵 weights
  ensureTableWithMigration(conn, 'seat_weight', `
    CREATE TABLE seat_weight (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'single',
      rows INTEGER NOT NULL DEFAULT 6,
      cols INTEGER NOT NULL DEFAULT 7,
      weights TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}'
    );
    INSERT INTO seat_weight (id) VALUES (1);
  `, []);

  // 座位历史快照：按天保存（snap_date），week_start 为由当天推导的周一，供历史下拉按周聚合。
  // 迁移数组独立于 seat_layout/seat_template，避免 snap_date 被带到另两张表。
  const seatHistoryMigrations = [
    ...seatMigrations,
    { column: 'snap_date', sql: "snap_date TEXT NOT NULL DEFAULT ''" }
  ];

  ensureTableWithMigration(conn, 'seat_history', `
    CREATE TABLE seat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      snap_date TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'single',
      rows INTEGER NOT NULL,
      cols INTEGER NOT NULL,
      seats TEXT NOT NULL DEFAULT '[]',
      aisle_cols TEXT NOT NULL DEFAULT '[]',
      groups_config TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `, seatHistoryMigrations);

  // 存量快照回填：旧数据只有 week_start，没有 snap_date，用 week_start 兜底，保证按天查询可用
  conn.exec(`UPDATE seat_history SET snap_date = week_start WHERE snap_date = ''`);
}

module.exports = { migrateSeat };
