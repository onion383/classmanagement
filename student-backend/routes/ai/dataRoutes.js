const express = require('express');
const path = require('path');
const fs = require('fs');
const { db, getFields } = require('../../db');
const { sanitizeField } = require('../../services/sanitize');
const { validateRow } = require('../../services/businessRules');
const dbManager = require('../../dbManager');
const { READ_TABLES, JSON_WRITE_TABLES } = require('./constants');
const { tableColumns, displayColumns, serializeColVal } = require('./helpers');
// 工具相关常量/执行器惰性加载：仅在真正处理对应路由时才 require
const tools = () => require('./tools');

const router = express.Router();

// GET /api/ai/records/:table?ids=1,2 —— 供前端按 id 取整条记录的完整字段（仅限可读表白名单）
router.get('/records/:table', (req, res) => {
  try {
    const table = req.params.table;
    if (!READ_TABLES[table]) return res.status(400).json({ error: '不支持的数据表' });
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
      // 上限 50：与批量删除（propose_delete_many）的条数上限对齐，保证删除预览能完整列出全部记录
      .slice(0, 50);
    if (!ids.length) return res.status(400).json({ error: '缺少记录 id' });
    const rows = db.prepare(`SELECT * FROM "${table}" WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    // 只返回列表页展示的列（过滤 position / 外键 / created_at 等内部列），整行不再全部露出
    res.json({ success: true, data: { columns: displayColumns(table), rows: ids.map((id) => byId.get(id)).filter(Boolean) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 整块写入前的自动快照：只对「当前在用」的表生效（模板/权重表无对应历史表，不存）。
// 写快照的目的：整块写入是「整体替换」，一旦写坏无法回滚，故写入前先把旧值留一份。
// key 语义：week 按周 upsert（schedule_history 以 week_start 为主键维度）；
//          day 按天 upsert（seat_history 以 snap_date + mode 为主键维度）；
//          dutyday 按天 + 模式 upsert（duty_history 以 snap_date + mode 为主键维度，需按 daily/big 拆行）。
const SNAPSHOT_RULES = {
  schedule: { history: 'schedule_history', key: 'week' },
  seat_layout: { history: 'seat_history', key: 'day' },
  duty_layout: { history: 'duty_history', key: 'dutyday' },
};

// 按 daily/big 拆分「按模式打包」的字段（与 routes/duty.js 的 fieldToModeMap 口径一致）：
// 顶层键全是 daily/big 视为新模式结构，否则视为旧版整块、整体归入 daily。
function splitModeMap(field) {
  let obj = {};
  try { obj = (typeof field === 'object' && field !== null) ? field : JSON.parse(field || '{}'); } catch (_) { obj = {}; }
  if (!obj || typeof obj !== 'object') return { daily: {}, big: {} };
  const keys = Object.keys(obj);
  const isModeMap = keys.length > 0 && keys.every((k) => k === 'daily' || k === 'big');
  if (isModeMap) return { daily: obj.daily || {}, big: obj.big || {} };
  return { daily: obj, big: {} };
}

// 取某天所在周的周一（YYYY-MM-DD），与各页历史快照的周口径一致
function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay() === 0 ? 7 : d.getDay(); // 周一=1 ... 周日=7
  d.setDate(d.getDate() - (dow - 1));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function localDateStr(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// 写入前把当前行的旧值快照进对应历史表（幂等 upsert，失败不阻断写入，仅记录）
function snapshotBeforeWrite(table, row) {
  const rule = SNAPSHOT_RULES[table];
  if (!rule) return;
  const today = new Date();
  const week = mondayOf(today);
  if (rule.key === 'week') {
    // 课表快照：week_start + cells + settings
    const exists = db.prepare(`SELECT id FROM ${rule.history} WHERE week_start = ?`).get(week);
    if (exists) {
      db.prepare(`UPDATE ${rule.history} SET cells = ?, settings = ? WHERE week_start = ?`)
        .run(row.cells ?? '[]', row.settings ?? '{}', week);
    } else {
      db.prepare(`INSERT INTO ${rule.history} (week_start, cells, settings) VALUES (?, ?, ?)`)
        .run(week, row.cells ?? '[]', row.settings ?? '{}');
    }
    return;
  }
  // 值日快照：duty_history 以 snap_date + mode 为维度，cells/settings 按 daily/big 拆开各写一行
  if (rule.key === 'dutyday') {
    const snapDate = localDateStr(today);
    const cellsMap = splitModeMap(row.cells);
    const settingsMap = splitModeMap(row.settings);
    ['daily', 'big'].forEach((m) => {
      const cells = JSON.stringify(cellsMap[m] || {});
      const settings = JSON.stringify(settingsMap[m] || {});
      const exists = db.prepare(`SELECT id FROM ${rule.history} WHERE snap_date = ? AND mode = ?`).get(snapDate, m);
      if (exists) {
        db.prepare(`UPDATE ${rule.history} SET week_start=?, cells=?, settings=? WHERE snap_date=? AND mode=?`)
          .run(week, cells, settings, snapDate, m);
      } else {
        db.prepare(`INSERT INTO ${rule.history} (week_start, snap_date, mode, cells, settings) VALUES (?,?,?,?,?)`)
          .run(week, snapDate, m, cells, settings);
      }
    });
    return;
  }
  // 座位快照：snap_date + mode 维度 upsert，保留几何与分组等全部字段
  const snapDate = localDateStr(today);
  const mode = row.mode || 'single';
  const exists = db.prepare(`SELECT id FROM ${rule.history} WHERE snap_date = ? AND mode = ?`).get(snapDate, mode);
  if (exists) {
    db.prepare(`UPDATE ${rule.history} SET week_start=?, rows=?, cols=?, seats=?, aisle_cols=?, groups_config=?, settings=? WHERE snap_date=? AND mode=?`)
      .run(week, row.rows, row.cols, row.seats ?? '[]', row.aisle_cols ?? '[]', row.groups_config ?? '[]', row.settings ?? '{}', snapDate, mode);
  } else {
    db.prepare(`INSERT INTO ${rule.history} (week_start, snap_date, mode, rows, cols, seats, aisle_cols, groups_config, settings) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(week, snapDate, mode, row.rows, row.cols, row.seats ?? '[]', row.aisle_cols ?? '[]', row.groups_config ?? '[]', row.settings ?? '{}');
  }
}

// 取某列在 table_meta 登记的字段类型（供 sanitizeField 的「按类型兜底」使用），未登记默认「文字」
function colType(table, col) {
  const meta = getFields(table) || [];
  const f = meta.find((x) => x.name === col);
  return f && f.type ? f.type : '文字';
}

// 整块写入一张「非行式」表的指定列（供 /doc 单次写入与 /api/ai/apply-batch 事务内复用）。
// 统一顺序：清洗（列级业务规则）→ 依赖既有数据的一致性校验 → 写入前历史快照 → 覆盖写入。
// 返回 { ok, table, id, before, after } 或 { error }；不抛异常，由调用方统一处理。
function applyDocWrite(table, id, values) {
  if (!JSON_WRITE_TABLES[table]) return { error: '该表暂不支持 AI 整块写入' };
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { error: '缺少要写入的列值' };
  const rid = Number.isInteger(id) ? id : 1;
  const cols = tableColumns(table);
  const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(rid);
  if (!row) return { error: `表中没有 id=${rid} 的行` };
  // ① 先按列级业务规则清洗（JSON 形状 / 枚举 / 数值 / 日期 / 路径），不合法直接拒绝、不落库
  const cleaned = {};
  try {
    for (const k of Object.keys(values)) {
      if (k === 'id' || !cols.includes(k) || values[k] === undefined) continue;
      cleaned[k] = sanitizeField(values[k], table, k, '文字');
    }
  } catch (e) {
    return { error: e.message };
  }
  const keys = Object.keys(cleaned);
  if (!keys.length) return { error: '没有可写入的字段' };
  // ①-2 依赖既有数据的一致性校验（座位引用的学生是否真实存在、值日项目/星期/姓名是否合法等）
  try {
    validateRow(table, cleaned, row);
  } catch (e) {
    return { error: e.message };
  }
  const before = {};
  const after = {};
  keys.forEach((k) => { before[k] = row[k]; after[k] = cleaned[k]; });
  // ② 整块写入是「整体替换」，先把旧值快照进历史表（课表/座位），留一颗后悔药
  try {
    snapshotBeforeWrite(table, row);
  } catch (e) {
    console.warn(`[ai] 写入前快照失败（已跳过，不影响本次写入）：${e.message}`);
  }
  const setSql = keys.map((k) => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE "${table}" SET ${setSql} WHERE id = ?`).run(...keys.map((k) => serializeColVal(cleaned[k])), rid);
  return { ok: true, table, id: rid, before, after };
}

// POST /api/ai/doc —— 整块写入「非行式」表（座位/权重/课表/值日/模板等）
//   body: { table, id, values }，values 为「列名 → 该列完整新值」。
//   仅限 JSON_WRITE_TABLES 白名单、仅真实列；入库前统一走列级业务规则清洗
//   （JSON 形状 / 枚举 / 数值范围 / 严格日期 / 路径），不合法直接 400 拒绝、不落库；
//   写入前对课表/座位先把旧值快照进历史表。返回写入前后的列值（before/after），供前端登记「整块撤销」。
router.post('/doc', (req, res) => {
  try {
    const { table, id, values } = req.body || {};
    const r = applyDocWrite(table, id, values);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, table: r.table, id: r.id, before: r.before, after: r.after });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 当前请求所属班主任库的 slug（取自鉴权中间件写入 token 的 dbSlug，与 AI 工具 ctx.slug 口径一致）
function currentSlug(req) {
  return (req.user && req.user.dbSlug) || 'default';
}

// POST /api/ai/apply-batch —— 把多张表/多类写操作放进「单个事务」执行：任一步失败整体回滚。
//   body: { ops }，ops 由 propose_batch 归一化产出（行式 add/update/delete + doc 整块写入）。
//   返回 results（每项含 before/after 或整行），供前端逐条登记「同批次撤销」。
router.post('/apply-batch', (req, res) => {
  try {
    const ops = Array.isArray(req.body && req.body.ops) ? req.body.ops : [];
    if (!ops.length) return res.status(400).json({ error: '缺少要执行的操作（ops 不能为空）' });
    if (ops.length > tools().MAX_BATCH_OPS) return res.status(400).json({ error: `一次最多 ${tools().MAX_BATCH_OPS} 个操作（当前 ${ops.length} 个）` });
    const results = [];
    const run = db.transaction(() => {
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i] || {};
        const at = `第 ${i + 1} 个操作`;
        const action = String(op.action || '');
        const table = String(op.table || '');
        if (action === 'doc') {
          const r = applyDocWrite(table, op.id, op.values);
          if (r.error) throw new Error(`${at}：${r.error}`);
          results.push({ action: 'doc', table: r.table, id: r.id, before: r.before, after: r.after });
          continue;
        }
        if (!tools().BATCH_ROW_TABLES[table]) throw new Error(`${at}：该表不支持按行写入（${table || '未指定表'}）`);
        const cols = tableColumns(table);
        if (action === 'add') {
          const data = op.data && typeof op.data === 'object' && !Array.isArray(op.data) ? op.data : {};
          const row = {};
          for (const k of Object.keys(data)) {
            if (k === 'id' || !cols.includes(k)) continue;
            row[k] = sanitizeField(data[k], table, k, colType(table, k));
          }
          const keys = Object.keys(row);
          if (!keys.length) throw new Error(`${at}：新增缺少字段数据`);
          // 行式表若有 position 列且未提供，补为当前最大值 +1（与各业务路由的排序接续一致）
          if (cols.includes('position') && row.position === undefined) {
            const mx = db.prepare(`SELECT MAX(position) AS m FROM "${table}"`).get();
            row.position = (Number(mx && mx.m) || 0) + 1;
          }
          validateRow(table, row);
          const sql = `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
          const info = db.prepare(sql).run(...keys.map((k) => serializeColVal(row[k])));
          const full = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(info.lastInsertRowid);
          results.push({ action: 'add', table, id: info.lastInsertRowid, row: full });
        } else if (action === 'update') {
          const id = Number(op.id);
          if (!Number.isInteger(id) || id <= 0) throw new Error(`${at}：缺少有效的记录 id`);
          const changes = op.changes && typeof op.changes === 'object' && !Array.isArray(op.changes) ? op.changes : {};
          const old = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
          if (!old) throw new Error(`${at}：要修改的记录不存在（${table} id=${id}）`);
          const row = {};
          for (const k of Object.keys(changes)) {
            if (k === 'id' || !cols.includes(k)) continue;
            row[k] = sanitizeField(changes[k], table, k, colType(table, k));
          }
          const keys = Object.keys(row);
          if (!keys.length) throw new Error(`${at}：没有可修改的字段`);
          validateRow(table, row, old);
          const setSql = keys.map((k) => `"${k}" = ?`).join(', ');
          db.prepare(`UPDATE "${table}" SET ${setSql} WHERE id = ?`).run(...keys.map((k) => serializeColVal(row[k])), id);
          const after = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
          results.push({ action: 'update', table, id, before: old, after });
        } else if (action === 'delete') {
          const id = Number(op.id);
          if (!Number.isInteger(id) || id <= 0) throw new Error(`${at}：缺少有效的记录 id`);
          const old = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
          if (!old) throw new Error(`${at}：要删除的记录不存在（${table} id=${id}）`);
          db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
          results.push({ action: 'delete', table, id, row: old });
        } else {
          throw new Error(`${at}：未知操作类型「${action}」`);
        }
      }
    });
    run();
    res.json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/ai/snapshot —— 立即创建一份整库快照（加密 .db 副本），自动保留最近 20 份
router.post('/snapshot', async (req, res) => {
  try {
    const r = await tools().runSnapshotCreate({ slug: currentSlug(req) });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, snapshot: r.snapshot, count: r.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/snapshots —— 列出已有快照（最新在前）
router.get('/snapshots', (req, res) => {
  try {
    const r = tools().runSnapshotList({ slug: currentSlug(req) });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, count: r.count, snapshots: r.snapshots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/snapshot/restore —— 还原到指定快照（覆盖整库，须老师在界面二次确认后才调用）
//   顺序：先断开该库连接（含缓存）→ 覆盖 .db → 清 -wal/-shm 残留 → 重新打开。
router.post('/snapshot/restore', (req, res) => {
  try {
    const slug = currentSlug(req);
    const name = String((req.body && req.body.snapshot) || '').trim().replace(/\.db$/, '');
    if (!tools().SNAPSHOT_NAME_RE.test(name)) return res.status(400).json({ error: '无效的快照标识' });
    const dir = dbManager.snapshotsDir(slug);
    const src = path.join(dir, `${name}.db`);
    if (!fs.existsSync(src)) return res.status(404).json({ error: `快照不存在：${name}` });
    const target = dbManager.dbFilePath(slug);
    dbManager.evictConn(slug);
    fs.copyFileSync(src, target);
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(target + suffix, { force: true }); } catch (_) { /* 忽略 */ }
    }
    dbManager.withDb(slug, () => {}); // 重新打开（懒加载）该库
    res.json({ ok: true, snapshot: name, reload: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
