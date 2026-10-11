const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { registerHistoryRoutes } = require('./historyRoutes');

// ======================== 实行课表（临时表） ========================
router.get('/', (req, res) => {
  try {
    const row = db.prepare('SELECT cells, settings FROM schedule WHERE id = 1').get();
    let cells = row ? JSON.parse(row.cells) : [];
    let settings = row ? JSON.parse(row.settings) : {};
    // 活动课表为空时，回退到主课表，保证首页/桌面小组件也能显示已排课程
    if (!Array.isArray(cells) || cells.length === 0) {
      const master = db.prepare('SELECT cells, settings FROM master_schedule WHERE id = 1').get();
      if (master) {
        const mCells = JSON.parse(master.cells);
        if (Array.isArray(mCells) && mCells.length > 0) {
          cells = mCells;
          settings = JSON.parse(master.settings) || settings;
        }
      }
    }
    // 若 cells 是「按节次键的对象」而非数组，规范化为数组，避免首页/桌面小组件按行索引取不到
    if (!Array.isArray(cells) && cells && typeof cells === 'object') {
      cells = Object.keys(cells)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => cells[k]);
    }
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
// 四组路由（列表 / 单周 / 保存 / 删除）与 duty 同构，走公共实现。
// schedule 的 cells/settings 直接 JSON 解析；单周快照响应额外带 id 字段。
registerHistoryRoutes(router, {
  table: 'schedule_history',
  includeId: true,
  parseSnapshot: (row) => ({ cells: JSON.parse(row.cells), settings: JSON.parse(row.settings) }),
  stringifySnapshot: (cells, settings) => [JSON.stringify(cells), JSON.stringify(settings)],
});

module.exports = router;