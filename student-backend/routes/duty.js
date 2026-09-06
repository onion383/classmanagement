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

// ======================== 模式（日常值日 / 大扫除） ========================
// cells/settings/items 字段既可存旧版「整块即日常」，也可存「按模式分键」的新结构，
// 这样两种模式数据彼此独立，且旧数据自动归入「日常」模式。
const MODES = ['daily', 'big'];
function fieldToModeMap(field) {
  let obj = {};
  try { obj = (typeof field === 'object' && field !== null) ? field : JSON.parse(field || '{}'); }
  catch (e) { obj = {}; }
  if (!obj || typeof obj !== 'object') return { daily: {}, big: {} };
  const keys = Object.keys(obj);
  // 顶层键全部是指定模式名 → 新模式结构；否则视为旧版整块，归为日常
  const isModeMap = keys.length > 0 && keys.every(k => k === 'daily' || k === 'big');
  if (isModeMap) return { daily: obj.daily || {}, big: obj.big || {} };
  return { daily: obj, big: {} };
}
const unpackMode = (field, mode) => fieldToModeMap(field)[mode] || {};
const packMode = (field, mode, data) => {
  const map = fieldToModeMap(field);
  map[mode] = data;
  return map;
};
const normalizeMode = (m) => (m === 'big' ? 'big' : 'daily');

// ======================== 全局设置（时间 + 劳动项目） ========================
router.get('/settings', (req, res) => {
  try {
    const mode = normalizeMode(req.query.mode);
    const row = db.prepare('SELECT days, items FROM duty_settings WHERE id = 1').get();
    if (!row) return res.json({ days: ['周一','周二','周三','周四','周五'], items: [] });
    res.json({
      days: JSON.parse(row.days),
      items: unpackMode(row.items, mode)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const { days, items } = req.body;
    const mode = normalizeMode(req.body.mode || req.query.mode);
    if (!Array.isArray(days) || !Array.isArray(items)) {
      return res.status(400).json({ error: '参数格式错误' });
    }
    const row = db.prepare('SELECT items FROM duty_settings WHERE id = 1').get();
    const mergedItems = packMode(row ? row.items : null, mode, items);
    db.prepare('UPDATE duty_settings SET days=?, items=? WHERE id=1')
      .run(JSON.stringify(days), JSON.stringify(mergedItems));
    res.json({ message: '设置已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 当前值日表 ========================
router.get('/', (req, res) => {
  try {
    const mode = normalizeMode(req.query.mode);
    const row = db.prepare('SELECT cells, settings FROM duty_layout WHERE id = 1').get();
    let cells = row ? unpackMode(row.cells, mode) : {};
    let settings = row ? unpackMode(row.settings, mode) : {};
    // 当前值日表为空时，回退到值日模板，保证首页/桌面小组件能看到已配置的值日
    const hasLayout = (cells && Object.keys(cells).length > 0)
      || (settings && Array.isArray(settings.items) && settings.items.length > 0);
    if (!hasLayout) {
      const tpl = db.prepare('SELECT cells, settings FROM duty_template WHERE id = 1').get();
      if (tpl) {
        const tCells = unpackMode(tpl.cells, mode);
        const tSettings = unpackMode(tpl.settings, mode);
        if (tSettings.items && tSettings.items.length > 0) {
          cells = tCells;
          settings = tSettings;
        }
      }
    }
    // layout/template 未携带 items（项目存于独立的 duty_settings 表）时补回，保证首页能列出值日项目
    if (!Array.isArray(settings.items) || settings.items.length === 0) {
      const g = db.prepare(`SELECT items FROM duty_settings WHERE id = 1`).get();
      if (g && g.items) {
        try {
          const gItems = unpackMode(g.items, mode);
          if (Array.isArray(gItems) && gItems.length > 0) settings.items = gItems;
        } catch (_) { /* 解析失败则忽略 */ }
      }
    }
    res.json({ cells, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', (req, res) => {
  try {
    const { cells, settings } = req.body;
    const mode = normalizeMode(req.body.mode || req.query.mode);
    if (!cells || typeof cells !== 'object') {
      return res.status(400).json({ error: '参数格式错误' });
    }
    const row = db.prepare('SELECT cells, settings FROM duty_layout WHERE id = 1').get();
    const mergedCells = packMode(row ? row.cells : null, mode, cells);
    const mergedSettings = packMode(row ? row.settings : null, mode, settings || {});
    db.prepare('UPDATE duty_layout SET cells=?, settings=? WHERE id=1')
      .run(JSON.stringify(mergedCells), JSON.stringify(mergedSettings));
    res.json({ message: '保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 值日模板 ========================
router.get('/template', (req, res) => {
  try {
    const mode = normalizeMode(req.query.mode);
    const row = db.prepare('SELECT cells, settings FROM duty_template WHERE id = 1').get();
    if (!row) return res.json({ cells: {}, settings: {} });
    res.json({
      cells: unpackMode(row.cells, mode),
      settings: unpackMode(row.settings, mode)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/template', (req, res) => {
  try {
    const { cells, settings } = req.body;
    const mode = normalizeMode(req.body.mode || req.query.mode);
    if (!cells || typeof cells !== 'object') {
      return res.status(400).json({ error: '参数格式错误' });
    }
    const row = db.prepare('SELECT cells, settings FROM duty_template WHERE id = 1').get();
    const mergedCells = packMode(row ? row.cells : null, mode, cells);
    const mergedSettings = packMode(row ? row.settings : null, mode, settings || {});
    db.prepare('UPDATE duty_template SET cells=?, settings=? WHERE id=1')
      .run(JSON.stringify(mergedCells), JSON.stringify(mergedSettings));
    res.json({ message: '模板保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 从模板应用到当前值日表 ========================
router.post('/apply-master', (req, res) => {
  try {
    const mode = normalizeMode(req.query.mode);
    const template = db.prepare('SELECT cells, settings FROM duty_template WHERE id=1').get();
    if (!template) return res.status(400).json({ error: '模板为空' });
    const row = db.prepare('SELECT cells, settings FROM duty_layout WHERE id = 1').get();
    const mergedCells = packMode(row ? row.cells : null, mode, unpackMode(template.cells, mode));
    const mergedSettings = packMode(row ? row.settings : null, mode, unpackMode(template.settings, mode));
    db.prepare('UPDATE duty_layout SET cells=?, settings=? WHERE id=1').run(JSON.stringify(mergedCells), JSON.stringify(mergedSettings));
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