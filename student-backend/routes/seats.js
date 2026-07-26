const express = require('express');
const router = express.Router();
const { db } = require('../db');

// ======================== 当前座位 ========================
router.get('/', (req, res) => {
  try {
    const row = db.prepare('SELECT mode, rows, cols, seats, aisle_cols, groups_config, settings FROM seat_layout WHERE id = 1').get();
    if (!row) return res.json({ mode: 'single', rows: 6, cols: 7, seats: [], aisleCols: [], groupsConfig: [], settings: {} });
    res.json({
      mode: row.mode,
      rows: row.rows,
      cols: row.cols,
      seats: JSON.parse(row.seats),
      aisleCols: JSON.parse(row.aisle_cols),
      groupsConfig: JSON.parse(row.groups_config),
      settings: JSON.parse(row.settings)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', (req, res) => {
  try {
    const { mode, rows, cols, seats, aisleCols, groupsConfig, settings } = req.body;
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || !Array.isArray(seats)) {
      return res.status(400).json({ error: '参数格式错误' });
    }
    // 确保 seats 尺寸与 rows/cols 匹配
    const trimmed = seats.slice(0, rows).map(r => {
      const row = Array.isArray(r) ? r.slice(0, cols) : [];
      while (row.length < cols) row.push(null);
      return row;
    });
    while (trimmed.length < rows) trimmed.push(Array(cols).fill(null));

    db.prepare(`UPDATE seat_layout SET mode=?, rows=?, cols=?, seats=?, aisle_cols=?, groups_config=?, settings=? WHERE id=1`)
      .run(
        mode || 'single',
        rows,
        cols,
        JSON.stringify(trimmed),
        JSON.stringify(aisleCols || []),
        JSON.stringify(groupsConfig || []),
        JSON.stringify(settings || {})
      );
    res.json({ message: '保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 座位模板 ========================
router.get('/master', (req, res) => {
  try {
    const row = db.prepare('SELECT mode, rows, cols, seats, aisle_cols, groups_config, settings FROM seat_template WHERE id = 1').get();
    if (!row) return res.json({ mode: 'single', rows: 6, cols: 7, seats: [], aisleCols: [], groupsConfig: [], settings: {} });
    res.json({
      mode: row.mode,
      rows: row.rows,
      cols: row.cols,
      seats: JSON.parse(row.seats),
      aisleCols: JSON.parse(row.aisle_cols),
      groupsConfig: JSON.parse(row.groups_config),
      settings: JSON.parse(row.settings)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/master', (req, res) => {
  try {
    const { mode, rows, cols, seats, aisleCols, groupsConfig, settings } = req.body;
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || !Array.isArray(seats)) {
      return res.status(400).json({ error: '参数格式错误' });
    }
    const trimmed = seats.slice(0, rows).map(r => {
      const row = Array.isArray(r) ? r.slice(0, cols) : [];
      while (row.length < cols) row.push(null);
      return row;
    });
    while (trimmed.length < rows) trimmed.push(Array(cols).fill(null));

    db.prepare(`UPDATE seat_template SET mode=?, rows=?, cols=?, seats=?, aisle_cols=?, groups_config=?, settings=? WHERE id=1`)
      .run(
        mode || 'single',
        rows,
        cols,
        JSON.stringify(trimmed),
        JSON.stringify(aisleCols || []),
        JSON.stringify(groupsConfig || []),
        JSON.stringify(settings || {})
      );
    res.json({ message: '模板保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 从模板应用到当前座位 ========================
router.post('/apply-master', (req, res) => {
  try {
    const template = db.prepare('SELECT mode, rows, cols, seats, aisle_cols, groups_config, settings FROM seat_template WHERE id=1').get();
    if (!template) return res.status(400).json({ error: '模板为空' });
    db.prepare('UPDATE seat_layout SET mode=?, rows=?, cols=?, seats=?, aisle_cols=?, groups_config=?, settings=? WHERE id=1')
      .run(template.mode, template.rows, template.cols, template.seats, template.aisle_cols, template.groups_config, template.settings);
    res.json({ message: '已应用模板' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 全局设置（预留） ========================
router.get('/settings', (req, res) => {
  res.json({});
});

router.put('/settings', (req, res) => {
  res.json({ message: 'ok' });
});

// ======================== 历史快照 ========================
router.get('/history', (req, res) => {
  try {
    const rows = db.prepare('SELECT week_start, created_at FROM seat_history ORDER BY week_start DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history/:weekStart', (req, res) => {
  try {
    const { weekStart } = req.params;
    const row = db.prepare('SELECT * FROM seat_history WHERE week_start = ?').get(weekStart);
    if (!row) return res.json(null);
    res.json({
      week_start: row.week_start,
      mode: row.mode,
      rows: row.rows,
      cols: row.cols,
      seats: JSON.parse(row.seats),
      aisleCols: JSON.parse(row.aisle_cols),
      groupsConfig: JSON.parse(row.groups_config),
      settings: JSON.parse(row.settings),
      created_at: row.created_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/snapshot', (req, res) => {
  try {
    const { week_start, mode, rows, cols, seats, settings } = req.body;
    if (!week_start) return res.status(400).json({ error: '缺少周开始日期' });

    // 走廊列根据 mode 和 settings.showAisle 动态生成，无需存储
    const aisleCols = [];
    const groupsConfig = [];

    const exists = db.prepare('SELECT id FROM seat_history WHERE week_start = ?').get(week_start);
    if (exists) {
      db.prepare('UPDATE seat_history SET mode=?, rows=?, cols=?, seats=?, aisle_cols=?, groups_config=?, settings=? WHERE week_start=?')
        .run(mode, rows, cols, JSON.stringify(seats), JSON.stringify(aisleCols), JSON.stringify(groupsConfig), JSON.stringify(settings), week_start);
    } else {
      db.prepare('INSERT INTO seat_history (week_start, mode, rows, cols, seats, aisle_cols, groups_config, settings) VALUES (?,?,?,?,?,?,?,?)')
        .run(week_start, mode, rows, cols, JSON.stringify(seats), JSON.stringify(aisleCols), JSON.stringify(groupsConfig), JSON.stringify(settings));
    }
    res.json({ message: '快照已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;