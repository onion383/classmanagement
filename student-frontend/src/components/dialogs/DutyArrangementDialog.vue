<template>
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
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

      <div class="flex justify-end gap-2">
        <button @click="$emit('cancel')" class="bg-surface-hover px-4 py-2 rounded text-text border border-border">取消</button>
        <button @click="confirm" class="bg-info text-text-inverse px-4 py-2 rounded border-none">确定</button>
      </div>
    </div>
  </div>
  </Transition>
</template>

<script>
import GridView from '../tables/GridView.vue'
import AppSelect from '../base/AppSelect.vue'
import axios from 'axios'
import '../../styles/dialog-transition.css'

const API_BASE = '/api'

// Fisher-Yates 洗牌
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 排表条件选项：method 为排表方式，constraint 为限制条件（拖到方式下方）
const OPTIONS = [
  { key: 'random', label: '随机排表', type: 'method' },
  { key: 'group', label: '分组排表', type: 'method' },
  { key: 'relation', label: '特殊关系', type: 'constraint' },
  { key: 'labor', label: '特殊劳动', type: 'constraint' }
]

export default {
  name: 'DutyArrangementDialog',
  components: { GridView, AppSelect },
  props: {
    visible: Boolean,
    // 值日全局设置：days（星期）、items（[{name, count, ...}]）
    days: { type: Array, default: () => [] },
    items: { type: Array, default: () => [] },
    // 全班学生（含 id / 姓名）
    students: { type: Array, default: () => [] }
  },
  emits: ['cancel', 'confirm'],
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

    // ==================== 槽位模型 ====================
    // 值日槽位：{item, day, k}，按「天」外层排列，使同一天连续，便于均衡轮转同一天互不重复
    buildSlots() {
      const slots = []
      this.daysArr.forEach(day => {
        this.itemsArr.forEach(it => {
          const n = Math.max(1, Number(it.count) || 1)
          for (let k = 0; k < n; k++) slots.push({ item: it.name, day, k })
        })
      })
      return slots
    },
    // 由 assigned(下标→姓名) 还原 cells：{项目:{星期:[姓名,...]}}
    buildCells(slots, assigned) {
      const cells = {}
      this.itemsArr.forEach(it => { cells[it.name] = {}; this.daysArr.forEach(d => { cells[it.name][d] = [] }) })
      slots.forEach((s, i) => {
        const name = assigned[i]
        if (name && typeof name === 'string' && name.trim()) cells[s.item][s.day].push(name)
      })
      // 对齐每个项目每天人数 = count
      this.itemsArr.forEach(it => {
        const n = Math.max(1, Number(it.count) || 1)
        this.daysArr.forEach(d => {
          const arr = cells[it.name][d]
          while (arr.length < n) arr.push('')
        })
      })
      return cells
    },
    findSlots(slots, assigned, name) {
      const out = []
      for (let i = 0; i < slots.length; i++) if (assigned[i] === name) out.push(i)
      return out
    },

    // ==================== 均衡轮转填充 ====================
    // 把 names 循环填入所有槽位（尽量均衡；同一天连续槽位互不重复）
    roundRobinFill(slots, names) {
      const assigned = new Array(slots.length).fill('')
      names = [...names]
      for (let i = 0; i < slots.length; i++) assigned[i] = names[i % names.length]
      return assigned
    },
    // 分组填充：每组分配到「主天」，同组成员尽量同一天；空余用全体均衡补充
    groupFill(slots, buckets) {
      const names = this.studentNames
      const allMembers = buckets.flat().filter(Boolean)
      const others = names.filter(n => !allMembers.includes(n))
      const dayList = this.daysArr
      // 组 → 主天（循环分配，保证尽量分布在天上）
      const pool = {}
      buckets.forEach((g, gi) => {
        const d = dayList[gi % dayList.length]
        ;(pool[d] = pool[d] || []).push(...shuffle(g))
        // 记录主天统计（用于符合度）
        const key = 'g' + gi
        this._groupMainDay = this._groupMainDay || {}
        this._groupMainDay[key] = d
      })
      // 每 slot 归到其天
      const byDay = {}
      slots.forEach((s, i) => { (byDay[s.day] = byDay[s.day] || []).push(i) })
      Object.keys(byDay).forEach(d => {
        const need = byDay[d].length
        const have = (pool[d] || []).length
        if (have < need) {
          const source = others.length ? others.concat(allMembers) : names
          for (let i = have; i < need; i++) pool[d].push(source[i % source.length])
        }
      })
      const assigned = new Array(slots.length).fill('')
      Object.keys(byDay).forEach(d => {
        const arr = (pool[d] || [])
        byDay[d].forEach((si, idx) => { assigned[si] = arr[idx] || '' })
      })
      return assigned
    },

    // ==================== 流水线排表 ====================
    isMethod(n) {
      return OPTIONS.find(o => o.key === n.key)?.type === 'method'
    },
    // 先序处理：随机/分组可并存，主填充优先分组；后应用全部约束
    buildAssignment() {
      this.satisfaction = {}
      const slots = this.buildSlots()
      if (!slots.length) { this.previewCells = {}; return }
      // 方式节点：随机/分组可同时存在，去重后取「分组」作主策略（若已选维度），否则随机
      const methods = this.tree.filter(n => this.isMethod(n))
      const group = methods.find(n => n.key === 'group')
      let assigned
      if (group && this.groupBuckets().length) {
        this._groupMainDay = {}
        assigned = this.groupFill(slots, this.groupBuckets())
      } else {
        assigned = this.roundRobinFill(slots, shuffle(this.studentNames))
        this.trackSatisfaction('random', this.studentNames.length, this.studentNames.length)
      }
      // 收集全部约束：各方式子级 + 独立拖放顶部的限制条件，逐个应用
      const constraints = methods.flatMap(n => n.children || [])
        .concat(this.tree.filter(n => !this.isMethod(n)))
      for (const c of constraints) {
        if (c.key === 'relation') assigned = this.applyRelation(slots, assigned, c)
        else if (c.key === 'labor') assigned = this.applyLabor(slots, assigned, c)
      }
      return { slots, assigned }
    },

    // 分组符合度：组内成员落在「其组主天」人数的占比（由 computeGroupSatisfaction 依据实际排表结果计算）

    // 特殊关系：A、B 不在同一天值日。冲突时把 B 的一个槽位移到别的天
    applyRelation(slots, assigned, node) {
      assigned = [...assigned]
      if (!node.a || !node.b || node.a === node.b) return assigned
      const ia = this.findSlots(slots, assigned, node.a)
      const ib = this.findSlots(slots, assigned, node.b)
      const daysA = new Set(ia.map(i => slots[i].day))
      let conflict = false
      for (const i of ib) if (daysA.has(slots[i].day)) { conflict = true; break }
      let ok = !conflict
      if (conflict) {
        // 找一个不同天的空槽位给 b 的第一个冲突槽位
        const targetDay = this.daysArr.find(d => !daysA.has(d))
        for (let i = 0; i < ib.length && !ok; i++) {
          const idx = ib[i]
          if (!daysA.has(slots[idx].day)) continue
          if (targetDay == null) break
          // 在该目标天找一个空槽位
          const empty = slots.findIndex((s, j) => s.day === targetDay && !assigned[j])
          if (empty >= 0) {
            assigned[empty] = assigned[idx]
            assigned[idx] = ''
            ok = true
            break
          }
        }
      }
      this.trackSatisfaction('relation:' + node.a + '-' + node.b, ok ? 1 : 0, 1)
      return assigned
    },

    // 特殊劳动：A 一定做 / 不做某劳动项目
    applyLabor(slots, assigned, node) {
      assigned = [...assigned]
      if (!node.student || !node.item) return assigned
      const a = node.student
      const want = node.action === 'do' // true=一定做，false=不做
      const aSlots = this.findSlots(slots, assigned, a)
      const inItem = aSlots.filter(i => slots[i].item === node.item)
      let ok
      if (want) {
        ok = inItem.length > 0
        if (!ok) {
          // 找到该项目空槽位放 A；否则把 A 一个非该项目槽位与该项目的某槽位交换
          const empty = slots.findIndex((s, i) => s.item === node.item && !assigned[i])
          if (empty >= 0) {
            if (aSlots.length) { assigned[empty] = a; assigned[aSlots[0]] = '' }
            else assigned[empty] = a
            ok = true
          } else {
            const otherItemSlot = aSlots.find(i => slots[i].item !== node.item)
            const tgtItem = slots.findIndex((s, i2) => s.item === node.item && i2 !== aSlots[0])
            if (otherItemSlot != null && tgtItem >= 0) {
              const tmp = assigned[tgtItem]; assigned[tgtItem] = a; assigned[otherItemSlot] = tmp
              ok = true
            }
          }
        }
      } else {
        ok = inItem.length === 0
        if (!ok) {
          // 把 A 移出该项目：移到任意空位，否则清空（保证不占用该劳动）
          for (const idx of inItem) {
            const empty = slots.findIndex((s, i) => s.item !== node.item && !assigned[i])
            if (empty >= 0) { assigned[empty] = a; assigned[idx] = '' }
            else { assigned[idx] = '' }
          }
          if (this.findSlots(slots, assigned, a).length === 0) ok = true
        }
      }
      this.trackSatisfaction('labor:' + a + ':' + node.item, ok ? 1 : 0, 1)
      return assigned
    },

    // ==================== 满足率 ====================
    trackSatisfaction(key, done, total) {
      if (!this.satisfaction[key]) this.satisfaction[key] = { done: 0, total: 0 }
      this.satisfaction[key].done += done
      this.satisfaction[key].total += total
    },
    satisfactionKey(node) {
      if (node.key === 'relation') return 'relation:' + node.a + '-' + node.b
      if (node.key === 'labor') return 'labor:' + node.student + ':' + node.item
      return node.key
    },
    satisfactionOf(node) {
      const key = this.satisfactionKey(node)
      if (!key || !this.satisfaction[key]) return null
      const { done, total } = this.satisfaction[key]
      return total ? Math.round((done / total) * 100) : 0
    },

    // ==================== 预览 ====================
    generatePreview() {
      let result = this.buildAssignment()
      if (!result || !result.assigned.length) return
      this.previewCells = this.buildCells(result.slots, result.assigned)
      this.previewVersion++
      // 分组符合度：补算（需用排表结果）
      this.computeGroupSatisfaction()
    },
    computeGroupSatisfaction() {
      if (!this._groupMainDay) return
      const buckets = this.groupBuckets()
      let done = 0, total = 0
      // 每位学生所在天 = 其在 previewCells 中出现的 day 集合的主天
      buckets.forEach((g, gi) => {
        const main = this._groupMainDay['g' + gi]
        if (!main || !g.length) return
        g.forEach(name => {
          total++
          const days = new Set()
          for (const it of Object.keys(this.previewCells))
            for (const day of Object.keys(this.previewCells[it]))
              if (this.previewCells[it][day].includes(name)) days.add(day)
          if (days.has(main)) done++
        })
      })
      if (total) { this.satisfaction.group = { done, total } }
    },

    buildPreviewRows(cells) {
      const rows = []
      const days = this.daysArr
      this.itemsArr.forEach(it => {
        const n = Math.max(1, Number(it.count) || 1)
        for (let k = 0; k < n; k++) {
          rows.push({
            _rowKey: `it_${it.name}_${k}`,
            label: it.name,
            _isReadonly: true,
            _rowHeaderRowSpan: k === 0 ? n : 0,
            cells: days.map(day => ({ course: cells[it.name]?.[day]?.[k] || '' }))
          })
        }
      })
      return rows
    },

    // ==================== 拖拽交互 ====================
    onOptionDragStart(e, opt) {
      e.dataTransfer.setData('text/plain', opt.key)
      e.dataTransfer.effectAllowed = 'copy'
    },
    onNodeDragStart(e, node) {
      e.dataTransfer.setData('text/plain', node.key)
      e.dataTransfer.effectAllowed = 'copy'
    },
    onDropTop(e) {
      const opt = this.findOption(e)
      if (!opt) { this.rejectOnce(); return }
      // 排表方式：随机/分组不再二选一，可同时存在，同 key 去重
      if (opt.type === 'method') {
        if (this.tree.some(n => n.key === opt.key)) {
          this.rejectText = '「' + opt.label + '」已存在'
          this.showReject()
          return
        }
        this.tree.push({ key: opt.key, label: opt.label, children: [], ...this.initExtra(opt) })
      } else {
        // 限制条件：允许独立拖放到顶部（也可挂到某方式下方），去重
        if (this.tree.some(n => n.key === opt.key)) {
          this.rejectText = '「' + opt.label + '」已存在'
          this.showReject()
          return
        }
        this.tree.push({ key: opt.key, label: opt.label, children: [], ...this.initExtra(opt) })
      }
      this.resetArranged()
    },
    onDropChild(e, node) {
      const opt = this.findOption(e)
      if (!opt) { return }
      if (opt.type !== 'constraint' || node.children.some(c => c.key === opt.key)) {
        if (opt.type !== 'constraint') this.rejectText = '「' + opt.label + '」是排表方式，只能拖到顶部作为一级条件'
        this.showReject()
        return
      }
      node.children.push({ key: opt.key, label: opt.label, ...this.initExtra(opt) })
      this.resetArranged()
    },
    findOption(e) {
      const key = e.dataTransfer.getData('text/plain')
      return OPTIONS.find(o => o.key === key)
    },
    initExtra(opt) {
      if (opt.key === 'group') return { option: this.selectedDimId }
      if (opt.key === 'relation') return { a: '', b: '' }
      if (opt.key === 'labor') return { student: '', action: 'do', item: '' }
      return {}
    },
    removeNode(ni) {
      this.tree.splice(ni, 1)
      this.resetArranged()
    },
    removeChild(ni, ci) {
      this.tree[ni]?.children.splice(ci, 1)
      this.resetArranged()
    },
    // 条件变更后回到「开始排表」，清空预览
    resetArranged() {
      this.arranged = false
      this.previewCells = {}
      this.previewVersion++
    },
    startArrange() {
      this.generatePreview()
      this.arranged = true
    },
    showReject() {
      clearTimeout(this._rejectTimer)
      this._rejectTimer = setTimeout(() => { this.rejectText = '' }, 2500)
    },
    rejectOnce() {
      this.rejectText = ''
    },
    confirm() {
      this.$emit('confirm', { cells: this.previewCells })
    }
  }
}
</script>