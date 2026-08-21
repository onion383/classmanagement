// =========================================================================
// recoveryKey.js —— 恢复密钥公用工具
//
// 512 个常见汉字，随机取 12 个作为「中文恢复词」；服务端只保存密钥哈希，
// 校验时用「抄写的前 3 个词」或全部 12 词派生哈希做常数时间比对。
// 注册、订单（重置恢复密钥）、忘记密码 均复用本模块，避免重复定义。
// =========================================================================

const crypto = require('crypto');

const POOL = '山水日月风雨雷电云霞雪霜露雾虹霓晨昏朝夕春华秋实冬夏寒暑冷暖东西南北上下左右大小多少长短粗细远近高矮深浅明暗曲折顺逆安危患祸福寿康宁喜乐哀愁悲欢离合聚散起落升腾沉浮进出开关快慢迟早先后始终正反真假善恶美丑爱恨情仇得失成败胜负端倪边际尽头根源枝条花果叶根茎干枝桠芽蕾苞蕊瓣萼果实核仁壳皮肉骨血脉筋络肌肤毛发齿舌唇颈肩臂手掌握指肘膝腿足背胸腹脐腰臀腹背心胆肠脾胃肾肝肺脾胆血液津气体声韵调律节奏鼓琴瑟笛箫笙竽钟鼓磬铃铎声';

// 生成 12 个词的恢复密钥（连续汉字字符串）
function pickPhrase() {
  const chars = [];
  for (let i = 0; i < 12; i++) {
    chars.push(POOL[crypto.randomInt(0, POOL.length)]);
  }
  return chars.join('');
}

// 派生：恢复密钥 -> 哈希（用于服务端保存校验，不存明文）
function deriveRestoreHash(phrase) {
  return crypto.createHash('sha256').update('restore:' + phrase).digest('hex');
}

// 归一化：仅保留汉字，兼容用户粘贴带序号（1.水 …）或带空格的格式
function normalizePhrase(phrase) {
  return String(phrase).replace(/[^\u4e00-\u9fa5]/g, '');
}

// 展示用：给 12 个汉字配上序号，如「1.水  2.络  3.蕾 …」
function formatPhrase(phrase) {
  return normalizePhrase(phrase).split('').map((c, i) => `${i + 1}.${c}`).join('  ');
}

// 安全比较：固定长度哈希常数时间比对
function safeEqualHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const maxLen = Math.max(bufA.length, bufB.length) + 1;
  const pa = Buffer.alloc(maxLen, 0); pa.set(bufA);
  const pb = Buffer.alloc(maxLen, 0); pb.set(bufB);
  let diff = pa.length ^ pb.length;
  for (let i = 0; i < pa.length; i++) diff |= pa[i] ^ pb[i];
  return diff === 0;
}

module.exports = { pickPhrase, deriveRestoreHash, normalizePhrase, formatPhrase, safeEqualHash };