// =========================================================================
// importSheet.js —— 「从文件导入数据」的表头识别与行映射（纯函数，无 DOM 依赖）
//
// 为什么单独抽出来：这里最容易出的错是**列错位**。
// 老实现先 `map` 再 `filter` 掉空表头，然后用过滤后的数组下标去取值：
//   表头 ['姓名', '', '学号']  →  过滤后 ['姓名', '学号']
//   取值时 姓名←第0列（对）、学号←第1列（错，实际是空表头那一列）
// 于是空表头右边的所有列整体左移一格，导入后数据串列。
// 现在每个表头都带着它的**原始列下标**，取值一律用原下标。
//
// 另一个隐蔽问题：同名表头（两份「备注」）在对象里会互相覆盖，
// 只剩最后一列的值。这里给重复表头加序号后缀，保住两列数据。
// =========================================================================

// 单元格是否算「有内容」：空串 / null / undefined 都算空（数字 0 算有内容）
function hasValue(cell) {
  return cell !== '' && cell !== null && cell !== undefined
}

function cellText(cell) {
  return cell === undefined || cell === null ? '' : String(cell).trim()
}

// 一行 → 带原列下标的表头列表；空表头列被跳过（跳过的是它自己，不是它右边的列）
export function headerColumns(row) {
  const used = new Set()
  const columns = []
  ;(Array.isArray(row) ? row : []).forEach((cell, index) => {
    const name = cellText(cell)
    if (!name) return
    let unique = name
    let n = 2
    // 同名表头：第二个起加「_2」「_3」避免对象键互相覆盖丢数据。
    // 后缀**不能用「 (2)」**（空格+括号）：这个 name 会原样作为列名 POST 给后端，
    // 而 assertValidColumn 的白名单是 /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/，
    // 空格与括号都不在字符集里 → 含同名表头的 Excel 会整体导入失败（硬失败，不是跳过）。
    while (used.has(unique)) unique = `${name}_${n++}`
    used.add(unique)
    columns.push({ name: unique, index })
  })
  return columns
}

// 智能提取表头：跳过标题行/空行，取「前 10 行内非空列数最多」且下一行也有内容的一行。
// 因为 xlsx 导出时第一行是文件名标题行（只有 1 格），直接取第一条会误把它当表头。
export function detectHeader(data) {
  const rows = Array.isArray(data) ? data : []
  let headerRowIndex = -1
  let bestCount = -1
  for (let i = 0; i < Math.min(rows.length - 1, 10); i++) {
    const row = rows[i]
    const next = rows[i + 1]
    if (!Array.isArray(row) || !Array.isArray(next)) continue
    if (!row.some(hasValue) || !next.some(hasValue)) continue
    const count = row.filter(hasValue).length
    if (count > bestCount) {
      bestCount = count
      headerRowIndex = i
    }
  }
  // 全表找不到「像表头」的行时退化为第一行（与老行为一致）
  if (headerRowIndex === -1) headerRowIndex = 0
  return { headerRowIndex, columns: headerColumns(rows[headerRowIndex]) }
}

// 数据行 → 对象数组；缺少必填字段的行计入 skipped。
// 取值用表头的原始列下标，空表头列只跳过自己，不影响右侧列。
export function mapSheetRows(data, headerRowIndex, columns, requiredFields = []) {
  const rows = []
  let skipped = 0
  const body = (Array.isArray(data) ? data : []).slice(headerRowIndex + 1)
  for (const row of body) {
    if (!Array.isArray(row) || !row.some(hasValue)) continue
    const obj = {}
    for (const col of columns) obj[col.name] = cellText(row[col.index])
    const missing = requiredFields.some((field) => !obj[field] || obj[field].trim() === '')
    if (missing) { skipped++; continue }
    rows.push(obj)
  }
  return { rows, skipped }
}

// 一站式解析：sheet_to_json(header:1) 得到的二维数组 → 表头 + 对象行
export function parseSheet(data, requiredFields = []) {
  const rows = Array.isArray(data) ? data : []
  if (rows.length === 0) return { headerRowIndex: 0, columns: [], fields: [], rows: [], skipped: 0 }
  const { headerRowIndex, columns } = detectHeader(rows)
  const mapped = mapSheetRows(rows, headerRowIndex, columns, requiredFields)
  return {
    headerRowIndex,
    columns,
    fields: columns.map((c) => c.name),
    rows: mapped.rows,
    skipped: mapped.skipped,
  }
}
