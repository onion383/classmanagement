const express = require('express');
const router = express.Router();
const { db, renumber } = require('../db');

// 允许前端更新的字段白名单
const EDITABLE = ['姓名', '类型', '开始时间', '结束时间', '家长联系电话', '学生联系电话', '状态', '返校时间', '备注'];

function now() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function cleanUp(data) {
  const row = {};
  EDITABLE.forEach(k => {
    if (data[k] !== undefined) row[k] = (data[k] === '' || data[k] === null) ? null : data[k];
  });
  return row;
}

function listOrders() {
  return db.prepare('SELECT * FROM leave_records ORDER BY position, id').all();
}

// GET /api/leaves 全量列表
router.get('/', (req, res) => {
  try {
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

    data.类型 = body.类型 || null;
    data.开始时间 = body.开始时间 || null;
    data.结束时间 = body.结束时间 || null;
    data.备注 = body.备注 || null;
    data.状态 = '请假中';
    data.返校时间 = null;
    data.created_at = now();

    const maxPos = db.prepare('SELECT MAX(position) AS maxPos FROM leave_records').get().maxPos || 0;
    data.position = maxPos + 1;

    const cols = Object.keys(data).map(c => `"${c}"`).join(',');
    const ph = Object.keys(data).map(() => '?').join(',');
    const result = db.prepare(`INSERT INTO leave_records (${cols}) VALUES (${ph})`).run(...Object.values(data));
    renumber('leave_records');
    res.json({ id: result.lastInsertRowid, message: '添加请假成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leaves/:id 编辑
router.put('/:id', (req, res) => {
  try {
    const row = cleanUp(req.body || {});
    if (Object.keys(row).length === 0) return res.status(400).json({ error: '没有可更新的字段' });
    const setClause = Object.keys(row).map(k => `"${k}" = ?`).join(', ');
    db.prepare(`UPDATE leave_records SET ${setClause} WHERE id = ?`).run(...Object.values(row), Number(req.params.id));
    res.json({ message: '修改成功' });
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