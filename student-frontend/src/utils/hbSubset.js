/**
 * 中文字体动态子集化（harfbuzz wasm）
 *
 * 为什么需要：PDF 导出要把中文字体嵌进文档。jsPDF 只能整份嵌入，不认 `putOnlyUsedFonts`
 * （实测 jsPDF 4.2.1 对自定义 TTF 该开关完全无效，三种设置方式输出体积完全相同）。
 * 所以 13MB 全量字体每次都被完整写进 PDF：50 行×8 列要 386ms、1.78MB。
 *
 * 做法：拿「本次实际要画的字符」在导出前现做一个子集（通常 80~150 字），
 * 把子集喂给 jsPDF。实测子集化本身只要 4ms，导出降到 22ms、PDF 121KB。
 *
 * 与「预生成静态子集」的区别（重要）：
 *   静态子集（如 GB2312 固定 6763 字）覆盖不到人名用字 —— 实测缺「玥 喆 昇 犇 燚」，
 *   而这些恰恰是班级名单里的常见字，且缺字在 PDF 里是**静默空白**（不报错、不告警）。
 *   动态子集的字符直接取自待导出文本，因此不可能缺字，也不需要任何缺字检测。
 *
 * wasm 来源：harfbuzzjs 1.6.4 的 `dist/harfbuzz-subset.wasm`（683KB，sha256
 *   62415fe6bad92ef16f3e5d2dbed6c66a4adec7f5a59c6d27084811c92cce1ba5）。
 *   构建期由 Vite 作为 asset 处理（带 hash，享 app:// 的 immutable 缓存）。
 *
 * 为什么不直接用 npm 的 `subset-font`：它的 index.js 用 `require('fs').readFile` 读 wasm，
 * 只支持 Node，渲染进程里跑不了；且它附带 fontverter/wawoff2/pako（woff2 转换，本项目用不到）。
 * 这里只移植它对 hb-subset 的调用序列（约 100 行），wasm 改用 fetch 加载。
 */

// Vite 会把 new URL(..., import.meta.url) 里的资源改写成带 hash 的产物地址
const WASM_URL = new URL('../wasm/hb-subset.wasm', import.meta.url)

const HB_MEMORY_MODE_WRITABLE = 2
const HB_SUBSET_SETS_NAME_ID = 4
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6

// 保留 name 表里这些条目：0-6 是字体名/版本，13-14 是许可与许可链接。
// 合规要求：Noto Sans SC 是 OFL 1.1，子集后的字体仍须带着版权与许可声明。
const KEEP_NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 13, 14]

let modulePromise = null

function loadModule() {
  if (!modulePromise) {
    modulePromise = fetch(WASM_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`子集引擎加载失败: HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      // 用 compile(arrayBuffer) 而不是 compileStreaming：
      // app:// 协议返回的 Content-Type 未必是 application/wasm，流式编译会直接拒绝。
      .then((buf) => WebAssembly.compile(buf))
      .catch((e) => {
        modulePromise = null // 失败不缓存，下次导出可重试
        throw e
      })
  }
  return modulePromise
}

/**
 * 同步核心：已初始化的 wasm 实例 + 全量字体字节 + 要保留的文本 → 子集字体字节。
 * 单独导出是为了让 Node 侧探针能直接调用（不必经过 fetch）。
 *
 * @param {object} hb   wasm exports
 * @param {ArrayBuffer|Uint8Array} fontBytes 全量 TTF
 * @param {string} text 本次要绘制的全部字符（重复无妨）
 * @returns {ArrayBuffer} 子集 TTF
 */
export function subsetWithExports(hb, fontBytes, text) {
  const src = fontBytes instanceof Uint8Array ? fontBytes : new Uint8Array(fontBytes)
  // wasm 内存会增长，增长后旧的 TypedArray 视图会 detach，所以每次用都重新取
  const heap = () => new Uint8Array(hb.memory.buffer)

  const input = hb.hb_subset_input_create_or_fail()
  if (input === 0) throw new Error('hb_subset_input_create_or_fail 返回 0')

  const fontPtr = hb.malloc(src.byteLength)
  if (fontPtr === 0) {
    hb.hb_subset_input_destroy(input)
    throw new Error('子集引擎内存分配失败')
  }

  let blob = 0
  let face = 0
  let subset = 0
  let result = 0
  try {
    heap().set(src, fontPtr)
    blob = hb.hb_blob_create(fontPtr, src.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0)
    face = hb.hb_face_create(blob, 0)
    hb.hb_blob_destroy(blob)
    blob = 0
    if (face === 0) throw new Error('hb_face_create 失败（字体数据可能已损坏）')

    // 等价于 pyftsubset 的 --layout-features=*
    const features = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG)
    hb.hb_set_clear(features)
    hb.hb_set_invert(features)

    const nameIds = hb.hb_subset_input_set(input, HB_SUBSET_SETS_NAME_ID)
    for (const id of KEEP_NAME_IDS) hb.hb_set_add(nameIds, id)

    const unicodes = hb.hb_subset_input_unicode_set(input)
    for (const ch of text) {
      const cp = ch.codePointAt(0)
      // 跳过代理对残留与换行等控制字符（hb_set_add 对它们无意义，但也不该塞进去）
      if (cp >= 0x20) hb.hb_set_add(unicodes, cp)
    }

    subset = hb.hb_subset_or_fail(face, input)
    if (subset === 0) throw new Error('hb_subset_or_fail 返回 0，字体子集化失败')

    result = hb.hb_face_reference_blob(subset)
    const offset = hb.hb_blob_get_data(result, 0)
    const len = hb.hb_blob_get_length(result)
    if (!len) throw new Error('子集结果为空')

    // slice 复制一份出来：返回后 wasm 侧的数据会被 destroy，不能保留视图
    return heap().slice(offset, offset + len).buffer
  } finally {
    if (result) hb.hb_blob_destroy(result)
    if (subset) hb.hb_face_destroy(subset)
    if (face) hb.hb_face_destroy(face)
    hb.hb_subset_input_destroy(input)
    hb.free(fontPtr)
  }
}

/**
 * 从全量字体生成只含 text 用到的字形的子集。
 *
 * 内存策略：**缓存编译产物（Module），不缓存实例（Instance）**。
 *   · harfbuzz wasm 的线性内存初始化就有 65MB（编译时写死的 INITIAL_MEMORY，1040 页 × 64KB）；
 *   · 实例可以正常被 GC 回收，但**只要还有一个 export 函数可达，整块内存就全活**；
 *   · 所以每次导出现建一个实例、用完即弃（函数返回后实例不可达），只把 Module 留在缓存里（几 MB）。
 * 实测这样每次子集化 6.5~8.7ms、external 内存不随次数增长；比常驻实例省掉 65MB。
 *
 * 反过来的做法（缓存实例复用）只省这几毫秒，却要 65MB 常驻，不划算。
 */
export async function subsetTtf(fontBytes, text) {
  if (!text) throw new Error('子集文本不能为空')
  const module = await loadModule()
  // 每实例化一次都要重新 _initialize()：memory 是新的，堆布局得重建
  const instance = new WebAssembly.Instance(module)
  instance.exports._initialize()
  return subsetWithExports(instance.exports, fontBytes, text)
}
