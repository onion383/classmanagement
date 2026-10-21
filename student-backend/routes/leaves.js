const express = require('express');
const router = express.Router();
const { db, renumber } = require('../db');
const { now, cleanUp, maxPosition, buildInsert, buildUpdate } = require('../utils/sql');
const { sanitizeField } = require('../services/sanitize');
const { validateRow } = require('../services/businessRules');
const { reorderRows } = require('../services/tableService');

// 允许前端更新的字段白名单
const EDITABLE = ['姓名', '类型', '开始时间', '结束时间', '家长联系电话', '学生联系电话', '状态', '返校时间', '备注'];

// 今日到班两张只读表的列顺序存储名（复用 table_meta，不改表结构）
const TODAY_COLUMN_TABLES = {
  active: 'leave_today_active',
  returned: 'leave_today_returned',
  records: 'leave_records_columns'
};

function listOrders() {
  return db.prepare('SELECT * FROM leave_records ORDER BY position, id').all();
}

// GET /api/leaves 全量列表
router.get('/', (req, res) => {
  try {
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ data: listOrders() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leaves 添加请假（学生联系方式从学生表自动带出）
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const data = {};

    // 首选通过 studentId 从学生表带出姓名与联系方式
    if (body.studentId) {
      const stu = db.prepare('SELECT id, 姓名, 家长联系电话, 学生联系电话 FROM students WHERE id = ?').get(body.studentId);
      if (!stu) return res.status(404).json({ error: '学生不存在' });
      data.student_id = stu.id;
      data.姓名 = body.姓名 || stu.姓名;
      data.家长联系电话 = body.家长联系电话 !== undefined ? body.家长联系电话 : (stu.家长联系电话 || null);
      data.学生联系电话 = body.学生联系电话 !== undefined ? body.学生联系电话 : (stu.学生联系电话 || null);
    } else {
      data.student_id = null;
      data.姓名 = body.姓名 || null;
      data.家长联系电话 = body.家长联系电话 || null;
      data.学生联系电话 = body.学生联系电话 || null;
    }

    data.类型 = body.类型 ? sanitizeField(body.类型, 'leave_records', '类型', '文字') : null;
    data.开始时间 = sanitizeField(body.开始时间 || null, 'leave_records', '开始时间', '日期');
    data.结束时间 = sanitizeField(body.结束时间 || null, 'leave_records', '结束时间', '日期');
    data.备注 = body.备注 || null;
    data.状态 = '请假中';
    data.返校时间 = null;
    data.created_at = now();

    // 跨字段校验：结束时间必须晚于开始时间（不合法直接拒绝，避免写入「负时长 / 倒置」请假）
    validateRow('leave_records', { 开始时间: data.开始时间, 结束时间: data.结束时间 });

    data.position = maxPosition('leave_records') + 1;
    const result = buildInsert('leave_records', data);
    renumber('leave_records');
    res.json({ id: result.lastInsertRowid, message: '添加请假成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leaves/:id 编辑
router.put('/:id', (req, res) => {
  try {
    const row = cleanUp(req.body || {}, EDITABLE, 'leave_records');
    if (Object.keys(row).length === 0) return res.status(400).json({ error: '没有可更新的字段' });
    buildUpdate('leave_records', row, req.params.id);
    res.json({ message: '修改成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leaves/reorder 保存整表行顺序（前端传全量 id 顺序）
router.post('/reorder', (req, res) => {
  try {
    const ids = (req.body && req.body.ids) || [];
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids 不能为空' });
    reorderRows('leave_records', ids.map(Number));
    res.json({ message: '排序成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leaves/today-columns 读取今日到班两张表的列顺序
router.get('/today-columns', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT table_name, column_name FROM table_meta WHERE table_name IN (?, ?, ?) ORDER BY sort_order'
    ).all(TODAY_COLUMN_TABLES.active, TODAY_COLUMN_TABLES.returned, TODAY_COLUMN_TABLES.records);
    const out = { active: [], returned: [], records: [] };
    rows.forEach(r => {
      if (r.table_name === TODAY_COLUMN_TABLES.active) out.active.push(r.column_name);
      else if (r.table_name === TODAY_COLUMN_TABLES.returned) out.returned.push(r.column_name);
      else out.records.push(r.column_name);
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leaves/today-columns 保存某张表的列顺序 { table: 'active'|'returned', order: [...] }
router.post('/today-columns', (req, res) => {
  try {
    const { table, order } = req.body || {};
    const tableName = TODAY_COLUMN_TABLES[table];
    if (!tableName || !Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: '参数不合法' });
    }
    const del = db.prepare('DELETE FROM table_meta WHERE table_name = ?');
    const ins = db.prepare('INSERT INTO table_meta (table_name, column_name, data_type, sort_order) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      del.run(tableName);
      order.forEach((name, i) => ins.run(tableName, String(name), '文字', i + 1));
    })();
    res.json({ message: '列顺序已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/leaves/:id 删除
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM leave_records WHERE id = ?').run(Number(req.params.id));
    renumber('leave_records');
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leaves/:id/return 销假（标记已返校）
router.post('/:id/return', (req, res) => {
  try {
    const result = db.prepare("UPDATE leave_records SET 状态='已返校', 返校时间=? WHERE id = ?").run(now(), Number(req.params.id));
    if (result.changes === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ message: '已销假' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leaves/:id/unreturn 撤销销假（恢复为请假中）
router.post('/:id/unreturn', (req, res) => {
  try {
    const result = db.prepare("UPDATE leave_records SET 状态='请假中', 返校时间=NULL WHERE id = ?").run(Number(req.params.id));
    if (result.changes === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ message: '已撤销销假' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leaves/:id/cancel 取消请假
router.post('/:id/cancel', (req, res) => {
  try {
    const result = db.prepare("UPDATE leave_records SET 状态='已取消' WHERE id = ?").run(Number(req.params.id));
    if (result.changes === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ message: '已取消请假' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// 供 /api/dashboard 聚合复用（挂在 router 函数对象上，不影响既有路由）
module.exports.listOrders = listOrders;