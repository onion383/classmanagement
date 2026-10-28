const express = require('express');
const router = express.Router();
const { db } = require('../db');
const store = require('../services/slotStore');
const { validateRow } = require('../services/businessRules');
const { normalizeSeats, assertSeatCell, SEAT_MAX_ROWS, SEAT_MAX_COLS } = require('../services/sanitize');
const { readDocJson } = require('../utils/json');
const { isDateStr } = require('../utils/sql');

function validateSeatSize(rows, cols) {
  if (rows < 1 || rows > SEAT_MAX_ROWS) return `行数需在 1 ~ ${SEAT_MAX_ROWS} 之间`;
  if (cols < 1 || cols > SEAT_MAX_COLS) return `列数需在 1 ~ ${SEAT_MAX_COLS} 之间`;
  return null;
}

// PATCH /cell 的 row/col 是 0 基坐标，不能直接套用 validateSeatSize（它校验的是 1 基数量）。
function validateCellCoord(row, col) {
  if (row < 0 || row >= SEAT_MAX_ROWS) return `行坐标需在 0 ~ ${SEAT_MAX_ROWS - 1} 之间`;
  if (col < 0 || col >= SEAT_MAX_COLS) return `列坐标需在 0 ~ ${SEAT_MAX_COLS - 1} 之间`;
  return null;
}

// 读取座位：库中若被历史/AI 写成了「扁平对象数组」，这里规范化为二维数组返回，
// 保证前端（按 seats[行][列] 渲染）拿到的一直是可用形态；畸形数据不原样回传，按空座位处理。
function readSeats(raw) {
  let parsed;
  try { parsed = raw ? JSON.parse(raw) : []; } catch (_) { return []; }
  if (!Array.isArray(parsed)) {
    console.error('[seats] 座位数据不是数组，按空座位处理');
    return [];
  }
  try {
    return normalizeSeats(parsed, 'seats');
  } catch (err) {
    // 不能把未通过 normalizeSeats 的原始数据回给前端：那样会绕过 50×30 上限，
    // 前端还按二维数组渲染，等于把畸形数据伪装成正常座位表。
    console.error('[seats] 座位数据畸形，按空座位处理:', err.message);
    return [];
  }
}

// ======================== 当前座位 ========================
router.get('/', (req, res) => {
    const row = db.prepare('SELECT mode, rows, cols, seats, aisle_cols, groups_config, settings FROM seat_layout WHERE id = 1').get();
  if (!row) return res.json({ mode: 'single', rows: 6, cols: 7, seats: [], aisleCols: [], groupsConfig: [], settings: {} });
  // seats 单独走 readSeats（还要规范化结构），其余三列统一走 readDocJson：
  // 四条 JSON 列只要有一条畸形，裸解析就会让整个响应 500、页面白板。
  const extra = readDocJson(row, {
    aisleCols: ['aisle_cols', []],
    groupsConfig: ['groups_config', []],
    settings: ['settings', {}],
  });
  res.json({
    mode: row.mode,
    rows: row.rows,
    cols: row.cols,
    seats: readSeats(row.seats),
    ...extra,
  });
});

router.put('/', (req, res) => {
  try {
    const { mode, rows, cols, seats, aisleCols, groupsConfig, settings } = req.body;
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || !Array.isArray(seats)) {
      return res.status(400).json({ error: '参数格式错误' });
    }
    const sizeError = validateSeatSize(rows, cols);
    if (sizeError) {
      return res.status(400).json({ error: sizeError });
    }
    // 规范化座位结构（兼容「二维数组」与「扁平对象数组」），并做元素级校验
    let normSeats;
    try { normSeats = normalizeSeats(seats, 'seats'); } catch (e) { return res.status(400).json({ error: e.message }); }
    // 确保 seats 尺寸与 rows/cols 匹配
    const trimmed = normSeats.slice(0, rows).map(r => {
      const row = Array.isArray(r) ? r.slice(0, cols) : [];
      while (row.length < cols) row.push(null);
      return row;
    });
    while (trimmed.length < rows) trimmed.push(Array(cols).fill(null));

    // 依赖既有数据的一致性校验：座位里的学生 id 必须真实存在（尺寸越界也在此拦下）
    validateRow('seat_layout', { seats: trimmed, rows, cols });

    store.setDoc('seat_layout', {
      mode: mode || 'single',
      rows,
      cols,
      seats: JSON.stringify(trimmed),
      aisle_cols: JSON.stringify(aisleCols || []),
      groups_config: JSON.stringify(groupsConfig || []),
      settings: JSON.stringify(settings || {}),
    });
    res.json({ message: '保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 单格更新（供撤销/重做前的单格提交） ========================
function updateSingleCell(table, row, col, value) {
  const rec = store.getDoc(table);
  // 这里**刻意不兜底**：读取路径可以把畸形 seats 降级成空座位（只影响这一次显示），
  // 写入路径若也降级，空数组会把整张座位表覆盖成只剩这一格 —— 数据直接丢。
  // 解析失败就抛，由统一错误出口返回 500，数据保持原样。
  const seats = rec ? JSON.parse(rec.seats) : [];
  if (!Array.isArray(seats[row])) seats[row] = [];
  seats[row][col] = value == null ? null : value;
  store.setDoc(table, { seats: JSON.stringify(seats) });
}

// 单格 value 校验：与 PUT 走 normalizeSeats 时同一强度（空值 / 数字 / ≤20 字文本）。
// 此前两个 PATCH 路由只校验坐标，value 可以塞对象、Infinity 或任意长字符串，
// 直接把畸形数据写进矩阵 —— 而同一份数据走 PUT 是被拒的。
function validateCellValue(value, row, col) {
  try {
    assertSeatCell(value, 'seats', row, col);
    return null;
  } catch (e) {
    return e.message;
  }
}

router.patch('/cell', (req, res) => {
    const { row, col, value } = req.body
  if (!Number.isInteger(row) || !Number.isInteger(col)) return res.status(400).json({ error: '参数格式错误' })
  const coordErr = validateCellCoord(row, col)
  if (coordErr) return res.status(400).json({ error: coordErr })
  const valueErr = validateCellValue(value, row, col)
  if (valueErr) return res.status(400).json({ error: valueErr })
  updateSingleCell('seat_layout', row, col, value)
  res.json({ message: '已更新' })
});

router.patch('/master/cell', (req, res) => {
    const { row, col, value } = req.body
  if (!Number.isInteger(row) || !Number.isInteger(col)) return res.status(400).json({ error: '参数格式错误' })
  const coordErr = validateCellCoord(row, col)
  if (coordErr) return res.status(400).json({ error: coordErr })
  const valueErr = validateCellValue(value, row, col)
  if (valueErr) return res.status(400).json({ error: valueErr })
  updateSingleCell('seat_template', row, col, value)
  res.json({ message: '已更新' })
});

// ======================== 座位模板 ========================
router.get('/master', (req, res) => {
    const row = db.prepare('SELECT mode, rows, cols, seats, aisle_cols, groups_config, settings FROM seat_template WHERE id = 1').get();
  if (!row) return res.json({ mode: 'single', rows: 6, cols: 7, seats: [], aisleCols: [], groupsConfig: [], settings: {} });
  const extra = readDocJson(row, {
    aisleCols: ['aisle_cols', []],
    groupsConfig: ['groups_config', []],
    settings: ['settings', {}],
  });
  res.json({
    mode: row.mode,
    rows: row.rows,
    cols: row.cols,
    seats: readSeats(row.seats),
    ...extra,
  });
});

router.put('/master', (req, res) => {
  try {
    const { mode, rows, cols, seats, aisleCols, groupsConfig, settings } = req.body;
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || !Array.isArray(seats)) {
      return res.status(400).json({ error: '参数格式错误' });
    }
    const sizeError = validateSeatSize(rows, cols);
    if (sizeError) {
      return res.status(400).json({ error: sizeError });
    }
    // 规范化座位结构（兼容「二维数组」与「扁平对象数组」），并做元素级校验
    let normSeats;
    try { normSeats = normalizeSeats(seats, 'seats'); } catch (e) { return res.status(400).json({ error: e.message }); }
    const trimmed = normSeats.slice(0, rows).map(r => {
      const row = Array.isArray(r) ? r.slice(0, cols) : [];
      while (row.length < cols) row.push(null);
      return row;
    });
    while (trimmed.length < rows) trimmed.push(Array(cols).fill(null));

    // 依赖既有数据的一致性校验：座位里的学生 id 必须真实存在
    validateRow('seat_template', { seats: trimmed, rows, cols });

    store.setDoc('seat_template', {
      mode: mode || 'single',
      rows,
      cols,
      seats: JSON.stringify(trimmed),
      aisle_cols: JSON.stringify(aisleCols || []),
      groups_config: JSON.stringify(groupsConfig || []),
      settings: JSON.stringify(settings || {}),
    });
    res.json({ message: '模板保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 从模板应用到当前座位 ========================
router.post('/apply-master', (req, res) => {
    const template = db.prepare('SELECT mode, rows, cols, seats, aisle_cols, groups_config, settings FROM seat_template WHERE id=1').get();
  if (!template) return res.status(400).json({ error: '模板为空' });
  store.setDoc('seat_layout', {
    mode: template.mode,
    rows: template.rows,
    cols: template.cols,
    seats: template.seats,
    aisle_cols: template.aisle_cols,
    groups_config: template.groups_config,
    settings: template.settings,
  });
  res.json({ message: '已应用模板' });
});

// ======================== 座位位置权重表 ========================
// 与座位布局共用几何参数（rows/cols/mode/showAisle），但单独存储数字矩阵。
router.get('/weight', (req, res) => {
    const row = db.prepare('SELECT mode, rows, cols, weights, settings FROM seat_weight WHERE id = 1').get();
  if (!row) return res.json({ mode: 'single', rows: 6, cols: 7, weights: [], settings: {} });
  const extra = readDocJson(row, { weights: [], settings: {} });
  res.json({
    mode: row.mode,
    rows: row.rows,
    cols: row.cols,
    ...extra,
  });
});

router.put('/weight', (req, res) => {
    const { mode, rows, cols, weights, settings } = req.body;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || !Array.isArray(weights)) {
    return res.status(400).json({ error: '参数格式错误' });
  }
  const sizeError = validateSeatSize(rows, cols);
  if (sizeError) return res.status(400).json({ error: sizeError });
  // 权重尺寸与 rows/cols 对齐：超出截断、不足补 null
  const trimmed = weights.slice(0, rows).map(r => {
    const row = Array.isArray(r) ? r.slice(0, cols) : [];
    while (row.length < cols) row.push(null);
    return row;
  });
  while (trimmed.length < rows) trimmed.push(Array(cols).fill(null));

  store.setDoc('seat_weight', {
    mode: mode || 'single',
    rows,
    cols,
    weights: JSON.stringify(trimmed),
    settings: JSON.stringify(settings || {}),
  });
  res.json({ message: '权重保存成功' });
});

// ======================== 草稿表（智能排表的临时草稿） ========================
// 草稿只在「智能排表」弹窗里恢复：保存本次排表的预览结果与条件。
// saved_at 为空串即视为没有草稿（不额外存标记位，避免多一个状态字段）。
router.get('/draft', (req, res) => {
    const row = db.prepare('SELECT mode, rows, cols, seats, aisle_cols, settings, conditions, saved_at FROM seat_draft WHERE id = 1').get();
  if (!row || !row.saved_at) return res.json({ exists: false });
  // 草稿的 seats 同样要按矩阵规范化：AI / 历史写入的草稿可能是扁平对象数组，
  // 原样回传会让前端按 seats[行][列] 读到 undefined。
  const extra = readDocJson(row, {
    aisleCols: ['aisle_cols', []],
    settings: {},
    conditions: [],
  });
  res.json({
    exists: true,
    mode: row.mode,
    rows: row.rows,
    cols: row.cols,
    seats: readSeats(row.seats),
    ...extra,
    savedAt: row.saved_at
  });
});

router.put('/draft', (req, res) => {
    const { mode, rows, cols, seats, aisleCols, settings, conditions } = req.body;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || !Array.isArray(seats)) {
    return res.status(400).json({ error: '参数格式错误' });
  }
  const sizeError = validateSeatSize(rows, cols);
  if (sizeError) {
    return res.status(400).json({ error: sizeError });
  }
  // 尺寸对齐（超出截断、不足补齐），与正式座位表同一套规则
  const trimmed = seats.slice(0, rows).map(r => {
    const row = Array.isArray(r) ? r.slice(0, cols) : [];
    while (row.length < cols) row.push(null);
    return row;
  });
  while (trimmed.length < rows) trimmed.push(Array(cols).fill(null));
  // 全空的草稿视为没有内容，直接拒绝，避免启动时弹一个空草稿提示
  if (!trimmed.some(r => r.some(v => v !== null && v !== ''))) {
    return res.status(400).json({ error: '草稿内容为空' });
  }

  const savedAt = new Date().toISOString();
  store.setDoc('seat_draft', {
    mode: mode || 'single',
    rows,
    cols,
    seats: JSON.stringify(trimmed),
    aisle_cols: JSON.stringify(aisleCols || []),
    groups_config: JSON.stringify([]),
    settings: JSON.stringify(settings || {}),
    conditions: JSON.stringify(conditions || []),
    saved_at: savedAt,
  });
  res.json({ message: '草稿已保存', savedAt });
});

// 清除草稿：清空内容与 saved_at，下次启动不再提示
router.delete('/draft', (req, res) => {
    store.setDoc('seat_draft', { seats: '[]', conditions: '[]', saved_at: '' });
  res.json({ message: '草稿已清除' });
});

// ======================== 全局设置（预留） ========================
router.get('/settings', (req, res) => {
  res.json({});
});

router.put('/settings', (req, res) => {
  res.json({ message: 'ok' });
});

// ======================== 历史快照（按天） ========================
// 快照按天保存：每行代表某一天（snap_date）的座位；week_start 为由该天推导的周一，
// 历史下拉按 week_start 聚合，回看时取该周最后一天的快照。
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

// 历史列表：按周聚合（代表日期 = 该周最后一天），供下拉框使用
router.get('/history', (req, res) => {
    res.json(store.histWeeks('seat'));
});

// 单周快照：返回该周最后一天（最新一天）的座位
router.get('/history/:weekStart', (req, res) => {
    const rec = store.histLatest('seat', req.params.weekStart, null);
  if (!rec) return res.json(null);
  const p = rec.payload || {};
  res.json({
    week_start: rec.week_start,
    snap_date: rec.snap_date,
    mode: rec.mode,
    rows: p.rows,
    cols: p.cols,
    seats: p.seats || [],
    aisleCols: p.aisleCols || [],
    groupsConfig: p.groupsConfig || [],
    settings: p.settings || {},
    created_at: rec.created_at,
  });
});

// 按天取快照区间（座位指数结算用）：返回区间内每日快照，按天升序；from/to 可只给其一
router.get('/daily', (req, res) => {
    const { from, to } = req.query;
  res.json(store.histDaily('seat', { from, to }).map((rec) => {
    const p = rec.payload || {};
    return {
      snap_date: rec.snap_date,
      week_start: rec.week_start,
      mode: rec.mode,
      rows: p.rows,
      cols: p.cols,
      seats: p.seats || [],
      settings: p.settings || {},
    };
  }));
});

// 保存某一天的快照（手动保存 / 补存都会走到这里）：按 snap_date 幂等 upsert
router.post('/snapshot', (req, res) => {
    const { snap_date, mode, rows, cols, seats, settings } = req.body;
  if (!snap_date) return res.status(400).json({ error: '缺少快照日期' });
  // 快照日期直接落库并据此推导周一：非法串会生成 NaN 周键，历史列表出现幽灵周
  if (!isDateStr(snap_date)) return res.status(400).json({ error: '快照日期格式不正确（应为 YYYY-MM-DD）' });

  // 走廊列根据 mode 和 settings.showAisle 动态生成，无需存储
  store.histUpsert('seat', {
    weekStart: mondayOf(snap_date),
    snapDate: snap_date,
    mode: mode || 'single',
    payload: {
      mode: mode || 'single',
      rows,
      cols,
      seats,
      aisleCols: [],
      groupsConfig: [],
      settings,
    },
  });
  res.json({ message: '快照已保存' });
});

// 补存历史快照：仅学期范围内。过去日期缺失才补（沿用最近一天座位），
// includeToday=true 时今天总是用当前临时表覆盖（启动时静默补全用）。
router.post('/snapshot/backfill', (req, res) => {
  try {
    const includeToday = !!(req.body && req.body.includeToday);
    const today = localDateStr(new Date());
    const { start, end } = store.semesterRange();
    // 未设置学期开始日期时无法界定结算范围，直接跳过
    if (!start) return res.json({ message: '未设置学期开始日期', inserted: 0 });

    let upper = includeToday ? today : shiftDateStr(today, -1);
    if (end && upper > end) upper = end;
    if (upper < start) return res.json({ message: '学期范围外', inserted: 0 });

    const layout = store.getDoc('seat_layout');
    const layoutPayload = layout ? {
      mode: layout.mode,
      rows: layout.rows,
      cols: layout.cols,
      seats: JSON.parse(layout.seats),
      settings: JSON.parse(layout.settings),
    } : null;

    let inserted = 0;
    let cur = start;
    while (cur <= upper) {
      const isToday = cur === today;
      const exists = store.histFind('seat', cur, null);
      if (isToday && includeToday && layoutPayload) {
        // 今天：总是覆盖为当前临时表
        if (exists) store.histUpdateByDate('seat', cur, null, layoutPayload);
        else store.histInsert('seat', {
          weekStart: mondayOf(cur), snapDate: cur, mode: layoutPayload.mode,
          payload: { ...layoutPayload, aisleCols: [], groupsConfig: [] },
        });
        inserted++;
      } else if (!exists) {
        // 过去日期：缺失才补，沿用最近一天座位；没有更早快照则用当前座位
        const prev = store.histPrev('seat', cur, null);
        const payload = prev ? prev.payload : layoutPayload;
        if (payload) {
          store.histInsert('seat', {
            weekStart: mondayOf(cur), snapDate: cur, mode: payload.mode || 'single',
            payload: { ...payload, aisleCols: [], groupsConfig: [] },
          });
          inserted++;
        }
      }
      cur = shiftDateStr(cur, 1);
    }
    res.json({ message: `已补存 ${inserted} 天`, inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除某一周的历史快照（该周下的全部天）
router.delete('/history/:weekStart', (req, res) => {
    const changes = store.histDeleteWeek('seat', req.params.weekStart, null);
  if (!changes) return res.status(404).json({ error: '该周快照不存在' });
  res.json({ message: '快照已删除' });
});

// 补录/生成一整周记录（周一起 7 天）：已存在的日期跳过，缺失的日期沿用最近一天的座位
// （没有更早快照时用当前座位表）。week_start 传任意日期都会先归一到该周周一。
router.post('/history/week', (req, res) => {
  try {
    const raw = (req.body && req.body.week_start) || '';
    // 用 isDateStr 而不是只看格式：'2026-02-30' 格式对但日期不存在，
    // mondayOf 会把它解析成 NaN，补录出一批 NaN-NaN-NaN 的幽灵记录。
    if (!isDateStr(raw)) return res.status(400).json({ error: '周起始日期格式不正确' });
    const weekStart = mondayOf(raw);
    const layout = store.getDoc('seat_layout');
    const layoutPayload = layout ? {
      mode: layout.mode,
      rows: layout.rows,
      cols: layout.cols,
      seats: JSON.parse(layout.seats),
      settings: JSON.parse(layout.settings),
    } : null;

    let inserted = 0;
    for (let i = 0; i < 7; i++) {
      const date = shiftDateStr(weekStart, i);
      if (store.histFind('seat', date, null)) continue;
      const prev = store.histPrev('seat', date, null);
      const payload = prev ? prev.payload : layoutPayload;
      if (!payload) continue;
      store.histInsert('seat', {
        weekStart, snapDate: date, mode: payload.mode || 'single',
        payload: { ...payload, aisleCols: [], groupsConfig: [] },
      });
      inserted++;
    }
    res.json({ message: inserted ? `已生成 ${inserted} 天记录` : '该周记录已完整，无需补录', inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;