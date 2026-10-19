// schema 拆分子文件：卫生值日槽位表（设置/当前/模板/权重/草稿）+ 只读逻辑视图。
function migrateDuty(conn) {
  // 原 duty_settings / duty_layout / duty_template / duty_weight / duty_draft 五张同构单例表
  // 合并为 duty_slots，按 kind 区分：
  //   settings：全局「星期 + 劳动项目」配置（days/items）
  //   current ：当前值日表（cells/settings）
  //   template：值日模板（cells/settings）
  //   weight  ：项目权重表（weights/settings）
  //   draft   ：智能排表草稿（cells/settings/conditions/saved_at）
  conn.exec(`
    CREATE TABLE IF NOT EXISTS duty_slots (
      kind TEXT PRIMARY KEY CHECK (kind IN ('settings','current','template','weight','draft')),
      days TEXT NOT NULL DEFAULT '["周一","周二","周三","周四","周五"]',
      items TEXT NOT NULL DEFAULT '[]',
      cells TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}',
      weights TEXT NOT NULL DEFAULT '{}',
      conditions TEXT NOT NULL DEFAULT '[]',
      saved_at TEXT NOT NULL DEFAULT ''
    );
    INSERT OR IGNORE INTO duty_slots (kind, items) VALUES
      ('settings', '[{"name":"擦黑板","difficulty":0.6,"count":1},{"name":"倒垃圾","difficulty":0.7,"count":2},{"name":"扫地","difficulty":0.8,"count":2}]');
    INSERT OR IGNORE INTO duty_slots (kind) VALUES ('current'), ('template'), ('weight'), ('draft');

    -- 只读逻辑视图：保持既有 SELECT 的写法与结果形状不变（写统一走 services/slotStore.js）
    DROP VIEW IF EXISTS duty_settings;
    DROP TABLE IF EXISTS duty_settings;
    CREATE VIEW duty_settings AS
      SELECT 1 AS id, days, items FROM duty_slots WHERE kind = 'settings';

    DROP VIEW IF EXISTS duty_layout;
    DROP TABLE IF EXISTS duty_layout;
    CREATE VIEW duty_layout AS
      SELECT 1 AS id, cells, settings FROM duty_slots WHERE kind = 'current';

    DROP VIEW IF EXISTS duty_template;
    DROP TABLE IF EXISTS duty_template;
    CREATE VIEW duty_template AS
      SELECT 1 AS id, cells, settings FROM duty_slots WHERE kind = 'template';

    DROP VIEW IF EXISTS duty_weight;
    DROP TABLE IF EXISTS duty_weight;
    CREATE VIEW duty_weight AS
      SELECT 1 AS id, weights, settings FROM duty_slots WHERE kind = 'weight';

    DROP VIEW IF EXISTS duty_draft;
    DROP TABLE IF EXISTS duty_draft;
    CREATE VIEW duty_draft AS
      SELECT 1 AS id, cells, settings, conditions, saved_at FROM duty_slots WHERE kind = 'draft';
  `);
}

module.exports = { migrateDuty };
