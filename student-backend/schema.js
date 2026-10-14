// 纯建表结构：可复用于任一「班主任库」。
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

    CREATE TABLE IF NOT EXISTS widget_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      toolbox_enabled INTEGER DEFAULT 1,
      note_save_path TEXT DEFAULT '',
      screenshot_save_path TEXT DEFAULT ''
    );
    INSERT OR IGNORE INTO widget_settings (id) VALUES (1);

    -- AI 助手：模型接入配置（密钥存在已加密的教师库内，仅后端使用）
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER DEFAULT 0,
      provider TEXT DEFAULT 'deepseek',
      base_url TEXT DEFAULT '',
      model TEXT DEFAULT '',
      api_key TEXT DEFAULT ''
    );
    INSERT OR IGNORE INTO ai_settings (id) VALUES (1);

    -- AI 助手：模型管理（多模型列表，is_active 标记当前选中，密钥仅存本机）
    CREATE TABLE IF NOT EXISTS ai_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT '',
      provider TEXT DEFAULT 'deepseek',
      base_url TEXT DEFAULT '',
      model TEXT DEFAULT '',
      api_key TEXT DEFAULT '',
      is_active INTEGER DEFAULT 0
    );
    -- 将旧的单模型配置迁移为第一条已选模型（仅当旧配置曾填写过模型名/密钥/地址）
    INSERT INTO ai_models (name, provider, base_url, model, api_key, is_active)
    SELECT '主模型', provider, base_url, model, api_key, 1
    FROM ai_settings
    WHERE (COALESCE(model,'') != '' OR COALESCE(api_key,'') != '' OR COALESCE(base_url,'') != '')
      AND NOT EXISTS (SELECT 1 FROM ai_models);

    -- AI 助手：对话记录（会话 + 消息）
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT '新对话',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages (conversation_id, id);

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

    -- 分组管理：分组维度（宿舍管理/学习小组…，设置维度级：组长称呼/每组人数/小组组数）
    CREATE TABLE IF NOT EXISTS group_dimensions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      leader_title TEXT DEFAULT '',
      members_per_group INTEGER DEFAULT 0,
      group_count INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      male_group_count INTEGER DEFAULT 0,
      female_group_count INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );

    -- 分组管理：某个维度下的组（小组名字，如宿舍号 302/303；gender：0=男生 1=女生）
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dimension_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      gender INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );

    -- 分组管理：组内成员（成员 + 备注）
    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      member_name TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );

    -- 加分管理：加分/扣分记录（类型：加分/扣分；分值恒为正数，由类型区分加扣）
    CREATE TABLE IF NOT EXISTS score_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      姓名 TEXT,
      学号 TEXT,
      类型 TEXT,
      项目 TEXT,
      分值 REAL,
      原因 TEXT,
      加分时间 TEXT,
      created_at TEXT,
      source TEXT DEFAULT 'personal',
      group_name TEXT,
      成员数 INTEGER DEFAULT 0
    );

    -- 班级活动：活动记录（状态由「时间」动态推导：未开始/进行中/已结束）
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER DEFAULT 1,
      时间 TEXT,
      主题 TEXT,
      地点 TEXT,
      简介 TEXT,
      参与人员 TEXT,
      created_at TEXT
    );

    -- 倒计时：名称 + 截止日 + 是否包含截止日当天
    CREATE TABLE IF NOT EXISTS countdowns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER DEFAULT 1,
      名称 TEXT,
      截止日 TEXT,
      包含这一天 INTEGER DEFAULT 0,
      created_at TEXT
    );
  `);

  // 存量库迁移：为 widget_settings 补充 desktop_apps（桌面小组件常用软件列表，JSON 数组文本）
  {
    const widgetCols = conn.prepare('PRAGMA table_info(widget_settings)').all().map(c => c.name);
    if (!widgetCols.includes('desktop_apps')) {
      conn.exec(`ALTER TABLE widget_settings ADD COLUMN desktop_apps TEXT DEFAULT '[]'`);
    }
  }
  // 存量库迁移：为 widget_settings 补充 class_info（首页班级信息：班名/口号/班风/学风，JSON 文本）
  {
    const widgetCols = conn.prepare('PRAGMA table_info(widget_settings)').all().map(c => c.name);
    if (!widgetCols.includes('class_info')) {
      conn.exec(`ALTER TABLE widget_settings ADD COLUMN class_info TEXT DEFAULT '{}'`);
    }
  }
  // 存量库迁移：为相册照片表补充 thumb_path 列
  {
    const photoCols = conn.prepare('PRAGMA table_info(album_photos)').all().map(c => c.name);
    if (!photoCols.includes('thumb_path')) {
      conn.exec(`ALTER TABLE album_photos ADD COLUMN thumb_path TEXT DEFAULT ''`);
    }
  }
  // 存量库迁移：为分组维度表补充 group_count（小组组数）列
  {
    const dimCols = conn.prepare('PRAGMA table_info(group_dimensions)').all().map(c => c.name);
    if (!dimCols.includes('group_count')) {
      conn.exec(`ALTER TABLE group_dimensions ADD COLUMN group_count INTEGER DEFAULT 0`);
    }
  }
  // 存量库迁移：为分组维度表补充 内置标记 + 男/女生宿舍数列
  {
    const dimCols = conn.prepare('PRAGMA table_info(group_dimensions)').all().map(c => c.name);
    if (!dimCols.includes('is_default')) {
      conn.exec(`ALTER TABLE group_dimensions ADD COLUMN is_default INTEGER DEFAULT 0`);
    }
    if (!dimCols.includes('male_group_count')) {
      conn.exec(`ALTER TABLE group_dimensions ADD COLUMN male_group_count INTEGER DEFAULT 0`);
    }
    if (!dimCols.includes('female_group_count')) {
      conn.exec(`ALTER TABLE group_dimensions ADD COLUMN female_group_count INTEGER DEFAULT 0`);
    }
  }
  // 存量库迁移：为 groups 表补充 gender 列（0=男生 1=女生）
  {
    const groupCols = conn.prepare('PRAGMA table_info(groups)').all().map(c => c.name);
    if (!groupCols.includes('gender')) {
      conn.exec(`ALTER TABLE groups ADD COLUMN gender INTEGER DEFAULT 0`);
    }
  }
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
  // 优化：相册照片按 (album_id, mtime) 排序展示，建索引避免大相册全表扫+排序（幂等）
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_album_photos_album_mtime ON album_photos (album_id, mtime DESC);`);
  // 优化：请假按学生+状态过滤（看板统计/时段冲突校验）
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_leave_student_status ON leave_records (student_id, 状态);`);
  // 优化：收支按时间排序展示
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_fee_time ON fee_records (收支时间);`);
  // 优化：加分按学生过滤 + 时间排序展示
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_score_student_time ON score_records (student_id, 加分时间);`);
  // 优化：学生按姓名搜索（搜索栏/下拉候选）
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_students_name ON students (姓名);`);
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

  // 草稿表：智能排表弹窗「保存草稿」的落库目标（单独一张表，不影响正式座位表/模板表）。
  // 除与座位表一致的字段外，多存 conditions（本次排表的条件列表）与 saved_at（保存时间）。
  // 没有草稿时 saved_at 为空串，接口据此判断是否存在草稿。
  ensureTableWithMigration('seat_draft', `
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
  ensureTableWithMigration('seat_weight', `
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

  ensureTableWithMigration('seat_history', `
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

  // ======================== 加分记录表迁移（存量库补表） ========================
  ensureTableWithMigration('score_records', `
    CREATE TABLE score_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      姓名 TEXT,
      学号 TEXT,
      类型 TEXT,
      项目 TEXT,
      分值 REAL,
      原因 TEXT,
      加分时间 TEXT,
      created_at TEXT,
      source TEXT DEFAULT 'personal',
      group_name TEXT,
      成员数 INTEGER DEFAULT 0
    );
  `, [
    { column: '学号', sql: `"学号" TEXT` },
    { column: '原因', sql: `"原因" TEXT` },
    { column: 'source', sql: `"source" TEXT DEFAULT 'personal'` },
    { column: 'group_name', sql: `"group_name" TEXT` },
    { column: '成员数', sql: `"成员数" INTEGER DEFAULT 0` }
  ]);

  // ======================== 卫生值日表（设置/当前/模板/历史） ========================
  // duty_settings：全局「时间(星期几) + 劳动项目(含辛苦度、人数)」配置
  // duty_layout / duty_template：当前值日表与值日模板（cells 按 项目名→星期→学生名单 存储）
  // duty_history：按周保存的当前值日表快照
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

    CREATE TABLE IF NOT EXISTS duty_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      cells TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ======================== 撤销历史（持久化 undo） ========================
  // 按资源 key 分组记录编辑动作，支持跨重启后继续撤销。
  // dir：1=可撤销（undo侧），0=已撤销（redo侧）。
  conn.exec(`
    CREATE TABLE IF NOT EXISTS undo_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      dir INTEGER NOT NULL DEFAULT 1,
      ts TEXT NOT NULL DEFAULT ''
    );
  `);
  // 优化：按资源分组查询/删最旧记录
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_undo_key ON undo_history (key, id);`);

  // ======================== 班干部 ========================
  // cadres：职务树节点。parent_id=0 表示顶级（直接挂在根下，如班主任/班长）。
  // cadre_members：职务的担任学生（一个职务可多人，一人也可任多职）。
  conn.exec(`
    CREATE TABLE IF NOT EXISTS cadres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER NOT NULL DEFAULT 0,
      max_count INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cadre_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cadre_id INTEGER NOT NULL,
      student_id INTEGER,
      student_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
}

module.exports = { initSchema };