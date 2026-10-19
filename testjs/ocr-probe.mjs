// 临时探针：用 sharp 生成一张带中文文字的 PNG，验证 Windows OCR 服务能否正确识别
import { createRequire } from 'module'
const require = createRequire('d:/code/Webapp/project-name/student-backend/package.json')
const sharp = require('sharp')
const { recognizeDataUrl } = require('d:/code/Webapp/project-name/student-backend/services/ocr.js')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="240">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="40" y="95" font-size="54" font-family="Microsoft YaHei" fill="#000000">班费支出 2026年10月</text>
  <text x="40" y="180" font-size="54" font-family="Microsoft YaHei" fill="#000000">合计 12800 元</text>
</svg>`

const png = await sharp(Buffer.from(svg)).png().toBuffer()
const dataUrl = 'data:image/png;base64,' + png.toString('base64')
console.log('--- 识别结果 ---')
console.log(JSON.stringify(await recognizeDataUrl(dataUrl), null, 1))
