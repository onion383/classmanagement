// =========================================================================
// set-recovery-key.js —— 为指定账号(默认 admin)生成并写入恢复密钥
// 用法:  node set-recovery-key.js [账号]
// 说明: 生成 12 词中文恢复密钥,写入该账号所在的库,并在控制台一次性打印。
//        适合为「从旧版迁移而来、尚无恢复密钥」的 admin 账号补设密钥。
// 注意:  需在 student-backend 目录下运行,且由 Electron 内运行以保证
//        better-sqlite3-multiple-ciphers 的原生模块 ABI 匹配。
// =========================================================================
const dbManager = require('./dbManager');
const { pickPhrase, deriveRestoreHash, formatPhrase } = require('./services/recoveryKey');

const username = process.argv[2] || 'admin';

const conn = dbManager.getDefault();
const user = conn.prepare('SELECT username FROM users WHERE username = ?').get(username);
if (!user) {
  console.error('未找到账号: ' + username);
  process.exit(1);
}

const phrase = pickPhrase();
const hash = deriveRestoreHash(phrase);
conn.prepare('UPDATE users SET recovery_hash = ? WHERE username = ?').run(hash, username);

console.log('账号:', username);
console.log('恢复密钥:', formatPhrase(phrase));
console.log('');
console.log('请立即保存,该密钥仅此一次显示;忘记密码时可用来重置。');