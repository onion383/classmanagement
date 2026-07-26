const express = require('express');
const router = express.Router();
const { db } = require('../db');

// ======================== 实行课表（临时表） ========================
router.get('/', (req, res) => {
  try {
    const row = db.prepare('SELECT cells, settings FROM schedule WHERE id = 1').get();
    const cells = row ? JSON.parse(row.cells) : [];
    const settings = row ? JSON.parse(row.settings) : {};
    res.json({ cells, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', (req, res) => {
  try {
    const { cells, settings } = req.body;
    if (cells && !Array.isArray(cells)) return res.status(400).json({ error: '数据格式错误' });
    db.prepare('UPDATE schedule SET cells = ?, settings = ? WHERE id = 1')
      .run(JSON.stringify(cells || []), JSON.stringify(settings || {}));
    res.json({ message: '保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 一般课表（模板） ========================
router.get('/master', (req, res) => {
  try {
    const row = db.prepare('SELECT cells, settings FROM master_schedule WHERE id = 1').get();
    const cells = row ? JSON.parse(row.cells) : [];
    const settings = row ? JSON.parse(row.settings) : {};
    res.json({ cells, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/master', (req, res) => {
  try {
    const { cells, settings } = req.body;
    if (cells && !Array.isArray(cells)) return res.status(400).json({ error: '数据格式错误' });
    db.prepare('UPDATE master_schedule SET cells = ?, settings = ? WHERE id = 1')
      .run(JSON.stringify(cells || []), JSON.stringify(settings || {}));
    res.json({ message: '一般课表保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 从一般课表应用到实行课表 ========================
router.post('/apply-master', (req, res) => {
  try {
    const master = db.prepare('SELECT cells, settings FROM master_schedule WHERE id = 1').get();
    if (!master) return res.status(400).json({ error: '一般课表为空' });
    db.prepare('UPDATE schedule SET cells = ?, settings = ? WHERE id = 1')
      .run(master.cells, master.settings);
    res.json({ message: '已将一般课表应用为实行课表' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 全局设置（学期开始日期） ========================
router.get('/settings', (req, res) => {
  try {
    const row = db.prepare('SELECT semester_start FROM schedule_settings WHERE id = 1').get();
    res.json(row || { semester_start: '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const { semester_start } = req.body;
    db.prepare('UPDATE schedule_settings SET semester_start = ? WHERE id = 1')
      .run(semester_start || '');
    res.json({ message: '设置已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 历史快照 ========================
// 获取所有已保存的快照周列表
router.get('/history', (req, res) => {
  try {
    const rows = db.prepare('SELECT week_start, created_at FROM schedule_history ORDER BY week_start DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取特定周的快照
router.get('/history/:weekStart', (req, res) => {
  try {
    const { weekStart } = req.params;
    const row = db.prepare('SELECT * FROM schedule_history WHERE week_start = ?').get(weekStart);
    if (!row) return res.json(null);
    res.json({
      id: row.id,
      week_start: row.week_start,
      cells: JSON.parse(row.cells),
      settings: JSON.parse(row.settings),
      created_at: row.created_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 保存当前周快照（自动或手动）
router.post('/snapshot', (req, res) => {
  try {
    const { week_start, cells, settings } = req.body;
    if (!week_start) return res.status(400).json({ error: '缺少周开始日期' });
    const exists = db.prepare('SELECT id FROM schedule_history WHERE week_start = ?').get(week_start);
    if (exists) {
      db.prepare('UPDATE schedule_history SET cells = ?, settings = ? WHERE week_start = ?')
        .run(JSON.stringify(cells), JSON.stringify(settings), week_start);
    } else {
      db.prepare('INSERT INTO schedule_history (week_start, cells, settings) VALUES (?, ?, ?)')
        .run(week_start, JSON.stringify(cells), JSON.stringify(settings));
    }
    res.json({ message: '快照已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;