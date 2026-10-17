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
const dbManager = require('../dbManager');
const sessions = require('../services/sessions');

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

// 登录 Token 签发策略：不设过期时间（不带 exp 声明），只要用户不主动退出就一直有效；
// 主动退出时由 services/sessions 把该 token 的 sid 移出会话名单，原 token 立即失效。
// 属本地单机应用，这是「长期保持登录」与「可吊销」之间的平衡做法。
const TOKEN_SIGN_OPTS = {};
// 配套 Cookie 同样按 100 年设置。Chromium 会把 Cookie 有效期上限截到 400 天，
// 但不影响登录保持：前端登录态走 localStorage + Authorization 头，
// Cookie 仅用于图片/CSS 等静态资源请求（且这些请求也可用 ?token= 兜底）。
const TOKEN_COOKIE_MAX_AGE = 100 * 365 * 24 * 60 * 60 * 1000;

// 解析请求中的 Token：优先 Authorization 头，其次 Cookie，最后 URL 查询参数。
// 查询参数供 <img> / CSS url() 等无法携带请求头的资源请求使用（渲染层受 file:// 跨源限制，
// Lax Cookie 不会自动带过去），后端仍校验 Token 有效性，不降低鉴权。
function resolveToken(req) {
  const headerToken = (req.headers.authorization || '').split(' ')[1];
  if (headerToken) return headerToken;
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

function verifyToken(token) {
  const payload = jwtLib().verify(token, SECRET);
  // 会话名单校验：主动退出会把 sid 移出名单，此后原 token 立即失效（用户须重新登录）。
  // 不带 sid 的旧 token（本次改动之前签发的）同样视为失效，全部需要重新登录一次。
  if (!payload || !sessions.has(payload.sid)) throw new Error('会话已失效');
  return payload;
}

function auth(requiredRoles = []) {
  return (req, res, next) => {
    const token = resolveToken(req);
    if (!token) return res.status(401).json({ error: '未登录' });
    try {
      const user = verifyToken(token);
      if (requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
        return res.status(403).json({ error: '权限不足' });
      }
      req.user = user;
      const slug = user.dbSlug || 'default';
      // 绑定当前请求对应的班主任库：使 db.js 导出的 db 代理命中正确库
      return dbManager.withDb(slug, () => next());
    } catch {
      res.status(401).json({ error: 'Token无效' });
    }
  };
}

// 静态资源鉴权：仅校验 Token 有效性（不区分角色），配合 Cookie/查询参数使用，
// 避免 <img> / CSS url() 等无 Authorization 头的请求被拦截。
function authStatic() {
  return (req, res, next) => {
    const token = resolveToken(req);
    if (!token) return res.status(401).json({ error: '未登录' });
    try {
      req.user = verifyToken(token);
      next();
    } catch {
      res.status(401).json({ error: 'Token无效' });
    }
  };
}

module.exports = { auth, authStatic, SECRET, resolveToken, verifyToken, TOKEN_SIGN_OPTS, TOKEN_COOKIE_MAX_AGE };