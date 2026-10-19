// schema 拆分子文件：学期设置表 + 学期表 + 课表（模板/当前/历史）+ 学期播种。
function migrateSchedule(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS schedule_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      semester_start TEXT NOT NULL DEFAULT '',
      semester_end TEXT NOT NULL DEFAULT '',
      auto_apply INTEGER DEFAULT 1
    );
    INSERT OR IGNORE INTO schedule_settings (id, semester_start) VALUES (1, '');

    -- 学期表：支持「多学期列表 + 当前学期」（设置页可增加学期、选择学期、修改学期名）。
    -- is_current = 1 的那条是当前学期；schedule_settings.semester_start/end 保留为它的镜像，
    -- 供座位补存范围、座位指数结算等既有逻辑继续读取。
    CREATE TABLE IF NOT EXISTS semesters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      is_current INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

  // 存量库迁移：为学期设置补充 semester_end（学期结束日期，用于座位指数按天结算的范围判定）
  {
    const schCols = conn.prepare('PRAGMA table_info(schedule_settings)').all().map(c => c.name);
    if (!schCols.includes('semester_end')) {
      conn.exec(`ALTER TABLE schedule_settings ADD COLUMN semester_end TEXT NOT NULL DEFAULT ''`);
    }
  }
  // 学期表播种：列表为空时建一条「当前学期」。
  // 有旧的单条学期（schedule_settings）就用它的起止日期，否则按当前月份推算默认学期：
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
      const legacy = conn.prepare('SELECT semester_start, semester_end FROM schedule_settings WHERE id = 1').get() || {};
      const range = autoSemesterRange();
      const start = legacy.semester_start || range.start;
      const end = legacy.semester_end || range.end;
      conn.prepare('INSERT INTO semesters (name, start_date, end_date, is_current) VALUES (?,?,?,1)')
        .run(autoSemesterName(start), start, end);
    }
    // 同步一次镜像：schedule_settings 为空时用当前学期补上（座位补存/座位指数依赖它）
    const cur = conn.prepare('SELECT start_date, end_date FROM semesters WHERE is_current = 1 ORDER BY id DESC LIMIT 1').get();
    const sch = conn.prepare('SELECT semester_start FROM schedule_settings WHERE id = 1').get() || {};
    if (cur && !sch.semester_start) {
      conn.prepare('UPDATE schedule_settings SET semester_start = ?, semester_end = ? WHERE id = 1')
        .run(cur.start_date || '', cur.end_date || '');
    }
  }
}

module.exports = { migrateSchedule };
