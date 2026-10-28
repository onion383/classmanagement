// =========================================================================
// fileName.js —— 保存/导出文件名的清洗
//
// 用户会在「导出」弹窗里自己填文件名，而这个名字最终交给系统保存对话框落盘。
// 不清洗的话：含 < > : " / \ | ? * 的名字会让 Windows 保存失败或写到意外的目录；
// 末尾的点和空格会被系统悄悄吞掉（"a." 存成 "a"），导致「名字对不上」。
// 控制字符（\u0000-\u001f）同样非法。
// =========================================================================

// Windows 非法字符 + 控制字符；盘符/路径分隔符都在里面，顺带堵住目录穿越
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const MAX_LEN = 120

export function sanitizeFileName(name, fallback = '导出文件') {
  const raw = name === undefined || name === null ? '' : String(name)
  let cleaned = raw.replace(ILLEGAL_CHARS, '_').trim()
  // 末尾的点与空格：Windows 会丢弃它们，提前去掉避免「显示名和实际文件名不一致」
  cleaned = cleaned.replace(/[. ]+$/, '').trim()
  // 过长文件名在某些文件系统/路径长度下会直接失败，按字符截断（保留中文可读性）
  if (cleaned.length > MAX_LEN) cleaned = cleaned.slice(0, MAX_LEN).replace(/[. ]+$/, '')
  return cleaned || fallback
}
