// OCR 探针：用 sharp 生成一张带中文文字的 PNG，验证 Windows OCR 服务能否正确识别。
// 用法：
//   node testjs/ocr-probe.mjs                  # 默认两行示例文字
//   node testjs/ocr-probe.mjs "班费支出 500 元"  # 自定义单行文字
//   OCR_TEXT="第一行|第二行" node testjs/ocr-probe.mjs   # 用 | 分隔多行
// 说明：仅 Windows 有效（底层调用系统 OCR 能力）；路径全部相对仓库根目录解析，可在任意 cwd 下执行。
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 以 student-backend 的 package.json 为基准解析依赖（sharp 装在该子工程下）
const require = createRequire(path.join(ROOT, 'student-backend', 'package.json'))
const sharp = require('sharp')
const { recognizeDataUrl } = require(path.join(ROOT, 'student-backend', 'services', 'ocr.js'))

// 文字来源：命令行参数 > OCR_TEXT 环境变量 > 默认示例
const fromArgs = process.argv.slice(2).join(' ').trim()
const fromEnv = String(process.env.OCR_TEXT || '').split('|').map((s) => s.trim()).filter(Boolean)
const lines = fromArgs ? [fromArgs] : (fromEnv.length ? fromEnv : ['班费支出 2026年10月', '合计 12800 元'])

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const width = 820
const height = Math.max(160, 60 + lines.length * 90)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${lines.map((t, i) => `<text x="40" y="${95 + i * 90}" font-size="54" font-family="Microsoft YaHei" fill="#000000">${esc(t)}</text>`).join('\n  ')}
</svg>`

const png = await sharp(Buffer.from(svg)).png().toBuffer()
const dataUrl = 'data:image/png;base64,' + png.toString('base64')

console.log('--- 输入文字 ---')
lines.forEach((l) => console.log('  ' + l))
console.log('--- 识别结果 ---')
console.log(JSON.stringify(await recognizeDataUrl(dataUrl), null, 1))
