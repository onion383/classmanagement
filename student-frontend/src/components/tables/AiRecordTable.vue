<template>
  <div class="my-1.5">
    <!-- 读取中 -->
    <div v-if="loading" class="px-2 py-1.5 text-xs text-text-muted">正在读取数据…</div>
    <!-- 出错 -->
    <div v-else-if="error" class="px-2 py-1.5 text-xs text-text-muted">{{ error }}</div>
    <!-- 网格表（座位/课表/值日）：用只读 GridView 还原成网格展示 -->
    <div v-else-if="isGrid" class="my-1.5">
      <AiGridPreview :table="table" />
    </div>
    <!-- 普通表：直接复用列表页的表格组件（只读）：字段横向排列、一行对应一条记录 -->
    <div v-else class="rounded-lg border border-border overflow-hidden">
      <DynamicTable
        :fields="fields"
        :rows="rows"
        :max-height="tableHeight"
        readonly
        hideMoveButtons
        hideAddRow
        noRowDrag
      />
    </div>
  </div>
</template>

<script>
import DynamicTable from './DynamicTable.vue'
import AiGridPreview, { GRID_TABLES } from './AiGridPreview.vue'
import { apiFetch } from '../../utils/apiUrl.js'

// AI 只指认「表名 + id」，这里取完整记录后交给列表页同一个表格组件渲染
export default {
  name: 'AiRecordTable',
  components: { DynamicTable, AiGridPreview },
  props: {
    table: { type: String, required: true },
    ids: { type: Array, required: true },
  },
  data() {
    return { fields: [], rows: [], loading: true, error: '' }
  },
  computed: {
    // 网格表交由 AiGridPreview 自行取数并还原成网格
    isGrid() { return GRID_TABLES.includes(this.table) },
    // 表格高度按行数自适应（表头约 36px、每行约 32px），最多 400px 后纵向滚动
    tableHeight() {
      return Math.min(400, 36 + this.rows.length * 32)
    },
  },
  watch: {
    table: 'load',
    ids: 'load',
  },
  created() {
    this.load()
  },
  methods: {
    async load() {
      this.loading = true
      this.error = ''
      // 网格表由 AiGridPreview 自己取数并还原网格，这里不再按行取记录
      if (this.isGrid) { this.loading = false; return }
      if (!this.ids.length) {
        this.error = '缺少记录 id'
        this.loading = false
        return
      }
      try {
        const r = await apiFetch(`/api/ai/records/${this.table}?ids=${this.ids.join(',')}`)
        const j = await r.json()
        if (!r.ok || !j.success) throw new Error(j.error || '读取失败')
        // 列名直接用数据库字段名（本项目字段名本身就是界面上的显示名），与列表页表头一致
        this.fields = j.data.columns.map((name) => ({ name }))
        // 表格组件按 _rowKey 做行标识，这里用记录 id 补上
        this.rows = j.data.rows.map((row) => ({ ...row, _rowKey: row.id }))
        if (!this.rows.length) this.error = '未找到这条记录（可能已被删除）'
      } catch (e) {
        this.error = e.message || '读取数据失败'
      } finally {
        this.loading = false
      }
    },
  },
}
</script>
