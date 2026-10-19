// schema 拆分子文件：学期表 + 课表槽位表（current/master）+ 只读逻辑视图 + 学期播种。
function migrateSchedule(conn) {
  conn.exec(`
    -- 学期表：支持「多学期列表 + 当前学期」（设置页可增加学期、选择学期、修改学期名）。
    -- 当前学期的起止日期即「学期范围」，座位/值日补存与指数结算统一从这里读取。
    CREATE TABLE IF NOT EXISTS semesters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      is_current INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 课表槽位：current=实行课表，master=一般课表（模板）。原先两张同构表单行合并为按 kind 分行。
    CREATE TABLE IF NOT EXISTS schedule_slots (
      kind TEXT PRIMARY KEY CHECK (kind IN ('current','master')),
      cells TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}'
    );
    INSERT OR IGNORE INTO schedule_slots (kind) VALUES ('current'), ('master');

    -- 只读逻辑视图：保持既有 SELECT 的写法与结果形状不变（写统一走 services/slotStore.js）
    DROP VIEW IF EXISTS schedule;
    DROP TABLE IF EXISTS schedule;
    CREATE VIEW schedule AS
      SELECT 1 AS id, cells, settings FROM schedule_slots WHERE kind = 'current';

    DROP VIEW IF EXISTS master_schedule;
    DROP TABLE IF EXISTS master_schedule;
    CREATE VIEW master_schedule AS
      SELECT 1 AS id, cells, settings FROM schedule_slots WHERE kind = 'master';

    -- 学期设置（schedule_settings）已废弃：学期起止日期唯一来源为 semesters
    DROP VIEW IF EXISTS schedule_settings;
    DROP TABLE IF EXISTS schedule_settings;
  `);

  // 学期表播种：列表为空时建一条「当前学期」（按当前月份推算默认起止日期）。
  //   7 月 ~ 次年 1 月 → 本年 9/1 ~ 次年 1/31，名字「XXXX秋季学期」
  //   1 月            → 去年 9/1 ~ 本年 1/31，名字「XXXX秋季学期」
  //   2 月 ~ 6 月      → 本年 2/1 ~ 6/30，名字「XXXX夏季学期」
  function autoSemesterName(startDate) {
    const year = Number(String(startDate).slice(0, 4)) || new Date().getFullYear();
    const month = Number(String(startDate).slice(5, 7)) || 1;
    return month >= 7 ? `${year}秋季学期` : `${year}夏季学期`;
  }
  function autoSemesterRange() {
    const y = new Date().getFullYear();
    const m = new Date().getMonth() + 1;
    if (m >= 7) return { start: `${y}-09-01`, end: `${y + 1}-01-31` };
    if (m === 1) return { start: `${y - 1}-09-01`, end: `${y}-01-31` };
    return { start: `${y}-02-01`, end: `${y}-06-30` };
  }
  {
    const count = conn.prepare('SELECT COUNT(*) AS c FROM semesters').get().c;
    if (!count) {
      const range = autoSemesterRange();
      conn.prepare('INSERT INTO semesters (name, start_date, end_date, is_current) VALUES (?,?,?,1)')
        .run(autoSemesterName(range.start), range.start, range.end);
    }
  }
}

module.exports = { migrateSchedule };
