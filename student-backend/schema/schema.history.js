// schema 拆分子文件：三域历史快照（课表 / 值日 / 座位）合并为一张 domain_history + 只读逻辑视图。
function migrateHistory(conn) {
  // 原先 schedule_history / duty_history / seat_history 三张结构不同的历史表，
  // 合并为一张带 domain 的 domain_history，快照内容统一存 payload JSON：
  //   schedule → { cells, settings }
  //   duty     → { cells, settings }
  //   seat     → { mode, rows, cols, seats, aisleCols, groupsConfig, settings }
  // 逻辑表名仍可通过只读视图读取（AI 查询、历史接口的 SELECT 无需改动）。
  conn.exec(`
    CREATE TABLE IF NOT EXISTS domain_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL CHECK (domain IN ('schedule','duty','seat')),
      week_start TEXT NOT NULL DEFAULT '',
      snap_date TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_domain_history_week ON domain_history (domain, week_start DESC);
    CREATE INDEX IF NOT EXISTS idx_domain_history_date ON domain_history (domain, snap_date, mode);

    DROP VIEW IF EXISTS schedule_history;
    DROP TABLE IF EXISTS schedule_history;
    CREATE VIEW schedule_history AS
      SELECT id, week_start,
             json_extract(payload, '$.cells') AS cells,
             json_extract(payload, '$.settings') AS settings,
             created_at
      FROM domain_history WHERE domain = 'schedule';

    DROP VIEW IF EXISTS duty_history;
    DROP TABLE IF EXISTS duty_history;
    CREATE VIEW duty_history AS
      SELECT id, week_start, snap_date, mode,
             json_extract(payload, '$.cells') AS cells,
             json_extract(payload, '$.settings') AS settings,
             created_at
      FROM domain_history WHERE domain = 'duty';

    DROP VIEW IF EXISTS seat_history;
    DROP TABLE IF EXISTS seat_history;
    CREATE VIEW seat_history AS
      SELECT id, week_start, snap_date, mode,
             json_extract(payload, '$.rows') AS rows,
             json_extract(payload, '$.cols') AS cols,
             json_extract(payload, '$.seats') AS seats,
             json_extract(payload, '$.aisleCols') AS aisle_cols,
             json_extract(payload, '$.groupsConfig') AS groups_config,
             json_extract(payload, '$.settings') AS settings,
             created_at
      FROM domain_history WHERE domain = 'seat';
  `);
}

module.exports = { migrateHistory };
