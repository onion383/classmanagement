<template>
  <DialogShell :visible="visible" :z-index="50" overlay-class="bg-black/30">
    <div class="bg-surface rounded-lg p-5 shadow-card dialog-card flex flex-col overflow-hidden" style="width: 900px; height: 720px; max-width: 92vw;">
      <h3 class="text-lg font-bold mb-1">🧹 值日智能排表</h3>
      <p class="text-xs text-text-muted mb-3">按「条件流水线」依次生效：先排表方式，再逐条应用限制条件，越靠后的条件越重要，可部分覆盖前面的结果。结果仅预览，确认后才写回当前值日表。</p>

      <!-- 拒绝提示 -->
      <div v-if="rejectText" class="mb-3 px-3 py-2 rounded bg-warning/15 border border-warning/40 text-warning text-sm">{{ rejectText }}</div>

      <!-- 排表条件（方式 + 子级约束） -->
      <div class="mb-3">
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-medium block">排表条件</label>
          <button @click="startArrange" class="bg-primary text-text-inverse px-3 py-1.5 rounded border-none cursor-pointer text-sm">{{ arranged ? '🔀 换一换' : '▶ 开始排表' }}</button>
        </div>
        <div class="border border-dashed border-border rounded p-2 bg-surface-hover min-h-[44px]" @dragover.prevent @drop="onDropTop">
          <div v-if="tree.length === 0" class="text-sm text-text-muted py-1">拖入下方「排表方式」作为一级条件</div>
          <div v-for="(node, ni) in tree" :key="node.key" class="mb-1">
            <template v-if="isMethod(node)">
              <!-- 排表方式（随机/分组可并存） -->
              <div class="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded bg-primary text-text-inverse text-sm cursor-default" @dragover.prevent @drop.stop="onDropChild($event, node)">
                <button @click="removeNode(ni)" class="cursor-pointer text-text-inverse/80 hover:text-text-inverse font-bold leading-none text-base">×</button>
                <span class="cursor-grab select-none text-text-inverse/70" draggable="true" @dragstart="onNodeDragStart($event, node)">⠿</span>
                <span>{{ node.label }}</span>
                <!-- 分组排表：选择分组维度 -->
                <AppSelect v-if="node.key === 'group'" v-model="node.option" :options="dimensionOptions" placeholder="选择分组维度" class="w-40" @change="onDimensionChange" />
                <span v-if="satisfactionOf(node) !== null" class="ml-auto text-xs px-1.5 py-0.5 rounded bg-white/20 text-text-inverse border border-white/30">满足 {{ satisfactionOf(node) }}%</span>
              </div>
              <!-- 子级约束 -->
              <div v-if="node.children.length" class="ml-8 mt-1 border border-dashed border-info/50 rounded p-1 space-y-1">
                <div v-for="(child, ci) in node.children" :key="'c'+ci" class="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded bg-surface border border-border text-text text-sm">
                  <button @click="removeChild(ni, ci)" class="cursor-pointer text-text-muted hover:text-text font-bold leading-none text-base">×</button>
                  <span class="cursor-grab select-none" draggable="true" @dragstart="onNodeDragStart($event, child)">⠿</span>
                  <span>{{ child.label }}</span>
                  <!-- 特殊关系配置 -->
                  <template v-if="child.key === 'relation'">
                    <AppSelect v-model="child.a" :options="studentOptions" placeholder="学生" class="w-24" />
                    <span class="text-text-muted">和</span>
                    <AppSelect v-model="child.b" :options="studentOptions" placeholder="学生" class="w-24" />
                    <span class="text-text-muted">不在同一天值日</span>
                  </template>
                  <!-- 特殊劳动配置 -->
                  <template v-if="child.key === 'labor'">
                    <AppSelect v-model="child.student" :options="studentOptions" placeholder="学生" class="w-24" />
                    <AppSelect v-model="child.action" :options="[{value:'do',label:'一定做'},{value:'not',label:'不做'}]" class="w-20" />
                    <AppSelect v-model="child.item" :options="itemOptions" placeholder="劳动项目" class="w-32" />
                  </template>
                  <span v-if="satisfactionOf(child) !== null" class="ml-auto text-xs px-1.5 py-0.5 rounded bg-info/15 text-info border border-info/30">满足 {{ satisfactionOf(child) }}%</span>
                </div>
              </div>
              <div v-else class="ml-8 mt-1 border border-dashed border-info/40 rounded p-1 min-h-[24px] flex items-center text-xs text-text-muted px-2">
                拖入限制条件（特殊关系 / 特殊劳动）
              </div>
            </template>
            <!-- 独立限制条件：无需依附某方式，可单独排表满足 -->
            <div v-else class="ml-8 flex flex-wrap items-center gap-2 px-3 py-1.5 rounded bg-surface border border-border text-text text-sm" @dragover.prevent @drop.stop="onDropChild($event, node)">
              <button @click="removeNode(ni)" class="cursor-pointer text-text-muted hover:text-text font-bold leading-none text-base">×</button>
              <span class="cursor-grab select-none" draggable="true" @dragstart="onNodeDragStart($event, node)">⠿</span>
              <span>{{ node.label }}</span>
              <!-- 特殊关系配置 -->
              <template v-if="node.key === 'relation'">
                <AppSelect v-model="node.a" :options="studentOptions" placeholder="学生" class="w-24" />
                <span class="text-text-muted">和</span>
                <AppSelect v-model="node.b" :options="studentOptions" placeholder="学生" class="w-24" />
                <span class="text-text-muted">不在同一天值日</span>
              </template>
              <!-- 特殊劳动配置 -->
              <template v-if="node.key === 'labor'">
                <AppSelect v-model="node.student" :options="studentOptions" placeholder="学生" class="w-24" />
                <AppSelect v-model="node.action" :options="[{value:'do',label:'一定做'},{value:'not',label:'不做'}]" class="w-20" />
                <AppSelect v-model="node.item" :options="itemOptions" placeholder="劳动项目" class="w-32" />
              </template>
              <span v-if="satisfactionOf(node) !== null" class="ml-auto text-xs px-1.5 py-0.5 rounded bg-info/15 text-info border border-info/30">满足 {{ satisfactionOf(node) }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 可选条件（可拖拽） -->
      <div class="mb-4 flex gap-4">
        <div class="flex-1">
          <label class="text-sm font-medium mb-2 block">排表方式（拖到上方，二选一）</label>
          <div class="flex flex-wrap gap-2">
            <div v-for="opt in methodOptions" :key="opt.key" draggable="true" @dragstart="onOptionDragStart($event, opt)" class="px-3 py-2 rounded border border-border bg-primary text-text-inverse cursor-grab select-none text-sm shadow-sm hover:border-info">{{ opt.label }}</div>
          </div>
        </div>
        <div class="flex-1">
          <label class="text-sm font-medium mb-2 block">限制条件（拖到某方式下方）</label>
          <div class="flex flex-wrap gap-2">
            <div v-for="opt in constraintOptions" :key="opt.key" draggable="true" @dragstart="onOptionDragStart($event, opt)" class="px-3 py-2 rounded border border-border bg-surface cursor-grab select-none text-sm shadow-sm hover:border-info">{{ opt.label }}</div>
          </div>
        </div>
      </div>

      <!-- 预览 -->
      <div class="flex-1 overflow-auto border border-border rounded mb-4" style="min-height: 200px;">
        <GridView
          v-if="previewRows.length"
          :key="previewKey"
          :col-headers="daysArr"
          :rows="previewRows"
          :hide-meta-columns="true"
          :show-row-number="true"
          :disable-row-drag="true"
          row-header-label="劳动项目"
          :enable-candidate="false"
          :min-table-height="200"
        />
        <div v-else class="flex items-center justify-center h-full text-text-muted text-sm py-8">设置劳动项目后开始排表</div>
      </div>

      <div class="flex justify-between gap-2">
        <button v-if="draft && draft.exists" @click="onClearDraft" class="text-text-muted hover:text-text px-4 py-2 rounded text-sm border border-border bg-surface-hover">清除草稿</button>
        <div v-else></div>
        <div class="flex gap-2">
          <button @click="onSaveDraft" :disabled="!arranged" class="bg-surface-hover px-4 py-2 rounded text-text border border-border disabled:opacity-40 disabled:cursor-not-allowed">保存草稿</button>
          <button @click="$emit('cancel')" class="bg-surface-hover px-4 py-2 rounded text-text border border-border">取消</button>
          <button @click="confirm" class="bg-info text-text-inverse px-4 py-2 rounded border-none">确定</button>
        </div>
      </div>
    </div>
  </DialogShell>
</template>

<script>
import GridView from '../../tables/GridView/GridView.vue'
import AppSelect from '../../base/AppSelect.vue'
import { useDutyArrangementPipeline } from './DutyArrangementDialog.pipeline.js'
import { useDutyArrangementOptions } from './DutyArrangementDialog.options.js'
import { useDutyArrangementDimension } from './DutyArrangementDialog.dimension.js'
import '../../../styles/dialog-transition.css'
import DialogShell from '../../base/DialogShell.vue'

// 排表条件选项：method 为排表方式，constraint 为限制条件（拖到方式下方）
const OPTIONS = [
  { key: 'random', label: '随机排表', type: 'method' },
  { key: 'group', label: '分组排表', type: 'method' },
  { key: 'fair', label: '权重公平', type: 'method' },
  { key: 'relation', label: '特殊关系', type: 'constraint' },
  { key: 'labor', label: '特殊劳动', type: 'constraint' }
]

export default {
  name: 'DutyArrangementDialog',
  components: { GridView, AppSelect, DialogShell },
  props: {
    visible: Boolean,
    // 值日全局设置：days（星期）、items（[{name, count, ...}]）
    days: { type: Array, default: () => [] },
    items: { type: Array, default: () => [] },
    // 全班学生（含 id / 姓名）
    students: { type: Array, default: () => [] },
    // 值日项目权重表：{ 项目名: { 星期: 权重值 } }
    weights: { type: Object, default: () => ({}) },
    // 公平账本：{ 学生姓名: 累计权重值 }
    ledger: { type: Object, default: () => ({}) },
    // 草稿：{ exists, cells, settings, conditions, savedAt }
    draft: { type: Object, default: () => ({ exists: false }) }
  },
  emits: ['cancel', 'confirm', 'save-draft', 'clear-draft'],
  data() {
    return {
      tree: [{ key: 'random', label: '随机排表', children: [] }],
      previewCells: {},
      previewVersion: 0,
      rejectText: '',
      arranged: false,
      satisfaction: {},
      // 分组维度（来自分组管理接口）
      dimensions: [],
      groups: [],
      selectedDimId: ''
    }
  },
  computed: {
    daysArr() {
      return (this.days && this.days.length) ? this.days : ['周一', '周二', '周三', '周四', '周五']
    },
    itemsArr() {
      return (this.items && this.items.length) ? this.items : []
    },
    // 学生姓名（排表操作的原子单位）
    studentNames() {
      return this.students.map(s => String(s.姓名 || '').trim()).filter(Boolean)
    },
    studentOptions() {
      return this.students.map(s => ({ value: String(s.姓名).trim(), label: s.姓名 }))
    },
    itemOptions() {
      return this.itemsArr.map(it => ({ value: it.name, label: it.name }))
    },
    dimensionOptions() {
      return this.dimensions.map(d => ({ value: String(d.id), label: d.name }))
    },
    methodOptions() {
      return OPTIONS.filter(o => o.type === 'method')
    },
    constraintOptions() {
      return OPTIONS.filter(o => o.type === 'constraint')
    },
    previewKey() {
      const flat = this.tree.flatMap(n => [n.key, ...(n.children || []).map(c => c.key)]).join('-') || 'empty'
      return this.visible ? `duty-arrange-${flat}-${this.previewVersion}` : 'closed'
    },
    previewRows() {
      return this.buildPreviewRows(this.previewCells)
    }
  },
  watch: {
    visible(v) {
      if (v) {
        this.arranged = false
        this.previewCells = {}
        this.previewVersion++
        this.satisfaction = {}
        this.rejectText = ''
        // 草稿恢复：若存在草稿则先恢复（树 + 预览），让用户接着上次继续
        if (this.draft && this.draft.exists && this.draft.conditions && this.draft.conditions.length) {
          this.tree = this.draft.conditions.map(c => ({ ...c, children: c.children || [] }))
          if (this.draft.cells && Object.keys(this.draft.cells).length) {
            this.previewCells = this.draft.cells
            this.arranged = true
            this.previewVersion++
          }
        } else {
          this.tree = [{ key: 'random', label: '随机排表', children: [] }]
        }
        this.fetchDimensions()
      }
    },
    tree: {
      deep: true,
      handler() {
        this.arranged = false
      }
    }
  },
  methods: {
    ...useDutyArrangementPipeline(OPTIONS),
    ...useDutyArrangementOptions(OPTIONS),
    ...useDutyArrangementDimension(),
  }
}
</script>
