const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'class-system-secret-2024';

function auth(requiredRoles = []) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').split(' ')[1];
    if (!token) return res.status(401).json({ error: '未登录' });
    try {
      const user = jwt.verify(token, SECRET);
      if (requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
        return res.status(403).json({ error: '权限不足' });
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Token无效' });
    }
  };
}

module.exports = { auth, SECRET };