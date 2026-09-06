const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const { auth, authStatic } = require('./middleware/auth');
const { createDynamicTableRouter } = require('./routes/dynamicTable');

// 图片魔数签名校验：mimetype/扩展名可被伪造，只有文件真实字节的「魔数」才可信。
// jpg/png/gif/bmp/webp 各自的开头字节签名；命中任一即视为真实图片。
const IMAGE_SIGNATURES = [
  [0xff, 0xd8, 0xff],                                        // jpeg
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],         // png
  [0x47, 0x49, 0x46, 0x38],                                  // gif ('GIF8')
  [0x42, 0x4d],                                              // bmp ('BM')
  [0x52, 0x49, 0x46, 0x46],                                  // webp ('RIFF...WEBP')
];
function hasImageSignature(filePath) {
  let buf;
  try {
    const fd = fs.openSync(filePath, 'r');
    buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
  } catch (_) { return false; }
  for (const sig of IMAGE_SIGNATURES) {
    if (buf.length >= sig.length && sig.every((b, i) => buf[i] === b)) return true;
  }
  return false;
}

require('./db');
const dbManager = require('./dbManager');
const secureChannel = require('./services/secureChannel');

// 关键路由：启动时立即加载（登录必需）
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');

const app = express();
const PORT = 3000;

app.use(cors());
// Host 校验：仅接受本机回环地址的请求，阻断「任意网页/DNS rebinding 探测 localhost API」。
// 本服务是本地单用户后端，且 Token 可通过 Header/Cookie/Query 携带，
// 恶意网页即使跨域发来请求，其 Host 头也不是 localhost，故一律拒绝。
app.use((req, res, next) => {
  const host = String(req.get('host') || '').replace(/:\d+$/, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return next();
  return res.status(403).json({ error: '非法访问' });
});
// 备份包内含整库 base64 数据，体积可能达数十 MB，需放大请求体上限以避免 413
app.use(express.json({ limit: '200mb' }));

// 加密通道中间件：请求解密优先于路由处理，响应加密在 express.json 之后
// 仅当有 K_master（SECURE_MASTER 注入）时才真正安装，否则不影响明文请求
if (secureChannel.hasMaster()) {
  app.use(secureChannel.requestDecrypt);
  app.use(secureChannel.responseEncrypt);
  // 握手端点：前置公开，不要求认证
  const secureRouter = express.Router();
  secureRouter.post('/handshake', (req, res) => {
    try {
      const { pub } = req.body;
      if (!pub || typeof pub !== 'string') {
        return res.status(400).json({ error: 'bad request' });
      }
      const result = secureChannel.performHandshake(pub);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });
  app.use('/api/secure', secureRouter);
  console.log('[secure] 安全通道已启用（K_master 注入），加密传输生效');
} else {
  console.log('[secure] 安全通道未注入密钥，保持明文传输（兼容默认环境）');
}

// 静态图片资源鉴权：收据、背景图均需登录（Cookie/Header 校验），避免敏感文件被未授权访问
// 目录统一指向 DATA_DIR/uploads（可写，打包后位于 userData，不在只读 asar 内）
app.use('/uploads', authStatic(), express.static(dbManager.uploadsDir));
app.use('/api/background', authStatic(), express.static(dbManager.backgroundDir));

// ===================== 关键路由（登录页必需） =====================
app.use('/api', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/students', auth(['teacher']), createDynamicTableRouter('students', {
  minCount: 1,
  protectedColumns: ['学号', '姓名']
}));

// 托管前端静态文件（生产模式用）
app.use(express.static(path.join(__dirname, '../dist')));

// ===================== 启动服务器 =====================
// 端口冲突时自动重试（应用退出后旧进程可能未完全释放端口）
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`✅ 服务器已启动：http://localhost:${port}`);

    // 就绪信号后立即后台暖机：把「require sqlite 原生模块 + 打开 index/default 库并 initSchema」
    // 的一次性冷启动成本放到首个用户请求到达前悄悄完成，避免登录/首屏请求干等 cold start 而转圈。
    // 暖机失败静默，后续请求照常懒加载兜底，不影响功能。
    setImmediate(() => {
      try { dbManager.warmup(); } catch (_) { /* 暖机失败不影响正常懒加载路径 */ }
    });

    // 非关键路由懒加载：服务器就绪后再逐个注册，不阻塞就绪信号。
    // 每个路由的 require() 在 setImmediate 回调中执行，分散到不同事件循环 tick，
    // 避免启动时加载大量 JS 文件与 .node 原生模块（如 album 的 sharp、ai 的 pdf-parse 等）。
    // 用户登录后导航到对应页面时，路由早已注册完毕，无感知。
    const deferredLoaders = [
      () => { app.use('/api/schedule', auth(['teacher']), require('./routes/schedule')); },
      () => { app.use('/api/seats', auth(['teacher']), require('./routes/seats')); },
      () => { app.use('/api/leaves', auth(['teacher']), require('./routes/leaves')); },
      () => { app.use('/api/album', auth(['teacher']), require('./routes/album')); },
      () => { app.use('/api/group-manage', auth(['teacher']), require('./routes/groupManage')); },
      () => { app.use('/api/scores', auth(['teacher']), require('./routes/scores')); },
      () => { app.use('/api/duty', auth(['teacher']), require('./routes/duty')); },
      () => { app.use('/api/widget-settings', auth(['teacher']), require('./routes/widgetSettings')); },
      () => { app.use('/api/undo', auth(['teacher']), require('./routes/undo')); },
      () => { app.use('/api/activities', auth(['teacher']), require('./routes/activities')); },
      () => { app.use('/api/countdowns', auth(['teacher']), require('./routes/countdowns')); },
      () => { app.use('/api/cadres', auth(['teacher']), require('./routes/cadres')); },
      () => { app.use('/api/ai', auth(['teacher']), require('./routes/ai')); },
      // fee-records 含 multer（文件上传处理），一起延迟加载
      () => {
        const multer = require('multer');
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
        app.use('/api/fee-records', auth(['teacher']), createDynamicTableRouter('fee_records', {
          minCount: 1,
          fieldTypeOverrides: { '收支金额': '小数', '收支时间': '日期' },
          extraRoutes: (router) => {
            router.post('/upload-receipt', upload.array('receipts', 10), (req, res) => {
              if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: '没有上传文件' });
              }
              // 魔数校验：逐个读取真实字节，伪装成图片的非图片文件一律清理并拒绝
              const bad = req.files.filter(f => !hasImageSignature(f.path));
              if (bad.length > 0) {
                bad.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
                return res.status(400).json({ error: '文件内容不是有效图片' });
              }
              const urls = req.files.map(f => `/uploads/${f.filename}`);
              res.json({ urls });
            }, (err, req, res, next) => {
              // 处理文件类型/大小被 multer 拒绝的情况（fileFilter/limits）
              res.status(400).json({ error: err && err.message ? err.message : '图片上传失败' });
            });
          }
        }));
      },
    ];

    // 逐个注册，每个 defer 到下一个事件循环 tick
    for (const loader of deferredLoaders) {
      setImmediate(loader);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`端口 ${port} 被占用，等待 1s 后重试...`);
      setTimeout(() => server.close(() => startServer(port)), 1000);
    } else {
      console.error('服务器启动失败:', err);
      process.exit(1);
    }
  });

  // 优雅退出：收到 SIGTERM 时关闭服务器
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

startServer(PORT);