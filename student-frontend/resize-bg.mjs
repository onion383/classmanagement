// 将 public/glass-bg.jpg 压缩到屏幕分辨率（长边 2560px ≈ 2K 屏）
// 原图保留不动，输出 public/glass-bg-opt.jpg
import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'

const src = 'public/glass-bg.jpg'
const dst = 'public/glass-bg-opt.jpg'
const MAX = 2560 // 长边最大像素

const meta = await sharp(src).metadata()
const w = meta.width
const h = meta.height
const longer = w >= h ? w : h
if (longer <= MAX) {
  console.log(`原图长边 ${longer} ≤ ${MAX}，无需缩放，直接复制`)
  writeFileSync(dst, readFileSync(src))
  process.exit(0)
}

const scale = MAX / longer
const newW = Math.round(w * scale)
const newH = Math.round(h * scale)

await sharp(src)
  .resize(newW, newH, { fit: 'outside', withoutEnlargement: true })
  .jpeg({ quality: 85, mozjpeg: true })
  .toFile(dst)

const origSize = (await sharp(src).metadata()).size
const optSize = (await sharp(dst).metadata()).size
console.log(`原图: ${w}×${h}  ${(origSize / 1024 / 1024).toFixed(1)}MB`)
console.log(`压缩: ${newW}×${newH}  ${(optSize / 1024 / 1024).toFixed(1)}MB`)