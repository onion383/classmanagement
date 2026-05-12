const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { db, getFields, renumber } = require('../db');

// Multer 配置（不变）
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// GET /fee-records
router.get('/', (req, res) => {
  try {
    const results = db.prepare('SELECT * FROM fee_records ORDER BY position ASC').all();
    let fields = getFields('fee_records');
    if (fields.length === 0 && results.length > 0) {
      fields = Object.keys(results[0]).filter(k => k !== 'id' && k !== 'position').map(k => ({ name: k, type: '文字' }));
    }
    // 修正显示类型（金额→小数，时间→日期）
    fields.forEach(f => {
      if (f.name === '收支金额') f.type = '小数';
      if (f.name === '收支时间') f.type = '日期';
    });
    res.json({ data: results, fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /fee-records
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

    const maxPos = db.prepare('SELECT MAX(position) AS maxPos FROM fee_records').get().maxPos || 0;
    let insertPos;
    if (atPosition && atPosition <= maxPos) {
      insertPos = atPosition;
      db.prepare('UPDATE fee_records SET position = position + 1 WHERE position >= ?').run(atPosition);
    } else {
      insertPos = maxPos + 1;
    }

    cleaned.position = insertPos;
    const columns = Object.keys(cleaned).map(c => `"${c}"`).join(',');
    const placeholders = Object.keys(cleaned).map(() => '?').join(',');
    const values = Object.values(cleaned);

    const result = db.prepare(`INSERT INTO fee_records (${columns}) VALUES (${placeholders})`).run(...values);
    renumber('fee_records');
    res.json({ id: result.lastInsertRowid, message: '添加成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /fee-records/:id
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

    db.prepare(`UPDATE fee_records SET ${setClause} WHERE id = ?`).run(...values);
    res.json({ message: '修改成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /fee-records/:id
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const count = db.prepare('SELECT COUNT(*) AS count FROM fee_records').get().count;
    if (count <= 1) return res.status(400).json({ error: '至少需要保留一条班费记录' });

    const row = db.prepare('SELECT position FROM fee_records WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });

    db.prepare('DELETE FROM fee_records WHERE id = ?').run(id);
    db.prepare('UPDATE fee_records SET position = position - 1 WHERE position > ?').run(row.position);
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移动行 POST /fee-records/move
router.post('/move', (req, res) => {
  try {
    const { id, direction } = req.body;
    if (!id || !direction) return res.status(400).json({ error: '缺少参数' });

    const row = db.prepare('SELECT position FROM fee_records WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });

    const cur = row.position;
    const maxPos = db.prepare('SELECT MAX(position) AS maxPos FROM fee_records').get().maxPos;
    let target;
    if (direction === 'up') target = cur - 1;
    else if (direction === 'down') target = cur + 1;
    else return res.status(400).json({ error: '无效方向' });

    if (target < 1 || target > maxPos) return res.status(400).json({ error: '已到边界' });

    const targetRow = db.prepare('SELECT id FROM fee_records WHERE position = ?').get(target);
    if (!targetRow) return res.status(400).json({ error: '目标行异常' });

    db.prepare(`UPDATE fee_records SET position = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? END WHERE id IN (?, ?)`)
      .run(id, target, targetRow.id, cur, id, targetRow.id);
    res.json({ message: '移动成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 动态添加列 POST /fee-records/add-column
router.post('/add-column', (req, res) => {
  try {
    const { columnName, dataType, after } = req.body;
    if (!columnName || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(columnName)) return res.status(400).json({ error: '列名不合法' });
    if (columnName === 'id' || columnName === 'position') return res.status(400).json({ error: '不能使用保留字段' });

    let sqlType = 'TEXT';
    if (dataType === '整数') sqlType = 'INTEGER';
    else if (dataType === '小数') sqlType = 'REAL';
    else if (dataType === '日期') sqlType = 'TEXT';

    db.prepare(`ALTER TABLE fee_records ADD COLUMN "${columnName}" ${sqlType}`).run();

    const metas = db.prepare('SELECT column_name, sort_order FROM table_meta WHERE table_name = ? ORDER BY sort_order').all('fee_records');
    let sortOrder;
    if (after === 'first' || !after) {
      sortOrder = 1;
      db.prepare('UPDATE table_meta SET sort_order = sort_order + 1 WHERE table_name = ?').run('fee_records');
    } else {
      const targetMeta = metas.find(m => m.column_name === after);
      if (!targetMeta) return res.status(400).json({ error: '目标列不存在' });
      sortOrder = targetMeta.sort_order + 1;
      db.prepare('UPDATE table_meta SET sort_order = sort_order + 1 WHERE table_name = ? AND sort_order >= ?').run('fee_records', sortOrder);
    }

    db.prepare('INSERT INTO table_meta (table_name, column_name, data_type, sort_order) VALUES (?, ?, ?, ?)')
      .run('fee_records', columnName, dataType || '文字', sortOrder);
    res.json({ message: `字段 ${columnName} 添加成功` });
  } catch (err) {
    if (err.message.includes('duplicate column name')) return res.status(400).json({ error: '该字段已存在' });
    res.status(500).json({ error: err.message });
  }
});

// 删除列 DELETE /fee-records/columns/:columnName
router.delete('/columns/:columnName', (req, res) => {
  const { columnName } = req.params;
  if (columnName === 'id' || columnName === 'position') return res.status(400).json({ error: '不能删除保留字段' });

  try {
    const deletable = db.prepare('SELECT COUNT(*) AS cnt FROM table_meta WHERE table_name = ?').get('fee_records').cnt;
    if (deletable <= 1) return res.status(400).json({ error: '至少需要保留一个数据字段' });

    db.prepare('DELETE FROM table_meta WHERE table_name = ? AND column_name = ?').run('fee_records', columnName);
    const remaining = db.prepare('SELECT column_name FROM table_meta WHERE table_name = ? ORDER BY sort_order').all('fee_records');
    const stmt = db.prepare('UPDATE table_meta SET sort_order = ? WHERE table_name = ? AND column_name = ?');
    remaining.forEach((m, i) => stmt.run(i + 1, 'fee_records', m.column_name));

    res.json({ message: `字段 ${columnName} 已删除` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 上传收据（不变）
router.post('/upload-receipt', upload.array('receipts', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '没有上传文件' });
  }
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

// 行排序
router.post('/reorder', (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });

    const stmt = db.prepare('UPDATE fee_records SET position = ? WHERE id = ?');
    ids.forEach((id, index) => stmt.run(index + 1, id));
    res.json({ message: '顺序更新成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移动列
router.post('/move-column', (req, res) => {
  try {
    const { columnName, targetColumnName, position } = req.body;
    if (!columnName || columnName === 'id' || columnName === 'position') {
      return res.status(400).json({ error: '列名不合法或为保留字段' });
    }
    if (position === 'after' && (targetColumnName === columnName || !targetColumnName)) {
      return res.status(400).json({ error: '无效的目标列' });
    }

    const metas = db.prepare('SELECT column_name, sort_order FROM table_meta WHERE table_name = ? ORDER BY sort_order').all('fee_records');
    const col = metas.find(m => m.column_name === columnName);
    if (!col) return res.status(400).json({ error: '列不存在' });

    const target = position === 'first' ? null : metas.find(m => m.column_name === targetColumnName);
    if (position === 'after' && !target) return res.status(400).json({ error: '目标列不存在' });

    const withoutMoved = metas.filter(m => m.column_name !== columnName);
    let newOrder = [...withoutMoved];
    if (position === 'first') {
      newOrder.unshift(col);
    } else {
      const targetIdx = newOrder.findIndex(m => m.column_name === targetColumnName);
      newOrder.splice(targetIdx + 1, 0, col);
    }

    const stmt = db.prepare('UPDATE table_meta SET sort_order = ? WHERE table_name = ? AND column_name = ?');
    newOrder.forEach((m, i) => stmt.run(i + 1, 'fee_records', m.column_name));
    res.json({ message: '列顺序已更新' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;