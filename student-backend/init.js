// init.js
const db = require('./db');

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
        \`年级\` VARCHAR(20),
        \`班级\` VARCHAR(20),
        \`姓名\` VARCHAR(50) NOT NULL,
        \`年龄\` INT,
        \`备注\` VARCHAR(200),
        \`position\` INT DEFAULT 0
      )
    `;
    db.query(createStudentTableSQL, err => {
      if (err) return console.error('建 students 表失败: ', err);
      console.log('📋 students 表已就绪');

      // 处理示例数据和 position 列
      db.query('SELECT COUNT(*) AS count FROM students', (err, result) => {
        if (!err && result[0].count === 0) {
          const insertSQL = "INSERT INTO students (\`学号\`, \`年级\`, \`班级\`, \`姓名\`, \`年龄\`, \`备注\`, \`position\`) VALUES ('2024001', '大三', '计算机1班', '张三', 20, '班长', 1)";
          db.query(insertSQL, err2 => {
            if (err2) console.error('插入示例学生失败: ', err2);
            else console.log('✅ 已插入示例数据：张三');
          });
        }
        // 确保 position 列存在并编号
        ensurePositionColumn('students', () => {
          // ---------- 创建 fee_records 表 ----------
          const createFeeTableSQL = `
            CREATE TABLE IF NOT EXISTS fee_records (
              id INT AUTO_INCREMENT PRIMARY KEY,
              \`收支编码\` VARCHAR(50),
              \`收支类型\` VARCHAR(10),
              \`收支金额\` DECIMAL(10,2),
              \`收支时间\` DATE,
              \`备注\` VARCHAR(200),
              \`收据\` TEXT,
              \`position\` INT DEFAULT 0
            )
          `;
          db.query(createFeeTableSQL, err => {
            if (err) return console.error('建 fee_records 表失败: ', err);
            console.log('📋 fee_records 表已就绪');
            db.query('SELECT COUNT(*) AS count FROM fee_records', (err, result) => {
              if (!err && result[0].count === 0) {
                const insertFeeSQL = "INSERT INTO fee_records (`收支编码`, `收支类型`, `收支金额`, `收支时间`, `备注`, `收据`, `position`) VALUES ('SZ-2024001', '收入', 500.00, '2024-01-15', '班费收缴', '[]', 1)";
                db.query(insertFeeSQL, err2 => {
                  if (err2) console.error('插入示例班费记录失败: ', err2);
                  else console.log('✅ 已插入示例班费记录');
                });
              }
              ensurePositionColumn('fee_records', callback);
            });
          });
        });
      });
    });
  });
}

// 辅助函数：确保某表有 position 列并重新编号
function ensurePositionColumn(tableName, callback) {
  db.query(`SHOW COLUMNS FROM ${tableName} LIKE 'position'`, (err, result) => {
    if (result.length === 0) {
      db.query(`ALTER TABLE ${tableName} ADD COLUMN position INT DEFAULT 0`, err => {
        if (err) console.error(`添加 ${tableName}.position 失败`);
        renumberPosition(tableName, callback);
      });
    } else {
      renumberPosition(tableName, callback);
    }
  });
}

function renumberPosition(tableName, callback) {
  db.query('SET @rownum = 0');
  db.query(`UPDATE ${tableName} SET position = (@rownum := @rownum + 1) ORDER BY id`, err => {
    if (err) console.error(`重新编号 ${tableName}.position 失败:`, err);
    else console.log(`✅ ${tableName}.position 已重新编号`);
    if (callback) callback();
  });
}

module.exports = { initializeDatabase, ensurePositionColumn, renumberPosition };