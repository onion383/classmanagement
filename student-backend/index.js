const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '20060310',      // ⚠️ 改成你自己的密码
  database: 'school'
});

// ---------- 初始化（自动建表、处理 position 列、插入示例）----------
function initializeDatabase(callback) {
  db.connect(err => {
    if (err) {
      console.error('数据库连接失败: ', err);
      return;
    }
    console.log('✅ 数据库连接成功');

    // ---------- 创建 students 表 ----------
    const createStudentTableSQL = `
      CREATE TABLE IF NOT EXISTS students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`学号\` VARCHAR(20),
        \`姓名\` VARCHAR(50) NOT NULL,
        \`性别\` VARCHAR(10),
        \`年龄\` INT,
        \`年级\` VARCHAR(20),
        \`备注\` VARCHAR(200),
        \`position\` INT DEFAULT 0
      )
    `;
    db.query(createStudentTableSQL, err => {
      if (err) {
        console.error('建 students 表失败: ', err);
        return;
      }
      console.log('📋 students 表已就绪');

      // 检查 students 表中是否有数据
      db.query('SELECT COUNT(*) AS count FROM students', (err, result) => {
        if (err) return;

        if (result[0].count === 0) {
          // 插入示例学生数据
          const insertSQL = "INSERT INTO students (\`学号\`, \`姓名\`, \`性别\`, \`年龄\`, \`年级\`, \`备注\`, \`position\`) VALUES ('2024001', '张三', '男', 20, '大三', '班长', 1)";
          db.query(insertSQL, err2 => {
            if (err2) console.error('插入示例学生失败: ', err2);
            else console.log('✅ 已插入示例数据：张三');
          });
        }

        // 确保 students 的 position 列存在并重新编号
        db.query("SHOW COLUMNS FROM students LIKE 'position'", (err3, res3) => {
          const ensureStudentPosition = () => {
            db.query("SET @rownum = 0");
            db.query("UPDATE students SET position = (@rownum := @rownum + 1) ORDER BY id", (err4) => {
              if (err4) console.error('重新编号学生 position 失败:', err4);
              else console.log('✅ 学生 position 已重新编号');
            });
          };

          if (res3.length === 0) {
            db.query("ALTER TABLE students ADD COLUMN `position` INT DEFAULT 0", () => {
              ensureStudentPosition();
            });
          } else {
            ensureStudentPosition();
          }
        });
      });

      // ---------- 创建 fee_records 表 ----------
      const createFeeTableSQL = `
        CREATE TABLE IF NOT EXISTS fee_records (
          id INT AUTO_INCREMENT PRIMARY KEY,
          \`收支编码\` VARCHAR(50),
          \`收支类型\` VARCHAR(10),
          \`收支金额\` DECIMAL(10,2),
          \`收支时间\` DATE,
          \`备注\` VARCHAR(200),
          \`收据\` VARCHAR(500),
          \`position\` INT DEFAULT 0
        )
      `;
      db.query(createFeeTableSQL, err => {
        if (err) {
          console.error('建 fee_records 表失败: ', err);
          return;
        }
        console.log('📋 fee_records 表已就绪');

        // 检查 fee_records 表中是否有数据
        db.query('SELECT COUNT(*) AS count FROM fee_records', (err, result) => {
          if (err) return;

          if (result[0].count === 0) {
            // 插入示例班费记录
            const insertFeeSQL = "INSERT INTO fee_records (\`收支编码\`, \`收支类型\`, \`收支金额\`, \`收支时间\`, \`备注\`, \`收据\`, \`position\`) VALUES ('SZ-2024001', '收入', 500.00, '2024-01-15', '班费收缴', '', 1)";
            db.query(insertFeeSQL, err2 => {
              if (err2) console.error('插入示例班费记录失败: ', err2);
              else console.log('✅ 已插入示例班费记录');
            });
          }

          // 确保 fee_records 的 position 列存在并重新编号
          db.query("SHOW COLUMNS FROM fee_records LIKE 'position'", (err3, res3) => {
            const ensureFeePosition = () => {
              db.query("SET @rownum = 0");
              db.query("UPDATE fee_records SET position = (@rownum := @rownum + 1) ORDER BY id", (err4) => {
                if (err4) console.error('重新编号班费 position 失败:', err4);
                else console.log('✅ 班费 position 已重新编号');
              });
            };

            if (res3.length === 0) {
              db.query("ALTER TABLE fee_records ADD COLUMN `position` INT DEFAULT 0", () => {
                ensureFeePosition();
              });
            } else {
              ensureFeePosition();
            }
          });
        });

        // 所有初始化完成，启动服务器
        callback();
      });
    });
  });
}

// 类型映射
function mapType(sqlType) {
  const t = sqlType.toLowerCase();
  if (t.includes('int')) return '整数';
  if (t.includes('float') || t.includes('double') || t.includes('decimal')) return '小数';
  if (t.includes('date') || t.includes('time')) return '日期';
  return '文字';
}

// ==================== 接口 ====================

// 1. 获取所有学生（按 position 排序，返回字段类型）
app.get('/students', (req, res) => {
  db.query('SELECT * FROM students ORDER BY position ASC', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    db.query('SHOW COLUMNS FROM students', (err2, columns) => {
      let fields = [];
      if (err2 || !columns) {
        // 降级：从数据中推导字段
        fields = results.length > 0 ? Object.keys(results[0]).map(k => ({ name: k, type: '文字' })) : [];
      } else {
        fields = columns.map(c => ({ name: c.Field, type: mapType(c.Type) }));
      }
      res.json({ data: results, fields });
    });
  });
});

// 2. 添加学生（支持插入到指定位置 atPosition）
app.post('/students', (req, res) => {
  const data = req.body;
  const atPosition = data.atPosition;   // 可选参数：插入到哪个位置
  delete data.atPosition;

  const keys = Object.keys(data);
  if (keys.length === 0) return res.status(400).json({ error: '没有字段' });

  // 清理空值
  const cleaned = {};
  keys.forEach(k => {
    cleaned[k] = (data[k] === '' || data[k] === undefined) ? null : data[k];
  });

  // 获取当前最大的 position 值
  db.query('SELECT MAX(position) AS maxPos FROM students', (err, result) => {
    let nextPos = (result[0].maxPos || 0) + 1;
    // 如果指定了 atPosition 且有效（<= maxPos），则插入到该位置，同时将后续 position 后移
    const insertPos = (atPosition && atPosition <= result[0].maxPos) ? atPosition : nextPos;

    if (atPosition && atPosition <= result[0].maxPos) {
      // 把 >= 插入位置的所有行的 position 加 1
      db.query('UPDATE students SET position = position + 1 WHERE position >= ?', [atPosition], (err) => {
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

// 3. 修改学生
app.put('/students/:id', (req, res) => {
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

// 4. 删除学生（并保持 position 连续）
app.delete('/students/:id', (req, res) => {
  const { id } = req.params;

  // 检查总数，只剩一个时禁止删除
  db.query('SELECT COUNT(*) AS count FROM students', (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result[0].count <= 1) {
      return res.status(400).json({ error: '至少需要保留一个学生' });
    }

    // 原有删除逻辑
    db.query('SELECT position FROM students WHERE id = ?', [id], (err, result2) => {
      if (err || result2.length === 0) return res.status(404).json({ error: '学生不存在' });
      const deletedPos = result2[0].position;

      db.query('DELETE FROM students WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.query('UPDATE students SET position = position - 1 WHERE position > ?', [deletedPos], (err) => {
          if (err) console.error('调整 position 失败:', err);
          res.json({ message: '删除成功' });
        });
      });
    });
  });
});

// 5. 移动行（上移/下移）
app.post('/move-row', (req, res) => {
  const { id, direction } = req.body;
  if (!id || !direction) return res.status(400).json({ error: '缺少参数' });

  db.query('SELECT position FROM students WHERE id = ?', [id], (err, result) => {
    if (err || result.length === 0) return res.status(404).json({ error: '学生不存在' });
    const currentPos = result[0].position;

    let targetPos;
    if (direction === 'up') targetPos = currentPos - 1;
    else if (direction === 'down') targetPos = currentPos + 1;
    else return res.status(400).json({ error: '无效方向' });

    // 检查边界
    if (direction === 'up' && targetPos < 1) {
      return res.status(400).json({ error: '已是第一个，无法上移' });
    }

    db.query('SELECT MAX(position) AS maxPos FROM students', (err2, maxRes) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const maxPos = maxRes[0].maxPos || 0;
      if (direction === 'down' && targetPos > maxPos) {
        return res.status(400).json({ error: '已是最后一个，无法下移' });
      }

      // 查找目标行
      db.query('SELECT id FROM students WHERE position = ?', [targetPos], (err3, result2) => {
        if (err3) return res.status(500).json({ error: err3.message });
        if (result2.length === 0) {
          return res.status(400).json({ error: '无法移动（目标位置异常）' });
        }
        const targetId = result2[0].id;

        // 交换两个行的 position
        db.query(
          `UPDATE students SET position = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? END WHERE id IN (?, ?)`,
          [id, targetPos, targetId, currentPos, id, targetId],
          (err4) => {
            if (err4) return res.status(500).json({ error: err4.message });
            res.json({ message: '移动成功' });
          }
        );
      });
    });
  });
});

// 6. 动态添加列（支持指定位置）
app.post('/add-column', (req, res) => {
  const { columnName, dataType, after } = req.body;
  if (!columnName || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(columnName)) {
    return res.status(400).json({ error: '列名不合法' });
  }
  if (columnName === 'id' || columnName === 'position') return res.status(400).json({ error: '不能使用保留字段' });

  let sqlType;
  switch (dataType) {
    case '整数': sqlType = 'INT'; break;
    case '小数': sqlType = 'DOUBLE'; break;
    case '日期': sqlType = 'DATE'; break;
    default: sqlType = 'VARCHAR(100)';
  }

  const addSql = `ALTER TABLE students ADD COLUMN \`${columnName}\` ${sqlType}`;
  db.query(addSql, (err) => {
    if (err) {
      if (err.code === 'ER_DUP_FIELDNAME') return res.status(400).json({ error: '该字段已存在' });
      return res.status(500).json({ error: err.message });
    }

    // 移动到指定位置
    if (after && after !== 'last') {
      let positionSql;
      if (after === 'first') {
        positionSql = `ALTER TABLE students MODIFY COLUMN \`${columnName}\` ${sqlType} FIRST`;
      } else {
        positionSql = `ALTER TABLE students MODIFY COLUMN \`${columnName}\` ${sqlType} AFTER \`${after}\``;
      }
      db.query(positionSql, (err2) => {
        if (err2) console.error('调整列顺序失败:', err2);
        res.json({ message: `字段 ${columnName} 添加成功` });
      });
    } else {
      res.json({ message: `字段 ${columnName} 添加成功` });
    }
  });
});

// 7. 删除列
app.delete('/columns/:columnName', (req, res) => {
  const { columnName } = req.params;
  if (columnName === 'id' || columnName === 'position') {
    return res.status(400).json({ error: '不能删除保留字段' });
  }

  // 检查可删除的字段数量（排除 id 和 position）
  db.query("SHOW COLUMNS FROM students", (err, columns) => {
    if (err) return res.status(500).json({ error: err.message });
    const deletable = columns.filter(c => c.Field !== 'id' && c.Field !== 'position');
    if (deletable.length <= 1) {
      return res.status(400).json({ error: '至少需要保留一个数据字段' });
    }

    // 原有删除列逻辑
    const sql = `ALTER TABLE students DROP COLUMN \`${columnName}\``;
    db.query(sql, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: `字段 ${columnName} 已删除` });
    });
  });
});


// ---------- 班费记录接口 ----------

app.get('/fee-records', (req, res) => {
  db.query('SELECT * FROM fee_records ORDER BY position ASC', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    db.query('SHOW COLUMNS FROM fee_records', (err2, columns) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const fields = columns.map(c => ({ name: c.Field, type: mapType(c.Type) }));
      // 将金额字段类型标记为数字，方便前端校验
      fields.forEach(f => {
        if (f.name === '收支金额') f.type = '小数';
        if (f.name === '收支时间') f.type = '日期';
      });
      res.json({ data: results, fields });
    });
  });
});

app.post('/fee-records', (req, res) => {
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
      db.query('UPDATE fee_records SET position = position + 1 WHERE position >= ?', [atPosition], (err) => {
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




// 修改班费记录
app.put('/fee-records/:id', (req, res) => {
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

// 删除班费记录（至少保留一条）
app.delete('/fee-records/:id', (req, res) => {
  const { id } = req.params;

  db.query('SELECT COUNT(*) AS count FROM fee_records', (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result[0].count <= 1) {
      return res.status(400).json({ error: '至少需要保留一条班费记录' });
    }

    db.query('SELECT position FROM fee_records WHERE id = ?', [id], (err, result2) => {
      if (err || result2.length === 0) return res.status(404).json({ error: '记录不存在' });
      const deletedPos = result2[0].position;

      db.query('DELETE FROM fee_records WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.query('UPDATE fee_records SET position = position - 1 WHERE position > ?', [deletedPos], (err) => {
          if (err) console.error('调整 position 失败:', err);
          res.json({ message: '删除成功' });
        });
      });
    });
  });
});

// 移动班费行
app.post('/fee-records/move', (req, res) => {
  const { id, direction } = req.body;
  if (!id || !direction) return res.status(400).json({ error: '缺少参数' });

  db.query('SELECT position FROM fee_records WHERE id = ?', [id], (err, result) => {
    if (err || result.length === 0) return res.status(404).json({ error: '记录不存在' });
    const currentPos = result[0].position;

    let targetPos;
    if (direction === 'up') targetPos = currentPos - 1;
    else if (direction === 'down') targetPos = currentPos + 1;
    else return res.status(400).json({ error: '无效方向' });

    if (direction === 'up' && targetPos < 1) {
      return res.status(400).json({ error: '已是第一个，无法上移' });
    }

    db.query('SELECT MAX(position) AS maxPos FROM fee_records', (err2, maxRes) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const maxPos = maxRes[0].maxPos || 0;
      if (direction === 'down' && targetPos > maxPos) {
        return res.status(400).json({ error: '已是最后一个，无法下移' });
      }

      db.query('SELECT id FROM fee_records WHERE position = ?', [targetPos], (err3, result2) => {
        if (err3) return res.status(500).json({ error: err3.message });
        if (result2.length === 0) return res.status(400).json({ error: '无法移动（目标位置异常）' });

        const targetId = result2[0].id;
        db.query(
          `UPDATE fee_records SET position = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? END WHERE id IN (?, ?)`,
          [id, targetPos, targetId, currentPos, id, targetId],
          (err4) => {
            if (err4) return res.status(500).json({ error: err4.message });
            res.json({ message: '移动成功' });
          }
        );
      });
    });
  });
});

// 动态添加班费列
app.post('/fee-records/add-column', (req, res) => {
  const { columnName, dataType, after } = req.body;
  if (!columnName || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(columnName)) {
    return res.status(400).json({ error: '列名不合法' });
  }
  if (columnName === 'id' || columnName === 'position') return res.status(400).json({ error: '不能使用保留字段' });

  let sqlType;
  switch (dataType) {
    case '整数': sqlType = 'INT'; break;
    case '小数': sqlType = 'DOUBLE'; break;
    case '日期': sqlType = 'DATE'; break;
    default: sqlType = 'VARCHAR(100)';
  }

  db.query(`ALTER TABLE fee_records ADD COLUMN \`${columnName}\` ${sqlType}`, (err) => {
    if (err) {
      if (err.code === 'ER_DUP_FIELDNAME') return res.status(400).json({ error: '该字段已存在' });
      return res.status(500).json({ error: err.message });
    }

    if (after && after !== 'last') {
      let positionSql;
      if (after === 'first') {
        positionSql = `ALTER TABLE fee_records MODIFY COLUMN \`${columnName}\` ${sqlType} FIRST`;
      } else {
        positionSql = `ALTER TABLE fee_records MODIFY COLUMN \`${columnName}\` ${sqlType} AFTER \`${after}\``;
      }
      db.query(positionSql, (err2) => {
        if (err2) console.error('调整列顺序失败:', err2);
        res.json({ message: `字段 ${columnName} 添加成功` });
      });
    } else {
      res.json({ message: `字段 ${columnName} 添加成功` });
    }
  });
});

// 删除班费列
app.delete('/fee-records/columns/:columnName', (req, res) => {
  const { columnName } = req.params;
  if (columnName === 'id' || columnName === 'position') return res.status(400).json({ error: '不能删除保留字段' });

  db.query("SHOW COLUMNS FROM fee_records", (err, columns) => {
    if (err) return res.status(500).json({ error: err.message });
    const deletable = columns.filter(c => c.Field !== 'id' && c.Field !== 'position');
    if (deletable.length <= 1) {
      return res.status(400).json({ error: '至少需要保留一个数据字段' });
    }

    db.query(`ALTER TABLE fee_records DROP COLUMN \`${columnName}\``, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: `字段 ${columnName} 已删除` });
    });
  });
});

// ---------- 启动服务器 ----------
const PORT = 3000;
initializeDatabase(() => {
  app.listen(PORT, () => console.log(`🚀 后端服务运行在 http://localhost:${PORT}`));
});