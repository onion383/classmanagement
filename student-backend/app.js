const express = require('express');
const path = require('path');
const cors = require('cors');

require('./db');

const studentsRouter = require('./routes/students');
const feeRecordsRouter = require('./routes/feeRecords');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');   
const scheduleRouter = require('./routes/schedule');

const app = express();
const PORT = 3000;

// 1. 中间件
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 2. 路由
app.use('/', authRoutes);              // 登录
app.use('/account', accountRoutes);    // 账号管理（修改密码）
app.use('/students', studentsRouter);
app.use('/fee-records', feeRecordsRouter);
app.use('/schedule', scheduleRouter);

// 3. 托管前端（可选）
app.use(express.static(path.join(__dirname, '../dist')));

app.listen(PORT, () => {
  console.log(`✅ 服务器已启动：http://localhost:${PORT}`);
});