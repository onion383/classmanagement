// ===== 值日智能排表：分组维度（分组管理接口） =====
// 纯代码搬运自 DutyArrangementDialog.vue 的 methods，未改写逻辑；经 ctx 闭包调用（script setup）。
// ctx 契约：{ dimensions, groups, selectedDimId, tree, arranged, rejectText, loadDimensionGroups 等 }。
import axios from 'axios'

const API_BASE = '/api'

export function useDutyArrangementDimension(ctx) {
  return {
    // ==================== 分组维度（分组管理接口） ====================
    async fetchDimensions() {
      try {
        const res = await axios.get(`${API_BASE}/group-manage/bootstrap`)
        ctx.dimensions.value = res.data.dimensions || []
        const active = res.data.active
        ctx.groups.value = (active && active.groups) || []
        ctx.selectedDimId.value = active ? String(active.dimension.id) : ''
        // 若当前默认方式是分组，同步其维度选项
        const g = ctx.tree.value.find(n => n.key === 'group')
        if (g && ctx.selectedDimId.value) g.option = ctx.selectedDimId.value
      } catch (e) { console.error(e); ctx.rejectText.value = '加载分组维度失败' }
    },
    async onDimensionChange(id) {
      ctx.selectedDimId.value = id
      ctx.loadDimensionGroups(id)
    },
    async loadDimensionGroups(dimId) {
      if (!dimId) return
      try {
        const res = await axios.get(`${API_BASE}/group-manage/${dimId}`)
        ctx.groups.value = (res.data && res.data.groups) || []
        ctx.arranged.value = false
      } catch (e) { console.error(e) }
    },
    // 当前选中维度各组成员（姓名数组）
    groupBuckets() {
      return ctx.groups.value.map(g => (g.members || []).map(m => String(m.member_name || '').trim()).filter(Boolean))
    },
  }
}
