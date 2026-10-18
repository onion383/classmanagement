<template>
  <!-- 快照还原：整库覆盖，强警示（文案由后端给出） -->
  <div v-if="isSnapshotRestore" class="rounded-lg border border-danger overflow-hidden">
    <div class="flex gap-3 px-3 py-2 text-xs border-b border-danger/40">
      <span class="text-text-muted flex-shrink-0 w-20 truncate">快照</span>
      <span class="text-text min-w-0 break-all">{{ proposal.snapshot }}</span>
    </div>
    <div class="px-3 py-2 text-xs text-danger leading-relaxed">
      {{ proposal.warning || '还原将覆盖当前全部数据，且无法撤销' }}
    </div>
  </div>
  <!-- 跨表批量操作：按表分组列出每一项动作 -->
  <div v-else-if="isBatchOps" class="rounded-lg border border-border overflow-hidden divide-y divide-border">
    <div v-for="(g, gi) in batchOpGroups" :key="gi" class="px-3 py-2">
      <div class="text-text-muted text-xs mb-1">{{ g.tableLabel }}（{{ g.items.length }} 项）</div>
      <div v-for="(it, ii) in g.items" :key="ii" class="flex items-center gap-2 text-xs py-0.5">
        <span class="flex-shrink-0" :class="it.tone">{{ it.actionLabel }}</span>
        <span class="text-text min-w-0 break-all" :title="it.detail">{{ it.detail }}</span>
      </div>
    </div>
  </div>
  <!-- 技能提案（kind=skill）：展示技能名与正文；更新/删除时先展示原正文作对照 -->
  <div v-else-if="isSkill" class="rounded-lg border border-border overflow-hidden divide-y divide-border">
    <div class="flex gap-3 px-3 py-2 text-xs">
      <span class="text-text-muted flex-shrink-0 w-20 truncate">技能名</span>
      <span class="text-text min-w-0 break-all">{{ proposal.name }}</span>
    </div>
    <div v-if="skillBefore" class="px-3 py-2">
      <div class="text-text-muted text-xs mb-1">原正文（将被覆盖）</div>
      <pre class="text-xs text-text-muted whitespace-pre-wrap break-words max-h-60 overflow-auto m-0 font-mono">{{ skillBefore }}</pre>
    </div>
    <div v-if="skillContent" class="px-3 py-2">
      <div class="text-text-muted text-xs mb-1">新正文</div>
      <pre class="text-xs text-text whitespace-pre-wrap break-words max-h-60 overflow-auto m-0 font-mono">{{ skillContent }}</pre>
    </div>
    <div v-if="proposal.operation === 'delete'" class="px-3 py-2 text-xs text-danger leading-relaxed">
      删除后该技能文件将从技能库移除，无法撤销。
    </div>
  </div>
  <!-- 删除：展示库里现有记录，让用户看清将被删掉的是什么 -->
  <AiRecordTable v-else-if="isDelete" :table="proposal.table" :ids="deleteIds" />
  <!-- 前端设置提案：展示「设置项 → 新值」 -->
  <div v-else-if="isFront" class="rounded-lg border border-border overflow-hidden">
    <div class="flex gap-3 px-3 py-2 text-xs">
      <span class="text-text-muted flex-shrink-0 w-28 truncate">{{ frontLabel }}</span>
      <span class="text-text min-w-0 break-all">{{ frontValue }}</span>
    </div>
  </div>
  <!-- 整块写入且属于网格表：用只读 GridView 还原成网格预览（新值覆盖当前行的对应列） -->
  <AiGridPreview v-else-if="isGrid" :table="proposal.table" :override="proposal.values" />
  <!-- 其它整块写入（如值日设置）：列出将被覆盖的列及其完整新值 -->
  <div v-else-if="isJson" class="rounded-lg border border-border overflow-hidden divide-y divide-border">
    <div v-for="(v, k) in jsonValues" :key="k" class="flex gap-3 px-3 py-2 text-xs">
      <span class="text-text-muted flex-shrink-0 w-20 truncate">{{ k }}</span>
      <span class="text-text min-w-0 break-all">{{ preview(v) }}</span>
    </div>
  </div>
  <!-- 批量修改：逐行展示「旧值 → 新值」对照 -->
  <div v-else-if="isBatchUpdate" class="rounded-lg border border-border overflow-hidden divide-y divide-border">
    <div v-for="(u, ui) in batchUpdateDiffs" :key="ui" class="px-3 py-2">
      <div class="flex items-center gap-2 text-xs mb-1">
        <span class="text-text-muted flex-shrink-0">修改记录</span>
        <span class="text-text-muted flex-shrink-0">#{{ u.id }}</span>
      </div>
      <div v-for="(d, i) in u.diff" :key="i" class="flex items-center gap-2 text-xs py-0.5">
        <span class="text-text-muted flex-shrink-0 w-24 truncate" :title="d.field">{{ d.field }}</span>
        <span class="min-w-0 flex-1 break-all text-text-muted line-through" :title="fmt(d.from)">{{ fmt(d.from) }}</span>
        <span class="text-text-muted flex-shrink-0">→</span>
        <span class="min-w-0 flex-1 break-all text-text" :title="fmt(d.to)">{{ fmt(d.to) }}</span>
      </div>
    </div>
  </div>
  <!-- 修改：优先展示「旧值 → 新值」对照，便于确认改了什么 -->
  <div v-else-if="isUpdateDiff" class="rounded-lg border border-border overflow-hidden divide-y divide-border">
    <div class="flex items-center gap-2 px-3 py-2 text-xs">
      <span class="text-text-muted flex-shrink-0">修改记录</span>
      <span class="text-text-muted flex-shrink-0">#{{ payload.id }}</span>
    </div>
    <div v-for="(d, i) in updateDiff" :key="i" class="flex items-center gap-2 px-3 py-2 text-xs">
      <span class="text-text-muted flex-shrink-0 w-24 truncate" :title="d.field">{{ d.field }}</span>
      <span class="min-w-0 flex-1 break-all text-text-muted line-through" :title="fmt(d.from)">{{ fmt(d.from) }}</span>
      <span class="text-text-muted flex-shrink-0">→</span>
      <span class="min-w-0 flex-1 break-all text-text" :title="fmt(d.to)">{{ fmt(d.to) }}</span>
    </div>
  </div>
  <!-- 新增：把将要写入的字段横向列出（只读） -->
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
</template>

<script>
import DynamicTable from './DynamicTable.vue'
import AiRecordTable from './AiRecordTable.vue'
import AiGridPreview, { GRID_TABLES } from './AiGridPreview.vue'

// 前端设置项：key → 展示名 + 枚举值的中文说明（供设置提案预览可读）
const FRONT_LABELS = {
  theme: '主题', mode: '日夜模式', iconStyle: '图标样式', topbarColor: '标题栏配色',
  animations: '动画效果', bgMaskOpacity: '背景遮罩不透明度', glassOpacity: '毛玻璃不透明度',
  mergeNotifications: '提示合并',
}
const FRONT_VALUE_LABELS = {
  base: '彩色色块', glass: '毛玻璃', glass2: '新毛玻璃', win11: 'Win11', minimal: '极简',
  day: '日间', night: '夜间',
  color: '彩色图标', emoji: 'Emoji',
  blue: '深蓝', light: '白色调',
}
// 表名 → 展示名（跨表批量操作按表分组时显示；未收录的表直接显示原表名）
const TABLE_LABELS = {
  students: '学生', fee_records: '班费记录', activities: '班级活动', countdowns: '倒计时',
  leave_records: '请假记录', score_records: '加分扣分记录', cadres: '班干部职务',
  group_members: '小组成员', cadre_members: '职务成员',
  schedule: '当前课表', master_schedule: '主课表模板',
  seat_layout: '当前座位表', seat_template: '座位模板', seat_weight: '座位权重表',
  duty_settings: '值日设置', duty_layout: '当前值日表', duty_template: '值日模板', duty_weight: '值日权重表',
}

// 写提案预览：新增/修改展示「将要写入的值」，删除展示「将被删除的那条记录」
export default {
  name: 'AiProposalTable',
  components: { DynamicTable, AiRecordTable, AiGridPreview },
  props: {
    proposal: { type: Object, required: true },
  },
  computed: {
    // 整库快照还原提案（kind=snapshot_restore）：覆盖全部数据，须强警示
    isSnapshotRestore() { return this.proposal.kind === 'snapshot_restore' },
    // 跨表批量操作提案（kind=batch_ops）：按表分组列出每一项动作
    isBatchOps() { return this.proposal.kind === 'batch_ops' },
    batchOpGroups() {
      const ops = Array.isArray(this.proposal.ops) ? this.proposal.ops : []
      const order = []
      const groups = new Map()
      for (const op of ops) {
        const table = (op && op.table) || ''
        if (!groups.has(table)) { groups.set(table, []); order.push(table) }
        groups.get(table).push(this._opItem(op || {}))
      }
      return order.map((t) => ({ table: t, tableLabel: TABLE_LABELS[t] || t, items: groups.get(t) }))
    },
    isDelete() { return this.proposal.operation === 'delete' },
    // 技能提案（kind=skill）：新建/更新/删除技能库里的 md 指令文件
    isSkill() { return this.proposal.kind === 'skill' },
    // 将要写入的新正文（删除无正文）
    skillContent() { return this.isSkill && this.proposal.operation !== 'delete' ? String(this.proposal.content || '') : '' },
    // 原正文（更新/删除时后端附带 before）
    skillBefore() { return this.isSkill && this.proposal.before ? String(this.proposal.before) : '' },
    // 前端设置提案（主题/日夜模式等）
    isFront() { return this.proposal.kind === 'front' },
    frontLabel() { return FRONT_LABELS[this.proposal.key] || this.proposal.key || '设置' },
    frontValue() {
      const v = this.proposal.value
      if (typeof v === 'boolean') return v ? '开启' : '关闭'
      if (v == null) return '空'
      return FRONT_VALUE_LABELS[v] || String(v)
    },
    // 整块写入提案（非行式表）：values 为「列名 → 该列完整新值」
    isJson() { return this.proposal.kind === 'json' },
    // 整块写入且表属于网格家族时，用 GridView 网格预览
    isGrid() { return this.isJson && GRID_TABLES.includes(this.proposal.table) },
    jsonValues() {
      const v = this.proposal.values
      return v && typeof v === 'object' ? v : {}
    },
    isBatch() { return !!this.proposal.batch },
    // 批量修改提案（operation=update 且 batch，后端附 diffs:[{id,diff}]）：逐行展示对照
    isBatchUpdate() {
      return this.proposal.operation === 'update' && this.proposal.batch === true
        && Array.isArray(this.proposal.diffs) && this.proposal.diffs.length > 0
    },
    batchUpdateDiffs() { return this.isBatchUpdate ? this.proposal.diffs : [] },
    // 修改提案的「旧值 → 新值」对照（后端在 update 提案里附带 diff）
    isUpdateDiff() { return this.proposal.operation === 'update' && Array.isArray(this.proposal.diff) && this.proposal.diff.length > 0 },
    updateDiff() { return this.isUpdateDiff ? this.proposal.diff : [] },
    payload() {
      const d = this.proposal.data
      return d && typeof d === 'object' ? d : {}
    },
    // update 的提案数据是 { id, changes }，只展示 id 与要改的字段
    changedFields() {
      const c = this.payload.changes
      return c && typeof c === 'object' ? c : {}
    },
    batchRows() {
      return Array.isArray(this.payload.rows) ? this.payload.rows : []
    },
    fields() {
      if (this.proposal.operation === 'update') {
        return ['id', ...Object.keys(this.changedFields)].map((name) => ({ name }))
      }
      // 批量新增：各行列可能不同，取并集并保持首次出现的顺序
      if (this.isBatch) {
        const keys = []
        for (const r of this.batchRows) {
          for (const k of Object.keys(r || {})) if (!keys.includes(k)) keys.push(k)
        }
        return keys.map((name) => ({ name }))
      }
      return Object.keys(this.payload).map((name) => ({ name }))
    },
    rows() {
      if (this.proposal.operation === 'update') {
        return [{ ...this.changedFields, id: this.payload.id, _rowKey: this.payload.id }]
      }
      if (this.isBatch) {
        return this.batchRows.map((r, i) => ({ ...r, _rowKey: i }))
      }
      return [{ ...this.payload, _rowKey: 1 }]
    },
    deleteIds() {
      // 批量删除：data.ids 为待删除的 id 列表，全部列出让用户看清将被删掉的记录
      if (this.isBatch && Array.isArray(this.payload.ids)) {
        return this.payload.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      }
      const id = Number(this.payload.id)
      return Number.isInteger(id) && id > 0 ? [id] : []
    },
    tableHeight() { return Math.min(400, 36 + this.rows.length * 32) },
  },
  methods: {
    // 把一个批量操作 op 归一为「动作标签 + 色调 + 详情文本」供列表展示
    _opItem(op) {
      const id = op.id != null ? op.id : (op.data && op.data.id)
      if (op.action === 'add') return { actionLabel: '新增', tone: 'text-success', detail: this._valuesSummary(op.data) }
      if (op.action === 'delete') return { actionLabel: '删除', tone: 'text-danger', detail: `#${id}` }
      if (op.action === 'update') {
        const changes = (op.data && op.data.changes) || {}
        return { actionLabel: '修改', tone: 'text-info', detail: `#${id}  ${this._changesSummary(changes)}` }
      }
      return { actionLabel: '整块写入', tone: 'text-info', detail: this._valuesSummary(op.values) }
    },
    // 「字段=值」摘要（新增行 / 整块写入用）
    _valuesSummary(v) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return '空'
      const ks = Object.keys(v)
      if (!ks.length) return '空'
      return ks.map((k) => `${k}=${this._short(v[k])}`).join('  ')
    },
    // 「字段→新值」摘要（修改用）
    _changesSummary(c) {
      const ks = Object.keys(c || {})
      if (!ks.length) return '（无改动字段）'
      return ks.map((k) => `${k}→${this._short(c[k])}`).join('  ')
    },
    _short(v) {
      const s = v == null ? '空' : (typeof v === 'object' ? JSON.stringify(v) : String(v))
      return s.length > 40 ? s.slice(0, 40) + '…' : s
    },
    // 整块写入的值预览：对象/数组转紧凑 JSON，过长则截断
    preview(v) {
      if (v == null) return '空'
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return s.length > 300 ? s.slice(0, 300) + '…' : s
    },
    // 修改对照的单值展示：空值显示为「空」，对象/数组转 JSON
    fmt(v) {
      if (v == null || v === '') return '空'
      return typeof v === 'object' ? JSON.stringify(v) : String(v)
    },
  },
}
</script>
