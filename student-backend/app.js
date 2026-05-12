const express = require('express');
const path = require('path');
const cors = require('cors');

// 1. 引入数据库（这一行就会自动建库、建表、插入示例数据）
require('./db');               // 代替原来的 connect 和 init

// 2. 引入路由
const studentsRouter = require('./routes/students');
const feeRecordsRouter = require('./routes/feeRecords');

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 路由挂载
app.use('/students', studentsRouter);
app.use('/fee-records', feeRecordsRouter);
// 如果有前端打包文件也可以托管
app.use(express.static(path.join(__dirname, '../dist')));

// 启动服务器
app.listen(PORT, () => {
  console.log(`✅ 服务器已启动：http://localhost:${PORT}`);
});