const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const router = express.Router();

// 允许解析的扩展名与下方 /upload 的解析分支保持一致（文本 / PDF / Word / PPT / Excel）
const ALLOWED_UPLOAD_EXT = /\.(txt|csv|md|json|xml|html|pdf|docx?|pptx|xlsx?)$/i;

// 文件上传中间件惰性构造（临时存储在系统临时目录）：multer（含 busboy）约 50KB，
// 只在首次真正上传文件时才 require，避免启动/空闲期就解析；require 有缓存，首次之后零成本。
let _upload = null;
function getUpload() {
  if (_upload) return _upload;
  const multer = require('multer');
  _upload = multer({
    dest: path.join(os.tmpdir(), 'ai-uploads'),
    limits: {
      fileSize: 20 * 1024 * 1024, // 单文件 20MB，超出直接拒绝，避免超大文件拖垮解析
      files: 1,                    // 一次只接受一个文件
    },
    fileFilter: (req, file, cb) => {
      const ok = ALLOWED_UPLOAD_EXT.test(file.originalname || '');
      // 第二个参数 includeFile=true 表示接受；false 时 multer 会丢弃文件并报错
      cb(ok ? null : new Error('不支持的文件类型，请上传 txt/csv/md/json/xml/html/pdf/doc/docx/ppt/pptx/xls/xlsx'), ok);
    },
  });
  return _upload;
}

// 把「惰性构造的 multer」接进路由：首次请求时才构造，行为与原 upload.single('file') 一致
const uploadSingle = (req, res, next) => getUpload().single('file')(req, res, next);


// =========================================================================
// 文件上传解析接口：提取文本（PDF/Word/PPT/Excel/TXT/CSV等）返回给前端
// =========================================================================
router.post('/upload', uploadSingle, async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, error: '未上传文件' });
    }
    const { originalname, path: tempPath, mimetype } = req.file;
    let text = '';

    try {
      const ext = path.extname(originalname).toLowerCase();
      
      // TXT / CSV 纯文本：直接读取
      if (ext === '.txt' || ext === '.csv' || ext === '.md' || ext === '.json' || ext === '.xml' || ext === '.html') {
        text = fs.readFileSync(tempPath, 'utf-8');
      }
      // PDF：用 pdf-parse 提取文本（v2 起导出 PDFParse 类，不再是可调用函数）
      else if (ext === '.pdf') {
        // pdfjs 在 Node 下需要 DOMMatrix 全局；此前由 35MB 的 @napi-rs/canvas 提供。
        // 本应用只做文本提取（不渲染），改用纯 JS 轻量补丁，从而打包时剔除 canvas。
        // 必须在本行之前安装，pdf-parse 内部会用到该全局。
        require('../../services/pdfDomShim');
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: fs.readFileSync(tempPath) });
        try {
          text = (await parser.getText()).text;
        } finally {
          await parser.destroy();
        }
      }
      // Word (.docx)：用 mammoth 提取文本
      else if (ext === '.docx' || ext === '.doc') {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: tempPath });
        text = result.value;
      }
      // Excel (.xlsx/.xls/.csv)：用 xlsx 提取所有单元格文本
      else if (ext === '.xlsx' || ext === '.xls') {
        const XLSX = require('xlsx');
        // 原型污染防护：xlsx 解析恶意文件可能向 Object.prototype 注入属性，
        // 解析前后对比自有属性名，移除新增的键（GHSA-4r6h-8v6p-xvw6 缓解）。
        const protoSnapshot = new Set(Object.getOwnPropertyNames(Object.prototype));
        let workbook;
        try {
          // sheetRows 限制单表最多解析的行数，约束 ReDoS 与内存爆炸半径（GHSA-5pgg-2g8v-p4x9 缓解）
          workbook = XLSX.readFile(tempPath, { sheetRows: 5000 });
        } finally {
          for (const k of Object.getOwnPropertyNames(Object.prototype)) {
            if (!protoSnapshot.has(k)) { try { delete Object.prototype[k]; } catch (_) {} }
          }
        }
        const lines = [];
        // 限制工作表数量，避免多表恶意文件耗尽内存
        workbook.SheetNames.slice(0, 20).forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          lines.push(`=== Sheet: ${sheetName} ===`);
          json.forEach((row) => {
            lines.push(row.map(String).join('\t'));
          });
        });
        text = lines.join('\n');
      }
      // PowerPoint (.pptx)：本质是 zip，解压后按页读取 ppt/slides/slideN.xml，
      // 抽取每个段落（<a:p>）里的 <a:t> 文字节点，按 第N页 分段输出纯文本
      else if (ext === '.pptx') {
        const extractZip = require('extract-zip'); // 复用 ffmpeg 已在用的轻量解压库，按需加载
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-'));
        try {
          await extractZip(tempPath, { dir });
          // XML 实体最小还原，避免正文里出现 &amp; 之类
          const unescapeXml = (s) => s
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
          const lines = [];
          const slidesDir = path.join(dir, 'ppt', 'slides');
          if (fs.existsSync(slidesDir)) {
            // 按 slide1、slide2… 的自然顺序排序（字符串排序会把 slide10 排到 slide2 前）
            const files = fs.readdirSync(slidesDir)
              .filter((f) => /^slide\d+\.xml$/i.test(f))
              .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
            files.forEach((f, i) => {
              const xml = fs.readFileSync(path.join(slidesDir, f), 'utf-8');
              // 同一段落里的多个 <a:t> 属于一段，先按段落拼接，再逐段成行
              const paras = xml.split('</a:p>')
                .map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unescapeXml(m[1])).join(''))
                .filter((p) => p.trim());
              lines.push(`=== 第 ${i + 1} 页 ===`);
              if (paras.length) lines.push(paras.join('\n'));
            });
          }
          text = lines.length ? lines.join('\n') : '（未从该演示文稿中提取到文字）';
        } finally {
          // 解压目录整体清掉，不留残余
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        }
      }
      // 默认：尝试按文本读取
      else {
        text = fs.readFileSync(tempPath, 'utf-8');
      }

      // 限制总长度：AI 有 context 限制，这里截一下
      const MAX_LEN = 100000; // ~100KB，足够一般使用
      if (text.length > MAX_LEN) {
        text = text.slice(0, MAX_LEN) + `\n\n...（文件太长，已截断至 ${MAX_LEN} 字符）`;
      }
    } catch (err) {
      // 提取失败，直接返回文件名 + 错误提示
      text = `文件名：${originalname}\n\n错误：提取文本失败 (${err.message})`;
    } finally {
      // 删除临时文件
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }

    return res.json({
      success: true,
      data: {
        filename: originalname,
        text: text,
        length: text.length,
      },
    });
  } catch (err) {
    return res.json({ success: false, error: err.message || '解析文件失败' });
  }
});

// 文件被 multer 拒绝（类型不支持 / 超过大小上限）时，统一返回与业务一致的错误结构
router.use('/upload', (err, req, res, next) => {
  if (!err) return next();
  const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件过大，请上传 20MB 以内的文件' : (err.message || '文件上传失败');
  res.status(400).json({ success: false, error: msg });
});


module.exports = router;
