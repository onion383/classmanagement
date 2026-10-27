// ===== 表格关键字搜索：过滤与「搜索无结果」判定 =====
// 抽成独立纯函数的原因：useTableCRUD 依赖 Vue 生命周期 + 后端接口，Node 下无法直接 import；
// 而「搜不到东西时该显示什么」是分支最多的判定（本来就空 vs 被筛空），必须有单测兜住。

// 按关键字过滤行：不区分大小写的子串匹配；单元格值为 null/undefined 视为不匹配。
// 没选搜索列或关键字为空 → 原样返回（不过滤）。
export function filterRowsByKeyword(rows, field, keyword) {
  if (!field || !keyword) return rows
  const kw = String(keyword).toLowerCase()
  return rows.filter(s => {
    const val = s ? s[field] : null
    return val != null && String(val).toLowerCase().includes(kw)
  })
}

// 「搜索无结果」：有关键字在搜、搜出来 0 行、且表里本来是有数据的。
//
// 关键：表里本来就没数据时**不算**搜索无结果。那种情况该说「还没有 XX 数据」（提示去添加），
// 而不是「暂无搜索结果」（让用户去清搜索，清了也还是空，等于给了个没用的按钮）。
//
// field/keyword 必须与 filterRowsByKeyword 用的是同一份，否则会出现
// 「提示无结果但表里其实有行」的矛盾（过滤口径和判定口径不一致）。
export function isSearchNoResult(rows, filtered, field, keyword) {
  if (!field || !keyword) return false
  if (!rows || rows.length === 0) return false
  return !filtered || filtered.length === 0
}
