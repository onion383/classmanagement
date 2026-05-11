const express = require('express');
const router = express.Router();
const db = require('../db');
const { mapType } = require('../utils');

// GET /students
router.get('/', (req, res) => {
  db.query('SELECT * FROM students ORDER BY position ASC', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    db.query('SHOW COLUMNS FROM students', (err2, columns) => {
      let fields = [];
      if (err2 || !columns) {
        fields = results.length > 0 ? Object.keys(results[0]).map(k => ({ name: k, type: '文字' })) : [];
      } else {
        fields = columns.map(c => ({ name: c.Field, type: mapType(c.Type) }));
      }
      res.json({ data: results, fields });
    });
  });
});

// POST /students
router.post('/', (req, res) => {
  const data = req.body;
  const atPosition = data.atPosition;
  delete data.atPosition;

  const keys = Object.keys(data);
  if (keys.length === 0) return res.status(400).json({ error: '没有字段' });

  const cleaned = {};
  keys.forEach(k => {
    cleaned[k] = (data[k] === '' || data[k] === undefined) ? null : data[k];
  });

  db.query('SELECT MAX(position) AS maxPos FROM students', (err, result) => {
    let nextPos = (result[0].maxPos || 0) + 1;
    const insertPos = (atPosition && atPosition <= result[0].maxPos) ? atPosition : nextPos;

    if (atPosition && atPosition <= result[0].maxPos) {
      db.query('UPDATE students SET position = position + 1 WHERE position >= ?', [atPosition], err => {
        if (err) return res.status(500).json({ error: err.message });
        insertStudent(insertPos);
      });
    } else {
      insertStudent(nextPos);
    }

    function insertStudent(pos) {
      cleaned.position = pos;
      const columns = Object.keys(cleaned).map(k => `\`${k}\``).join(', ');
      const placeholders = Object.keys(cleaned).map(() => '?').join(', ');
      const values = Object.values(cleaned);
      db.query(`INSERT INTO students (${columns}) VALUES (${placeholders})`, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: result.insertId, message: '添加成功' });
      });
    }
  });
});

// PUT /students/:id
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const data = req.body;
  const keys = Object.keys(data);
  if (keys.length === 0) return res.status(400).json({ error: '没有字段' });

  const cleaned = {};
  keys.forEach(k => {
    cleaned[k] = (data[k] === '' || data[k] === undefined) ? null : data[k];
  });

  const setClause = Object.keys(cleaned).map(k => `\`${k}\` = ?`).join(', ');
  const values = Object.values(cleaned);
  values.push(id);

  db.query(`UPDATE students SET ${setClause} WHERE id = ?`, values, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '修改成功' });
  });
});

//
// DELETE /students/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  db.query('SELECT COUNT(*) AS count FROM students', (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result[0].count <= 1) return res.status(400).json({ error: '至少需要保留一个学生' });

    db.query('SELECT position FROM students WHERE id = ?', [id], (err, result2) => {
      if (err || result2.length === 0) return res.status(404).json({ error: '学生不存在' });
      const deletedPos = result2[0].position;

      db.query('DELETE FROM students WHERE id = ?', [id], err => {
        if (err) return res.status(500).json({ error: err.message });
        db.query('UPDATE students SET position = position - 1 WHERE position > ?', [deletedPos], err => {
          if (err) console.error('调整 position 失败:', err);
          res.json({ message: '删除成功' });
        });
      });
    });
  });
});

// 移动行 POST /students/move-row
router.post('/move-row', (req, res) => {
  const { id, direction } = req.body;
  if (!id || !direction) return res.status(400).json({ error: '缺少参数' });

  db.query('SELECT position FROM students WHERE id = ?', [id], (err, result) => {
    if (err || result.length === 0) return res.status(404).json({ error: '学生不存在' });
    const currentPos = result[0].position;

    let targetPos;
    if (direction === 'up') targetPos = currentPos - 1;
    else if (direction === 'down') targetPos = currentPos + 1;
    else return res.status(400).json({ error: '无效方向' });

    if (direction === 'up' && targetPos < 1) return res.status(400).json({ error: '已是第一个，无法上移' });

    db.query('SELECT MAX(position) AS maxPos FROM students', (err2, maxRes) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const maxPos = maxRes[0].maxPos || 0;
      if (direction === 'down' && targetPos > maxPos) return res.status(400).json({ error: '已是最后一个，无法下移' });

      db.query('SELECT id FROM students WHERE position = ?', [targetPos], (err3, result2) => {
        if (err3) return res.status(500).json({ error: err3.message });
        if (result2.length === 0) return res.status(400).json({ error: '无法移动（目标位置异常）' });

        const targetId = result2[0].id;
        db.query(
          `UPDATE students SET position = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? END WHERE id IN (?, ?)`,
          [id, targetPos, targetId, currentPos, id, targetId],
          err4 => {
            if (err4) return res.status(500).json({ error: err4.message });
            res.json({ message: '移动成功' });
          }
        );
      });
    });
  });
});

// 动态添加列 POST /students/add-column
router.post('/add-column', (req, res) => {
  const { columnName, dataType, after } = req.body;
  if (!columnName || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(columnName)) return res.status(400).json({ error: '列名不合法' });
  if (columnName === 'id' || columnName === 'position') return res.status(400).json({ error: '不能使用保留字段' });

  let sqlType;
  switch (dataType) {
    case '整数': sqlType = 'INT'; break;
    case '小数': sqlType = 'DOUBLE'; break;
    case '日期': sqlType = 'DATE'; break;
    default: sqlType = 'VARCHAR(100)';
  }

  const addSql = `ALTER TABLE students ADD COLUMN \`${columnName}\` ${sqlType}`;
  db.query(addSql, err => {
    if (err) {
      if (err.code === 'ER_DUP_FIELDNAME') return res.status(400).json({ error: '该字段已存在' });
      return res.status(500).json({ error: err.message });
    }

    if (after && after !== 'last') {
      let positionSql;
      if (after === 'first') positionSql = `ALTER TABLE students MODIFY COLUMN \`${columnName}\` ${sqlType} FIRST`;
      else positionSql = `ALTER TABLE students MODIFY COLUMN \`${columnName}\` ${sqlType} AFTER \`${after}\``;
      db.query(positionSql, err2 => {
        if (err2) console.error('调整列顺序失败:', err2);
        res.json({ message: `字段 ${columnName} 添加成功` });
      });
    } else {
      res.json({ message: `字段 ${columnName} 添加成功` });
    }
  });
});

// 删除列 DELETE /students/columns/:columnName
router.delete('/columns/:columnName', (req, res) => {
  const { columnName } = req.params;
  if (columnName === 'id' || columnName === 'position') return res.status(400).json({ error: '不能删除保留字段' });

  if (columnName === '学号' || columnName === '姓名') {
    return res.status(400).json({ error: '该字段受保护，无法删除' });
  }

  db.query("SHOW COLUMNS FROM students", (err, columns) => {
    if (err) return res.status(500).json({ error: err.message });
    const deletable = columns.filter(c => c.Field !== 'id' && c.Field !== 'position');
    if (deletable.length <= 1) return res.status(400).json({ error: '至少需要保留一个数据字段' });

    db.query(`ALTER TABLE students DROP COLUMN \`${columnName}\``, err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: `字段 ${columnName} 已删除` });
    });
  });
});

//后端顺序保存
// 行排序：接受 id 数组，按顺序更新 position
router.post('/reorder', (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });
  // 构建 CASE WHEN 批量更新
  let caseWhen = '';
  const params = [];
  ids.forEach((id, index) => {
    caseWhen += ' WHEN ? THEN ? ';
    params.push(id, index + 1);
  });
  const sql = `UPDATE students SET position = CASE id ${caseWhen} END WHERE id IN (${ids.map(() => '?').join(',')})`;
  params.push(...ids);
  db.query(sql, params, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '顺序更新成功' });
  });
});

// 移动列位置
router.post('/move-column', (req, res) => {
  const { columnName, targetColumnName, position } = req.body;
  if (!columnName || columnName === 'id' || columnName === 'position') {
    return res.status(400).json({ error: '列名不合法或为保留字段' });
  }

  // 目标列不能是自己
  if (position === 'after' && (targetColumnName === columnName || !targetColumnName)) {
    return res.status(400).json({ error: '无效的目标列' });
  }

  // 查询当前表的列信息（根据路由确定表名：students 或 fee_records）
  const tableName = 'students'; // 如果是班费，这里改为 fee_records
  db.query(`SHOW COLUMNS FROM ${tableName}`, (err, columns) => {
    if (err) return res.status(500).json({ error: err.message });
    const col = columns.find(c => c.Field === columnName);
    if (!col) return res.status(400).json({ error: '列不存在' });

    let sql;
    if (position === 'first') {
      sql = `ALTER TABLE ${tableName} MODIFY COLUMN \`${columnName}\` ${col.Type} FIRST`;
    } else {
      sql = `ALTER TABLE ${tableName} MODIFY COLUMN \`${columnName}\` ${col.Type} AFTER \`${targetColumnName}\``;
    }

    db.query(sql, (err) => {
      if (err) {
        console.error('移动列失败:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: '列顺序已更新' });
    });
  });
});

module.exports = router;