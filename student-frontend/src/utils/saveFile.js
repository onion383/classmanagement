// 保存文件的唯一出口：文件名清洗 → 系统保存对话框 → 成功后用系统默认应用打开。
// 供数据管理导出（exportFormats）、课表/座位导出（ExportExcel）、AI 导出（aiFiles）共用——
// 此前这三处各写了一份同样的 SAVE_FILE→OPEN_FILE 样板，改一处漏一处（PDF 导出就曾漏掉清洗）。
// 返回保存到的文件路径；用户取消或保存失败返回 ''（调用方按 falsy 处理）。
import { INVOKE } from '../electronChannels.js'
import { sanitizeFileName } from './fileName.js'

export async function saveBlobWithDialog(defaultName, blob) {
  // 文件名来自用户输入 / AI 生成，落盘前统一清洗（非法字符 / 末尾点空格 / 超长）
  const safeName = sanitizeFileName(defaultName)
  const arrayBuffer = await blob.arrayBuffer()
  const result = await window.electron.invoke(INVOKE.SAVE_FILE, { defaultName: safeName, data: arrayBuffer })
  if (result && !result.canceled && result.filePath) {
    // 保存成功后用系统默认应用打开文件
    window.electron.invoke(INVOKE.OPEN_FILE, { filePath: result.filePath }).catch(() => {})
    return result.filePath
  }
  return ''
}
