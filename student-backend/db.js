const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '20060310',   // 你的密码
  database: 'school'
});

module.exports = db;