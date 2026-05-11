const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { initializeDatabase } = require('./init');
const studentsRouter = require('./routes/students');
const feeRecordsRouter = require('./routes/feeRecords');

const app = express();
app.use(cors());
app.use(express.json());

// 静态文件服务
app.use('/uploads', express.static('uploads'));

// 挂载路由
app.use('/students', studentsRouter);
app.use('/fee-records', feeRecordsRouter);

const PORT = 3000;

initializeDatabase(() => {
  // 尝试使用 HTTPS，如果证书不存在则降级为 HTTP
  try {
    const options = {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem')
    };
    https.createServer(options, app).listen(PORT, () => {
      console.log(`🚀 后端服务运行在 https://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('未找到证书，降级为 HTTP');
    app.listen(PORT, () => {
      console.log(`🚀 后端服务运行在 http://localhost:${PORT}`);
    });
  }
});