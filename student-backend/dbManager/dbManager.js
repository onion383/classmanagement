// =========================================================================
// dbManager.js —— 多库加密核心（聚合入口）
//
// 设计要点（对应需求「多库加密」）：
//   1. 每个班主任一个「自含加密库」：业务数据 + 应用设置 + 账号(含恢复密钥) 同库。
//   2. 服务端维护 index.db（主密钥加密），登记每个班主任库：
//        slug / 账号 / 库密钥(用主密钥包裹)。
//   3. 登录时用 index.db 定位账号 -> 解开库密钥 -> 打开对应班主任库 -> 校验密码。
//   4. 用 AsyncLocalStorage 把「当前请求所属的班主任库」绑定到请求上下文，
//      已有的 db.prepare(...) / tableService 等代码无需逐个改造即可命中正确库。
//
// 密钥约定：
//   - 主密钥 DB_MASTER_KEY：环境变量或 student-backend/.env，用于解密 index.db 与包裹库密钥。禁止硬编码。
//   - 库密钥：每个班主任库独立生成的随机密钥（32 字节 hex），用主密钥 AES-256-GCM 包裹后存入 index.db。
//
// 本文件为原 student-backend/dbManager.js 拆分后的主入口：实现按职责搬运到
// dbManager.<part>.js 子模块，本文件仅汇总导出，导出接口与原文件完全一致。
//   dbManager.base.js    主密钥 / 数据目录与资源目录 / 密钥包裹 / 上下文缓存 / 连接原语 / index 登记
//   dbManager.conn.js    连接管理（打开/驱逐/取库/暖机）
//   dbManager.account.js 班主任账号（新建/删除/定位）
//   dbManager.backup.js  备份恢复与就地加密转换
//   dbManager.memory.js  AI 长期记忆
//   dbManager.skills.js  AI 技能
// =========================================================================

const base = require('./dbManager.base');
const conn = require('./dbManager.conn');
const account = require('./dbManager.account');
const backup = require('./dbManager.backup');
const memory = require('./dbManager.memory');
const skills = require('./dbManager.skills');

module.exports = {
  ensureIndex: base.ensureIndex,
  createTeacher: account.createTeacher,
  deleteTeacher: account.deleteTeacher,
  resolveByUsername: account.resolveByUsername,
  resolveByDbFile: account.resolveByDbFile,
  registryFindByUsername: base.registryFindByUsername,
  registryFindBySlug: base.registryFindBySlug,
  wrapKey: base.wrapKey,
  unwrapKey: base.unwrapKey,
  wrapKeyBySecret: base.wrapKeyBySecret,
  decryptBundleKey: base.decryptBundleKey,
  current: conn.current,
  withDb: conn.withDb,
  exportBundle: backup.exportBundle,
  restoreBundle: backup.restoreBundle,
  convertDbEncryption: backup.convertDbEncryption,
  registrySetEncrypted: base.registrySetEncrypted,
  registryDelete: base.registryDelete,
  evictConn: conn.evictConn,
  // 快照/还原用：库文件路径（按 slug）与快照目录
  dbFilePath: backup.dbFilePath,
  snapshotsDir: base.snapshotsDir,
  registryList: base.registryList,
  registryListValid: account.registryListValid,
  warmup: conn.warmup,
  // AI 长期记忆（md 文档，随备份/恢复一起带走）
  readMemory: memory.readMemory,
  writeMemory: memory.writeMemory,
  appendMemory: memory.appendMemory,
  // AI 技能（可编辑的 md 指令文件）
  normalizeSkillName: skills.normalizeSkillName,
  listSkills: skills.listSkills,
  skillExists: skills.skillExists,
  readSkill: skills.readSkill,
  writeSkill: skills.writeSkill,
  deleteSkill: skills.deleteSkill,
  readSkills: skills.readSkills,
  // 可写资源目录（与数据库同层，随 userData 持久化）
  dataDir: base.dataDir,
  uploadsDir: base.uploadsDir,
  backgroundDir: base.backgroundDir,
  thumbsDir: base.thumbsDir,
  trashDir: base.trashDir,
  skillsDirRoot: skills.skillsDirRoot,
};
