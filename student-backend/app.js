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

const { db } = require('./db');
const dbManager = require('./dbManager/dbManager');
const secureChannel = require('./services/secureChannel');
const { deleteRow } = require('./services/tableService');
const { studentRelations, purgeStudentRelations } = require('./services/studentRelations');

// 关键路由：启动时立即加载（登录必需）
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');

const app = express();
// 端口可用环境变量覆盖（默认 3000）：打包/日常运行行为不变，
// 仅用于在同一台机器上并行起一个「隔离数据目录」的测试后端做性能测量。
const PORT = Number(process.env.PORT) || 3000;

// CORS 白名单：只允许应用自身来源（Electron 自定义协议 / file://）与本机回环页面访问。
// 之前裸 cors() 会回显任意站点的 Origin，任意网页都能把响应读走，配合本机明文凭据会扩大攻击面。
const CORS_ORIGIN_RE = /^(?:app:\/\/|file:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$)/;
app.use(cors({
  origin(origin, cb) {
    // 无 Origin：Electron 主进程 / Node 客户端 / 同源请求；'null'：file:// 页面
    if (!origin || origin === 'null') return cb(null, true);
    return cb(null, CORS_ORIGIN_RE.test(origin));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Proof'],
  exposedHeaders: ['X-Auth-Required', 'X-Renewed-Token', 'X-Renewed-Media'],
}));

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
  // 信道凭据：解 X-Auth-Proof 为 req.channelToken / 会话绑定身份。
  // 必须排在 requestDecrypt 之后：凭据的 sid 要与请求体加密用的会话一致（见中间件内校验）。
  app.use(secureChannel.requestAuthProof);
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
  protectedColumns: ['学号', '姓名'],
  extraRoutes: (router) => {
    // 删前影响预览：返回该生关联的 请假/加分/座位/值日 数量（学生本身不与它们建外键，靠 id/姓名弱关联）
    router.get('/:id/relations', (req, res) => {
      try {
        const id = Number(req.params.id);
        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
        if (!student) return res.status(404).json({ error: '学生不存在' });
        res.json(studentRelations(student));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // 一并删除学生 + 勾选的关联记录（body.relations：{ leave/score/seat/duty }）。
    // 返回被删的请假/加分整行，便于前端登记撤销。
    router.post('/:id/delete-with-relations', (req, res) => {
      try {
        const id = Number(req.params.id);
        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
        if (!student) return res.status(404).json({ error: '学生不存在' });
        const rel = (req.body && req.body.relations) || {};
        let removed = null;
        db.transaction(() => {
          removed = purgeStudentRelations(student, {
            leave: !!rel.leave, score: !!rel.score, seat: !!rel.seat, duty: !!rel.duty,
          });
          deleteRow('students', id, { minCount: 1 });
        })();
        res.json({ message: '已删除学生及其关联记录', removed });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });
  }
}));

// 托管前端静态文件（生产模式用）
app.use(express.static(path.join(__dirname, '../dist')));

// ===================== 启动服务器 =====================
// 端口冲突时自动重试（应用退出后旧进程可能未完全释放端口）
function startServer(port) {
  // 只监听本机回环地址（127.0.0.1）：若像原先那样不指定 host，Node 会监听 0.0.0.0/::，
  // 首次启动即触发 Windows 防火墙“允许访问”弹窗。本服务只供本机前端/主进程访问，
  // 绑定回环即可满足需求，且不会触发防火墙提示（检查更新是出站请求，本就不会弹窗）。
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`✅ 服务器已启动：http://127.0.0.1:${port}`);

    // 就绪上报：通过 fork 的 IPC 通道告知主进程「端口已监听」，由主进程转发给各渲染窗口。
    // 前端据此在就绪瞬间发起首个请求，不再靠固定退避重试去「撞」端口。
    try { if (process.send) process.send({ type: 'backend-ready', port }) } catch (_) { /* 非 fork 场景忽略 */ }

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
      () => { app.use('/api/undo', auth(['teacher']), require('./routes/undo/undo')); },
      () => { app.use('/api/search', auth(['teacher']), require('./routes/search')); },
      () => { app.use('/api/activities', auth(['teacher']), require('./routes/activities')); },
      () => { app.use('/api/countdowns', auth(['teacher']), require('./routes/countdowns')); },
      () => { app.use('/api/cadres', auth(['teacher']), require('./routes/cadres')); },
      () => { app.use('/api/ai', auth(['teacher']), require('./routes/ai/ai')); },
      // 首屏聚合接口：把首页 9 个接口合并为 1 次请求（依赖上面各路由已注册，故放最后）
      () => { app.use('/api/dashboard', auth(['teacher']), require('./routes/dashboard')); },
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

  // 退出前先叫醒扫描子进程。
  // 为什么必须主动做：worker 是 fork 出来的子进程，父进程 exit() 后它会**继续活着**
  //（Windows 上更是彻底没人管），变成一个孤儿进程继续扫库写库 —— 磁盘 IO 与 CPU 全被它占着，
  // 而前端已经显示「后端已关闭」。所以退出前发一条 shutdown 让它自己收工退出。
  process.on('exit', () => {
    try { require('./scanWorker').shutdown(); } catch (_) { /* 模块未加载过就算了 */ }
  });
}

// 心跳应答：主进程周期性发 ping，这里的回调只有在事件循环空闲时才会被执行。
// 若后端「假死」（进程尚在但事件循环被同步操作卡住，如 better-sqlite3 慢查询/锁等待），
// pong 会随之延迟或不来，主进程据此判定异常并重连。纯内存操作，不碰数据库、不写日志。
process.on('message', (msg) => {
  if (!msg) return;
  // 性能面板：内存自报（process.memoryUsage()，单位字节，由主进程换算）
  if (msg.type === 'mem-query') {
    try { if (process.send) process.send({ type: 'mem-report', mem: process.memoryUsage() }) } catch (_) { /* 通道断开忽略 */ }
    return;
  }
  // 性能面板：手动 GC（需以 --expose-gc 启动才有 global.gc）
  if (msg.type === 'gc-request') {
    let ok = false;
    try {
      if (typeof global.gc === 'function') { global.gc(); ok = true; }
    } catch (_) { ok = false; }
    try { if (process.send) process.send({ type: 'gc-report', ok }) } catch (_) { /* 通道断开忽略 */ }
    return;
  }
  if (msg.type !== 'ping') return;
  try { if (process.send) process.send({ type: 'pong', t: msg.t }) } catch (_) { /* 通道断开忽略 */ }
});

startServer(PORT);