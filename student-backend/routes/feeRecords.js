const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { mapType } = require('../utils');

// Multer 配置
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'uploads/'); },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// GET /fee-records
router.get('/', (req, res) => {
  db.query('SELECT * FROM fee_records ORDER BY position ASC', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    db.query('SHOW COLUMNS FROM fee_records', (err2, columns) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const fields = columns.map(c => ({ name: c.Field, type: mapType(c.Type) }));
      fields.forEach(f => {
        if (f.name === '收支金额') f.type = '小数';
        if (f.name === '收支时间') f.type = '日期';
      });
      res.json({ data: results, fields });
    });
  });
});

// POST /fee-records
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

  db.query('SELECT MAX(position) AS maxPos FROM fee_records', (err, result) => {
    let nextPos = (result[0].maxPos || 0) + 1;
    const insertPos = (atPosition && atPosition <= result[0].maxPos) ? atPosition : nextPos;

    if (atPosition && atPosition <= result[0].maxPos) {
      db.query('UPDATE fee_records SET position = position + 1 WHERE position >= ?', [atPosition], err => {
        if (err) return res.status(500).json({ error: err.message });
        insertRecord(insertPos);
      });
    } else {
      insertRecord(nextPos);
    }

    function insertRecord(pos) {
      cleaned.position = pos;
      const columns = Object.keys(cleaned).map(k => `\`${k}\``).join(', ');
      const placeholders = Object.keys(cleaned).map(() => '?').join(', ');
      const values = Object.values(cleaned);
      db.query(`INSERT INTO fee_records (${columns}) VALUES (${placeholders})`, values, (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: result.insertId, message: '添加成功' });
      });
    }
  });
});

// PUT /fee-records/:id
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

  db.query(`UPDATE fee_records SET ${setClause} WHERE id = ?`, values, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '修改成功' });
  });
});

// DELETE /fee-records/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  db.query('SELECT COUNT(*) AS count FROM fee_records', (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result[0].count <= 1) return res.status(400).json({ error: '至少需要保留一条班费记录' });

    db.query('SELECT position FROM fee_records WHERE id = ?', [id], (err, result2) => {
      if (err || result2.length === 0) return res.status(404).json({ error: '记录不存在' });
      const deletedPos = result2[0].position;

      db.query('DELETE FROM fee_records WHERE id = ?', [id], err => {
        if (err) return res.status(500).json({ error: err.message });
        db.query('UPDATE fee_records SET position = position - 1 WHERE position > ?', [deletedPos], err => {
          if (err) console.error('调整 position 失败:', err);
          res.json({ message: '删除成功' });
        });
      });
    });
  });
});

// 移动行 POST /fee-records/move
router.post('/move', (req, res) => {
  const { id, direction } = req.body;
  if (!id || !direction) return res.status(400).json({ error: '缺少参数' });

  db.query('SELECT position FROM fee_records WHERE id = ?', [id], (err, result) => {
    if (err || result.length === 0) return res.status(404).json({ error: '记录不存在' });
    const currentPos = result[0].position;

    let targetPos;
    if (direction === 'up') targetPos = currentPos - 1;
    else if (direction === 'down') targetPos = currentPos + 1;
    else return res.status(400).json({ error: '无效方向' });

    if (direction === 'up' && targetPos < 1) return res.status(400).json({ error: '已是第一个，无法上移' });

    db.query('SELECT MAX(position) AS maxPos FROM fee_records', (err2, maxRes) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const maxPos = maxRes[0].maxPos || 0;
      if (direction === 'down' && targetPos > maxPos) return res.status(400).json({ error: '已是最后一个，无法下移' });

      db.query('SELECT id FROM fee_records WHERE position = ?', [targetPos], (err3, result2) => {
        if (err3) return res.status(500).json({ error: err3.message });
        if (result2.length === 0) return res.status(400).json({ error: '无法移动（目标位置异常）' });

        const targetId = result2[0].id;
        db.query(
          `UPDATE fee_records SET position = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? END WHERE id IN (?, ?)`,
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

// 动态添加列 POST /fee-records/add-column
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

  const addSql = `ALTER TABLE fee_records ADD COLUMN \`${columnName}\` ${sqlType}`;
  db.query(addSql, err => {
    if (err) {
      if (err.code === 'ER_DUP_FIELDNAME') return res.status(400).json({ error: '该字段已存在' });
      return res.status(500).json({ error: err.message });
    }

    if (after && after !== 'last') {
      let positionSql;
      if (after === 'first') positionSql = `ALTER TABLE fee_records MODIFY COLUMN \`${columnName}\` ${sqlType} FIRST`;
      else positionSql = `ALTER TABLE fee_records MODIFY COLUMN \`${columnName}\` ${sqlType} AFTER \`${after}\``;
      db.query(positionSql, err2 => {
        if (err2) console.error('调整列顺序失败:', err2);
        res.json({ message: `字段 ${columnName} 添加成功` });
      });
    } else {
      res.json({ message: `字段 ${columnName} 添加成功` });
    }
  });
});

// 删除列 DELETE /fee-records/columns/:columnName
router.delete('/columns/:columnName', (req, res) => {
  const { columnName } = req.params;
  if (columnName === 'id' || columnName === 'position') return res.status(400).json({ error: '不能删除保留字段' });

  db.query("SHOW COLUMNS FROM fee_records", (err, columns) => {
    if (err) return res.status(500).json({ error: err.message });
    const deletable = columns.filter(c => c.Field !== 'id' && c.Field !== 'position');
    if (deletable.length <= 1) return res.status(400).json({ error: '至少需要保留一个数据字段' });

    db.query(`ALTER TABLE fee_records DROP COLUMN \`${columnName}\``, err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: `字段 ${columnName} 已删除` });
    });
  });
});

// 上传收据图片 POST /fee-records/upload-receipt
router.post('/upload-receipt', upload.array('receipts', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '没有上传文件' });
  }
  const urls = req.files.map(file => `/uploads/${file.filename}`);
  res.json({ urls });
});

router.post('/reorder', (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });
  let caseWhen = '';
  const params = [];
  ids.forEach((id, index) => {
    caseWhen += ' WHEN ? THEN ? ';
    params.push(id, index + 1);
  });
  const sql = `UPDATE fee_records SET position = CASE id ${caseWhen} END WHERE id IN (${ids.map(() => '?').join(',')})`;
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
  const tableName = 'fee_records'; // 如果是班费，这里改为 fee_records
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