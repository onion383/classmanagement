import { reactive } from 'vue'
import axios from 'axios'

const API_BASE = '/api'

// 全局共享的「智能排表草稿」状态（与 useNotification 同风格：模块级单例，所有调用者共用一份）。
// 启动时 App 拉一次用于弹提示，智能排表弹窗打开时按 exists 决定是否恢复预览。
const draft = reactive({
  loaded: false,
  exists: false,
  rows: 6,
  cols: 7,
  mode: 'single',
  showAisle: true,
  seats: [],
  conditions: [],
  savedAt: ''
})

export function useSeatDraft() {
  // 拉取草稿；未登录或后端未就绪时静默降级为「没有草稿」，不打扰用户
  async function fetchDraft() {
    try {
      const res = await axios.get(`${API_BASE}/seats/draft`)
      draft.exists = !!res.data.exists
      if (draft.exists) {
        draft.rows = res.data.rows
        draft.cols = res.data.cols
        draft.mode = res.data.mode || 'single'
        draft.showAisle = (res.data.settings || {}).showAisle !== false
        draft.seats = res.data.seats || []
        draft.conditions = res.data.conditions || []
        draft.savedAt = res.data.savedAt || ''
      }
    } catch (_) {
      draft.exists = false
    }
    draft.loaded = true
    return draft
  }

  // 保存草稿：seats 为二维数组（学生 id / 新同学名字 / null），conditions 为排表条件列表
  async function saveDraft({ seats, conditions, rows, cols, mode, showAisle }) {
    const res = await axios.put(`${API_BASE}/seats/draft`, {
      rows,
      cols,
      seats,
      mode,
      aisleCols: [],
      settings: { showAisle },
      conditions: conditions || []
    })
    draft.exists = true
    draft.rows = rows
    draft.cols = cols
    draft.mode = mode || 'single'
    draft.showAisle = showAisle !== false
    draft.seats = seats
    draft.conditions = conditions || []
    draft.savedAt = res.data.savedAt || ''
    draft.loaded = true
    return res.data
  }

  // 清除草稿（「确定」应用座位表后调用）；清除失败不影响应用结果
  async function clearDraft() {
    try {
      await axios.delete(`${API_BASE}/seats/draft`)
    } catch (_) {}
    draft.exists = false
    draft.seats = []
    draft.conditions = []
    draft.savedAt = ''
  }

  return { draft, fetchDraft, saveDraft, clearDraft }
}
