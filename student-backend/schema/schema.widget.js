// schema 拆分子文件：系统设置表（widget_settings）+ 桌面软件/班级信息列迁移。
function migrateWidget(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS widget_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      toolbox_enabled INTEGER DEFAULT 1,
      note_save_path TEXT DEFAULT '',
      screenshot_save_path TEXT DEFAULT ''
    );
    INSERT OR IGNORE INTO widget_settings (id) VALUES (1);
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
}

module.exports = { migrateWidget };
