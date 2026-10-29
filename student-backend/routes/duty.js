const express = require('express');
const router = express.Router();
const { db } = require('../db');
const store = require('../services/slotStore');
const { validateRow } = require('../services/businessRules');
const { readDocJson, safeJson } = require('../utils/json');
const { isDateStr } = require('../utils/sql');

// cells 结构：{ 劳动项目名: { 星期几: [学生姓名,...] } }
// settings 结构：{ days: ['周一',...], items: [{name, difficulty, count}, ...] }

// ======================== 模式（日常值日 / 大扫除） ========================
// cells/settings/items 字段统一存「按模式分键」结构（{ daily: ..., big: ... }），
// 两种模式数据彼此独立。
// 拆包/打包的唯一实现在 services/dutyMode.js —— search.js / ai.dataRoutes.js / AI 工具
// 执行器读的是同一批字段，此前四份实现逐字重复，口径不一致会让同一份数据被解释成不同结构。
const { unpackMode, packMode, normalizeMode } = require('../services/dutyMode');

// ======================== 全局设置（时间 + 劳动项目） ========================
router.get('/settings', (req, res) => {
    const mode = normalizeMode(req.query.mode);
  const row = db.prepare('SELECT days, items FROM duty_settings WHERE id = 1').get();
  if (!row) return res.json({ days: ['周一','周二','周三','周四','周五'], items: [] });
  const doc = readDocJson(row, { days: [] });
  res.json({
    days: doc.days,
    items: unpackMode(row.items, mode, []) // items 的模式值是数组：缺失/旧结构回 []，不能回 {}
  });
});

router.put('/settings', (req, res) => {
    const { days, items } = req.body;
  const mode = normalizeMode(req.body.mode || req.query.mode);
  if (!Array.isArray(days) || !Array.isArray(items)) {
    return res.status(400).json({ error: '参数格式错误' });
  }
  const row = db.prepare('SELECT items FROM duty_settings WHERE id = 1').get();
  const mergedItems = packMode(row ? row.items : null, mode, items);
  store.setDoc('duty_settings', { days: JSON.stringify(days), items: JSON.stringify(mergedItems) });
  res.json({ message: '设置已保存' });
});

// ======================== 当前值日表 ========================
// 读取当前值日表（含「空则回退模板」「补回设置里的 items」两步），共用于 GET / 与 /api/dashboard。
function readDuty(modeRaw) {
  const mode = normalizeMode(modeRaw);
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
        const gItems = unpackMode(g.items, mode, []);
        if (Array.isArray(gItems) && gItems.length > 0) settings.items = gItems;
      } catch (_) { /* 解析失败则忽略 */ }
    }
  }
  return { cells, settings };
}

router.get('/', (req, res) => {
    res.json(readDuty(req.query.mode));
});

router.put('/', (req, res) => {
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
  store.setDoc('duty_layout', {
    cells: JSON.stringify(mergedCells),
    settings: JSON.stringify(mergedSettings),
  });
  res.json({ message: '保存成功' });
});

// ======================== 值日模板 ========================
router.get('/template', (req, res) => {
    const mode = normalizeMode(req.query.mode);
  const row = db.prepare('SELECT cells, settings FROM duty_template WHERE id = 1').get();
  if (!row) return res.json({ cells: {}, settings: {} });
  res.json({
    cells: unpackMode(row.cells, mode),
    settings: unpackMode(row.settings, mode)
  });
});

router.put('/template', (req, res) => {
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
  store.setDoc('duty_template', {
    cells: JSON.stringify(mergedCells),
    settings: JSON.stringify(mergedSettings),
  });
  res.json({ message: '模板保存成功' });
});

// ======================== 一次性保存（设置 + 当前表 + 模板） ========================
// 前端「保存设置」原会并发发 3 个请求（settings / 当前表 / 模板），各写各的表、各提交一次。
// 这里合并为单请求：一个事务里依次落三张表，省 2 次 HTTP 往返 + 2 次事务提交，
// 且三处要么一起成功、要么一起回滚，不会出现「设置存了但表没存」的错位状态。
// active / master 为可选：只有显式传入（对象，哪怕空对象 {}）时才写对应的表。
router.put('/save', (req, res) => {
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
    store.setDoc('duty_settings', { days: JSON.stringify(days), items: JSON.stringify(mergedItems) });

    // ② 当前值日表（仅当显式传入 active 时）
    if (active !== undefined) {
      const row = db.prepare('SELECT cells, settings FROM duty_layout WHERE id = 1').get();
      const mergedCells = packMode(row ? row.cells : null, mode, active);
      const mergedSettings = packMode(row ? row.settings : null, mode, {});
      store.setDoc('duty_layout', {
        cells: JSON.stringify(mergedCells),
        settings: JSON.stringify(mergedSettings),
      });
    }

    // ③ 值日模板（仅当显式传入 master 时）
    if (master !== undefined) {
      const row = db.prepare('SELECT cells, settings FROM duty_template WHERE id = 1').get();
      const mergedCells = packMode(row ? row.cells : null, mode, master);
      const mergedSettings = packMode(row ? row.settings : null, mode, {});
      store.setDoc('duty_template', {
        cells: JSON.stringify(mergedCells),
        settings: JSON.stringify(mergedSettings),
      });
    }
  })();

  res.json({ message: '保存成功' });
});

// ======================== 从模板应用到当前值日表 ========================
router.post('/apply-master', (req, res) => {
    const mode = normalizeMode(req.query.mode);
  const template = db.prepare('SELECT cells, settings FROM duty_template WHERE id=1').get();
  if (!template) return res.status(400).json({ error: '模板为空' });
  const row = db.prepare('SELECT cells, settings FROM duty_layout WHERE id = 1').get();
  const mergedCells = packMode(row ? row.cells : null, mode, unpackMode(template.cells, mode));
  const mergedSettings = packMode(row ? row.settings : null, mode, unpackMode(template.settings, mode));
  store.setDoc('duty_layout', {
    cells: JSON.stringify(mergedCells),
    settings: JSON.stringify(mergedSettings),
  });
  res.json({ message: '已应用模板' });
});

// ======================== 值日项目权重表 ========================
// 权重挂在「劳动项目 × 星期」上，与值日表同构；按 daily/big 分模式打包存储。
// 从未保存过时返回 {}，由前端用 items[].difficulty 铺满作为默认值。
router.get('/weight', (req, res) => {
    const mode = normalizeMode(req.query.mode);
  const row = db.prepare('SELECT weights FROM duty_weight WHERE id = 1').get();
  res.json({ weights: row ? unpackMode(row.weights, mode) : {} });
});

router.put('/weight', (req, res) => {
    const { weights } = req.body;
  const mode = normalizeMode(req.body.mode || req.query.mode);
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
    return res.status(400).json({ error: '参数格式错误' });
  }
  const row = db.prepare('SELECT weights FROM duty_weight WHERE id = 1').get();
  const merged = packMode(row ? row.weights : null, mode, weights);
  store.setDoc('duty_weight', { weights: JSON.stringify(merged) });
  res.json({ message: '权重保存成功' });
});

// ======================== 智能排表草稿 ========================
// 草稿只在「智能排表」弹窗里恢复：保存本次排表的预览结果与条件。
// saved_at 为空串即视为没有草稿（不额外存标记位，避免多一个状态字段）。
router.get('/draft', (req, res) => {
    const mode = normalizeMode(req.query.mode);
  const row = db.prepare('SELECT cells, settings, conditions, saved_at FROM duty_draft WHERE id = 1').get();
  if (!row || !row.saved_at) return res.json({ exists: false });
  res.json({
    exists: true,
    cells: unpackMode(row.cells, mode),
    settings: unpackMode(row.settings, mode),
    conditions: safeJson(row.conditions, []),
    savedAt: row.saved_at
  });
});

router.put('/draft', (req, res) => {
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
  store.setDoc('duty_draft', {
    cells: JSON.stringify(mergedCells),
    settings: JSON.stringify(mergedSettings),
    conditions: JSON.stringify(conditions || []),
    saved_at: savedAt,
  });
  res.json({ message: '草稿已保存', savedAt });
});

// 清除草稿：清空内容与 saved_at，下次启动不再提示
router.delete('/draft', (req, res) => {
    store.setDoc('duty_draft', { cells: '{}', settings: '{}', conditions: '[]', saved_at: '' });
  res.json({ message: '草稿已清除' });
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
function snapshotRow(rec) {
  const p = rec.payload || {};
  return {
    week_start: rec.week_start,
    snap_date: rec.snap_date,
    mode: rec.mode,
    cells: p.cells || {},
    settings: p.settings || {},
    created_at: rec.created_at,
  };
}

// 历史列表：按周聚合（代表日期 = 该周最后一天），供下拉框使用
router.get('/history', (req, res) => {
    const mode = normalizeMode(req.query.mode);
  res.json(store.histWeeks('duty', mode));
});

// 单周快照：返回该周最后一天（最新一天）的值日表
router.get('/history/:weekStart', (req, res) => {
    const mode = normalizeMode(req.query.mode);
  const rec = store.histLatest('duty', req.params.weekStart, mode);
  res.json(rec ? snapshotRow(rec) : null);
});

// 按天取快照区间（值日指数结算用）：返回区间内每日快照，按天升序；from/to 可只给其一
router.get('/daily', (req, res) => {
    const { from, to } = req.query;
  const mode = normalizeMode(req.query.mode);
  res.json(store.histDaily('duty', { from, to, mode }).map(snapshotRow));
});

// 保存某一天的值日表快照（手动保存 / 补存都会走到这里）：按 snap_date + mode 幂等 upsert
router.post('/snapshot', (req, res) => {
    const body = req.body || {};
  // 过渡期兼容：旧前端仍传 week_start，没有 snap_date 时以其作为快照日期
  const snapDate = body.snap_date || body.week_start;
  if (!snapDate) return res.status(400).json({ error: '缺少快照日期' });
  // 快照日期直接落库并据此推导周一：非法串会生成 NaN 周键，历史列表出现幽灵周
  if (!isDateStr(snapDate)) return res.status(400).json({ error: '快照日期格式不正确（应为 YYYY-MM-DD）' });
  const mode = normalizeMode(body.mode);
  store.histUpsert('duty', {
    weekStart: mondayOf(snapDate),
    snapDate,
    mode,
    payload: { cells: body.cells || {}, settings: body.settings || {} },
  });
  res.json({ message: '快照已保存' });
});

// 补存历史快照：仅学期范围内。过去日期缺失才补（沿用最近一天该模式的值日表），
// includeToday=true 时今天总是用当前值日表覆盖（启动时静默补全用）。
router.post('/snapshot/backfill', (req, res) => {
  try {
    const mode = normalizeMode(req.body && req.body.mode);
    const includeToday = !!(req.body && req.body.includeToday);
    const today = localDateStr(new Date());
    const { start, end } = store.semesterRange();
    // 未设置学期开始日期时无法界定结算范围，直接跳过
    if (!start) return res.json({ message: '未设置学期开始日期', inserted: 0 });

    let upper = includeToday ? today : shiftDateStr(today, -1);
    if (end && upper > end) upper = end;
    if (upper < start) return res.json({ message: '学期范围外', inserted: 0 });

    const layout = store.getDoc('duty_layout');
    const layoutPayload = {
      cells: layout ? unpackMode(layout.cells, mode) : {},
      settings: layout ? unpackMode(layout.settings, mode) : {},
    };

    let inserted = 0;
    let cur = start;
    while (cur <= upper) {
      const isToday = cur === today;
      const exists = store.histFind('duty', cur, mode);
      if (isToday && includeToday) {
        // 今天：总是覆盖为当前值日表
        if (exists) store.histUpdateByDate('duty', cur, mode, layoutPayload);
        else store.histInsert('duty', { weekStart: mondayOf(cur), snapDate: cur, mode, payload: layoutPayload });
        inserted++;
      } else if (!exists) {
        // 过去日期：缺失才补，沿用最近一天该模式的值日表；没有更早快照则用当前值日表
        const src = store.histPrev('duty', cur, mode);
        const payload = src ? { cells: src.payload.cells || {}, settings: src.payload.settings || {} } : layoutPayload;
        store.histInsert('duty', { weekStart: mondayOf(cur), snapDate: cur, mode, payload });
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
    const mode = normalizeMode(req.query.mode);
  const changes = store.histDeleteWeek('duty', req.params.weekStart, mode);
  if (!changes) return res.status(404).json({ error: '该周快照不存在' });
  res.json({ message: '快照已删除' });
});

// 补录/生成一整周记录（周一起 7 天）：已存在的日期跳过，缺失的日期沿用最近一天该模式的值日表
// （没有更早快照时用当前值日表）。week_start 传任意日期都会先归一到该周周一。
router.post('/history/week', (req, res) => {
  try {
    const raw = (req.body && req.body.week_start) || '';
    // 用 isDateStr 而不是只看格式：'2026-02-30' 格式对但日期不存在，
    // mondayOf 会把它解析成 NaN，补录出一批 NaN-NaN-NaN 的幽灵记录。
    if (!isDateStr(raw)) return res.status(400).json({ error: '周起始日期格式不正确' });
    const mode = normalizeMode(req.body && req.body.mode);
    const weekStart = mondayOf(raw);
    const layout = store.getDoc('duty_layout');
    const layoutPayload = {
      cells: layout ? unpackMode(layout.cells, mode) : {},
      settings: layout ? unpackMode(layout.settings, mode) : {},
    };

    let inserted = 0;
    for (let i = 0; i < 7; i++) {
      const date = shiftDateStr(weekStart, i);
      if (store.histFind('duty', date, mode)) continue;
      const src = store.histPrev('duty', date, mode);
      const payload = src ? { cells: src.payload.cells || {}, settings: src.payload.settings || {} } : layoutPayload;
      store.histInsert('duty', { weekStart, snapDate: date, mode, payload });
      inserted++;
    }
    res.json({ message: inserted ? `已生成 ${inserted} 天记录` : '该周记录已完整，无需补录', inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// 供 /api/dashboard 聚合复用（挂在 router 函数对象上，不影响既有路由）
module.exports.readDuty = readDuty;