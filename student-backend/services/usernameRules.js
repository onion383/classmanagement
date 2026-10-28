// =========================================================================
// usernameRules.js —— 账号名规则（注册与改名共用的唯一来源）
//
// 注册（POST /register）原先把「2~30 字符 + 字符白名单」写死在 auth.js，
// 而改名（PUT /api/account/username）只做了 trim —— 于是可以把账号改成
// 空白、超长或带路径分隔符/控制字符的名字，registry 与 users 表都会跟着脏。
// 现在两处共用本模块，规则只改一处。
// =========================================================================

const USERNAME_MIN = 2;
const USERNAME_MAX = 30;
// 允许：字母/数字/下划线（\w）、中文、@ . -
const USERNAME_RE = /^[\w\u4e00-\u9fa5@.-]+$/;

// 只做 trim（null/undefined → 空串），不做合法性判断
function normalizeUsername(input) {
  return String(input === undefined || input === null ? '' : input).trim();
}

// 合法返回空串，非法返回可直接展示给用户的错误文案
function usernameError(input) {
  const name = normalizeUsername(input);
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
    return `账号长度需在 ${USERNAME_MIN}-${USERNAME_MAX} 字符之间`;
  }
  if (!USERNAME_RE.test(name)) return '账号包含非法字符';
  return '';
}

module.exports = { USERNAME_MIN, USERNAME_MAX, USERNAME_RE, normalizeUsername, usernameError };
