const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { auth, authStatic } = require('./middleware/auth');
const { createDynamicTableRouter } = require('./routes/dynamicTable');

require('./db');
const dbManager = require('./dbManager');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const scheduleRouter = require('./routes/schedule');
const seatsRouter = require('./routes/seats');
const widgetSettingsRouter = require('./routes/widgetSettings');
const leavesRouter = require('./routes/leaves');
const albumRouter = require('./routes/album');

const app = express();
const PORT = 3000;

app.use(cors());
// 备份包内含整库 base64 数据，体积可能达数十 MB，需放大请求体上限以避免 413
app.use(express.json({ limit: '200mb' }));

// 静态图片资源鉴权：收据、背景图均需登录（Cookie/Header 校验），避免敏感文件被未授权访问
// 目录统一指向 DATA_DIR/uploads（可写，打包后位于 userData，不在只读 asar 内）
app.use('/uploads', authStatic(), express.static(dbManager.uploadsDir));
app.use('/api/background', authStatic(), express.static(dbManager.backgroundDir));

// Multer 配置（供上传收据使用）：仅允许图片，限制大小 10MB
const ALLOWED_EXT = /\.(jpg|jpeg|png|gif|webp|bmp)$/i;
const ALLOWED_MIME = /^image\/(jpeg|png|gif|webp|bmp)$/;
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dbManager.uploadsDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 单文件 10MB
  fileFilter: (req, file, cb) => {
    const ok = ALLOWED_MIME.test(file.mimetype) && ALLOWED_EXT.test(file.originalname);
    // 必须传第二个参数 includeFile（true=接受），否则 multer 视作拒绝并丢弃文件
    cb(ok ? null : new Error('仅支持图片文件（jpg/png/gif/webp/bmp），且大小不超过 10MB'), ok);
  }
});

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
    }, (err, req, res, next) => {
      // 处理文件类型/大小被 multer 拒绝的情况（fileFilter/limits）
      res.status(400).json({ error: err && err.message ? err.message : '图片上传失败' });
    });
  }
}));

// ===================== 独立路由 =====================
app.use('/api', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/schedule', auth(['teacher']), scheduleRouter);
app.use('/api/seats', auth(['teacher']), seatsRouter);
app.use('/api/leaves', auth(['teacher']), leavesRouter);
app.use('/api/album', auth(['teacher']), albumRouter);
app.use('/api/widget-settings', auth(['teacher']), widgetSettingsRouter);

// 托管前端静态文件（生产模式用）
app.use(express.static(path.join(__dirname, '../dist')));

app.listen(PORT, () => {
  console.log(`✅ 服务器已启动：http://localhost:${PORT}`);
});