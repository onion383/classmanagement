// schema 拆分子文件：卫生值日表（设置/当前/模板/权重/草稿）+ 按天升级迁移 + 存量回填。
const { ensureTableWithMigration } = require('./schema.helpers');

function migrateDuty(conn) {
  // ======================== 卫生值日表（设置/当前/模板/权重/草稿/历史） ========================
  // duty_settings：全局「时间(星期几) + 劳动项目(含辛苦度、人数)」配置
  // duty_layout / duty_template：当前值日表与值日模板（cells 按 项目名→星期→学生名单 存储）
  // duty_weight：值日项目权重表（项目名→星期→权重值），按 daily/big 分模式打包存储
  // duty_draft：智能排表的临时草稿（cells/settings/conditions + saved_at，saved_at 为空即无草稿）
  conn.exec(`
    CREATE TABLE IF NOT EXISTS duty_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      days TEXT NOT NULL DEFAULT '["周一","周二","周三","周四","周五"]',
      items TEXT NOT NULL DEFAULT '[]'
    );
    INSERT OR IGNORE INTO duty_settings (id, items) VALUES (1, '[{"name":"擦黑板","difficulty":0.6,"count":1},{"name":"倒垃圾","difficulty":0.7,"count":2},{"name":"扫地","difficulty":0.8,"count":2}]');

    CREATE TABLE IF NOT EXISTS duty_layout (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cells TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}'
    );
    INSERT OR IGNORE INTO duty_layout (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS duty_template (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cells TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}'
    );
    INSERT OR IGNORE INTO duty_template (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS duty_weight (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      weights TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}'
    );
    INSERT OR IGNORE INTO duty_weight (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS duty_draft (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cells TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}',
      conditions TEXT NOT NULL DEFAULT '[]',
      saved_at TEXT NOT NULL DEFAULT ''
    );
    INSERT OR IGNORE INTO duty_draft (id) VALUES (1);
  `);

  // duty_history 迁移：由「按周」升级为「按天」（对齐座位快照）。
  // 新增 snap_date（该行对应的具体日期）与 mode（daily/big），
  // 存量记录以其 week_start 作为 snap_date、并归入 daily 模式。
  ensureTableWithMigration(conn, 'duty_history', `
    CREATE TABLE duty_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      snap_date TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'daily',
      cells TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `, [
    { column: 'snap_date', sql: "snap_date TEXT NOT NULL DEFAULT ''" },
    { column: 'mode', sql: "mode TEXT NOT NULL DEFAULT 'daily'" }
  ]);
  conn.exec(`UPDATE duty_history SET snap_date = week_start WHERE snap_date = '';`);
}

module.exports = { migrateDuty };
