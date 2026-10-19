const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { now, cleanUp, buildInsert, buildUpdate } = require('../utils/sql');

// 允许前端更新的字段白名单
const EDITABLE = ['姓名', '学号', '类型', '项目', '分值', '原因', '加分时间', 'source', 'group_name', '成员数'];

// 全量列表（共用于 GET /api/scores 与 /api/dashboard）
function readAll() {
  return db.prepare('SELECT * FROM score_records ORDER BY 加分时间 DESC, id DESC').all();
}

// GET /api/scores 全量列表（按加分时间倒序）
router.get('/', (req, res) => {
  try {
    res.json({ data: readAll() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scores 添加加分（选学生自动带姓名学号；小组加分独立成一条 source='group' 记录）
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const data = {};

    // 小组加分：单条独立记录，不展开成每人一条
    if (body.source === 'group' || body.group_name) {
      data.source = 'group';
      data.student_id = null;
      data.姓名 = null;
      data.学号 = null;
      data.group_name = body.group_name || null;
      data.成员数 = Number(body.成员数) || 0;
    } else {
      data.source = 'personal';
      if (body.studentId) {
        const stu = db.prepare('SELECT id, 姓名, 学号 FROM students WHERE id = ?').get(body.studentId);
        if (!stu) return res.status(404).json({ error: '学生不存在' });
        data.student_id = stu.id;
        data.姓名 = body.姓名 || stu.姓名;
        data.学号 = body.学号 !== undefined ? body.学号 : (stu.学号 || null);
      } else {
        data.student_id = null;
        data.姓名 = body.姓名 || null;
        data.学号 = body.学号 || null;
      }
    }

    data.类型 = body.类型 === '扣分' ? '扣分' : '加分';
    data.项目 = body.项目 || null;
    data.分值 = Number(body.分值) || 0;
    data.原因 = body.原因 || null;
    data.加分时间 = body.加分时间 || now();
    data.created_at = now();

    const result = buildInsert('score_records', data);
    res.json({ id: result.lastInsertRowid, message: '添加加分成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/scores/:id 编辑
router.put('/:id', (req, res) => {
  try {
    const row = cleanUp(req.body || {}, EDITABLE, 'score_records');
    if (row['分值'] !== undefined && row['分值'] !== null) row['分值'] = Number(row['分值']);
    if (row['成员数'] !== undefined && row['成员数'] !== null) row['成员数'] = Number(row['成员数']);
    if (Object.keys(row).length === 0) return res.status(400).json({ error: '没有可更新的字段' });
    buildUpdate('score_records', row, req.params.id);
    res.json({ message: '修改成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/scores/:id 删除
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM score_records WHERE id = ?').run(Number(req.params.id));
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// 供 /api/dashboard 聚合复用（挂在 router 函数对象上，不影响既有路由）
module.exports.readAll = readAll;