import axios from 'axios'

// 撤销/重做域的统一接口层。收拢散落在各页面的 /api/undo* 调用，避免接口 URL 到处重拼。
// 必须走全局 axios 实例：secureAxios 对全局实例打了补丁做请求加密/响应解密，
// 换用其它实例会绕过安全通道。
// 各函数直接返回 axios 响应（Promise），便于调用方继续 .then/.catch 或解构 { data }。

// 登记一条撤销记录：body 结构由后端按 type 解析（cell_update / grid_cell / grid_snapshot /
// row_insert / row_delete / row_update / group_snapshot / album_* 等）
export function pushUndo(body) {
  return axios.post('/api/undo', body)
}

// 拉取全部撤销记录（设置页「撤销记录」列表，按表分组返回）
export function listUndo() {
  return axios.get('/api/undo')
}

// 按记录 id 撤销一条
export function undoById(id) {
  return axios.post(`/api/undo/${id}/undo`)
}

// 按记录 id 重做一条
export function redoById(id) {
  return axios.post(`/api/undo/${id}/redo`)
}

// 清空撤销记录；key 默认 'all'（清空全部表）
export function clearUndo(key = 'all') {
  return axios.delete('/api/undo', { params: { key } })
}

// 查询某张表的撤销可用态（canUndo/canRedo + 标签）
export function undoStatus(key) {
  return axios.get(`/api/undo/table/${encodeURIComponent(key)}/status`)
}

// 对某张表执行撤销/重做（redo=true 为重做）
export function applyUndo(key, redo = false) {
  return axios.post(`/api/undo/table/${encodeURIComponent(key)}/${redo ? 'redo' : 'undo'}`)
}
