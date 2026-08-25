const express = require('express');
const router = express.Router();
const { db } = require('../db');

// cells 结构：{ 劳动项目名: { 星期几: [学生姓名,...] } }
// settings 结构：{ days: ['周一',...], items: [{name, difficulty, count}, ...] }

function parseCell({ cells, settings }) {
  try {
    const parsed = JSON.parse(cells || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) { return {}; }
}

function parseSettings(str) {
  try {
    const s = JSON.parse(str || '{}');
    return s && typeof s === 'object' ? s : {};
  } catch (e) { return {}; }
}

// ======================== 全局设置（时间 + 劳动项目） ========================
router.get('/settings', (req, res) => {
  try {
    const row = db.prepare('SELECT days, items FROM duty_settings WHERE id = 1').get();
    if (!row) return res.json({ days: ['周一','周二','周三','周四','周五'], items: [] });
    res.json({
      days: JSON.parse(row.days),
      items: JSON.parse(row.items)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const { days, items } = req.body;
    if (!Array.isArray(days) || !Array.isArray(items)) {
      return res.status(400).json({ error: '参数格式错误' });
    }
    db.prepare('UPDATE duty_settings SET days=?, items=? WHERE id=1')
      .run(JSON.stringify(days), JSON.stringify(items));
    res.json({ message: '设置已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 当前值日表 ========================
router.get('/', (req, res) => {
  try {
    const row = db.prepare('SELECT cells, settings FROM duty_layout WHERE id = 1').get();
    if (!row) return res.json({ cells: {}, settings: {} });
    res.json({ cells: parseCell(row), settings: parseSettings(row.settings) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', (req, res) => {
  try {
    const { cells, settings } = req.body;
    if (!cells || typeof cells !== 'object') {
      return res.status(400).json({ error: '参数格式错误' });
    }
    db.prepare('UPDATE duty_layout SET cells=?, settings=? WHERE id=1')
      .run(JSON.stringify(cells), JSON.stringify(settings || {}));
    res.json({ message: '保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 值日模板 ========================
router.get('/template', (req, res) => {
  try {
    const row = db.prepare('SELECT cells, settings FROM duty_template WHERE id = 1').get();
    if (!row) return res.json({ cells: {}, settings: {} });
    res.json({ cells: parseCell(row), settings: parseSettings(row.settings) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/template', (req, res) => {
  try {
    const { cells, settings } = req.body;
    if (!cells || typeof cells !== 'object') {
      return res.status(400).json({ error: '参数格式错误' });
    }
    db.prepare('UPDATE duty_template SET cells=?, settings=? WHERE id=1')
      .run(JSON.stringify(cells), JSON.stringify(settings || {}));
    res.json({ message: '模板保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 从模板应用到当前值日表 ========================
router.post('/apply-master', (req, res) => {
  try {
    const template = db.prepare('SELECT cells, settings FROM duty_template WHERE id=1').get();
    if (!template) return res.status(400).json({ error: '模板为空' });
    db.prepare('UPDATE duty_layout SET cells=?, settings=? WHERE id=1').run(template.cells, template.settings);
    res.json({ message: '已应用模板' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 历史快照 ========================
router.get('/history', (req, res) => {
  try {
    const rows = db.prepare('SELECT week_start, created_at FROM duty_history ORDER BY week_start DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history/:weekStart', (req, res) => {
  try {
    const { weekStart } = req.params;
    const row = db.prepare('SELECT * FROM duty_history WHERE week_start = ?').get(weekStart);
    if (!row) return res.json(null);
    res.json({
      week_start: row.week_start,
      cells: parseCell(row),
      settings: parseSettings(row.settings),
      created_at: row.created_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/snapshot', (req, res) => {
  try {
    const { week_start, cells, settings } = req.body;
    if (!week_start) return res.status(400).json({ error: '缺少周开始日期' });

    const exists = db.prepare('SELECT id FROM duty_history WHERE week_start = ?').get(week_start);
    if (exists) {
      db.prepare('UPDATE duty_history SET cells=?, settings=? WHERE week_start=?')
        .run(JSON.stringify(cells || {}), JSON.stringify(settings || {}), week_start);
    } else {
      db.prepare('INSERT INTO duty_history (week_start, cells, settings) VALUES (?,?,?)')
        .run(week_start, JSON.stringify(cells || {}), JSON.stringify(settings || {}));
    }
    res.json({ message: '快照已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;