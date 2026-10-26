/**
 * PDF 导出用的中文字体（动态子集）
 *
 * 旧做法：每次导出都 fetch 整份 `/NotoSansSC-6.ttf.gz`（7.63MB）→ 解压 12.75MB →
 * base64 → 整个塞进 jsPDF。实测 50 行×8 列：386ms、PDF 1.78MB。
 *
 * 现做法：全量字体只加载一次（模块级缓存），导出前按「本次要画的字符」现做子集，
 * 把十几 KB 的子集喂给 jsPDF。实测 22ms、PDF 121KB，且不会缺字（字符取自实际文本）。
 * 子集化细节见 `utils/hbSubset.js`。
 *
 * 两条兜底，保证这个新能力出问题时导出仍然可用：
 *   1. 子集化失败（wasm 加载不了 / 浏览器不支持）→ 退回全量字体，行为等同改造前；
 *   2. 调用方忘了传文本 → 同样退回全量字体，宁可慢也不出错。
 */

import { subsetTtf } from './hbSubset.js'

const FONT_GZ_URL = '/NotoSansSC-6.ttf.gz'

// 兜底字符：标点、数字、单位，以及表格里由代码拼出来的固定词（如「讲台」「星期」）。
// 这些文本不一定出现在入参数据里（是渲染时拼的），漏了就会在 PDF 里变成空白，
// 所以固定带上一批。增量很小（每字约 0.3KB），换来的是「不会静默缺字」。
const SAFETY_TEXT = '0123456789.,:;%-+/()（）：、。，；！？ 【】　讲台备注合计总计平均分'
  + '星期周一二三四五六日上下午晚自习课次节科目教师班级人数第共页'

let fullTtfPromise = null

/**
 * 加载并缓存全量 TTF（解压后约 12.75MB，只占一次）。
 * 服务器是否已解压不一致，所以按 gzip 魔数判断后再决定要不要解：
 *   · 打包版 app:// 原样返回 gzip 字节，需自行解压；
 *   · Vite dev 会把 .gz 当预压缩资源（Content-Encoding: gzip），浏览器已透明解压。
 * Chromium 的 DecompressionStream 只支持 gzip/deflate，不支持 zstd —— 别改回 zstd。
 */
function loadFullTtf() {
  if (!fullTtfPromise) {
    fullTtfPromise = fetch(FONT_GZ_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`字体文件加载失败: HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then(async (buf) => {
        const bytes = new Uint8Array(buf)
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
          return new Response(stream).arrayBuffer()
        }
        return buf
      })
      .catch((e) => {
        fullTtfPromise = null // 失败不缓存，下次导出可重试
        throw e
      })
  }
  return fullTtfPromise
}

// 递归深度与节点数的保险丝：正常数据只有 3 层（行数组 → 行对象 → 单元格），
// 这两个上限只是防止误传超大对象时把主线程拖住。
const MAX_DEPTH = 32
const MAX_NODES = 200000

/**
 * 把任意嵌套的字符串/数字（数组、行对象）拍平成一段文本，供子集使用。
 *
 * 三个防御（都来自实测，不是臆想）：
 *   · **深度上限**：裸递归遇到 `row.child = row` 这种结构会直接 RangeError 爆栈，
 *     而调用点是 `loadPdfFontBase64(collectPdfText(...))`，抛错会被外层 catch 吃掉，
 *     结果是「字体没加载 → 退回 helvetica → 整份 PDF 中文全乱码」。宁可少收字符也不能抛。
 *     深度到顶就停，环最多被重复走 32 层，多余字符进子集无副作用（去重由 hb 做）。
 *   · **只走自有属性**：用 Object.keys 而不是 for...in，避免顺着原型链爬。
 *   · **节点上限**：防止误传超大对象时把主线程拖住。
 * （没上 WeakSet 做环检测：正常数据是树、不存在重叠引用，WeakSet 只带来 2~3ms 纯开销。）
 */
export function collectPdfText(...parts) {
  const out = []
  let nodes = 0
  let truncated = false
  const walk = (v, depth) => {
    if (v == null || depth > MAX_DEPTH) return
    if (nodes > MAX_NODES) {
      truncated = true
      return
    }
    const t = typeof v
    if (t === 'string') {
      out.push(v)
      return
    }
    if (t === 'number' || t === 'boolean') {
      out.push(String(v))
      return
    }
    if (t !== 'object') return
    nodes++
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1)
      return
    }
    for (const k of Object.keys(v)) walk(v[k], depth + 1) // 只取值，不把键名算进去
  }
  for (const p of parts) walk(p, 0)
  // 截断必须出声：静默少收字符 = PDF 里某几个字变空白（和缺字一样的隐蔽事故）
  if (truncated) console.warn(`[pdf] 文本收集达到 ${MAX_NODES} 个节点上限，已截断；若 PDF 出现空白字请检查入参`)
  return out.join('') + SAFETY_TEXT
}

function toBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  // 小字体（子集的常态，十几 KB）直接拼；超过 64KB 走 FileReader（浏览器原生，比逐块 btoa 快）
  if (bytes.length < 0x10000) {
    // 分块 fromCharCode：一次 apply 处理 32KB，避免逐字节 += 的字符串反复扩容
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    return btoa(binary)
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(new Blob([bytes]))
  })
}

/**
 * 全量字体解压后是 12.75MB 的 ArrayBuffer，留着可以让下次导出省掉 ~48ms（重新 fetch 7.6MB gz + 解压）。
 * 但一直挂着就是纯常驻，所以：导出结束后起一个 60s 定时器，期间没再导出就把它还回去。
 * 连续导出多个表时共享缓存，空闲后不占内存。
 */
const FONT_IDLE_RELEASE_MS = 60000
let releaseTimer = null

function scheduleFontRelease() {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => {
    fullTtfPromise = null
    releaseTimer = null
  }, FONT_IDLE_RELEASE_MS)
}

/**
 * 取「只含 text 中字符」的字体 base64，供 jsPDF 的 addFileToVFS 使用。
 * @param {string} text 本次要绘制的全部字符（用 collectPdfText 收集）
 */
export async function loadPdfFontBase64(text) {
  const full = await loadFullTtf()
  let bytes = full
  if (text) {
    try {
      bytes = await subsetTtf(full, text)
    } catch (e) {
      // 子集化不可用时不能让导出失败，退回全量（慢、但和改造前一样能出图）
      console.warn('[pdf] 字体子集化失败，已退回全量字体:', e)
      bytes = full
    }
  }
  const b64 = await toBase64(bytes)
  scheduleFontRelease() // 用完不立刻丢（下次导出还要用），空闲 60s 后再还回去
  return b64
}
