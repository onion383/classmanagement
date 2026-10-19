// schema 拆分子文件：撤销历史（持久化 undo）+ 分组索引 + 来源标记列迁移。
function migrateUndo(conn) {
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
  // 存量库迁移：为撤销历史补充 origin（来源标记）。
  // 空字符串=老师手动编辑产生；非空=AI 助手一次更改的批次标识，同一批次整批回退。
  {
    const undoCols = conn.prepare('PRAGMA table_info(undo_history)').all().map(c => c.name);
    if (!undoCols.includes('origin')) {
      conn.exec(`ALTER TABLE undo_history ADD COLUMN origin TEXT NOT NULL DEFAULT ''`);
    }
  }
}

module.exports = { migrateUndo };
