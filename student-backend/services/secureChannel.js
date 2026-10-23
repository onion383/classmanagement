// 安全通道（方案 A）：本地传输加密改造的核心模块。
//
// 目标威胁模型：本机存在被动抓包/监听回环流量的软件。为此对「业务 JSON API」
// 启用会话级加密；静态图片等 <img> 资源走签名 URL 豁免（见路由层）。
//
// 设计：
//   - 认证锚点 K_master：由 Electron 主进程随机生成，经环境变量注入后端，
//     并经 preload 注入前端。它只参与 HKDF 派生态，不直接在线上传输。
//   - 前向保密：每次会话前端生成 ephemeral P-256 密钥对，与后端做 ECDH，
//     派生的会话密钥一次性、会话级，泄露只影响当次。
//   - 数据面：会话密钥 + AES-256-GCM 加密请求体与响应体。
//
// 启用方式：仅当设置环境变量 SECURE_MASTER（64 位 hex）时，中间件才强制加密。
// 未设置时各函数安全降级为「无加密直通」，保证默认环境不破坏现有功能。

const crypto = require('crypto');

const CIPHER = 'aes-256-gcm';
const CURVE = 'prime256v1';        // P-256（Node ECDH 与 Chromium WebCrypto 均支持）
const SESSION_TTL_MS = 15 * 60 * 1000; // 会话有效期 15 分钟

// 信道凭据（X-Auth-Proof）：客户端用会话密钥加密 { token?, ts, n } 放进请求头，
// 明文 Authorization / Cookie / 查询串在安全模式下不再被接受——被动抓包拿不到可复用的凭据。
// ts 容差与 nonce 记忆窗口：本机前后端同源时钟，60 秒足够覆盖一次往返；nonce 记 120 秒防重放。
const AUTH_TS_SKEW_MS = 60 * 1000;
const AUTH_NONCE_TTL_MS = 120 * 1000;
const usedNonces = new Map(); // nonce -> 首次出现时间

// 64 位 hex(32 bytes) 主密钥
const KM_RE = /^[0-9a-f]{64}$/;
let K_MASTER = '';
function initMaster(master) {
  if (typeof master === 'string' && KM_RE.test(master)) K_MASTER = master;
}
function hasMaster() { return !!K_MASTER; }

// 会话表：sessionId -> { key: Buffer(32), createdAt }
const sessions = new Map();
function sessionCount() { return sessions.size; }

// 生成后端 ephemeral P-256 密钥对，返回 ECDH 实例与 raw 公钥(base64)
function genServerEphemeral() {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  return { ecdh, pubRaw: ecdh.getPublicKey().toString('base64') };
}

// 前端公钥(raw,P-256,65字节/或压缩33字节) + 后端私钥 -> 共享 ECDH 密
function deriveEcdhShared(pubRawB64, ecdh) {
  const pub = Buffer.from(String(pubRawB64 || ''), 'base64');
  if (pub.length !== 65 && pub.length !== 33) {
    throw new Error('invalid peer public key');
  }
  return ecdh.computeSecret(pub);
}

// HKDF(ikm=ECDH共享密, salt=K_master, info=固定) -> 32 字节会话密钥
// 前端用 WebCrypto HKDF 同样的参数，保证双方派生出同一 Ke。
function deriveSessionKey(shared) {
  // Node 某些版本的 hkdfSync 返回 ArrayBuffer 而非 Buffer，统一归一为 Buffer，保证后续 seed/open/equals 可靠
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(K_MASTER, 'hex'), Buffer.from('campus-secure-v1'), 32));
}

// AES-256-GCM 加密 -> base64(nonce).base64(tag).base64(ciphertext)
function seal(key, plaintextBuf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const enc = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

// 解密 seal() 输出
function open(key, packaged) {
  const parts = String(packaged).split('.');
  if (parts.length !== 3) throw new Error('bad packet');
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const enc = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv(CIPHER, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

// 一次握手：前端交来 pub -> 返回 后端 pub + sessionId
function performHandshake(clientPubB64) {
  const { ecdh, pubRaw } = genServerEphemeral();
  const shared = deriveEcdhShared(clientPubB64, ecdh);
  const key = deriveSessionKey(shared);
  const sessionId = crypto.randomBytes(16).toString('hex');
  // authToken：该信道会话绑定的登录 token（首次收到带 token 的凭据时写入），
  // 之后客户端只发不含 token 的信道凭据即可，登录 token 不再随每次请求上线。
  sessions.set(sessionId, { key, createdAt: Date.now(), authToken: null });
  cleanupSessions();
  return { sessionId, pub: pubRaw };
}

function getSessionKey(sessionId) {
  const s = sessions.get(sessionId);
  return s ? s.key : null;
}
function destroySession(sessionId) { sessions.delete(sessionId); }

// 会话 ↔ 登录 token 绑定：后端在收到带 token 的信道凭据（或登录成功）时登记。
// 绑定态被 auth 中间件判定失效时会解绑，让前端换一份带 token 的凭据重试一次。
function bindAuth(sessionId, token) {
  const s = sessionId && sessions.get(sessionId);
  if (!s || !token) return false;
  s.authToken = token;
  return true;
}
function getBoundAuth(sessionId) {
  const s = sessionId && sessions.get(sessionId);
  return s ? s.authToken : null;
}
function unbindAuth(sessionId) {
  const s = sessionId && sessions.get(sessionId);
  if (s) s.authToken = null;
}

// ======================== Express 中间件 ========================
// 加密只对「业务 JSON API」生效；静态图片/<img> 资源与握手路径走明文（见 Exempt）。
// 中间件采用「透明」策略：若请求体是 {session, d} 密文则解密，否则按明文放行，
// 响应同理——只有收到过加密请求（req.sessionId 已置位）才回包加密。这样即使
// 前端开关键与后端不一致，也能各自正常退化为明文直通，不破坏既有功能。

// 豁免路径前缀：握手、静态图片/上传、背景图
const EXEMPT_PREFIXES = ['/api/secure', '/uploads', '/api/background'];
function pathExempt(pathname) {
  return EXEMPT_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

// 请求解密中间件：把 { session, d } 解包为真实对象写回 req.body，并记录 req.sessionId
function requestDecrypt(req, res, next) {
  const method = req.method;
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  if (!hasBody || pathExempt(req.path) || !hasMaster()) return next();
  const body = req.body;
  if (!body || typeof body !== 'object' || typeof body.session !== 'string' || typeof body.d !== 'string') {
    return next(); // 非加密请求，明文放行
  }
  try {
    const key = getSessionKey(body.session);
    if (!key) return res.status(401).json({ d: 'session-expired' });
    const dec = open(key, body.d);
    req.body = JSON.parse(dec.toString('utf8'));
    req.sessionId = body.session;
  } catch (_) {
    return res.status(400).json({ error: '解密失败' });
  }
  return next();
}

// 响应加密中间件：包装 res.json，仅对加密会话的纯 JSON 数据封包为 { d: 'iv.tag.ct' }
function responseEncrypt(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    const sid = req.sessionId;
    if (!!sid && hasMaster() && !pathExempt(req.path)) {
      const buf = Buffer.from(JSON.stringify(data), 'utf8');
      const key = getSessionKey(sid); // 取会话的密钥本身（sessions.get 返回的是 { key, createdAt } 对象）
      if (key) {
        return originalJson({ d: seal(key, buf) });
      }
    }
    return originalJson(data);
  };
  return next();
}

// 信道凭据中间件：解 X-Auth-Proof（sid.iv.tag.ct）为 req.channelToken / req.channelBound。
// 报文由前端用会话密钥加密，明文里只有密文——本机抓包拿不到可复用的登录 token。
// 凭据里的 sid 必须与请求体加密用的会话一致，避免「凭据用一个会话、回包用另一个会话」。
function requestAuthProof(req, res, next) {
  if (!hasMaster()) return next();
  const raw = req.headers['x-auth-proof'];
  if (!raw) return next();

  const fail = (status, payload) => res.status(status).set('X-Auth-Required', '1').json(payload);
  const parts = String(raw).split('.');
  if (parts.length !== 4) return fail(401, { error: '凭据格式错误' });

  const [sid, iv, tag, ct] = parts;
  const key = getSessionKey(sid);
  if (!key) return res.status(401).json({ d: 'session-expired' });
  if (req.sessionId && req.sessionId !== sid) return fail(400, { error: '会话不一致' });

  let payload;
  try {
    payload = JSON.parse(open(key, [iv, tag, ct].join('.')).toString('utf8'));
  } catch (_) {
    return fail(401, { error: '凭据无效' });
  }

  const ts = Number(payload && payload.ts);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > AUTH_TS_SKEW_MS) {
    return fail(401, { error: '凭据已过期' });
  }

  const n = payload && payload.n ? String(payload.n) : '';
  if (!n) return fail(401, { error: '凭据缺少随机数' });
  cleanupNonces();
  if (usedNonces.has(n)) return fail(401, { error: '凭据重放' });
  usedNonces.set(n, Date.now());

  req.sessionId = sid;
  if (payload.token) {
    // 带 token：登记绑定，后续请求可以只发不含 token 的凭据
    bindAuth(sid, String(payload.token));
    req.channelToken = String(payload.token);
  }
  return next();
}

// 清理过期会话
function cleanupSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

// 清理重放记忆（窗口外的 nonce 不再需要拦截）
function cleanupNonces() {
  const now = Date.now();
  for (const [n, at] of usedNonces) {
    if (now - at > AUTH_NONCE_TTL_MS) usedNonces.delete(n);
  }
}

// 流式响应分帧加密（SSE 场景）：SSE 是逐帧 res.write，无法用 res.json 统一包装，
// 故在此按「单帧」封装。仅当本请求来自加密会话（req.sessionId 已由 requestDecrypt 置位）
// 时，把事件对象封成与 responseEncrypt 同形的 { d: 'iv.tag.ct' }；否则原样返回，明文直通。
function encodeStreamEvent(req, data) {
  const sid = req && req.sessionId;
  if (!!sid && hasMaster()) {
    const key = getSessionKey(sid);
    if (key) return { d: seal(key, Buffer.from(JSON.stringify(data), 'utf8')) };
  }
  return data;
}

module.exports = {
  initMaster, hasMaster, sessionCount,
  genServerEphemeral, deriveEcdhShared, deriveSessionKey,
  seal, open, performHandshake, getSessionKey, destroySession,
  bindAuth, getBoundAuth, unbindAuth,
  requestDecrypt, responseEncrypt, requestAuthProof, encodeStreamEvent,
  SESSION_TTL_MS,
};

// 模块加载时若已注入 SECURE_MASTER（Electron 主进程 fork 后端时设置），自动完成初始化；
// 未设置则保持直通（hasMaster()===false），不影响未启用加密的默认环境。
initMaster(process.env.SECURE_MASTER);