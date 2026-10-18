// 把 public/ 下用到的图片压缩为浏览器最优格式 WebP，输出回 public/。
// 原图统一保留在 origin/ 目录（不参与前端构建/打包，仅作备份与再次压缩的源）。
// 用法：确保原图在 origin/ 下，然后 node resize-bg.mjs
import { createRequire } from 'node:module'
import { existsSync, statSync } from 'node:fs'

// sharp 是后端已有依赖，前端未装：优先用本地，找不到再回退到 student-backend/node_modules。
const require = createRequire(import.meta.url)
let sharp
try {
  sharp = require('sharp')
} catch {
  sharp = createRequire(new URL('../student-backend/', import.meta.url))('sharp')
}

// 任务表：src 原图（origin/）→ dst 产物（public/）；long 为长边上限（不放大）。
const jobs = [
  // logo：界面最大只显示到 ~96px，256×256 已够高清；保留透明通道
  { src: 'origin/logo.png', dst: 'public/logo.webp', long: 256, quality: 90 },
  // 毛玻璃日间底图：全屏铺满，长边 1920 兼顾清晰与体积
  { src: 'origin/glass-bg.jpg', dst: 'public/glass-bg-opt.webp', long: 1920, quality: 80 },
  // 毛玻璃夜间底图：原图长边 1536，保持原尺寸
  { src: 'origin/glass-bg-night.jpg', dst: 'public/glass-bg-night.webp', long: 1536, quality: 80 },
  // 打赏收款码：需保持清晰以利扫码，保持原分辨率不缩放，质量偏保守（二维码边缘有损易糊）
  { src: 'origin/wechatpay.png', dst: 'public/wechatpay.webp', quality: 90 },
  { src: 'origin/alipay.jpg', dst: 'public/alipay.webp', quality: 90 },
]

const kb = (p) => (statSync(p).size / 1024).toFixed(1) + 'KB'

for (const { src, dst, long, quality } of jobs) {
  if (!existsSync(src)) {
    console.warn(`跳过：找不到源图 ${src}`)
    continue
  }
  const meta = await sharp(src).metadata()
  let pipe = sharp(src)
  if (long && Math.max(meta.width, meta.height) > long) {
    pipe = pipe.resize(long, long, { fit: 'inside', withoutEnlargement: true })
  }
  await pipe.webp({ quality, alphaQuality: 100, effort: 6 }).toFile(dst)
  const out = await sharp(dst).metadata()
  console.log(
    `${src} (${meta.width}×${meta.height}, ${kb(src)}) → ${dst} (${out.width}×${out.height}, ${kb(dst)})`
  )
}
