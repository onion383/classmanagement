// jsonwebtoken 懒加载：它连带 semver / side-channel 等一次性要花 ~40ms 同步加载，
// 而 auth 模块在 app.js 里是启动时同步 require 的，这 40ms 全部压在「后端就绪信号」之前。
// 改为首次验签时才 require：这 40ms 从「就绪前」挪到「首个鉴权请求」，
// 而首个鉴权请求本来就在就绪之后才发出，前端可感知的启动时间因此提前。
let _jwt = null;
function jwtLib() {
  if (!_jwt) _jwt = require('jsonwebtoken');
  return _jwt;
}
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dbManager = require('../dbManager/dbManager');
const sessions = require('../services/sessions');
const secureChannel = require('../services/secureChannel');

// 杜绝硬编码兜底：优先使用环境变量 JWT_SECRET。
// 若未配置，则从 .jwt-secret 文件读取（无则自动生成并持久化），保证重启后已签发 Token 仍有效。
// secret 文件必须放在 dataDir（可写、随 userData 持久化）：打包后 __dirname 位于只读 asar 内，
// 写在那里会失败导致每次重启都重新登录。
function resolveSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET;
  }
  const secretFile = path.join(dbManager.dataDir, '.jwt-secret');
  const legacyFile = path.join(__dirname, '..', '.jwt-secret');
  try {
    // 兼容旧位置：若旧文件存在且新位置没有，沿用旧密钥并迁移，避免已签发 Token 失效
    if (!fs.existsSync(secretFile) && fs.existsSync(legacyFile)) {
      fs.copyFileSync(legacyFile, secretFile);
    }
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing) return existing;
  } catch (_) { /* 文件不存在则生成 */ }
  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
  } catch (_) { /* 写入失败则退回进程内随机值，重启后需重新登录 */ }
  return generated;
}

const SECRET = resolveSecret();

// 登录 Token 签发策略：30 天有效期 + 会话名单双保险。
// 主动退出时由 services/sessions 把 sid 移出名单，原 token 立即失效；
// 即使 token 被从 localStorage/备份/内存中捞走，也最多只能用 30 天。
const TOKEN_SIGN_OPTS = { expiresIn: '30d' };
// 滑动续期：剩余有效期少于该阈值时，任意一次正常业务请求都会顺带续签一份新的 30 天 token。
// 效果是「活跃用户永不过期，长期不用的账号最多 30 天后失效」；sid 不变，
// 因此会话名单、媒体凭据（同 sid）都不受影响。
const SLIDE_RENEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// 配套 Cookie 仍按 100 年设置（JWT 自身有 exp，Cookie 活多久都不会延长鉴权）。
// 前端登录态走 localStorage + 加密信道凭据；Cookie 仅作为静态资源的兼容兜底。
const TOKEN_COOKIE_MAX_AGE = 100 * 365 * 24 * 60 * 60 * 1000;

// 媒体凭据：只用于 <img> / CSS url() 这类无法携带自定义头的静态资源。
// 登录 JWT 不再出现在 URL 里（URL 会进 Referer/日志/浏览器历史），换成一个
// scope=media 的受限凭据：能取图，不能调业务 API；登出吊销 sid 后同时失效。
const MEDIA_TOKEN_TTL = '30d';
const MEDIA_URL_RE = /^\/api\/album\/photo\/\d+\/(?:thumb|file)$/;

function isMediaRequest(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const url = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  return MEDIA_URL_RE.test(url);
}

// 明文模式下的凭据来源（Authorization / Cookie / 查询参数）。
function plainToken(req) {
  const headerToken = (req.headers.authorization || '').split(' ')[1];
  if (headerToken) return headerToken;
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

// 统一解析凭据来源，返回 { token, source }：
//   channel：本请求携带了加密凭据（X-Auth-Proof）
//   bound： 会话已绑定登录 token，本请求只带了不含 token 的信道凭据
//   media： 媒体路径上的受限媒体凭据（查询参数）
//   plain： 未启用安全通道时的明文凭据
function resolveAuth(req) {
  if (req.channelToken) return { token: req.channelToken, source: 'channel' };
  if (req.sessionId) {
    const bound = secureChannel.getBoundAuth(req.sessionId);
    if (bound) return { token: bound, source: 'bound' };
  }
  if (secureChannel.hasMaster()) {
    if (isMediaRequest(req)) {
      const q = req.query && req.query.token ? String(req.query.token) : null;
      if (q) return { token: q, source: 'media' };
    }
    return { token: null, source: 'none' };
  }
  return { token: plainToken(req), source: 'plain' };
}

// 兼容旧调用：只返回 token 字符串
function resolveToken(req) {
  return resolveAuth(req).token;
}

function verifyToken(token, { allowMedia = false } = {}) {
  const payload = jwtLib().verify(token, SECRET);
  // 会话名单校验：主动退出会把 sid 移出名单，此后原 token 立即失效（用户须重新登录）。
  // 不带 sid 的旧 token（本次改动之前签发的）同样视为失效，全部需要重新登录一次。
  if (!payload || !sessions.has(payload.sid)) throw new Error('会话已失效');
  // 媒体凭据只能用于媒体路径，不能拿来调业务 API
  if (payload.scope === 'media' && !allowMedia) throw new Error('媒体凭据不可用于此接口');
  return payload;
}

// 签发媒体凭据：sid 与登录 token 相同，登出时随会话一起吊销
function signMediaToken(user) {
  return jwtLib().sign(
    {
      userId: user.userId, username: user.username, role: user.role,
      dbSlug: user.dbSlug, sid: user.sid, scope: 'media',
    },
    SECRET,
    { expiresIn: MEDIA_TOKEN_TTL }
  );
}

// 滑动续期：token 剩余有效期进入 7 天窗口后，随本次正常请求续签一份新的 30 天 token。
// 新 token 沿用原 sid（会话名单 / 媒体凭据继续有效），通过响应头交前端落盘；
// 绑定到信道的 token 也同步更新，否则旧 token 到点后该信道会失效。
// 媒体路径（<img> 取图）不续签：图片请求读不到响应头，且不应因取图凭空签发凭据。
function slideSession(req, res, user, source) {
  if (!user || source === 'media') return;
  const exp = Number(user.exp) || 0;
  if (!exp || exp * 1000 - Date.now() > SLIDE_RENEW_WINDOW_MS) return;
  const payload = {
    userId: user.userId, username: user.username, role: user.role,
    dbSlug: user.dbSlug, sid: user.sid,
  };
  const token = jwtLib().sign(payload, SECRET, TOKEN_SIGN_OPTS);
  res.set('X-Renewed-Token', token);
  res.set('X-Renewed-Media', signMediaToken(payload));
  // 明文模式下 Cookie 还参与鉴权，一并续上；安全模式下 Cookie 不参与鉴权，刷新无副作用
  res.cookie('token', token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: TOKEN_COOKIE_MAX_AGE,
  });
  if (req.sessionId) secureChannel.bindAuth(req.sessionId, token);
}

// 「本机信息恢复」签发的 recover token 只授权「设置新密码」这一个动作。
// 设计上它不是完整登录态：除改密换发正式 token 外，不得调用任何业务接口。
// 白名单按「方法 + 完整路径」精确匹配；登出也放行，便于用户放弃本次恢复。
const RECOVER_ALLOWED = new Set([
  'PUT /api/account/password',
  'POST /api/auth/logout',
]);
function isRecoverScopeAllowed(req) {
  const fullPath = String(req.originalUrl || req.url || '').split('?')[0];
  return RECOVER_ALLOWED.has(`${req.method} ${fullPath}`);
}

function auth(requiredRoles = []) {
  return (req, res, next) => {
    const { token, source } = resolveAuth(req);
    if (!token) {
      // 安全模式下没有可用凭据：让前端补发一份带 token 的信道凭据后重试，
      // 而不是直接判定「登录失效」把用户踢回登录页。
      if (secureChannel.hasMaster() && req.sessionId) {
        res.set('X-Auth-Required', '1');
        return res.status(401).json({ d: 'auth-required' });
      }
      return res.status(401).json({ error: '未登录' });
    }
    try {
      const user = verifyToken(token, { allowMedia: isMediaRequest(req) });
      // 查询串里的凭据必须是受限媒体凭据：登录 JWT 不允许再通过 URL 使用
      if (source === 'media' && user.scope !== 'media') throw new Error('媒体凭据无效');
      if (requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
        return res.status(403).json({ error: '权限不足' });
      }
      if (user.recover === true && !isRecoverScopeAllowed(req)) {
        // 按「登录态不完整」处理：前端既有逻辑会清掉本地 token 并回登录页，
        // 避免恢复态凭据在后台被误当成正式会话继续使用。
        return res.status(401).json({ error: '恢复态仅允许设置新密码', code: 'RECOVER_SCOPE_ONLY' });
      }
      req.user = user;
      // 恢复态不参与滑动续期：它只能在改密时换发正式 token，不能被悄悄续成 30 天正式会话。
      if (user.recover !== true) slideSession(req, res, user, source);
      const slug = user.dbSlug || 'default';
      // 绑定当前请求对应的班主任库：使 db.js 导出的 db 代理命中正确库
      return dbManager.withDb(slug, () => next());
    } catch (err) {
      // 超级隐私模式：进程内的库钥匙已不在（如登出后旧 token 仍在），要求重新登录解锁
      if (err && err.code === 'DB_LOCKED') {
        return res.status(401).json({ error: '数据库已锁定，请重新登录', code: 'DB_LOCKED' });
      }
      // 绑定态 token 失效（换账号/其它窗口登出）：解绑并让前端带新 token 重试一次；
      // 若重试仍失败，才会按正常「Token失效」流程回登录页。
      if (source === 'bound') {
        secureChannel.unbindAuth(req.sessionId);
        res.set('X-Auth-Required', '1');
        return res.status(401).json({ d: 'auth-required' });
      }
      res.status(401).json({ error: 'Token无效' });
    }
  };
}

// 静态资源鉴权：<img> / CSS url() 没有自定义头，只能用查询参数里的媒体凭据。
// 安全模式下不再接受登录 JWT（哪怕放在 Cookie/查询串里）。
function authStatic() {
  return (req, res, next) => {
    const secureOn = secureChannel.hasMaster();
    const token = secureOn
      ? (req.query && req.query.token ? String(req.query.token) : null)
      : plainToken(req);
    if (!token) return res.status(401).json({ error: '未登录' });
    try {
      const user = verifyToken(token, { allowMedia: true });
      if (secureOn && user.scope !== 'media') throw new Error('媒体凭据无效');
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Token无效' });
    }
  };
}

module.exports = {
  auth, authStatic, SECRET, resolveToken, resolveAuth, verifyToken,
  signMediaToken, TOKEN_SIGN_OPTS, TOKEN_COOKIE_MAX_AGE, isRecoverScopeAllowed,
};