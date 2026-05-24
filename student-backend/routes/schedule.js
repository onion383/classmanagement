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

module.exports = router;