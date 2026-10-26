const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const router = express.Router();

// 允许解析的扩展名与下方 /upload 的解析分支保持一致（文本 / PDF / Word / PPT / Excel）
const ALLOWED_UPLOAD_EXT = /\.(txt|csv|md|json|xml|html|pdf|docx?|pptx|xlsx?)$/i;

// 返回给 AI 的文本上限（AI 有上下文限制，长文件只在前面这段有意义）。
// pptx 分支也用它作为「读够就停」的阈值 —— 反正最终只保留这么多，多解压的页没有意义。
const MAX_TEXT_LEN = 100000;

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
    const { originalname, path: tempPath } = req.file;
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
      // PowerPoint (.pptx)：本质是 zip，直接在内存里读 ppt/slides/slideN.xml，
      // 抽取每个段落（<a:p>）里的 <a:t> 文字节点，按 第N页 分段输出纯文本。
      //
      // 为什么不再落盘解压：这里的输入是**用户上传的文件**，而 extract-zip 存在
      // 「zip 内符号链接可写任意路径」的漏洞且无修复版本。jszip 把所有条目当字节流，
      // 根本不会还原符号链接，攻击面从根上消失；顺带省掉临时目录与清理。
      //
      // 资源闸门（防压缩炸弹）：multer 的 20MB 只挡住**文件本身**，挡不住解压后的膨胀
      // —— 1000:1 的压缩比很常见，20MB 的包可以解出 20GB。所以按「解压后」的体积再设三道：
      //   · 单个条目 20MB（正常一页 slide 的 XML 只有几十 KB）
      //   · 全部条目合计 100MB
      //   · 读取累计到 MAX_TEXT_LEN 就停（与下方统一的截断阈值一致，反正最终只保留这么多）
      // 前两道超限直接报错而不是「尽力解析」：残缺内容比明确失败更难排查。
      else if (ext === '.pptx') {
        const JSZip = require('jszip'); // mammoth 解析 docx 时已带，不新增依赖
        const zip = await JSZip.loadAsync(fs.readFileSync(tempPath));

        const MAX_ENTRY = 20 * 1024 * 1024;
        const MAX_TOTAL = 100 * 1024 * 1024;

        // jszip 把压缩条目存成 { compressedSize, uncompressedSize }；STORE 条目是原始数据
        const entrySize = (f) => {
          if (!f || f.dir) return 0;
          const d = f._data;
          if (d && typeof d === 'object' && typeof d.uncompressedSize === 'number') return d.uncompressedSize;
          if (typeof d === 'string') return Buffer.byteLength(d, 'utf8');
          return (d && typeof d.length === 'number') ? d.length : 0;
        };

        let totalSize = 0;
        for (const name of Object.keys(zip.files)) {
          const size = entrySize(zip.files[name]);
          if (size > MAX_ENTRY) {
            return res.json({ success: false, error: `压缩包内单个文件过大（约 ${(size / 1048576).toFixed(1)}MB），已拒绝解析` });
          }
          totalSize += size;
          if (totalSize > MAX_TOTAL) {
            return res.json({ success: false, error: `解压后体积超过 ${MAX_TOTAL / 1048576}MB，已拒绝解析` });
          }
        }

        // XML 实体最小还原，避免正文里出现 &amp; 之类
        const unescapeXml = (s) => s
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&');

        const lines = [];
        let textLen = 0;
        // 按 slide1、slide2… 的自然顺序排序（字符串排序会把 slide10 排到 slide2 前）
        const slideNames = Object.keys(zip.files)
          .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
          .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));

        for (let i = 0; i < slideNames.length; i++) {
          if (textLen >= MAX_TEXT_LEN) break; // 攒够最终要保留的量就不再解压后面的页
          const xml = await zip.files[slideNames[i]].async('string');
          textLen += xml.length;
          // 同一段落里的多个 <a:t> 属于一段，先按段落拼接，再逐段成行
          const paras = xml.split('</a:p>')
            .map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unescapeXml(m[1])).join(''))
            .filter((p) => p.trim());
          lines.push(`=== 第 ${i + 1} 页 ===`);
          if (paras.length) lines.push(paras.join('\n'));
        }
        text = lines.length ? lines.join('\n') : '（未从该演示文稿中提取到文字）';
      }
      // 默认：尝试按文本读取
      else {
        text = fs.readFileSync(tempPath, 'utf-8');
      }

      // 限制总长度：AI 有 context 限制，这里截一下
      if (text.length > MAX_TEXT_LEN) {
        text = text.slice(0, MAX_TEXT_LEN) + `\n\n...（文件太长，已截断至 ${MAX_TEXT_LEN} 字符）`;
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
