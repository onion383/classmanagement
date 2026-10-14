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

// ======================== 学期（多学期列表 + 当前学期） ========================
// 学期独立成表：设置页可「增加学期 / 选择学期 / 修改学期名」。
// schedule_settings.semester_start/end 保留为「当前学期」的镜像，
// 座位补存范围、座位指数结算等既有逻辑继续读 /settings，不必感知学期表。
function autoSemester() {
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  if (m >= 7) return { name: `${y}秋季学期`, start_date: `${y}-09-01`, end_date: `${y + 1}-01-31` };
  if (m === 1) return { name: `${y - 1}秋季学期`, start_date: `${y - 1}-09-01`, end_date: `${y}-01-31` };
  return { name: `${y}夏季学期`, start_date: `${y}-02-01`, end_date: `${y}-06-30` };
}

function currentSemester() {
  return db.prepare('SELECT id, name, start_date, end_date FROM semesters WHERE is_current = 1 ORDER BY id DESC LIMIT 1').get()
    || db.prepare('SELECT id, name, start_date, end_date FROM semesters ORDER BY id DESC LIMIT 1').get();
}

// 把当前学期的起止日期同步到 schedule_settings（镜像，供座位补存/座位指数读取）
function syncSemesterToSettings() {
  const cur = currentSemester();
  if (!cur) return;
  db.prepare('UPDATE schedule_settings SET semester_start = ?, semester_end = ? WHERE id = 1')
    .run(cur.start_date || '', cur.end_date || '');
}

// 学期列表（按开始日期倒序，未填日期的排最后）+ 当前学期
router.get('/semesters', (req, res) => {
  try {
    const list = db.prepare(`
      SELECT id, name, start_date, end_date, is_current FROM semesters
      ORDER BY (start_date = '') ASC, start_date DESC, id DESC
    `).all();
    res.json({ semesters: list, current: list.find(s => s.is_current) || list[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 增加学期：未给名字/起止日期时按当前月份推算默认值；新增加的学期即成为当前学期
router.post('/semesters', (req, res) => {
  try {
    const body = req.body || {};
    const def = autoSemester();
    const name = String(body.name || '').trim() || def.name;
    const start_date = body.start_date || def.start_date;
    const end_date = body.end_date || def.end_date;
    db.prepare('UPDATE semesters SET is_current = 0').run();
    const info = db.prepare('INSERT INTO semesters (name, start_date, end_date, is_current) VALUES (?,?,?,1)')
      .run(name, start_date, end_date);
    syncSemesterToSettings();
    res.json({ message: '学期已增加', id: info.lastInsertRowid, name, start_date, end_date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 切换当前学期（设置页「选择学期」即切换；注意声明在 /semesters/:id 之前，避免被参数路由截走）
router.put('/semesters/current', (req, res) => {
  try {
    const id = Number((req.body || {}).id);
    if (!id) return res.status(400).json({ error: '缺少学期' });
    const exists = db.prepare('SELECT id FROM semesters WHERE id = ?').get(id);
    if (!exists) return res.status(404).json({ error: '学期不存在' });
    db.prepare('UPDATE semesters SET is_current = 0').run();
    db.prepare('UPDATE semesters SET is_current = 1 WHERE id = ?').run(id);
    syncSemesterToSettings();
    res.json({ message: '已切换当前学期' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改学期：只传需要改的字段（学期名 / 开始日期 / 结束日期）
router.put('/semesters/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT id, name, start_date, end_date, is_current FROM semesters WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '学期不存在' });
    const body = req.body || {};
    const name = body.name != null ? (String(body.name).trim() || row.name) : row.name;
    const start_date = body.start_date != null ? body.start_date : row.start_date;
    const end_date = body.end_date != null ? body.end_date : row.end_date;
    db.prepare('UPDATE semesters SET name = ?, start_date = ?, end_date = ? WHERE id = ?')
      .run(name, start_date, end_date, id);
    if (row.is_current) syncSemesterToSettings();
    res.json({ message: '学期已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 全局设置（当前学期的开始/结束日期） ========================
router.get('/settings', (req, res) => {
  try {
    const cur = currentSemester();
    if (cur) return res.json({ semester_start: cur.start_date || '', semester_end: cur.end_date || '' });
    const row = db.prepare('SELECT semester_start, semester_end FROM schedule_settings WHERE id = 1').get();
    res.json(row || { semester_start: '', semester_end: '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const { semester_start, semester_end } = req.body;
    db.prepare('UPDATE schedule_settings SET semester_start = ?, semester_end = ? WHERE id = 1')
      .run(semester_start || '', semester_end || '');
    // 直接改学期起止日期时同步写回当前学期，避免两处不一致
    const cur = currentSemester();
    if (cur) {
      db.prepare('UPDATE semesters SET start_date = ?, end_date = ? WHERE id = ?')
        .run(semester_start || '', semester_end || '', cur.id);
    }
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