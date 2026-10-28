const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { now, cleanUp, buildInsert, buildUpdate } = require('../utils/sql');
const { sanitizeField, normNumber } = require('../services/sanitize');

// 允许前端更新的字段白名单
const EDITABLE = ['姓名', '学号', '类型', '项目', '分值', '原因', '加分时间', 'source', 'group_name', '成员数'];

// 全量列表（共用于 GET /api/scores 与 /api/dashboard）
function readAll() {
  return db.prepare('SELECT * FROM score_records ORDER BY 加分时间 DESC, id DESC').all();
}

// GET /api/scores 全量列表（按加分时间倒序）
router.get('/', (req, res) => {
    res.json({ data: readAll() });
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
      // 成员数没有列级规则，必须自己防 NaN：`Number(x) || 0` 会把「abc」静默变成 0
      data.成员数 = normNumber(body.成员数, '成员数') ?? 0;
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
    // 分值走列级规则（数字 + 范围 0~100000）；非数字直接报错，不再 `Number(x) || 0` 静默成 0 分
    data.分值 = sanitizeField(body.分值 ?? 0, 'score_records', '分值') ?? 0;
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
    const row = cleanUp(req.body || {}, EDITABLE, 'score_records');
  // 「分值」已由 cleanUp 按列级规则清洗（数字 + 范围），这里不再二次 Number()。
  // 「成员数」没有列级规则，cleanUp 可能原样留下字符串；Number('abc') = NaN，
  // better-sqlite3 会把 NaN 落成 NULL，于是成员数「凭空消失」。这里显式校验。
  if (row['成员数'] !== undefined && row['成员数'] !== null) {
    row['成员数'] = normNumber(row['成员数'], '成员数');
  }
  if (Object.keys(row).length === 0) return res.status(400).json({ error: '没有可更新的字段' });
  buildUpdate('score_records', row, req.params.id);
  res.json({ message: '修改成功' });
});

// DELETE /api/scores/:id 删除
router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM score_records WHERE id = ?').run(Number(req.params.id));
  res.json({ message: '删除成功' });
});

module.exports = router;
// 供 /api/dashboard 聚合复用（挂在 router 函数对象上，不影响既有路由）
module.exports.readAll = readAll;