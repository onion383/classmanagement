// 独立 FFmpeg 定位与按需获取（LGPL 构建）。
//
// 背景：旧实现 `require('ffmpeg-static')` 内嵌的是 GPL 版 FFmpeg 二进制，会引入 GPL
// 传染风险。用户选择改用 LGPL 版 FFmpeg —— LGPL 允许本程序以“独立进程 + 命令行调用”
// 的方式与其组合（mere aggregation），主程序仍可用本源可用协议发布。
//
// 定位策略（依次生效，找到即返回）：
//   1. 环境变量 FFMPEG_PATH（显式指定的可执行文件）
//   2. FFMPEG_HOME 目录（含其一级子目录，兼容解压出的 bin/ 结构）
//   3. <userData>/ffmpeg（缓存目录：按需下载的 LGPL 版落盘于此）
//   4. 随包/源码目录 resources/ffmpeg（构建时若放好 LGPL 二进制则直接使用）
//   5. 系统 PATH 中的 ffmpeg
//
// ensureFfmpeg() 在定位不到时，会从 BtbN/FFmpeg-Builds 下载 LGPL 构建并解压到 <userData>/ffmpeg
// 缓存，保证首次用到视频封面也能生成；下载/解压失败则返回 ''（缩略图回退占位）。

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { promisify } = require('util');
const { pipeline } = promisify(require('stream').pipeline);
const dbManager = require('../dbManager/dbManager');

// 计算文件 sha256（十六进制小写）
function sha256Hex(filePath) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(64 * 1024);
  let pos = 0, bytes;
  try {
    while ((bytes = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) {
      h.update(buf.subarray(0, bytes));
      pos += bytes;
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}
function verifySha256(filePath, expected) {
  try {
    return sha256Hex(filePath).toLowerCase() === String(expected).toLowerCase();
  } catch (_) { return false; }
}

const IS_WIN = process.platform === 'win32';
const EXE_NAME = IS_WIN ? 'ffmpeg.exe' : 'ffmpeg';
// 兜底下载 LGPL 版 FFmpeg（不含 GPL-only 编码器）；可用 FFMPEG_LGPL_URL 覆盖。
// 正常情况下随包已内置 LGPL 版 ffmpeg.exe（resources/ffmpeg），此处仅为极端兜底。
// 采用 BtbN/FFmpeg-Builds 的 "latest" 固定标签（长期可用），LGPL 资产 ZIP 解压后为
// ffmpeg-master-latest-win64-lgpl/bin/ffmpeg.exe，可由下方 findFfmpeg 的一级子目录探测命中。
const LGPL_URL = process.env.FFMPEG_LGPL_URL ||
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip';
// 缓存目录：<userData>/ffmpeg
const CACHE_DIR = path.join(dbManager.dataDir, 'ffmpeg');

function exists(p) {
  try { return !!(p && fs.statSync(p).isFile()); } catch (_) { return false; }
}
function isDir(p) {
  try { return !!(p && fs.statSync(p).isDirectory()); } catch (_) { return false; }
}

// 在若干目录（含一级子目录）中查找 ffmpeg 可执行文件
function findFfmpeg(subjects) {
  for (const subj of subjects) {
    if (!subj) continue;
    const exe = path.join(subj, EXE_NAME);
    if (exists(exe)) return exe;
    // 一级子目录（兼容 BtbN 解压出的 ffmpeg-master-latest-win64-lgpl/bin 等结构）
    if (isDir(subj)) {
      for (const name of dirsIn(subj)) {
        const child = path.join(subj, name, EXE_NAME);
        if (exists(child)) return child;
        const nested = path.join(subj, name, 'bin', EXE_NAME);
        if (exists(nested)) return nested;
      }
    }
  }
  return '';
}

function dirsIn(dir) {
  try { return fs.readdirSync(dir); } catch (_) { return []; }
}

// 递归检测目录内是否存在符号链接（用于解压后的安全校验）
function hasSymlink(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return false; }
  for (const e of entries) {
    if (e.isSymbolicLink()) return true;
    if (e.isDirectory() && hasSymlink(path.join(dir, e.name))) return true;
  }
  return false;
}

// 同步定位本机已有的 ffmpeg（不做网络请求）
function resolveFfmpegPath() {
  // 1. 显式指定可执行文件
  if (process.env.FFMPEG_PATH && exists(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;

  const candidates = [];
  // 打包后：asarUnpack 会把 exe 解成真实文件，位于 app.asar.unpacked 目录
  if (process.resourcesPath) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'resources');
    candidates.push(path.join(unpacked, 'ffmpeg'), unpacked);
  }
  // 2. 用户数据目录缓存
  candidates.push(CACHE_DIR, path.join(CACHE_DIR, 'bin'));
  // 3. 随包/源码资源目录
  candidates.push(path.resolve(__dirname, '../../resources/ffmpeg'));
  candidates.push(path.resolve(__dirname, '../../resources'));

  let hit = findFfmpeg(candidates);
  if (hit) return hit;

  // 4. FFMPEG_HOME 目录
  if (process.env.FFMPEG_HOME) {
    hit = findFfmpeg([process.env.FFMPEG_HOME]);
    if (hit) return hit;
  }

  // 5. 系统 PATH
  const envExt = process.env.PATHEXT?.split(';').filter(Boolean) || [];
  for (const dir of String(process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)) {
    if (!isDir(dir)) continue;
    const names = IS_WIN ? ([EXE_NAME, 'ffmpeg'].concat(envExt.map(e => 'ffmpeg' + e.toLowerCase()))) : [EXE_NAME];
    for (const n of names) {
      if (exists(path.join(dir, n))) return path.join(dir, n);
    }
  }
  return '';
}

// 异步下载并缓存 LGPL 版 FFmpeg；成功后返回可执行文件路径，失败返回 ''
async function ensureFfmpeg() {
  try {
    const local = resolveFfmpegPath();
    if (local) return local;

    if (exists(path.join(CACHE_DIR, '.inflight'))) return ''; // 已有并发下载在跑，直接跳过
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(path.join(CACHE_DIR, '.inflight'), '1', 'utf8');

    const zipPath = path.join(CACHE_DIR, 'tmp.mp4zip');
    console.log(`[ffmpeg] 未找到 ffmpeg，正在下载 LGPL 版: ${LGPL_URL}`);
    await download(LGPL_URL, zipPath);

    // 完整性校验：若配置了 FFMPEG_SHA256（下载的 zip 的 sha256），严格比对，
    // 不匹配即删除并中止，避免被中间人替换为恶意二进制。未配置则跳过（无权威参考值）。
    if (process.env.FFMPEG_SHA256) {
      if (!verifySha256(zipPath, process.env.FFMPEG_SHA256)) {
        await fsp.unlink(zipPath).catch(() => {});
        throw new Error('ffmpeg 下载完整性校验失败（sha256 不匹配）');
      }
    }

    // 解压：用自研的 unzipSafe（yauzl 流式），不再依赖 extract-zip
    // —— 后者有「zip 内符号链接写任意路径」的漏洞且无修复版本。
    // unzipSafe 在**解压前**逐条目拦掉符号链接/穿越路径；下面的 hasSymlink 是双保险
    // （自研代码宁可多一道），一旦命中同样 fail-closed。
    const { unzipSafe } = require('./unzipSafe'); // 轻量纯 JS，按需加载
    await unzipSafe(zipPath, CACHE_DIR);

    // 解压后安全校验：正常 LGPL 包内不应存在符号链接（符号链接可被用于穿越写入缓存目录外）。
    // 一旦发现即视为被篡改，清空缓存并放弃使用该二进制（fail-closed）。
    if (hasSymlink(CACHE_DIR)) {
      await fsp.unlink(zipPath).catch(() => {});
      await fsp.rm(CACHE_DIR, { recursive: true, force: true }).catch(() => {});
      throw new Error('解压结果含符号链接，已中止使用（疑似被篡改）');
    }

    await fsp.unlink(zipPath).catch(() => {});
    await fsp.unlink(path.join(CACHE_DIR, '.inflight')).catch(() => {});

    const found = findFfmpeg([CACHE_DIR]);
    return found || '';
  } catch (err) {
    await fsp.rm(path.join(CACHE_DIR, '.inflight'), { force: true }).catch(() => {});
    await fsp.rm(path.join(CACHE_DIR, 'tmp.mp4zip'), { force: true }).catch(() => {});
    console.error('[ffmpeg] LGPL 下载失败：', err.message);
    return '';
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
      }
      const out = fs.createWriteStream(dest);
      pipeline(res, out).then(resolve, reject);
    }).on('error', reject);
  });
}

module.exports = { resolveFfmpegPath, ensureFfmpeg };