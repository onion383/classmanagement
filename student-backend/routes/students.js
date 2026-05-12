const express = require('express');
const router = express.Router();
const { db, getFields, renumber } = require('../db');

// GET /students
router.get('/', (req, res) => {
  try {
    const results = db.prepare('SELECT * FROM students ORDER BY position ASC').all();
    let fields = getFields('students');
    // 如果元数据为空，降级为用结果键（一般不会）
    if (fields.length === 0 && results.length > 0) {
      fields = Object.keys(results[0]).filter(k => k !== 'id' && k !== 'position').map(k => ({ name: k, type: '文字' }));
    }
    res.json({ data: results, fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /students
router.post('/', (req, res) => {
  try {
    const data = req.body;
    const atPosition = data.atPosition;
    delete data.atPosition;

    const keys = Object.keys(data);
    if (keys.length === 0) return res.status(400).json({ error: '没有字段' });

    const cleaned = {};
    keys.forEach(k => {
      cleaned[k] = (data[k] === '' || data[k] === undefined) ? null : data[k];
    });

    const maxPos = db.prepare('SELECT MAX(position) AS maxPos FROM students').get().maxPos || 0;
    let insertPos;

    if (atPosition && atPosition <= maxPos) {
      insertPos = atPosition;
      db.prepare('UPDATE students SET position = position + 1 WHERE position >= ?').run(atPosition);
    } else {
      insertPos = maxPos + 1;
    }

    cleaned.position = insertPos;
    const columns = Object.keys(cleaned).map(c => `"${c}"`).join(',');
    const placeholders = Object.keys(cleaned).map(() => '?').join(',');
    const values = Object.values(cleaned);

    const result = db.prepare(`INSERT INTO students (${columns}) VALUES (${placeholders})`).run(...values);
    renumber('students');  // 保持 position 连续
    res.json({ id: result.lastInsertRowid, message: '添加成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /students/:id
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const keys = Object.keys(data);
    if (keys.length === 0) return res.status(400).json({ error: '没有字段' });

    const cleaned = {};
    keys.forEach(k => {
      cleaned[k] = (data[k] === '' || data[k] === undefined) ? null : data[k];
    });

    const setClause = Object.keys(cleaned).map(k => `"${k}" = ?`).join(', ');
    const values = Object.values(cleaned);
    values.push(id);

    db.prepare(`UPDATE students SET ${setClause} WHERE id = ?`).run(...values);
    res.json({ message: '修改成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /students/:id
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const count = db.prepare('SELECT COUNT(*) AS count FROM students').get().count;
    if (count <= 1) return res.status(400).json({ error: '至少需要保留一个学生' });

    const row = db.prepare('SELECT position FROM students WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '学生不存在' });

    db.prepare('DELETE FROM students WHERE id = ?').run(id);
    // 将后面记录的 position 减一
    db.prepare('UPDATE students SET position = position - 1 WHERE position > ?').run(row.position);
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移动行 POST /students/move-row
router.post('/move-row', (req, res) => {
  try {
    const { id, direction } = req.body;
    if (!id || !direction) return res.status(400).json({ error: '缺少参数' });

    const row = db.prepare('SELECT position FROM students WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '学生不存在' });

    const cur = row.position;
    const maxPos = db.prepare('SELECT MAX(position) AS maxPos FROM students').get().maxPos;
    let target;
    if (direction === 'up') target = cur - 1;
    else if (direction === 'down') target = cur + 1;
    else return res.status(400).json({ error: '无效方向' });

    if (target < 1 || target > maxPos) return res.status(400).json({ error: '已到边界' });

    const targetRow = db.prepare('SELECT id FROM students WHERE position = ?').get(target);
    if (!targetRow) return res.status(400).json({ error: '目标行异常' });

    db.prepare(`UPDATE students SET position = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? END WHERE id IN (?, ?)`)
      .run(id, target, targetRow.id, cur, id, targetRow.id);
    res.json({ message: '移动成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 动态添加列 POST /students/add-column
router.post('/add-column', (req, res) => {
  try {
    const { columnName, dataType, after } = req.body;
    if (!columnName || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(columnName)) return res.status(400).json({ error: '列名不合法' });
    if (columnName === 'id' || columnName === 'position') return res.status(400).json({ error: '不能使用保留字段' });

    // 1. 在 students 表里真正添加列（SQLite 只能加到末尾）
    let sqlType = 'TEXT';
    if (dataType === '整数') sqlType = 'INTEGER';
    else if (dataType === '小数') sqlType = 'REAL';
    else if (dataType === '日期') sqlType = 'TEXT';

    db.prepare(`ALTER TABLE students ADD COLUMN "${columnName}" ${sqlType}`).run();

    // 2. 确定 sort_order
    const metas = db.prepare('SELECT column_name, sort_order FROM table_meta WHERE table_name = ? ORDER BY sort_order').all('students');
    let sortOrder;
    if (after === 'first' || !after) {
      sortOrder = 1;
      // 后面的 sort_order 全部 +1
      db.prepare('UPDATE table_meta SET sort_order = sort_order + 1 WHERE table_name = ?').run('students');
    } else {
      const targetMeta = metas.find(m => m.column_name === after);
      if (!targetMeta) return res.status(400).json({ error: '目标列不存在' });
      sortOrder = targetMeta.sort_order + 1;
      db.prepare('UPDATE table_meta SET sort_order = sort_order + 1 WHERE table_name = ? AND sort_order >= ?').run('students', sortOrder);
    }

    db.prepare('INSERT INTO table_meta (table_name, column_name, data_type, sort_order) VALUES (?, ?, ?, ?)')
      .run('students', columnName, dataType || '文字', sortOrder);

    res.json({ message: `字段 ${columnName} 添加成功` });
  } catch (err) {
    if (err.message.includes('duplicate column name')) return res.status(400).json({ error: '该字段已存在' });
    res.status(500).json({ error: err.message });
  }
});

// 删除列 DELETE /students/columns/:columnName
router.delete('/columns/:columnName', (req, res) => {
  const { columnName } = req.params;
  if (columnName === 'id' || columnName === 'position') return res.status(400).json({ error: '不能删除保留字段' });
  if (columnName === '学号' || columnName === '姓名') return res.status(400).json({ error: '该字段受保护，无法删除' });

  try {
    // SQLite 不支持 DROP COLUMN，这里的对策：从 table_meta 中删除，前端不显示该列即可
    // 实际表结构保留该列（不影响功能）
    const deletable = db.prepare('SELECT COUNT(*) AS cnt FROM table_meta WHERE table_name = ?').get('students').cnt;
    if (deletable <= 1) return res.status(400).json({ error: '至少需要保留一个数据字段' });

    db.prepare('DELETE FROM table_meta WHERE table_name = ? AND column_name = ?').run('students', columnName);
    // 重新整理 sort_order
    const remaining = db.prepare('SELECT column_name FROM table_meta WHERE table_name = ? ORDER BY sort_order').all('students');
    const stmt = db.prepare('UPDATE table_meta SET sort_order = ? WHERE table_name = ? AND column_name = ?');
    remaining.forEach((m, i) => stmt.run(i + 1, 'students', m.column_name));

    res.json({ message: `字段 ${columnName} 已删除` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 行排序 POST /students/reorder
router.post('/reorder', (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });

    const stmt = db.prepare('UPDATE students SET position = ? WHERE id = ?');
    ids.forEach((id, index) => stmt.run(index + 1, id));
    res.json({ message: '顺序更新成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移动列 POST /students/move-column
router.post('/move-column', (req, res) => {
  try {
    const { columnName, targetColumnName, position } = req.body;
    if (!columnName || columnName === 'id' || columnName === 'position') {
      return res.status(400).json({ error: '列名不合法或为保留字段' });
    }
    if (position === 'after' && (targetColumnName === columnName || !targetColumnName)) {
      return res.status(400).json({ error: '无效的目标列' });
    }

    const metas = db.prepare('SELECT column_name, sort_order FROM table_meta WHERE table_name = ? ORDER BY sort_order').all('students');
    const col = metas.find(m => m.column_name === columnName);
    if (!col) return res.status(400).json({ error: '列不存在' });

    const target = position === 'first' ? null : metas.find(m => m.column_name === targetColumnName);
    if (position === 'after' && !target) return res.status(400).json({ error: '目标列不存在' });

    // 重新分配所有列的 sort_order
    const withoutMoved = metas.filter(m => m.column_name !== columnName);
    let newOrder = [...withoutMoved];
    if (position === 'first') {
      newOrder.unshift(col);
    } else {
      const targetIdx = newOrder.findIndex(m => m.column_name === targetColumnName);
      newOrder.splice(targetIdx + 1, 0, col);
    }

    const stmt = db.prepare('UPDATE table_meta SET sort_order = ? WHERE table_name = ? AND column_name = ?');
    newOrder.forEach((m, i) => stmt.run(i + 1, 'students', m.column_name));
    res.json({ message: '列顺序已更新' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;