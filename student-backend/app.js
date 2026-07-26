const express = require('express');
const path = require('path');
const cors = require('cors');

require('./db');

const studentsRouter = require('./routes/students');
const feeRecordsRouter = require('./routes/feeRecords');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');   
const scheduleRouter = require('./routes/schedule');
const seatsRouter = require('./routes/seats');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 所有路由挂载到 /api 下
app.use('/api', authRoutes);                // 例如 /api/login
app.use('/api/account', accountRoutes);
app.use('/api/students', studentsRouter);
app.use('/api/fee-records', feeRecordsRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/seats', seatsRouter);

// 托管前端静态文件（生产模式用）
app.use(express.static(path.join(__dirname, '../dist')));

app.listen(PORT, () => {
  console.log(`✅ 服务器已启动：http://localhost:${PORT}`);
});