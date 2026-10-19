// schema 拆分子文件：系统设置表（widget_settings）。
function migrateWidget(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS widget_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      toolbox_enabled INTEGER DEFAULT 1,
      note_save_path TEXT DEFAULT '',
      screenshot_save_path TEXT DEFAULT '',
      -- desktop_apps：桌面小组件常用软件列表（JSON 数组文本）
      desktop_apps TEXT DEFAULT '[]',
      -- class_info：首页班级信息（班名/口号/班风/学风，JSON 文本）
      class_info TEXT DEFAULT '{}'
    );
    INSERT OR IGNORE INTO widget_settings (id) VALUES (1);
  `);
}

module.exports = { migrateWidget };
