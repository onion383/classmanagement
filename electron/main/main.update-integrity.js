// =========================================================================
// main.update-integrity.js —— 更新包完整性校验（不依赖 electron，可单测）
//
// 更新链原先只校验 Content-Length：下载地址、重定向后的最终地址、发布资产的哈希
// 都没有验证。任何能改写 release 资产 / 中间劫持的一方都能塞入任意 exe，
// 而安装器会以静默参数直接运行它（B01-12）。
//
// 这里提供两道校验：
//   1) HTTPS：下载地址与重定向后的最终地址都必须是 https；
//   2) SHA-256：GitHub Releases API 会返回 asset.digest（形如 sha256:...），
//      有就强制比对文件哈希；缺失时至少按 asset.size 校验大小并留日志。
// =========================================================================

const crypto = require('crypto');
const fs = require('fs');

// 只接受 HTTPS 地址；非法 URL 或非 https 直接抛错
function assertHttpsUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl || ''));
  } catch (_) {
    throw new Error('更新包下载地址无效');
  }
  if (u.protocol !== 'https:') throw new Error('更新包下载地址必须是 HTTPS');
  return u;
}

// 流式计算文件 sha256（安装包上百 MB，不能整个读进内存）
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('data', (chunk) => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
    rs.on('error', reject);
  });
}

// 校验已下载的安装包。
// 返回 { ok, error?, verified: 'sha256' | 'size-only' }
//   · 大小与 expectedSize（asset.size 或 Content-Length）不一致 → 失败；
//   · digest 形如 sha256:<64 hex> → 比对哈希；
//   · 没有 digest → 仅大小校验，标记 size-only（调用方负责 warn）。
async function verifyDownloadedFile({ filePath, expectedSize, digest }) {
  const size = fs.statSync(filePath).size;
  if (expectedSize > 0 && size !== expectedSize) {
    return { ok: false, error: '下载文件不完整' };
  }
  const d = String(digest || '').toLowerCase();
  if (/^sha256:[0-9a-f]{64}$/.test(d)) {
    const actual = await sha256File(filePath);
    if (actual !== d.slice('sha256:'.length)) {
      return { ok: false, error: '更新包校验失败（SHA-256 不一致）' };
    }
    return { ok: true, verified: 'sha256' };
  }
  return { ok: true, verified: 'size-only' };
}

module.exports = { assertHttpsUrl, sha256File, verifyDownloadedFile };
