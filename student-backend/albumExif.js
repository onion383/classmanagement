// =========================================================================
// albumExif.js —— 从图片文件里读「拍摄时间」
//
// 为什么需要：相册时间轴原来按文件修改时间（mtime）分组，而 mtime 会被
// 复制、解压、微信/QQ 转存、同步盘上传下载全部改写 —— 一批 2019 年拍的
// 照片从QQ 导出来，时间轴就全变成「今天」。真正的拍摄时间在 EXIF 里：
// DateTimeOriginal（0x9003，实际拍摄）/ DateTimeDigitized（0x9004，数字化时间）
// / DateTime（0x0132，I FD0 里的通用时间），XMP 里也有 exif:DateTimeOriginal。
//
// 为什么不引第三方 exif 库：EXIF 就是一段 TIFF 头 + IFD 目录，本模块只需要
// 三个 ASCII 标签，自己解约 80 行，比多一个依赖更可控（也不进node_modules）。
//
// 覆盖格式：sharp 能解头的 JPEG / PNG / WebP / TIFF / AVIF / HEIF（有损或无损
// 由 sharp 构建决定）。读不动就返回 ''，调用方回退到 mtime —— 绝不猜。
// 视频没有 EXIF（ffprobe 太慢，扫描时每张都调命令行不可接受），一律走 mtime。
// =========================================================================

const MIN_YEAR = 1980   // 早于 1980 的「拍摄时间」基本是相机没上电的默认值
const MAX_SKEW_DAYS = 2 // 比「现在」还晚超过 2 天的，视为相机时钟没校准

// 把 "2024:05:06 10:11:12" 这种 EXIF 写法转成 "2024-05-06T10:11:12"（本地时间，无时区后缀）
// dateKey() 用 new Date() 解析无后缀字符串会按本地时间处理，日期分组才不会偏。
function normalizeExifDate(str) {
  if (!str) return ''
  const m = String(str).trim().match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return ''
  const [, y, mo, d, h, mi, s] = m
  const year = +y
  const mon = +mo
  const day = +d
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return ''
  if (h > 23 || mi > 59 || s > 59) return ''
  // 合理性校验：相机没上电时会写 0000:00:00 或 1970:01:01，相机时钟没校准会写未来时间
  if (year < MIN_YEAR) return ''
  const dt = new Date(year, mon - 1, day, +h, +mi, +s)
  if (isNaN(dt.getTime())) return ''
  if (dt.getTime() - Date.now() > MAX_SKEW_DAYS * 86400000) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${year}-${p(mon)}-${p(day)}T${p(+h)}:${p(+mi)}:${p(+s)}`
}

// 从一段 TIFF/EXIF 字节里取出第一个命中的标签值。
// 只处理 ASCII(2) / SHORT(3) / LONG(4) 三种类型 —— 日期标签都是 ASCII，
// ExifIFD 指针(0x8769)是 LONG，正好够用。
function readExifBuf(buf) {
  if (!buf || buf.length < 8) return null
  // sharp 给的通常已是 TIFF 头；少数来源前面带 "Exif\0\0" 前缀，跳过
  let base = 0
  if (buf.length > 6 && buf[0] === 0x45 && buf[1] === 0x78 && buf[2] === 0x69 && buf[3] === 0x66) base = 6
  const le = buf[base] === 0x49 && buf[base + 1] === 0x49
  const be = buf[base] === 0x4d && buf[base + 1] === 0x4d
  if (!le && !be) return null
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o))
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))

  if (u16(base + 2) !== 42) return null // TIFF magic
  // 注意：块内所有偏移都是相对 TIFF 头（即 base），带 "Exif\0\0" 前缀时要加上 base
  const ifd0 = base + u32(base + 4)
  if (ifd0 < 8 || ifd0 + 2 > buf.length) return null

  // 读一个 IFD 的全部条目，返回 Map<tag, 值>（值只取ASCII 字符串或数字）
  function readIfd(offset) {
    const out = new Map()
    if (offset < 8 || offset + 2 > buf.length) return out
    const n = u16(offset)
    // 条目数异常（截断/损坏）时按剩余长度收敛，避免越界读
    const maxEntries = Math.min(n, Math.floor((buf.length - offset - 2) / 12))
    for (let i = 0; i < maxEntries; i++) {
      const e = offset + 2 + i * 12
      if (e + 12 > buf.length) break
      const tag = u16(e)
      const type = u16(e + 2)
      const count = u32(e + 4)
      const valOff = e + 8
      if (type === 2) { // ASCII
        const start = count <= 4 ? valOff : base + u32(valOff)
        if (start < 0 || start >= buf.length) continue
        let end = start
        const max = Math.min(count, buf.length - start)
        while (end < start + max && buf[end] !== 0) end++
        out.set(tag, buf.toString('latin1', start, end))
      } else if (type === 3) { // SHORT
        out.set(tag, count <= 2 ? u16(valOff) : u16(base + u32(valOff)))
      } else if (type === 4) { // LONG
        out.set(tag, count <= 1 ? u32(valOff) : u32(base + u32(valOff)))
      }
    }
    return out
  }

  const ifd0Tags = readIfd(ifd0)
  const exifPtr = ifd0Tags.get(0x8769) // Exif IFD 指针
  const exifTags = typeof exifPtr === 'number' ? readIfd(base + exifPtr) : new Map()

  // 优先级：实际拍摄时间 > 数字化时间 > IFD0 通用时间
  const candidates = [
    exifTags.get(0x9003), // DateTimeOriginal
    exifTags.get(0x9004), // DateTimeDigitized
    ifd0Tags.get(0x0132),  // DateTime
  ]
  for (const c of candidates) {
    const v = normalizeExifDate(c)
    if (v) return v
  }
  return null
}

// XMP 里也常有拍摄时间（部分手机/相机只写 XMP 不写 EXIF）。字符串里正则捞一把。
function readXmp(xmp) {
  if (!xmp || typeof xmp !== 'string') return ''
  const m = xmp.match(/(?:exif:)?DateTimeOriginal\s*=\s*"([^"]+)"/)
    || xmp.match(/<exif:DateTime(?:Original|Digitized)?[^>]*>([^<]+)<\/exif:DateTime[^>]*>/)
  return m ? normalizeExifDate(m[1]) : ''
}

/**
 * 读一个图片文件的拍摄时间。
 * @returns {Promise<string>} 形如 "2024-05-06T10:11:12"（本地时间）；读不到返回 ''
 */
async function readExifDate(filePath) {
  try {
    const sharp = require('sharp') // 懒加载：与genThumb 一致，启动不背 sharp 初始化成本
    const meta = await sharp(filePath, { failOn: 'none' }).metadata()
    if (!meta) return ''
    return readExifBuf(meta.exif) || readXmp(meta.xmp) || ''
  } catch (_) {
    // 格式不支持 / 文件损坏 / 权限问题：全部回退到 mtime，不抛
    return ''
  }
}

module.exports = { readExifDate, normalizeExifDate, readExifBuf, readXmp }