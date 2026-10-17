// =========================================================================
// Windows 系统 OCR 封装（Windows.Media.Ocr）
//   应用是 Windows 桌面端，直接借系统自带的 OCR 引擎：零新增依赖、离线可用、
//   不增加安装包体积。通过 powershell.exe 跑一段 WinRT 脚本完成识别。
//   调用方式：recognizeDataUrl(dataUrl) → { ok, text } / { ok: false, error }
// =========================================================================
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// OCR 一般 1~3 秒，给足余量；超时直接判定失败，避免进程卡死
const TIMEOUT_MS = 60000;

// WinRT 的异步方法在 PowerShell 里要用 AsTask 手动等待；这是社区通用写法。
// 参数经 -EncodedCommand（UTF-16LE base64）传入，避开引号与编码问题；
// 识别结果写入 __OUT_FILE__（UTF-8），不从 stdout 读，避免中文乱码。
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
function Await($op, $type) {
  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}

[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

# 按用户已安装的语言创建引擎；没装带 OCR 的语言包时返回 $null
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { exit 3 }

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('__IMAGE_PATH__')) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
# OCR 只接受 Bgra8 / Gray8，这里显式转一次，避免「不支持的像素格式」报错
$bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

# 按词重组每行：Windows OCR 会把中文逐字当词、默认用空格连接，
# 直接取 $line.Text 会得到「班 费 支 出」；这里只在两个非中日韩字符之间补空格，
# 于是中文粘连正确（班费支出2026年10月），英文仍保留词间空格（Total Amount 12800）
function Test-Cjk([char]$ch) {
  $i = [int]$ch
  return (($i -ge 0x2E80 -and $i -le 0x9FFF) -or ($i -ge 0xF900 -and $i -le 0xFAFF) -or ($i -ge 0xFF00 -and $i -le 0xFFEF))
}
$lines = @()
foreach ($line in $result.Lines) {
  $words = @($line.Words)
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $words.Count; $i++) {
    if ($i -gt 0) {
      $prev = [char]$words[$i - 1].Text[$words[$i - 1].Text.Length - 1]
      $cur = [char]$words[$i].Text[0]
      # 两个数字之间也不补空格：OCR 会把「10」拆成 1、0 两个词，补了就变成「1 0」
      $bothDigits = [char]::IsDigit($prev) -and [char]::IsDigit($cur)
      if (-not $bothDigits -and -not (Test-Cjk $prev) -and -not (Test-Cjk $cur)) { [void]$sb.Append(' ') }
    }
    [void]$sb.Append($words[$i].Text)
  }
  $lines += $sb.ToString()
}
$text = [string]::Join([Environment]::NewLine, $lines)
[System.IO.File]::WriteAllText('__OUT_FILE__', $text, (New-Object System.Text.UTF8Encoding($false)))
`;

// 识别一张本地图片文件，返回 { ok, text } 或 { ok:false, error }
function recognizeFile(imagePath) {
  return new Promise((resolve) => {
    // 输出文件与图片同放临时目录，避免污染用户目录
    const outFile = path.join(os.tmpdir(), `ocr-out-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    const quote = (p) => p.replace(/'/g, "''"); // PowerShell 单引号字符串里的转义
    const script = PS_SCRIPT
      .replace('__IMAGE_PATH__', quote(imagePath))
      .replace('__OUT_FILE__', quote(outFile));
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        let text = '';
        try { text = fs.readFileSync(outFile, 'utf-8'); } catch (_) { /* 未生成输出文件 */ }
        try { fs.unlinkSync(outFile); } catch (_) { /* 忽略 */ }

        if (err) {
          if (err.killed) return resolve({ ok: false, error: '识别超时，请换一张更小的图片重试' });
          if (err.code === 3) {
            return resolve({
              ok: false,
              error: '系统没有可用的 OCR 语言。请在 Windows「设置 → 时间和语言 → 语言和区域」里添加中文语言包（含OCR组件）后重试',
            });
          }
          const detail = String(stderr || err.message || '').trim().split('\n')[0];
          return resolve({ ok: false, error: `识别失败：${detail.slice(0, 200) || '未知错误'}` });
        }

        const trimmed = text.replace(/\r/g, '').trim();
        if (!trimmed) return resolve({ ok: true, text: '', empty: true });
        resolve({ ok: true, text: trimmed });
      }
    );
  });
}

// 识别前端传来的 data URL（data:image/png;base64,...）
async function recognizeDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(String(dataUrl || ''));
  if (!m) return { ok: false, error: '图片数据格式不正确（需要 data:image/...;base64,...）' };
  const extMap = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
    'image/bmp': '.bmp', 'image/gif': '.gif', 'image/tiff': '.tif',
  };
  const ext = extMap[m[1].toLowerCase()] || '.png';
  const tmp = path.join(os.tmpdir(), `ocr-src-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  try {
    fs.writeFileSync(tmp, Buffer.from(m[2], 'base64'));
  } catch (err) {
    return { ok: false, error: '图片写入临时文件失败：' + (err.message || '未知错误') };
  }
  try {
    return await recognizeFile(tmp);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* 忽略 */ }
  }
}

module.exports = { recognizeFile, recognizeDataUrl };
