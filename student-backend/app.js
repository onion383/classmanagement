const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { auth } = require('./middleware/auth');
const { createDynamicTableRouter } = require('./routes/dynamicTable');

require('./db');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const scheduleRouter = require('./routes/schedule');
const seatsRouter = require('./routes/seats');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer 配置（供上传收据使用）
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ===================== 动态表路由（通用 CRUD） =====================
app.use('/api/students', auth(['teacher']), createDynamicTableRouter('students', {
  minCount: 1,
  protectedColumns: ['学号', '姓名']
}));

app.use('/api/fee-records', auth(['teacher']), createDynamicTableRouter('fee_records', {
  minCount: 1,
  fieldTypeOverrides: { '收支金额': '小数', '收支时间': '日期' },
  extraRoutes: (router) => {
    router.post('/upload-receipt', upload.array('receipts', 10), (req, res) => {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: '没有上传文件' });
      }
      const urls = req.files.map(f => `/uploads/${f.filename}`);
      res.json({ urls });
    });
  }
}));

// ===================== 独立路由 =====================
app.use('/api', authRoutes);
app.use('/api/account', auth(), accountRoutes);
app.use('/api/schedule', auth(['teacher']), scheduleRouter);
app.use('/api/seats', auth(['teacher']), seatsRouter);

// 托管前端静态文件（生产模式用）
app.use(express.static(path.join(__dirname, '../dist')));

app.listen(PORT, () => {
  console.log(`✅ 服务器已启动：http://localhost:${PORT}`);
});