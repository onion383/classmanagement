/**
 * 核对动态子集的 cmap 是否覆盖「实际会被绘制的全部字符」。
 * 漏一个字 = PDF 里那块空白（jsPDF 不报错、不告警，所以只能靠这种逐字核对兜住）。
 *
 * 原为 font-subset-verify.py（fontTools），2026-10-29 转纯 Node 实现：
 * 直接解析 sfnt 二进制（表目录 + cmap 0/4/6/12 + name 表），零第三方依赖，
 * 不再需要 Python 环境。校验口径与原 py 版一致：
 *   · cmap 覆盖 = 码位在子表中有映射条目（与 fontTools getBestCmap 的键存在语义一致）；
 *   · name 表须保留 0/1/2/13/14（版权/家族/样式/许可/许可链接）；
 *   · 每条调用路径的文本各自对应一份子集来核（不能拿 A 的子集去校验 B 的文本）。
 *
 * 输入（由 testjs/smoke/pdf-subset-verify.mjs 产出）：
 *   testjs/tmp/subset-out.ttf        子集字体
 *   testjs/tmp/subset-out-excel.ttf  子集字体（ExportExcel 路径）
 *   testjs/tmp/subset-text.txt       必须被覆盖的字符
 *   testjs/tmp/subset-text-excel.txt 同上（ExportExcel 路径）
 *
 * 跑法：node testjs/smoke/font-subset-verify.mjs
 * 退出码：0 全部覆盖；2 有缺字；3 产物缺失（先跑 pdf-subset-verify.mjs，视为环境不具备跳过）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')
const TMP = path.join(ROOT, 'testjs', 'tmp')

// ---- sfnt 表目录 ----
function parseTables(buf) {
  const numTables = buf.readUInt16BE(4)
  const tables = {}
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16
    tables[buf.toString('latin1', p, p + 4)] = {
      offset: buf.readUInt32BE(p + 8),
      length: buf.readUInt32BE(p + 12),
    }
  }
  return tables
}

// ---- cmap 子表：返回 { has(cp) }（键存在语义，与 fontTools getBestCmap 一致） ----
function parseCmapFormat(buf, off) {
  const format = buf.readUInt16BE(off)
  if (format === 4) {
    const segCount = buf.readUInt16BE(off + 6) / 2
    const endO = off + 14
    const startO = endO + segCount * 2 + 2
    const deltaO = startO + segCount * 2
    const rangeO = deltaO + segCount * 2
    const segs = []
    for (let i = 0; i < segCount; i++) {
      segs.push({
        start: buf.readUInt16BE(startO + i * 2),
        end: buf.readUInt16BE(endO + i * 2),
        rangeOffset: buf.readUInt16BE(rangeO + i * 2),
        rangeOffsetPos: rangeO + i * 2,
      })
    }
    return {
      has(cp) {
        if (cp > 0xffff) return false
        for (const s of segs) {
          if (cp < s.start || cp > s.end) continue
          if (s.rangeOffset === 0) return true // 段内连续映射：整段有条目
          const gi = s.rangeOffsetPos + s.rangeOffset + (cp - s.start) * 2
          return gi + 1 < buf.length // glyphIdArray 有显式条目即算覆盖
        }
        return false
      },
    }
  }
  if (format === 12) {
    const n = buf.readUInt32BE(off + 12)
    const groups = []
    for (let i = 0; i < n; i++) {
      const p = off + 16 + i * 12
      groups.push({ start: buf.readUInt32BE(p), end: buf.readUInt32BE(p + 4) })
    }
    return { has: (cp) => groups.some((g) => cp >= g.start && cp <= g.end) }
  }
  if (format === 0) {
    return { has: (cp) => cp >= 0 && cp < 256 } // 256 项定长表：键齐全
  }
  if (format === 6) {
    const first = buf.readUInt16BE(off + 6)
    const count = buf.readUInt16BE(off + 8)
    return { has: (cp) => cp >= first && cp < first + count }
  }
  return null // 其它格式（5/10/13…）：本项目子集不产出，遇到即不识别
}

function bestCmap(buf, tables) {
  const t = tables.cmap
  if (!t) return null
  const base = t.offset
  const numSub = buf.readUInt16BE(base + 2)
  const subs = []
  for (let i = 0; i < numSub; i++) {
    const p = base + 4 + i * 8
    subs.push({
      platform: buf.readUInt16BE(p),
      encoding: buf.readUInt16BE(p + 2),
      offset: base + buf.readUInt32BE(p + 4),
    })
  }
  // fontTools getBestCmap 偏好：Windows 全 Unicode(3,10) > Windows BMP(3,1) > Unicode(0,*) > 其它
  const score = (s) =>
    s.platform === 3 && s.encoding === 10 ? 4 : s.platform === 3 && s.encoding === 1 ? 3 : s.platform === 0 ? 2 : 1
  subs.sort((a, b) => score(b) - score(a))
  for (const s of subs) {
    const c = parseCmapFormat(buf, s.offset)
    if (c) return c
  }
  return null
}

// ---- name 表：0/1/2/13/14 的保留情况（只取每个 nameID 的第一条，与 py 版一致） ----
function utf16beToString(raw) {
  const b = Buffer.from(raw)
  for (let i = 0; i + 1 < b.length; i += 2) {
    const t = b[i]
    b[i] = b[i + 1]
    b[i + 1] = t
  }
  return b.toString('utf16le')
}

function parseNames(buf, tables) {
  const t = tables.name
  const out = new Map()
  if (!t) return out
  const base = t.offset
  const count = buf.readUInt16BE(base + 2)
  const stringOffset = buf.readUInt16BE(base + 4)
  for (let i = 0; i < count; i++) {
    const p = base + 6 + i * 12
    const platform = buf.readUInt16BE(p)
    const nameID = buf.readUInt16BE(p + 6)
    const length = buf.readUInt16BE(p + 8)
    const offset = buf.readUInt16BE(p + 10)
    if (out.has(nameID)) continue
    const start = base + stringOffset + offset
    const raw = buf.subarray(start, start + length)
    out.set(nameID, (platform === 3 || platform === 0 ? utf16beToString(raw) : raw.toString('latin1')).slice(0, 60))
  }
  return out
}

// ---- 主流程 ----
const SUBSET = path.join(TMP, 'subset-out.ttf')
if (!fs.existsSync(SUBSET)) {
  console.log('缺少子集文件，先跑 node testjs/smoke/pdf-subset-verify.mjs')
  console.log('（缺少产物时本脚本视为环境不具备，跳过而非失败）')
  process.exit(3)
}

const buf = fs.readFileSync(SUBSET)
const tables = parseTables(buf)
const cmap = bestCmap(buf, tables)

// name 表：合规要求子集后仍带版权（0）与许可（13/14）
const keep = new Map([
  [0, '版权'],
  [1, '字体名'],
  [2, '样式'],
  [13, '许可'],
  [14, '许可链接'],
])
const names = parseNames(buf, tables)
console.log(`子集字形数: ${countCmap(buf, tables)}`)
console.log('name 表保留情况:')
for (const [nid, label] of keep) {
  const has = names.has(nid) ? '有' : '缺'
  console.log(`  [${String(nid).padStart(2)}] ${label}: ${has}   ${names.get(nid) || ''}`)
}

// 字形数 = cmap 的映射条目数（逐段/组累加区间大小，与 fontTools len(cmap) 同口径）
function countCmap(b, tb) {
  const t = tb.cmap
  if (!t) return 0
  const base = t.offset
  const numSub = b.readUInt16BE(base + 2)
  let best = null
  for (let i = 0; i < numSub; i++) {
    const p = base + 4 + i * 8
    const off = base + b.readUInt32BE(p + 4)
    const fmt = b.readUInt16BE(off)
    if (fmt === 4 || fmt === 12) { best = off; break }
  }
  if (best == null) return 0
  const fmt = b.readUInt16BE(best)
  if (fmt === 12) {
    const n = b.readUInt32BE(best + 12)
    let c = 0
    for (let i = 0; i < n; i++) {
      const p = best + 16 + i * 12
      c += b.readUInt32BE(p + 4) - b.readUInt32BE(p) + 1
    }
    return c
  }
  const segCount = b.readUInt16BE(best + 6) / 2
  const endO = best + 14
  const startO = endO + segCount * 2 + 2
  let c = 0
  let hasSentinel = false
  for (let i = 0; i < segCount; i++) {
    const s = b.readUInt16BE(startO + i * 2)
    const e = b.readUInt16BE(endO + i * 2)
    if (e >= s) {
      c += e - s + 1
      if (s <= 0xffff && e >= 0xffff) hasSentinel = true
    }
  }
  if (hasSentinel) c -= 1 // 末段 0xFFFF 是 format 4 的必填哨兵，不算字形
  return c
}

let ok = true
// 每条调用路径的文本不同，必须各自对应一份子集来核（不能拿 A 的子集去校验 B 的文本）
for (const [fontFile, textFile] of [
  ['subset-out.ttf', 'subset-text.txt'],
  ['subset-out-excel.ttf', 'subset-text-excel.txt'],
]) {
  const fp = path.join(TMP, fontFile)
  const tp = path.join(TMP, textFile)
  if (!(fs.existsSync(fp) && fs.existsSync(tp))) continue
  const f2 = fs.readFileSync(fp)
  const cm2 = bestCmap(f2, parseTables(f2))
  const text = fs.readFileSync(tp, 'utf8')
  const need = new Set([...text].filter((c) => c.codePointAt(0) >= 0x20))
  const miss = [...need].filter((c) => !cm2.has(c.codePointAt(0))).sort((a, b) => a.codePointAt(0) - b.codePointAt(0))
  console.log(`\n${textFile} ← ${fontFile}: 需要 ${need.size} 个字符，缺 ${miss.length} 个`)
  if (miss.length) {
    ok = false
    console.log(`  缺失: ${miss.join('')}`)
    console.log(`  码位: [${miss.map((c) => '0x' + c.codePointAt(0).toString(16)).join(', ')}]`)
  } else {
    console.log('  全部覆盖')
  }
}
process.exit(ok ? 0 : 2)
