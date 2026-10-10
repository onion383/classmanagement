/**
 * electron-builder afterPack 钩子（仅 Windows）：剔除 Chromium 运行时里本应用用不到的组件、
 * 并压缩体积庞大的第三方许可聚合文件，以减小安装体积。
 *
 * 实测依据（对打包产物开远程调试端口 9222，用 CDP 核对渲染结果 / WebGL 状态 / 进程已加载模块）：
 *   - vk_swiftshader.dll / vk_swiftshader_icd.json / vulkan-1.dll
 *     仅用于「没有 GPU 时的软件 Vulkan 回退」。本应用不使用 WebGL / WebGPU，
 *     这三个文件在运行时进程模块列表里从未出现；删除后界面渲染、动画与 WebGL 状态完全一致（约 -6.1MB）。
 *   - dxcompiler.dll / dxil.dll
 *     DirectX 着色器编译器（DXC）。实测删除后 GPU 进程仍为硬件加速 ANGLE/D3D11
 *     （Intel Iris Xe），控制台无任何加载失败或报错（约 -25.9MB）。
 *     注意：极少数走 D3D12 / WebGPU 路径的机型可能因此回退到软件渲染，属已知取舍。
 *
 *   - LICENSES.chromium.html（约 19.4MB）
 *     Electron 随包分发的 Chromium 第三方组件许可全文聚合。其许可证（MIT/BSD/Apache 等）
 *     要求「在每一份副本中复制/保留声明」，并未要求以未压缩形式提供；压缩为 zip 后声明
 *     仍随每一份副本分发，Windows 可原生解压查看，合规性成立。压缩后约 2.1MB（约 -17.3MB）。
 *     红线：不得改为「联网下载」，必须始终随包分发。
 *
 * 明确保留（勿删）：
 *   libGLESv2.dll / libEGL.dll / d3dcompiler_47.dll —— ANGLE 硬件加速必需；
 *   icudtl.dat、resources.pak、v8_context_snapshot.bin / snapshot_blob.bin、ffmpeg.dll —— 运行时必需
 *   （ffmpeg.dll 供相册 <video> 播放媒体，删除会破坏播放）。
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const REMOVE_FILES = [
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll',
  'dxcompiler.dll',
  'dxil.dll',
]

// Electron 随包的 Chromium 许可聚合文件，压缩为同目录下的 zip
const LICENSE_HTML = 'LICENSES.chromium.html'
const LICENSE_ZIP = 'third-party-licenses.zip'

// CRC32（ZIP 中央目录需要），内置表实现，避免依赖 zlib.crc32 的 Node 版本差异
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0 ^ -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}

/**
 * 生成仅含单个文件的 ZIP（deflate 压缩）。用于把许可聚合文件压成 zip，
 * 不引入任何第三方依赖，保证 afterPack 在任意 Node 环境下可用。
 * @param {string} name 归档内的文件名
 * @param {Buffer} data 原始内容
 * @returns {Buffer} zip 字节流
 */
function makeSingleFileZip(name, data) {
  const nameBytes = Buffer.from(name, 'utf8')
  const crc = crc32(data)
  const deflated = zlib.deflateRawSync(data, { level: 9 })

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0) // 本地文件头签名
  local.writeUInt16LE(20, 4) // 解压所需版本
  local.writeUInt16LE(0x0800, 6) // 通用标志位：文件名 UTF-8
  local.writeUInt16LE(8, 8) // 压缩方法：deflate
  local.writeUInt16LE(0, 10) // 修改时间
  local.writeUInt16LE(0, 12) // 修改日期
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(deflated.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  local.writeUInt16LE(0, 28) // 扩展区长度

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0) // 中央目录头签名
  central.writeUInt16LE(20, 4) // 创建版本
  central.writeUInt16LE(20, 6) // 解压所需版本
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(8, 10)
  central.writeUInt16LE(0, 12)
  central.writeUInt16LE(0, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(deflated.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt16LE(0, 30) // 扩展区长度
  central.writeUInt16LE(0, 32) // 注释长度
  central.writeUInt16LE(0, 34) // 起始磁盘号
  central.writeUInt16LE(0, 36) // 内部属性
  central.writeUInt32LE(0, 38) // 外部属性
  central.writeUInt32LE(0, 42) // 本地头偏移

  const centralOffset = local.length + nameBytes.length + deflated.length

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // 中央目录结束签名
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(1, 8) // 本磁盘条目数
  end.writeUInt16LE(1, 10) // 总条目数
  end.writeUInt32LE(central.length + nameBytes.length, 12) // 中央目录大小
  end.writeUInt32LE(centralOffset, 16) // 中央目录偏移
  end.writeUInt16LE(0, 20) // 注释长度

  return Buffer.concat([local, nameBytes, deflated, central, nameBytes, end])
}

module.exports = async function afterPack(context) {
  // 仅在 Windows 产物上处理；其它平台结构不同，保持原样以免误删
  if (context.electronPlatformName !== 'win32') return

  const appOutDir = context.appOutDir
  let removed = 0
  let bytes = 0
  for (const name of REMOVE_FILES) {
    const target = path.join(appOutDir, name)
    try {
      const stat = fs.statSync(target)
      fs.rmSync(target, { force: true })
      removed += 1
      bytes += stat.size
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[afterPack] 剔除 ${name} 失败: ${err.message}`)
    }
  }
  console.log(`[afterPack] 已剔除 ${removed} 个可选运行时组件，约 ${(bytes / 1048576).toFixed(1)} MB`)

  // 压缩 Chromium 许可聚合文件为 zip，随包分发（合规：声明仍在每一份副本中）
  const licenseHtml = path.join(appOutDir, LICENSE_HTML)
  try {
    const stat = fs.statSync(licenseHtml)
    const data = fs.readFileSync(licenseHtml)
    const zip = makeSingleFileZip(LICENSE_HTML, data)
    fs.writeFileSync(path.join(appOutDir, LICENSE_ZIP), zip)
    fs.rmSync(licenseHtml, { force: true })
    const saved = (stat.size - zip.length) / 1048576
    console.log(
      `[afterPack] ${LICENSE_HTML} -> ${LICENSE_ZIP}，约 ${(stat.size / 1048576).toFixed(1)} MB -> ${(
        zip.length / 1048576
      ).toFixed(1)} MB（-${saved.toFixed(1)} MB）`
    )
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[afterPack] 压缩 ${LICENSE_HTML} 失败: ${err.message}`)
  }
}