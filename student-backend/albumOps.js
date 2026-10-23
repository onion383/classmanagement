// =========================================================================
// albumOps.js —— 班级相册文件操作共享模块
//
// 撤销/重做需要把「删除照片」的文件真正搬回原路径。系统回收站无法编程还原，
// 因此建立应用内回收站目录（dataDir/album-trash），删除照片时文件按确定性的
// 命名（{photoId}_{原名}）移入；撤销时再按同一规则从回收站移回原路径。
// 供 routes/album.js 与 routes/undo.js 共用，避免文件操作逻辑重复。
//
// 缩略图恢复说明：缩略图路径按库隔离，固定为 {THUMB_DIR}/{slug}/{photoId}.jpg
// （各库的 album_photos.id 都从 1 开始自增，若不按库隔离会互相覆盖导致串图），
// 删除后可删文件。恢复照片索引后 thumb_path 置空，routes/album.js 的 /thumb
// 接口会自动按需重建，因此这里不复制缩略图生成逻辑。
// =========================================================================

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const dbManager = require('./dbManager/dbManager');
const albumThumbs = require('./albumThumbs');

const THUMB_DIR = dbManager.thumbsDir;
const TRASH_DIR = dbManager.trashDir;
try { fs.mkdirSync(TRASH_DIR, { recursive: true }); } catch (_) {}

// 照片归档到回收站的确定性路径（按 id 命名保留原扩展名）
function trashPathFor(photo) {
  const base = photo && photo.id != null ? `${photo.id}_` : '';
  const name = (photo && photo.file_name) || 'file';
  return path.join(TRASH_DIR, base + name);
}

// 删除照片：把源文件移入应用内回收站（可还原）。
// rename 跨设备（源在 D:、回收站在 C:）会抛 EXDEV，退化为「复制后删除原文件」。
async function moveToTrash(photo) {
  if (!photo || !photo.file_path) return false;
  const dest = trashPathFor(photo);
  if (!fs.existsSync(photo.file_path)) return false;
  await fsp.rm(dest, { force: true }); // 清掉同名旧归档，避免 rename 冲突
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.rename(photo.file_path, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(photo.file_path, dest);
    await fsp.unlink(photo.file_path);
  }
  return true;
}

// 撤销删除照片：把文件从回收站搬回原路径。原目录若不存在则创建（同样兼容跨设备）。
async function restoreToOriginal(photo) {
  if (!photo || !photo.file_path) return false;
  const src = trashPathFor(photo);
  if (!fs.existsSync(src)) return false;
  await fsp.mkdir(path.dirname(photo.file_path), { recursive: true });
  try {
    await fsp.rename(src, photo.file_path);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(src, photo.file_path);
    await fsp.unlink(src);
  }
  return true;
}

// 删除某照片的缩略图缓存（路径由 {slug}/{photoId}.jpg 确定）。文件不存在则忽略。
// 传入 slug 时（当前请求上下文可取）按库定位；不传则退化为清内存缓存，
// 磁盘文件由调用方在拿到 slug 后处理。
async function deleteThumb(photo, slug) {
  const id = photo && photo.id;
  if (id == null) return;
  const s = slug || dbManager.currentSlug();
  if (!s) { albumThumbs.forgetPhoto(s, id); return; }
  const tp = albumThumbs.thumbPathFor(s, id);
  albumThumbs.forgetPhoto(s, id);
  await fsp.unlink(tp).catch(() => {});
}

module.exports = { THUMB_DIR, TRASH_DIR, trashPathFor, moveToTrash, restoreToOriginal, deleteThumb };