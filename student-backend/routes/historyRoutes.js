// =========================================================================
// historyRoutes.js —— 「周历史快照」路由公共实现
//
// duty 与 schedule 两个模块各自都有一组完全同构的历史快照路由：
//   GET    /history                 已保存快照的周列表
//   GET    /history/:weekStart      某一周的快照
//   POST   /snapshot                保存当前周快照（存在则更新）
//   DELETE /history/:weekStart      删除某一周快照
// 逻辑一致，仅「历史表名」与「快照字段（cells/settings）的解析/序列化方式」不同，
// 这里抽出公共实现，差异通过参数注入，避免两份逐行重复的代码各自维护。
// =========================================================================

const { db } = require('../db');

// table：历史表名（duty_history / schedule_history）。
// includeId：单周快照响应是否带 id 字段（schedule 带，duty 不带）。
// parseSnapshot(row) -> { cells, settings }：解析单周快照的 cells/settings。
// stringifySnapshot(cells, settings) -> [cellsJson, settingsJson]：写入时的序列化。
function registerHistoryRoutes(router, { table, includeId = false, parseSnapshot, stringifySnapshot }) {
  // 已保存快照的周列表
  router.get('/history', (req, res) => {
    try {
      const rows = db.prepare(`SELECT week_start, created_at FROM ${table} ORDER BY week_start DESC`).all();
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 特定周的快照
  router.get('/history/:weekStart', (req, res) => {
    try {
      const row = db.prepare(`SELECT * FROM ${table} WHERE week_start = ?`).get(req.params.weekStart);
      if (!row) return res.json(null);
      const { cells, settings } = parseSnapshot(row);
      res.json(includeId
        ? { id: row.id, week_start: row.week_start, cells, settings, created_at: row.created_at }
        : { week_start: row.week_start, cells, settings, created_at: row.created_at });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 保存当前周快照（自动或手动）
  router.post('/snapshot', (req, res) => {
    try {
      const { week_start, cells, settings } = req.body;
      if (!week_start) return res.status(400).json({ error: '缺少周开始日期' });
      const [cellsJson, settingsJson] = stringifySnapshot(cells, settings);
      const exists = db.prepare(`SELECT id FROM ${table} WHERE week_start = ?`).get(week_start);
      if (exists) {
        db.prepare(`UPDATE ${table} SET cells = ?, settings = ? WHERE week_start = ?`).run(cellsJson, settingsJson, week_start);
      } else {
        db.prepare(`INSERT INTO ${table} (week_start, cells, settings) VALUES (?, ?, ?)`).run(week_start, cellsJson, settingsJson);
      }
      res.json({ message: '快照已保存' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 删除某一周的快照
  router.delete('/history/:weekStart', (req, res) => {
    try {
      const info = db.prepare(`DELETE FROM ${table} WHERE week_start = ?`).run(req.params.weekStart);
      if (!info.changes) return res.status(404).json({ error: '该周快照不存在' });
      res.json({ message: '快照已删除' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerHistoryRoutes };