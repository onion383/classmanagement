// =========================================================================
// config.js —— 应用配置 / 路径 / 密钥
//
// 统一管理 userData 下的配置与密钥，供主进程各模块复用：
//   - app-config.json   —— 数据目录 / 缓存目录等可配置项（独立于业务数据目录，启动即读）
//   - node-compile-cache —— Node 侧模块字节码编译缓存目录
//   - 安全通道主密钥     —— 运行期随机，参与前后端 HKDF 派生态
//   - DB 静态加密主密钥  —— safeStorage/DPAPI 持久化（首启现场生成）
//
// 叶子模块：仅依赖 electron(app, safeStorage) 与 path/fs/crypto，不反向依赖其它业务模块。
// =========================================================================

const { app, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

// Node 编译缓存（code cache）：把主进程启动过程中加载的模块字节码缓存到磁盘，
// 下一次启动直接复用、跳过解析 + 编译（仅对 Node 侧模块生效，收益在后续启动）。
// 目录固定放 userData 下，随版本/源码变更自动失效重建。
function resolveCompileCacheDir() {
  return path.join(app.getPath('userData'), 'node-compile-cache')
}

// 安全通道主密钥（方案 A 的认证锚点 K_master）：本次运行周期内生成一次并复用于
// 「后端 fork env 注入」+「preload IPC 提供渲染层」。只参与前后端 HKDF 派生态，
// 不进线上传输。后端崩溃自动重启时复用同一值，保证已建立会话/前端持有的密钥仍一致。
let channelMasterKey = null
function getMasterKey() {
  if (!channelMasterKey) channelMasterKey = crypto.randomBytes(32).toString('hex')
  return channelMasterKey
}

// 数据目录/缓存目录解析（app-config.json，存于 userData，独立于业务数据目录以便启动即读）
function getAppConfigPath() {
  return path.join(app.getPath('userData'), 'app-config.json')
}
// 内存缓存：启动阶段 resolveDataDir / resolveThumbsDir / getDbMasterKey 会反复调用，
// 原先每次都同步 readFileSync 一次。同一进程内配置的唯一写入点是 saveAppConfig，保存后刷新缓存。
let appConfigCache = null
function resolveAppConfig() {
  if (appConfigCache) return appConfigCache
  try { appConfigCache = JSON.parse(fs.readFileSync(getAppConfigPath(), 'utf8')) || {} } catch (_) { appConfigCache = {} }
  return appConfigCache
}
function saveAppConfig(patch) {
  const next = { ...resolveAppConfig(), ...patch }
  if (!next.dataDir) delete next.dataDir
  if (!next.thumbsDir) delete next.thumbsDir
  // 写失败必须抛错：否则「切配置」这一步会静默失败，而调用方（如数据目录搬迁）
  // 会继续删掉旧目录，导致数据在新目录、配置却指向已删除的旧目录。
  try {
    fs.writeFileSync(getAppConfigPath(), JSON.stringify(next, null, 2))
  } catch (err) {
    console.error('[main] 写入 app-config 失败:', err?.message || err)
    throw new Error('配置文件写入失败：' + (err?.message || err))
  }
  appConfigCache = next
  return next
}
// 数据库主目录：默认 userData/data，可被用户配置覆盖
function resolveDataDir() {
  const cfg = resolveAppConfig()
  return cfg.dataDir ? path.resolve(cfg.dataDir) : path.join(app.getPath('userData'), 'data')
}
// 相册缩略图缓存目录：默认位于数据目录下 album-thumbs，可单独配置为独立缓存位置
function resolveThumbsDir() {
  const cfg = resolveAppConfig()
  if (cfg.thumbsDir) return path.resolve(cfg.thumbsDir)
  return path.join(resolveDataDir(), 'album-thumbs')
}

// DB 静态加密主密钥（方案 A：首启现场随机生成 + safeStorage/DPAPI 持久化）：
// 取代原先明文写在 student-backend/.env、随安装包分发的 DB_MASTER_KEY。
// - Windows 上 safeStorage 底层走 DPAPI，密文绑定当前系统用户，解开安装包拿不到明文。
// - 首启：文件不存在 → 生成随机 32 字节 → 加密写 userData/data/db-master.key。
// - 之后：解密文件复用同一把钥匙，保证持久库可连续打开。
// - 兜底：safeStorage 不可用（非 Windows 等）时仅返回运行期随机值，不落明文文件。
let dbMasterKey = null
function getDbMasterKey() {
  if (dbMasterKey) return dbMasterKey
  // 主密钥文件与数据库同目录存放，随数据目录一起迁移；解析用配置后的 dataDir，保证两者一致
  const keyFile = path.join(resolveDataDir(), 'db-master.key')
  try {
    if (fs.existsSync(keyFile) && safeStorage.isEncryptionAvailable()) {
      const blob = fs.readFileSync(keyFile)
      try {
        dbMasterKey = safeStorage.decryptString(blob)
        return dbMasterKey
      } catch { /* 密文损坏/密钥变更，退回重新生成 */ }
    }
    dbMasterKey = crypto.randomBytes(32).toString('hex')
    if (safeStorage.isEncryptionAvailable()) {
      try {
        fs.mkdirSync(path.dirname(keyFile), { recursive: true })
        fs.writeFileSync(keyFile, safeStorage.encryptString(dbMasterKey))
      } catch (err) {
        console.error('[main] DB 主密钥持久化失败，将仅本次运行有效:', err?.message || err)
      }
    }
    return dbMasterKey
  } catch (err) {
    console.error('[main] DB 主密钥初始化失败，使用运行期随机值:', err?.message || err)
    dbMasterKey = crypto.randomBytes(32).toString('hex')
    return dbMasterKey
  }
}

module.exports = {
  resolveCompileCacheDir,
  getMasterKey,
  getAppConfigPath,
  resolveAppConfig,
  saveAppConfig,
  resolveDataDir,
  resolveThumbsDir,
  getDbMasterKey,
}