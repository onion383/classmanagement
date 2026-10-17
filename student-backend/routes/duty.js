const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { validateRow } = require('../services/businessRules');

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
    // 依赖既有数据的一致性校验：项目/星期须已配置、名单里的姓名须是班级学生
    validateRow('duty_layout', { cells });
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
    // 依赖既有数据的一致性校验
    validateRow('duty_template', { cells });
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

// ======================== 一次性保存（设置 + 当前表 + 模板） ========================
// 前端「保存设置」原会并发发 3 个请求（settings / 当前表 / 模板），各写各的表、各提交一次。
// 这里合并为单请求：一个事务里依次落三张表，省 2 次 HTTP 往返 + 2 次事务提交，
// 且三处要么一起成功、要么一起回滚，不会出现「设置存了但表没存」的错位状态。
// active / master 为可选：只有显式传入（对象，哪怕空对象 {}）时才写对应的表。
router.put('/save', (req, res) => {
  try {
    const { days, items, active, master } = req.body;
    const mode = normalizeMode(req.body.mode || req.query.mode);
    if (!Array.isArray(days) || !Array.isArray(items)) {
      return res.status(400).json({ error: '参数格式错误' });
    }
    if (active !== undefined && (!active || typeof active !== 'object')) {
      return res.status(400).json({ error: '参数格式错误' });
    }
    if (master !== undefined && (!master || typeof master !== 'object')) {
      return res.status(400).json({ error: '参数格式错误' });
    }
    // 依赖既有数据的一致性校验（当前表 / 模板各自校验）
    if (active !== undefined) validateRow('duty_layout', { cells: active });
    if (master !== undefined) validateRow('duty_template', { cells: master });

    db.transaction(() => {
      // ① 全局设置（时间 + 劳动项目）
      const s = db.prepare('SELECT items FROM duty_settings WHERE id = 1').get();
      const mergedItems = packMode(s ? s.items : null, mode, items);
      db.prepare('UPDATE duty_settings SET days=?, items=? WHERE id=1')
        .run(JSON.stringify(days), JSON.stringify(mergedItems));

      // ② 当前值日表（仅当显式传入 active 时）
      if (active !== undefined) {
        const row = db.prepare('SELECT cells, settings FROM duty_layout WHERE id = 1').get();
        const mergedCells = packMode(row ? row.cells : null, mode, active);
        const mergedSettings = packMode(row ? row.settings : null, mode, {});
        db.prepare('UPDATE duty_layout SET cells=?, settings=? WHERE id=1')
          .run(JSON.stringify(mergedCells), JSON.stringify(mergedSettings));
      }

      // ③ 值日模板（仅当显式传入 master 时）
      if (master !== undefined) {
        const row = db.prepare('SELECT cells, settings FROM duty_template WHERE id = 1').get();
        const mergedCells = packMode(row ? row.cells : null, mode, master);
        const mergedSettings = packMode(row ? row.settings : null, mode, {});
        db.prepare('UPDATE duty_template SET cells=?, settings=? WHERE id=1')
          .run(JSON.stringify(mergedCells), JSON.stringify(mergedSettings));
      }
    })();

    res.json({ message: '保存成功' });
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

// ======================== 值日项目权重表 ========================
// 权重挂在「劳动项目 × 星期」上，与值日表同构；按 daily/big 分模式打包存储。
// 从未保存过时返回 {}，由前端用 items[].difficulty 铺满作为默认值。
router.get('/weight', (req, res) => {
  try {
    const mode = normalizeMode(req.query.mode);
    const row = db.prepare('SELECT weights FROM duty_weight WHERE id = 1').get();
    res.json({ weights: row ? unpackMode(row.weights, mode) : {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/weight', (req, res) => {
  try {
    const { weights } = req.body;
    const mode = normalizeMode(req.body.mode || req.query.mode);
    if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
      return res.status(400).json({ error: '参数格式错误' });
    }
    const row = db.prepare('SELECT weights FROM duty_weight WHERE id = 1').get();
    const merged = packMode(row ? row.weights : null, mode, weights);
    db.prepare('UPDATE duty_weight SET weights=? WHERE id=1').run(JSON.stringify(merged));
    res.json({ message: '权重保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 智能排表草稿 ========================
// 草稿只在「智能排表」弹窗里恢复：保存本次排表的预览结果与条件。
// saved_at 为空串即视为没有草稿（不额外存标记位，避免多一个状态字段）。
router.get('/draft', (req, res) => {
  try {
    const mode = normalizeMode(req.query.mode);
    const row = db.prepare('SELECT cells, settings, conditions, saved_at FROM duty_draft WHERE id = 1').get();
    if (!row || !row.saved_at) return res.json({ exists: false });
    res.json({
      exists: true,
      cells: unpackMode(row.cells, mode),
      settings: unpackMode(row.settings, mode),
      conditions: JSON.parse(row.conditions || '[]'),
      savedAt: row.saved_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/draft', (req, res) => {
  try {
    const { cells, settings, conditions } = req.body;
    const mode = normalizeMode(req.body.mode || req.query.mode);
    if (!cells || typeof cells !== 'object') {
      return res.status(400).json({ error: '参数格式错误' });
    }
    // 全空的草稿视为没有内容，直接拒绝，避免启动时弹一个空草稿提示
    const hasName = Object.values(cells).some(days => days && typeof days === 'object'
      && Object.values(days).some(list => Array.isArray(list) && list.some(n => n)));
    if (!hasName) return res.status(400).json({ error: '草稿内容为空' });

    const row = db.prepare('SELECT cells, settings FROM duty_draft WHERE id = 1').get();
    const mergedCells = packMode(row ? row.cells : null, mode, cells);
    const mergedSettings = packMode(row ? row.settings : null, mode, settings || {});
    const savedAt = new Date().toISOString();
    db.prepare(`UPDATE duty_draft SET cells=?, settings=?, conditions=?, saved_at=? WHERE id=1`)
      .run(JSON.stringify(mergedCells), JSON.stringify(mergedSettings), JSON.stringify(conditions || []), savedAt);
    res.json({ message: '草稿已保存', savedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清除草稿：清空内容与 saved_at，下次启动不再提示
router.delete('/draft', (req, res) => {
  try {
    db.prepare(`UPDATE duty_draft SET cells='{}', settings='{}', conditions='[]', saved_at='' WHERE id=1`).run();
    res.json({ message: '草稿已清除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 历史快照（按天） ========================
// 快照按天保存：每行代表某一天（snap_date）某一模式（daily/big）的值日表；
// week_start 为由该天推导的周一，历史下拉按 week_start 聚合，回看时取该周最后一天的快照。
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function parseDateStr(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function shiftDateStr(s, days) {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}
function mondayOf(s) {
  const d = parseDateStr(s);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return localDateStr(d);
}
function snapshotRow(row) {
  return {
    week_start: row.week_start,
    snap_date: row.snap_date,
    mode: row.mode,
    cells: parseCell(row),
    settings: parseSettings(row.settings),
    created_at: row.created_at
  };
}

// 历史列表：按周聚合（代表日期 = 该周最后一天），供下拉框使用
router.get('/history', (req, res) => {
  try {
    const mode = normalizeMode(req.query.mode);
    const rows = db.prepare(`
      SELECT week_start, MAX(snap_date) AS last_date, MAX(created_at) AS created_at, COUNT(*) AS count
      FROM duty_history WHERE mode = ? GROUP BY week_start ORDER BY week_start DESC
    `).all(mode);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 单周快照：返回该周最后一天（最新一天）的值日表
router.get('/history/:weekStart', (req, res) => {
  try {
    const { weekStart } = req.params;
    const mode = normalizeMode(req.query.mode);
    const row = db.prepare('SELECT * FROM duty_history WHERE week_start = ? AND mode = ? ORDER BY snap_date DESC, id DESC LIMIT 1').get(weekStart, mode);
    if (!row) return res.json(null);
    res.json(snapshotRow(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 按天取快照区间（值日指数结算用）：返回区间内每日快照，按天升序；from/to 可只给其一
router.get('/daily', (req, res) => {
  try {
    const { from, to } = req.query;
    const mode = normalizeMode(req.query.mode);
    const cols = 'snap_date, week_start, mode, cells, settings, created_at';
    let rows;
    if (from && to) {
      rows = db.prepare(`SELECT ${cols} FROM duty_history WHERE mode = ? AND snap_date >= ? AND snap_date <= ? ORDER BY snap_date ASC`).all(mode, from, to);
    } else if (to) {
      rows = db.prepare(`SELECT ${cols} FROM duty_history WHERE mode = ? AND snap_date <= ? ORDER BY snap_date ASC`).all(mode, to);
    } else if (from) {
      rows = db.prepare(`SELECT ${cols} FROM duty_history WHERE mode = ? AND snap_date >= ? ORDER BY snap_date ASC`).all(mode, from);
    } else {
      rows = db.prepare(`SELECT ${cols} FROM duty_history WHERE mode = ? ORDER BY snap_date ASC`).all(mode);
    }
    res.json(rows.map(snapshotRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 保存某一天的值日表快照（手动保存 / 补存都会走到这里）：按 snap_date + mode 幂等 upsert
router.post('/snapshot', (req, res) => {
  try {
    const body = req.body || {};
    // 过渡期兼容：旧前端仍传 week_start，没有 snap_date 时以其作为快照日期
    const snapDate = body.snap_date || body.week_start;
    if (!snapDate) return res.status(400).json({ error: '缺少快照日期' });
    const mode = normalizeMode(body.mode);
    const cells = JSON.stringify(body.cells || {});
    const settings = JSON.stringify(body.settings || {});
    const weekStart = mondayOf(snapDate);
    const exists = db.prepare('SELECT id FROM duty_history WHERE snap_date = ? AND mode = ?').get(snapDate, mode);
    if (exists) {
      db.prepare('UPDATE duty_history SET week_start=?, cells=?, settings=? WHERE snap_date=? AND mode=?')
        .run(weekStart, cells, settings, snapDate, mode);
    } else {
      db.prepare('INSERT INTO duty_history (week_start, snap_date, mode, cells, settings) VALUES (?,?,?,?,?)')
        .run(weekStart, snapDate, mode, cells, settings);
    }
    res.json({ message: '快照已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 补存历史快照：仅学期范围内。过去日期缺失才补（沿用最近一天该模式的值日表），
// includeToday=true 时今天总是用当前值日表覆盖（启动时静默补全用）。
router.post('/snapshot/backfill', (req, res) => {
  try {
    const mode = normalizeMode(req.body && req.body.mode);
    const includeToday = !!(req.body && req.body.includeToday);
    const today = localDateStr(new Date());
    const settings = db.prepare('SELECT semester_start, semester_end FROM schedule_settings WHERE id = 1').get();
    const start = (settings && settings.semester_start) || '';
    const end = (settings && settings.semester_end) || '';
    // 未设置学期开始日期时无法界定结算范围，直接跳过
    if (!start) return res.json({ message: '未设置学期开始日期', inserted: 0 });

    let upper = includeToday ? today : shiftDateStr(today, -1);
    if (end && upper > end) upper = end;
    if (upper < start) return res.json({ message: '学期范围外', inserted: 0 });

    const layout = db.prepare('SELECT cells, settings FROM duty_layout WHERE id = 1').get();
    const layoutCells = JSON.stringify(layout ? unpackMode(layout.cells, mode) : {});
    const layoutSettings = JSON.stringify(layout ? unpackMode(layout.settings, mode) : {});
    const getByDate = db.prepare('SELECT id FROM duty_history WHERE snap_date = ? AND mode = ?');
    const getPrev = db.prepare('SELECT cells, settings FROM duty_history WHERE snap_date < ? AND mode = ? ORDER BY snap_date DESC LIMIT 1');
    const ins = db.prepare('INSERT INTO duty_history (week_start, snap_date, mode, cells, settings) VALUES (?,?,?,?,?)');
    const upd = db.prepare('UPDATE duty_history SET cells=?, settings=? WHERE snap_date=? AND mode=?');

    let inserted = 0;
    let cur = start;
    while (cur <= upper) {
      const isToday = cur === today;
      if (isToday && includeToday) {
        // 今天：总是覆盖为当前值日表
        if (getByDate.get(cur, mode)) upd.run(layoutCells, layoutSettings, cur, mode);
        else ins.run(mondayOf(cur), cur, mode, layoutCells, layoutSettings);
        inserted++;
      } else if (!getByDate.get(cur, mode)) {
        // 过去日期：缺失才补，沿用最近一天该模式的值日表；没有更早快照则用当前值日表
        const src = getPrev.get(cur, mode);
        const srcCells = src ? JSON.stringify(parseCell(src)) : layoutCells;
        const srcSettings = src ? JSON.stringify(parseSettings(src.settings)) : layoutSettings;
        ins.run(mondayOf(cur), cur, mode, srcCells, srcSettings);
        inserted++;
      }
      cur = shiftDateStr(cur, 1);
    }
    res.json({ message: `已补存 ${inserted} 天`, inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除某一周的历史快照（该周下该模式的全部天）
router.delete('/history/:weekStart', (req, res) => {
  try {
    const { weekStart } = req.params;
    const mode = normalizeMode(req.query.mode);
    const info = db.prepare('DELETE FROM duty_history WHERE week_start = ? AND mode = ?').run(weekStart, mode);
    if (!info.changes) return res.status(404).json({ error: '该周快照不存在' });
    res.json({ message: '快照已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 补录/生成一整周记录（周一起 7 天）：已存在的日期跳过，缺失的日期沿用最近一天该模式的值日表
// （没有更早快照时用当前值日表）。week_start 传任意日期都会先归一到该周周一。
router.post('/history/week', (req, res) => {
  try {
    const raw = (req.body && req.body.week_start) || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return res.status(400).json({ error: '缺少周起始日期' });
    const mode = normalizeMode(req.body && req.body.mode);
    const weekStart = mondayOf(raw);
    const layout = db.prepare('SELECT cells, settings FROM duty_layout WHERE id = 1').get();
    const layoutCells = JSON.stringify(layout ? unpackMode(layout.cells, mode) : {});
    const layoutSettings = JSON.stringify(layout ? unpackMode(layout.settings, mode) : {});
    const getByDate = db.prepare('SELECT id FROM duty_history WHERE snap_date = ? AND mode = ?');
    const getPrev = db.prepare('SELECT cells, settings FROM duty_history WHERE snap_date < ? AND mode = ? ORDER BY snap_date DESC LIMIT 1');
    const ins = db.prepare('INSERT INTO duty_history (week_start, snap_date, mode, cells, settings) VALUES (?,?,?,?,?)');

    let inserted = 0;
    for (let i = 0; i < 7; i++) {
      const date = shiftDateStr(weekStart, i);
      if (getByDate.get(date, mode)) continue;
      const src = getPrev.get(date, mode);
      const srcCells = src ? JSON.stringify(parseCell(src)) : layoutCells;
      const srcSettings = src ? JSON.stringify(parseSettings(src.settings)) : layoutSettings;
      ins.run(weekStart, date, mode, srcCells, srcSettings);
      inserted++;
    }
    res.json({ message: inserted ? `已生成 ${inserted} 天记录` : '该周记录已完整，无需补录', inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;