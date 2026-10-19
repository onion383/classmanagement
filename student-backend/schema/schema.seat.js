// schema 拆分子文件：座位槽位表（当前/模板/草稿/权重）+ 只读逻辑视图。
function migrateSeat(conn) {
  // 原 seat_layout / seat_template / seat_draft / seat_weight 四张同构单例表合并为 seat_slots：
  //   current ：当前座位（mode/rows/cols/seats/aisle_cols/groups_config/settings）
  //   template：座位模板（同上）
  //   draft   ：智能排表草稿（同上 + conditions/saved_at）
  //   weight  ：座位位置权重（mode/rows/cols/weights/settings）
  conn.exec(`
    CREATE TABLE IF NOT EXISTS seat_slots (
      kind TEXT PRIMARY KEY CHECK (kind IN ('current','template','draft','weight')),
      mode TEXT NOT NULL DEFAULT 'single',
      rows INTEGER NOT NULL DEFAULT 6,
      cols INTEGER NOT NULL DEFAULT 7,
      seats TEXT NOT NULL DEFAULT '[]',
      aisle_cols TEXT NOT NULL DEFAULT '[]',
      groups_config TEXT NOT NULL DEFAULT '[]',
      weights TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}',
      conditions TEXT NOT NULL DEFAULT '[]',
      saved_at TEXT NOT NULL DEFAULT ''
    );
    INSERT OR IGNORE INTO seat_slots (kind) VALUES ('current'), ('template'), ('draft'), ('weight');

    -- 只读逻辑视图：保持既有 SELECT 的写法与结果形状不变（写统一走 services/slotStore.js）
    DROP VIEW IF EXISTS seat_layout;
    DROP TABLE IF EXISTS seat_layout;
    CREATE VIEW seat_layout AS
      SELECT 1 AS id, mode, rows, cols, seats, aisle_cols, groups_config, settings
      FROM seat_slots WHERE kind = 'current';

    DROP VIEW IF EXISTS seat_template;
    DROP TABLE IF EXISTS seat_template;
    CREATE VIEW seat_template AS
      SELECT 1 AS id, mode, rows, cols, seats, aisle_cols, groups_config, settings
      FROM seat_slots WHERE kind = 'template';

    DROP VIEW IF EXISTS seat_weight;
    DROP TABLE IF EXISTS seat_weight;
    CREATE VIEW seat_weight AS
      SELECT 1 AS id, mode, rows, cols, weights, settings
      FROM seat_slots WHERE kind = 'weight';

    DROP VIEW IF EXISTS seat_draft;
    DROP TABLE IF EXISTS seat_draft;
    CREATE VIEW seat_draft AS
      SELECT 1 AS id, mode, rows, cols, seats, aisle_cols, groups_config, settings, conditions, saved_at
      FROM seat_slots WHERE kind = 'draft';
  `);
}

module.exports = { migrateSeat };
