const express = require('express');
const router = express.Router();
const { db } = require('../db');

const MAX_ROWS = 50;
const MAX_COLS = 30;

function validateSeatSize(rows, cols) {
  if (rows < 1 || rows > MAX_ROWS) return `行数需在 1 ~ ${MAX_ROWS} 之间`;
  if (cols < 1 || cols > MAX_COLS) return `列数需在 1 ~ ${MAX_COLS} 之间`;
  return null;
}

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
    const sizeError = validateSeatSize(rows, cols);
    if (sizeError) {
      return res.status(400).json({ error: sizeError });
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

// ======================== 单格更新（供撤销/重做前的单格提交） ========================
function updateSingleCell(table, row, col, value) {
  const rec = db.prepare(`SELECT seats FROM "${table}" WHERE id = 1`).get()
  const seats = rec ? JSON.parse(rec.seats) : []
  if (!Array.isArray(seats[row])) seats[row] = []
  seats[row][col] = value == null ? null : value
  db.prepare(`UPDATE "${table}" SET seats = ? WHERE id = 1`).run(JSON.stringify(seats))
}

router.patch('/cell', (req, res) => {
  try {
    const { row, col, value } = req.body
    if (!Number.isInteger(row) || !Number.isInteger(col)) return res.status(400).json({ error: '参数格式错误' })
    updateSingleCell('seat_layout', row, col, value)
    res.json({ message: '已更新' })
  } catch (err) { res.status(500).json({ error: err.message }) }
});

router.patch('/master/cell', (req, res) => {
  try {
    const { row, col, value } = req.body
    if (!Number.isInteger(row) || !Number.isInteger(col)) return res.status(400).json({ error: '参数格式错误' })
    updateSingleCell('seat_template', row, col, value)
    res.json({ message: '已更新' })
  } catch (err) { res.status(500).json({ error: err.message }) }
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
    const sizeError = validateSeatSize(rows, cols);
    if (sizeError) {
      return res.status(400).json({ error: sizeError });
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

// ======================== 座位位置权重表 ========================
// 与座位布局共用几何参数（rows/cols/mode/showAisle），但单独存储数字矩阵。
router.get('/weight', (req, res) => {
  try {
    const row = db.prepare('SELECT mode, rows, cols, weights, settings FROM seat_weight WHERE id = 1').get();
    if (!row) return res.json({ mode: 'single', rows: 6, cols: 7, weights: [], settings: {} });
    res.json({
      mode: row.mode,
      rows: row.rows,
      cols: row.cols,
      weights: JSON.parse(row.weights),
      settings: JSON.parse(row.settings)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/weight', (req, res) => {
  try {
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

    db.prepare(`UPDATE seat_weight SET mode=?, rows=?, cols=?, weights=?, settings=? WHERE id=1`)
      .run(mode || 'single', rows, cols, JSON.stringify(trimmed), JSON.stringify(settings || {}));
    res.json({ message: '权重保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 草稿表（智能排表的临时草稿） ========================
// 草稿只在「智能排表」弹窗里恢复：保存本次排表的预览结果与条件。
// saved_at 为空串即视为没有草稿（不额外存标记位，避免多一个状态字段）。
router.get('/draft', (req, res) => {
  try {
    const row = db.prepare('SELECT mode, rows, cols, seats, aisle_cols, settings, conditions, saved_at FROM seat_draft WHERE id = 1').get();
    if (!row || !row.saved_at) return res.json({ exists: false });
    res.json({
      exists: true,
      mode: row.mode,
      rows: row.rows,
      cols: row.cols,
      seats: JSON.parse(row.seats),
      aisleCols: JSON.parse(row.aisle_cols),
      settings: JSON.parse(row.settings),
      conditions: JSON.parse(row.conditions),
      savedAt: row.saved_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/draft', (req, res) => {
  try {
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
    db.prepare(`UPDATE seat_draft SET mode=?, rows=?, cols=?, seats=?, aisle_cols=?, settings=?, conditions=?, saved_at=? WHERE id=1`)
      .run(
        mode || 'single',
        rows,
        cols,
        JSON.stringify(trimmed),
        JSON.stringify(aisleCols || []),
        JSON.stringify(settings || {}),
        JSON.stringify(conditions || []),
        savedAt
      );
    res.json({ message: '草稿已保存', savedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清除草稿：清空内容与 saved_at，下次启动不再提示
router.delete('/draft', (req, res) => {
  try {
    db.prepare(`UPDATE seat_draft SET seats='[]', conditions='[]', saved_at='' WHERE id=1`).run();
    res.json({ message: '草稿已清除' });
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
  try {
    const rows = db.prepare(`
      SELECT week_start, MAX(snap_date) AS last_date, MAX(created_at) AS created_at, COUNT(*) AS count
      FROM seat_history GROUP BY week_start ORDER BY week_start DESC
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 单周快照：返回该周最后一天（最新一天）的座位
router.get('/history/:weekStart', (req, res) => {
  try {
    const { weekStart } = req.params;
    const row = db.prepare('SELECT * FROM seat_history WHERE week_start = ? ORDER BY snap_date DESC, id DESC LIMIT 1').get(weekStart);
    if (!row) return res.json(null);
    res.json({
      week_start: row.week_start,
      snap_date: row.snap_date,
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

// 按天取快照区间（座位指数结算用）：返回区间内每日快照，按天升序；from/to 可只给其一
router.get('/daily', (req, res) => {
  try {
    const { from, to } = req.query;
    const cols = 'snap_date, week_start, mode, rows, cols, seats, settings';
    let rows;
    if (from && to) {
      rows = db.prepare(`SELECT ${cols} FROM seat_history WHERE snap_date >= ? AND snap_date <= ? ORDER BY snap_date ASC`).all(from, to);
    } else if (to) {
      rows = db.prepare(`SELECT ${cols} FROM seat_history WHERE snap_date <= ? ORDER BY snap_date ASC`).all(to);
    } else if (from) {
      rows = db.prepare(`SELECT ${cols} FROM seat_history WHERE snap_date >= ? ORDER BY snap_date ASC`).all(from);
    } else {
      rows = db.prepare(`SELECT ${cols} FROM seat_history ORDER BY snap_date ASC`).all();
    }
    res.json(rows.map(r => ({
      snap_date: r.snap_date,
      week_start: r.week_start,
      mode: r.mode,
      rows: r.rows,
      cols: r.cols,
      seats: JSON.parse(r.seats),
      settings: JSON.parse(r.settings)
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 保存某一天的快照（手动保存 / 补存都会走到这里）：按 snap_date 幂等 upsert
router.post('/snapshot', (req, res) => {
  try {
    const { snap_date, mode, rows, cols, seats, settings } = req.body;
    if (!snap_date) return res.status(400).json({ error: '缺少快照日期' });

    const week_start = mondayOf(snap_date);
    // 走廊列根据 mode 和 settings.showAisle 动态生成，无需存储
    const aisleCols = [];
    const groupsConfig = [];

    const exists = db.prepare('SELECT id FROM seat_history WHERE snap_date = ?').get(snap_date);
    if (exists) {
      db.prepare('UPDATE seat_history SET week_start=?, mode=?, rows=?, cols=?, seats=?, aisle_cols=?, groups_config=?, settings=? WHERE snap_date=?')
        .run(week_start, mode, rows, cols, JSON.stringify(seats), JSON.stringify(aisleCols), JSON.stringify(groupsConfig), JSON.stringify(settings), snap_date);
    } else {
      db.prepare('INSERT INTO seat_history (week_start, snap_date, mode, rows, cols, seats, aisle_cols, groups_config, settings) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(week_start, snap_date, mode, rows, cols, JSON.stringify(seats), JSON.stringify(aisleCols), JSON.stringify(groupsConfig), JSON.stringify(settings));
    }
    res.json({ message: '快照已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 补存历史快照：仅学期范围内。过去日期缺失才补（沿用最近一天座位），
// includeToday=true 时今天总是用当前临时表覆盖（启动时静默补全用）。
router.post('/snapshot/backfill', (req, res) => {
  try {
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

    const layout = db.prepare('SELECT mode, rows, cols, seats, settings FROM seat_layout WHERE id = 1').get();
    const getByDate = db.prepare('SELECT id FROM seat_history WHERE snap_date = ?');
    const getPrev = db.prepare('SELECT mode, rows, cols, seats, settings FROM seat_history WHERE snap_date < ? ORDER BY snap_date DESC LIMIT 1');
    const ins = db.prepare('INSERT INTO seat_history (week_start, snap_date, mode, rows, cols, seats, aisle_cols, groups_config, settings) VALUES (?,?,?,?,?,?,?,?,?)');
    const upd = db.prepare('UPDATE seat_history SET mode=?, rows=?, cols=?, seats=?, settings=? WHERE snap_date=?');

    let inserted = 0;
    let cur = start;
    while (cur <= upper) {
      const isToday = cur === today;
      if (isToday && includeToday && layout) {
        // 今天：总是覆盖为当前临时表
        if (getByDate.get(cur)) upd.run(layout.mode, layout.rows, layout.cols, layout.seats, layout.settings, cur);
        else ins.run(mondayOf(cur), cur, layout.mode, layout.rows, layout.cols, layout.seats, '[]', '[]', layout.settings);
        inserted++;
      } else if (!getByDate.get(cur)) {
        // 过去日期：缺失才补，沿用最近一天座位；没有更早快照则用当前座位
        const src = getPrev.get(cur) || layout;
        if (src) {
          ins.run(mondayOf(cur), cur, src.mode, src.rows, src.cols, src.seats, '[]', '[]', src.settings);
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
  try {
    const { weekStart } = req.params;
    const info = db.prepare('DELETE FROM seat_history WHERE week_start = ?').run(weekStart);
    if (!info.changes) return res.status(404).json({ error: '该周快照不存在' });
    res.json({ message: '快照已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 补录/生成一整周记录（周一起 7 天）：已存在的日期跳过，缺失的日期沿用最近一天的座位
// （没有更早快照时用当前座位表）。week_start 传任意日期都会先归一到该周周一。
router.post('/history/week', (req, res) => {
  try {
    const raw = (req.body && req.body.week_start) || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return res.status(400).json({ error: '缺少周起始日期' });
    const weekStart = mondayOf(raw);
    const layout = db.prepare('SELECT mode, rows, cols, seats, settings FROM seat_layout WHERE id = 1').get();
    const getByDate = db.prepare('SELECT id FROM seat_history WHERE snap_date = ?');
    const getPrev = db.prepare('SELECT mode, rows, cols, seats, settings FROM seat_history WHERE snap_date < ? ORDER BY snap_date DESC LIMIT 1');
    const ins = db.prepare('INSERT INTO seat_history (week_start, snap_date, mode, rows, cols, seats, aisle_cols, groups_config, settings) VALUES (?,?,?,?,?,?,?,?,?)');

    let inserted = 0;
    for (let i = 0; i < 7; i++) {
      const date = shiftDateStr(weekStart, i);
      if (getByDate.get(date)) continue;
      const src = getPrev.get(date) || layout;
      if (!src) continue;
      ins.run(weekStart, date, src.mode, src.rows, src.cols, src.seats, '[]', '[]', src.settings);
      inserted++;
    }
    res.json({ message: inserted ? `已生成 ${inserted} 天记录` : '该周记录已完整，无需补录', inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;