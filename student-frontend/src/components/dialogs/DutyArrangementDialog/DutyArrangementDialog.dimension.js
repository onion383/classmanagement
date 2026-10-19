// ===== 值日智能排表：分组维度（分组管理接口） =====
// 纯代码搬运自 DutyArrangementDialog.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
import axios from 'axios'

const API_BASE = '/api'

export function useDutyArrangementDimension() {
  return {
    // ==================== 分组维度（分组管理接口） ====================
    async fetchDimensions() {
      try {
        const res = await axios.get(`${API_BASE}/group-manage/bootstrap`)
        this.dimensions = res.data.dimensions || []
        const active = res.data.active
        this.groups = (active && active.groups) || []
        this.selectedDimId = active ? String(active.dimension.id) : ''
        // 若当前默认方式是分组，同步其维度选项
        const g = this.tree.find(n => n.key === 'group')
        if (g && this.selectedDimId) g.option = this.selectedDimId
      } catch (e) { console.error(e); this.rejectText = '加载分组维度失败' }
    },
    async onDimensionChange(id) {
      this.selectedDimId = id
      this.loadDimensionGroups(id)
    },
    async loadDimensionGroups(dimId) {
      if (!dimId) return
      try {
        const res = await axios.get(`${API_BASE}/group-manage/${dimId}`)
        this.groups = (res.data && res.data.groups) || []
        this.arranged = false
      } catch (e) { console.error(e) }
    },
    // 当前选中维度各组成员（姓名数组）
    groupBuckets() {
      return this.groups.map(g => (g.members || []).map(m => String(m.member_name || '').trim()).filter(Boolean))
    },
  }
}
