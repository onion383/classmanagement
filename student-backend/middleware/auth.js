const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dbManager = require('../dbManager');

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
  return jwt.verify(token, SECRET);
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

module.exports = { auth, authStatic, SECRET, resolveToken, verifyToken };