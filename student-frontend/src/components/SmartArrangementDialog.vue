<template>
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
    <div class="bg-surface rounded-lg p-5 shadow-card dialog-card flex flex-col overflow-hidden" style="width: 960px; height: 700px; max-width: 90vw;">
      <h3 class="text-lg font-bold mb-4">🧠 智能排表</h3>

      <!-- 拒绝提示 -->
      <Transition name="dialog">
      <div v-if="rejectText" class="mb-3 px-3 py-2 rounded bg-warning/15 border border-warning/40 text-warning text-sm">
        {{ rejectText }}
      </div>
      </Transition>

      <!-- 排表条件（树状：缩进项为父项的附加条件） -->
      <div class="mb-3">
        <div class="flex items-center justify-between mb-2">
        <label class="text-sm font-medium block">排表条件</label>
        <button @click="startArrange" class="bg-primary text-text-inverse px-3 py-1.5 rounded border-none cursor-pointer text-sm">{{ arranged ? '🔀 换一换' : '▶ 开始排表' }}</button>
      </div>
        <div
          class="border border-dashed border-border rounded p-2 bg-surface-hover min-h-[44px]"
          @dragover.prevent
          @drop="onDropTop"
        >
          <div v-if="tree.length === 0" class="text-sm text-text-muted py-1">拖入下方选项作为排表方式</div>
          <div v-for="(node, ni) in tree" :key="node.key" class="mb-1">
            <!-- 父级：排表方式（配置内联在同一行） -->
            <div
              class="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded bg-primary text-text-inverse text-sm cursor-default"
              @dragover.prevent
              @drop.stop="onDropChild($event, node)"
            >
              <button
                @click="toggleCollapse(node)"
                :disabled="node.children.length === 0"
                class="w-4 text-center leading-none text-xs cursor-pointer disabled:cursor-default disabled:opacity-30 text-text-inverse/80 hover:text-text-inverse"
                title="折叠/展开"
              >{{ isCollapsed(node) ? '▸' : '▾' }}</button>
              <span class="cursor-grab select-none text-text-inverse/70" draggable="true" @dragstart="onNodeDragStart($event, node)">⠿</span>
              <span>{{ node.label }}</span>
              <!-- 普通下拉配置（锁定同桌/性别选择等作一级条件时也支持） -->
              <span v-if="node.key === 'random'" class="text-text-inverse/80">随机单位</span>
              <select
                v-if="optionDef(node.key)"
                v-model="node.option"
                class="border rounded px-1.5 py-0.5 text-xs bg-white text-text cursor-pointer"
              >
                <option v-for="op in optionDef(node.key).options" :key="op.value" :value="op.value">{{ op.label }}</option>
              </select>
              <!-- 特殊关系条件配置 -->
              <template v-if="node.key === 'relation'">
                <select v-model="node.pair.a" class="border rounded px-1.5 py-0.5 text-xs bg-white text-text cursor-pointer">
                  <option value="" selected disabled>选择学生</option>
                  <option v-for="s in students" :key="'a'+s.id" :value="s.id">{{ s.姓名 }}</option>
                </select>
                <span class="text-text-inverse/80">和</span>
                <select v-model="node.pair.b" class="border rounded px-1.5 py-0.5 text-xs bg-white text-text cursor-pointer">
                  <option value="" selected disabled>选择学生</option>
                  <option v-for="s in students" :key="'b'+s.id" :value="s.id">{{ s.姓名 }}</option>
                </select>
                <select v-model="node.relationType" class="border rounded px-1.5 py-0.5 text-xs bg-white text-text cursor-pointer">
                  <option
                    v-for="rt in (relationOptionDef() || {}).relationOptions"
                    :key="rt.value"
                    :value="rt.value"
                  >{{ rt.label }}</option>
                </select>
              </template>
              <!-- 组内排表条件配置 -->
              <template v-if="node.key === 'group'">
                <select v-model="node.groupBy" class="border rounded px-1.5 py-0.5 text-xs bg-white text-text cursor-pointer">
                  <option v-for="g in groupOptions()" :key="g.value" :value="g.value">{{ g.label }}</option>
                </select>
                <select v-model="node.swapType" class="border rounded px-1.5 py-0.5 text-xs bg-white text-text cursor-pointer">
                  <option
                    v-for="s in swapTypeOptions(node.groupBy)"
                    :key="s.value"
                    :value="s.value"
                  >{{ s.label }}</option>
                </select>
              </template>
              <span v-if="satisfactionOf(node) !== null" class="ml-auto text-xs px-1.5 py-0.5 rounded bg-white/20 text-text-inverse border border-white/30">满足 {{ satisfactionOf(node) }}%</span>
              <button @click="removeNode(ni)" class="cursor-pointer text-text-inverse/80 hover:text-text-inverse font-bold leading-none text-base">×</button>
            </div>
            <!-- 附加条件区：虚线边框，作为缩进子级的拖放目标 -->
            <div
              v-show="!isCollapsed(node)"
              class="ml-10 mt-1 border border-dashed border-info/50 rounded p-1 min-h-[34px]"
              @dragover.prevent
              @drop.stop="onDropChild($event, node)"
            >
              <div v-for="(child, ci) in node.children" :key="child.key" class="mb-1 last:mb-0">
                <div class="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded bg-surface border border-border text-text text-sm">
                  <button
                    @click="toggleCollapse(child)"
                    :disabled="!(child.key === 'group' && child.children.length > 0)"
                    class="w-4 text-center leading-none text-xs cursor-pointer disabled:cursor-default disabled:opacity-30 text-text-muted hover:text-text"
                    title="折叠/展开"
                  >{{ isCollapsed(child) ? '▸' : '▾' }}</button>
                  <span class="cursor-grab select-none" draggable="true" @dragstart="onNodeDragStart($event, child)">⠿</span>
                  <span>{{ child.label }}</span>
                  <span v-if="child.key === 'random'" class="text-text-muted">随机单位</span>
                  <select
                    v-if="optionDef(child.key)"
                    v-model="child.option"
                    class="border rounded px-1.5 py-0.5 text-xs bg-surface cursor-pointer"
                  >
                    <option v-for="op in optionDef(child.key).options" :key="op.value" :value="op.value">{{ op.label }}</option>
                  </select>
                  <!-- 特殊关系条件配置（内联在同一行） -->
                  <template v-if="child.key === 'relation'">
                    <select v-model="child.pair.a" class="border rounded px-1.5 py-0.5 text-xs bg-surface cursor-pointer">
                      <option value="" selected disabled>选择学生</option>
                      <option v-for="s in students" :key="'a'+s.id" :value="s.id">{{ s.姓名 }}</option>
                    </select>
                    <span class="text-text-muted">和</span>
                    <select v-model="child.pair.b" class="border rounded px-1.5 py-0.5 text-xs bg-surface cursor-pointer">
                      <option value="" selected disabled>选择学生</option>
                      <option v-for="s in students" :key="'b'+s.id" :value="s.id">{{ s.姓名 }}</option>
                    </select>
                    <select v-model="child.relationType" class="border rounded px-1.5 py-0.5 text-xs bg-surface cursor-pointer">
                      <option
                        v-for="rt in (relationOptionDef() || {}).relationOptions"
                        :key="rt.value"
                        :value="rt.value"
                      >{{ rt.label }}</option>
                    </select>
                  </template>
                  <!-- 组内排表条件配置 -->
                  <template v-if="child.key === 'group'">
                    <select v-model="child.groupBy" class="border rounded px-1.5 py-0.5 text-xs bg-surface cursor-pointer">
                      <option v-for="g in groupOptions()" :key="g.value" :value="g.value">{{ g.label }}</option>
                    </select>
                    <select v-model="child.swapType" class="border rounded px-1.5 py-0.5 text-xs bg-surface cursor-pointer">
                      <option
                        v-for="s in swapTypeOptions(child.groupBy)"
                        :key="s.value"
                        :value="s.value"
                      >{{ s.label }}</option>
                    </select>
                  </template>
                  <span v-if="satisfactionOf(child) !== null" class="ml-auto text-xs px-1.5 py-0.5 rounded bg-info/15 text-info border border-info/30">满足 {{ satisfactionOf(child) }}%</span>
                  <button @click="removeChild(ni, ci)" class="cursor-pointer text-text-muted hover:text-text font-bold leading-none text-base">×</button>
                </div>
                <!-- 组内排表作为子级时：可再拖入其附加条件（孙子级） -->
                <div
                  v-if="child.key === 'group'"
                  v-show="!isCollapsed(child)"
                  class="ml-10 mt-1 border border-dashed border-info/40 rounded p-1 min-h-[30px]"
                  @dragover.prevent
                  @drop.stop="onDropGrandChild($event, ni, ci)"
                >
                  <div v-for="(gc, gi) in child.children" :key="'gc'+gc.key" class="mb-1 last:mb-0">
                    <div class="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded bg-surface-hover border border-border text-text text-xs">
                      <span class="cursor-grab select-none" draggable="true" @dragstart="onNodeDragStart($event, gc)">⠿</span>
                      <span>{{ gc.label }}</span>
                      <select v-if="optionDef(gc.key)" v-model="gc.option" class="border rounded px-1.5 py-0.5 text-xs bg-surface cursor-pointer">
                        <option v-for="op in optionDef(gc.key).options" :key="op.value" :value="op.value">{{ op.label }}</option>
                      </select>
                      <template v-if="gc.key === 'relation'">
                        <select v-model="gc.pair.a" class="border rounded px-1.5 py-0.5 text-xs bg-surface cursor-pointer">
                          <option value="" selected disabled>选择学生</option>
                          <option v-for="s in students" :key="'ga'+s.id" :value="s.id">{{ s.姓名 }}</option>
                        </select>
                        <span class="text-text-muted">和</span>
                        <select v-model="gc.pair.b" class="border rounded px-1.5 py-0.5 text-xs bg-surface cursor-pointer">
                          <option value="" selected disabled>选择学生</option>
                          <option v-for="s in students" :key="'gb'+s.id" :value="s.id">{{ s.姓名 }}</option>
                        </select>
                        <select v-model="gc.relationType" class="border rounded px-1.5 py-0.5 text-xs bg-surface cursor-pointer">
                          <option v-for="rt in (relationOptionDef() || {}).relationOptions" :key="rt.value" :value="rt.value">{{ rt.label }}</option>
                        </select>
                      </template>
                      <span v-if="satisfactionOf(gc) !== null" class="ml-auto text-xs px-1.5 py-0.5 rounded bg-info/15 text-info border border-info/30">满足 {{ satisfactionOf(gc) }}%</span>
                      <button @click="removeGrandChild(ni, ci, gi)" class="cursor-pointer text-text-muted hover:text-text font-bold leading-none text-base">×</button>
                    </div>
                  </div>
                  <div v-if="!child.children || child.children.length === 0" class="text-xs text-text-muted px-2 py-1">拖入附加条件</div>
                </div>
              </div>
              <div v-if="node.children.length === 0" class="text-xs text-text-muted px-2 py-1">拖入附加条件</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 优先级提示（满足率已内联显示在每行条件右侧） -->
      <div class="mb-3 text-xs text-text-muted">条件按顺序依次生效，越靠后的条件越重要，可部分覆盖前面的结果。</div>

      <!-- 可选条件（可拖拽，可复用）：排表方式可作一级；限制条件默认作子级附加，特殊关系也可作一级 -->
      <div class="mb-4 flex gap-4">
        <div class="flex-1">
          <label class="text-sm font-medium mb-2 block">排表方式（拖到上方作为一级条件）</label>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="opt in methodOptions"
              :key="opt.key"
              draggable="true"
              @dragstart="onOptionDragStart($event, opt)"
              class="px-3 py-2 rounded border border-border bg-primary text-text-inverse cursor-grab select-none text-sm shadow-sm hover:border-info"
            >
              {{ opt.label }}
            </div>
          </div>
        </div>
        <div class="flex-1">
          <label class="text-sm font-medium mb-2 block">限制条件（拖到某方式下方作附加条件，特殊关系也可拖到上方作一级条件）</label>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="opt in constraintOptions"
              :key="opt.key"
              draggable="true"
              @dragstart="onOptionDragStart($event, opt)"
              class="px-3 py-2 rounded border border-border bg-surface cursor-grab select-none text-sm shadow-sm hover:border-info"
            >
              {{ opt.label }}
            </div>
          </div>
        </div>
      </div>

      <!-- 表格预览 -->
      <div class="flex-1 overflow-auto border border-border rounded mb-4" style="min-height: 200px;">
        <GridView
          :key="previewKey"
          :colHeaders="previewColHeaders"
          :rows="previewRows"
          :hideMetaColumns="true"
          :showRowNumber="true"
          :minTableHeight="200"
          :enableCandidate="false"
        />
      </div>

      <div class="flex justify-end gap-2">
        <button @click="cancel" class="bg-surface-hover px-4 py-2 rounded text-text border border-border">取消</button>
        <button @click="confirm" class="bg-info text-text-inverse px-4 py-2 rounded border-none">确定</button>
      </div>
    </div>
  </div>
  </Transition>
</template>

<script>
import GridView from './GridView.vue';
import '../styles/dialog-transition.css'

// Fisher-Yates 洗牌
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 排表条件选项：type 区分排表方式（method，可作一级）与限制条件（constraint，只能作子级附加）
const OPTIONS = [
  {
    key: 'random',
    label: '随机排表',
    type: 'method',
    // 随机单位：打乱的最小不可分割单位（默认"按最后分割组"）
    options: [
      { value: 'last', label: '按最后分割组' },
      { value: 'student', label: '同学' },
      { value: 'deskmate', label: '同桌' },
      { value: 'six', label: '相邻六位' },
      { value: 'four', label: '相邻四位' },
      { value: 'whole', label: '一大组' },
      { value: 'column', label: '一列' }
    ]
  },
  { key: 'group', label: '组内排表', type: 'method' },
  {
    key: 'lock-deskmate',
    label: '锁定同桌',
    type: 'constraint',
    options: [
      { value: 'swap', label: '调换同桌位置' },
      { value: 'no-swap', label: '不调换同桌位置' },
      { value: 'random-swap', label: '随机调换同桌位置' }
    ]
  },
  {
    key: 'gender',
    label: '性别选择',
    type: 'constraint',
    options: [
      { value: 'mixed', label: '不同性别坐一起' },
      { value: 'same', label: '相同性别坐一起' }
    ]
  },
  {
    key: 'relation',
    label: '特殊关系',
    type: 'constraint',
    // 特殊关系允许作为一级条件（全局作用域），其余限制条件仍只能作子级附加
    canTop: true,
    relationOptions: [
      { value: 'deskmate', label: '作为同桌' },
      { value: 'not-deskmate', label: '不作为同桌' },
      { value: 'nearby', label: '坐在周围' },
      { value: 'not-nearby', label: '不坐在周围' }
    ]
  }
]

export default {
  name: 'SmartArrangementDialog',
  components: { GridView },
  props: {
    visible: Boolean,
    rows: { type: Number, default: 6 },
    cols: { type: Number, default: 7 },
    mode: { type: String, default: 'single' },
    showAisle: { type: Boolean, default: true },
    students: { type: Array, default: () => [] },
    // 当前未改动的座位表（二维数组，元素为学生 id 或 null），用于初始/条件变更时预览
    initialSeats: { type: Array, default: () => [] }
  },
  emits: ['cancel', 'confirm'],
  data() {
    return {
      // 排表方式树：父级为方式，缩进 children 为其附加条件（可多级嵌套）
      tree: [{ key: 'random', label: '随机排表', children: [], option: 'last' }],
      previewSeats: [],
      previewVersion: 0,
      rejectText: '',
      // 是否已排表：false 显示"开始排表"，true 显示"换一换"
      arranged: false,
      // 每个条件的满足率统计：key -> { done, total }
      satisfaction: {},
      // 记录各区域最近一次分组（组内排表）产生的组块结构，供外层随机排表整块打乱
      blockMap: {},
      // 条件树的折叠状态（独立于条件树存储：折叠是纯 UI 操作，不应触发条件变更监听而重置排表状态）
      collapsedMap: new Map()
    }
  },
  computed: {
    previewKey() {
      const flat = this.tree.flatMap(n => [n.key, ...n.children.map(c => c.key)]).join('-') || 'empty'
      return this.visible ? `arrange-${this.rows}-${this.cols}-${flat}-${this.previewVersion}` : 'closed'
    },
    previewColHeaders() {
      return this.generateColHeaders(this.cols, this.mode, this.showAisle)
    },
    previewRows() {
      return this.buildPreviewRows(this.previewSeats)
    },
    // 可选条件可复用：始终显示全部（拖到树中即生效，不因被选中而消失）
    // 排表方式（可作一级条件）
    methodOptions() {
      return OPTIONS.filter(o => o.type === 'method')
    },
    // 限制条件（只能作子级附加条件）
    constraintOptions() {
      return OPTIONS.filter(o => o.type === 'constraint')
    }
  },
  watch: {
    visible(v) {
      // 打开时：预览默认显示未改动的座位表，并重置为"开始排表"状态，不自动排表
      if (v) {
        this.arranged = false
        this.previewSeats = this.buildInitialSeats()
        this.previewVersion++
      }
    },
    // 任一条件（含下拉选项）变更：重置为"开始排表"
    tree: {
      deep: true,
      handler() {
        this.arranged = false
      }
    }
  },
  methods: {
    // ==================== 网格工具（与座位网格保持一致的显示算法） ====================
    generateColHeaders(cols, mode, showAisle) {
      const headers = []
      if (!showAisle) { for (let i = 0; i < cols; i++) headers.push(`列${i + 1}`); return headers }
      if (mode === 'single') {
        for (let i = 0; i < cols; i++) { headers.push(`列${i + 1}`); if (i < cols - 1) headers.push('走廊') }
      } else {
        for (let i = 0; i < cols; i++) { headers.push(`列${i + 1}`); if ((i + 1) % 2 === 0 && i < cols - 1) headers.push('走廊') }
      }
      return headers
    },
    getDisplayColCount(cols, mode, showAisle) {
      if (!showAisle) return cols
      if (mode === 'single') return cols + (cols - 1)
      else return cols + Math.floor((cols - 1) / 2)
    },
    isAisleCol(displayIdx, cols, mode, showAisle) {
      if (!showAisle) return false
      const totalDisplay = this.getDisplayColCount(cols, mode, showAisle)
      if (mode === 'single') return displayIdx % 2 === 1
      else return displayIdx >= 2 && (displayIdx - 2) % 3 === 0 && displayIdx < totalDisplay
    },
    // 读取组内排表的配置 { groupBy, swapType }（一级或子级均可）
    groupConfig() {
      for (const n of this.tree) {
        if (n.key === 'group') return { groupBy: n.groupBy, swapType: n.swapType }
        const c = n.children.find(x => x.key === 'group')
        if (c) return { groupBy: c.groupBy, swapType: c.swapType }
      }
      return null
    },

    // ==================== 统一条件流水线（核心重写） ====================
    // 依据当前条件树构建一张新的座位网格。
    // 处理顺序 = 树的先序（父先子后）。每个条件作用于一个"区域"（全局或某个组块），
    // 后处理的条件可部分覆盖先处理的结果（越靠后越重要），并各自统计满足率。
    buildSeats() {
      this.satisfaction = {}
      this.blockMap = {}
      const grid = this.initGrid()
      this.processRegion(grid, this.allCells(), this.tree)
      return grid
    },

    // 初始化网格：从原座位表填满学生，未出现的学生补到空位
    initGrid() {
      const grid = Array.from({ length: this.rows }, () => new Array(this.cols).fill(null))
      const used = new Set()
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const val = this.initialSeats?.[r]?.[c]
          let s = null
          if (typeof val === 'number') s = this.students.find(x => x.id === val)
          else if (val && typeof val === 'object') s = val
          if (s) { grid[r][c] = s; used.add(s.id) }
        }
      }
      const rest = this.students.filter(s => !used.has(s.id))
      let k = 0
      for (let r = 0; r < this.rows && k < rest.length; r++) {
        for (let c = 0; c < this.cols && k < rest.length; c++) {
          if (!grid[r][c]) { grid[r][c] = rest[k++]; used.add(rest[k - 1].id) }
        }
      }
      return grid
    },
    allCells() {
      const cells = []
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) cells.push({ r, c })
      return cells
    },

    // 递归处理一个节点列表到指定区域（全局 or 组块）
    processRegion(grid, region, nodes) {
      for (const node of nodes) {
        if (node && node.key === 'group') {
          // 组内排表：先分好组、排好整块顺序，再在每个组块内部满足子条件（组外成员不跨组）
          const whole = region.length === this.rows * this.cols
          const blocks = whole ? this.buildGroupBlocks().blocks : [{ pos: region }]
          if (whole) this.applyGroupSwap(grid)
          // 记录本区域的组块结构：供外层随机排表把组块作为最小不可分割单位整块打乱（成员不跨组）
          if (whole) this.blockMap[this.regionKey(region)] = blocks
          for (const child of node.children || []) {
            if (child.key === 'relation') {
              // 特殊关系：整张网格统一评估一次（内部按组块限定作用域、跨组不移动），
              // 避免逐块重复调用导致满足率分母虚增
              this.processRegion(grid, region, [child])
            } else {
              for (const block of blocks) this.processRegion(grid, block.pos, [child])
            }
          }
          const total = region.filter(p => grid[p.r][p.c]).length
          this.trackSatisfaction('group', total, total)
        } else {
          // 先满足附加条件（如性别限制先配对成同桌），再由父排表方式处理（如随机打乱这些同桌）
          this.processRegion(grid, region, node.children || [])
          this.applyCondition(grid, region, node)
        }
      }
    },

    // 应用单个条件到区域
    applyCondition(grid, region, node) {
      if (!node) return
      if (node.key === 'random') this.applyRandom(grid, region, node)
      else if (node.key === 'gender') this.applyGender(grid, region, node)
      else if (node.key === 'lock-deskmate') this.applyLockDeskmate(grid, region, node)
      else if (node.key === 'relation') this.applyRelationCondition(grid, region, node)
    },

    // 区域内单元格的"同桌槽位"：桌据模式（double）下偶数列相邻两格为一桌，其余为单格
    regionSlots(region) {
      const byRow = {}
      for (const p of region) (byRow[p.r] = byRow[p.r] || []).push(p.c)
      const slots = []
      const rows = Object.keys(byRow).map(Number).sort((a, b) => a - b)
      for (const r of rows) {
        const cols = byRow[r].sort((a, b) => a - b)
        const inRow = new Set(cols)
        let i = 0
        while (i < cols.length) {
          const c = cols[i]
          if (this.mode !== 'single' && c % 2 === 0 && inRow.has(c + 1)) {
            slots.push([{ r, c }, { r, c: c + 1 }])
            i += 2
          } else {
            slots.push([{ r, c }])
            i += 1
          }
        }
      }
      return slots
    },
    cellOrder(region) {
      return [...region].sort((a, b) => (a.r - b.r) || (a.c - b.c))
    },
    // 把单元（同桌对 + 单座）填入区域槽位。返回成功保持相邻的同桌对数。
    //  - 同桌对不可拆分，优先占 2 格槽位；槽位不足时拆成两个单座（不丢学生）
    //  - 单座优先占 2 格槽位的左格（右侧留空，保持单桌视觉），槽位不足时填剩余空位
    fillSlots(grid, region, slots, units) {
      const twoSlots = slots.filter(s => s.length === 2)
      for (const p of region) grid[p.r][p.c] = null
      const pairs = units.filter(u => u.indivisible)
      const singles = units.filter(u => !u.indivisible)
      let placedPairs = 0
      pairs.forEach((u, i) => {
        if (i < twoSlots.length) {
          const s = twoSlots[i]
          grid[s[0].r][s[0].c] = u.cells[0]
          grid[s[1].r][s[1].c] = u.cells[1]
          placedPairs++
        } else {
          // 2 格槽位不足：拆成两个单座，保住学生
          singles.push({ cells: [u.cells[0]], indivisible: false })
          singles.push({ cells: [u.cells[1]], indivisible: false })
        }
      })
      // 单座优先占剩余 2 格槽位左格
      let si = 0
      for (let i = placedPairs; i < twoSlots.length && si < singles.length; i++) {
        grid[twoSlots[i][0].r][twoSlots[i][0].c] = singles[si].cells[0]
        si++
      }
      // 再填剩余空位
      const empties = this.cellOrder(region).filter(p => !grid[p.r][p.c])
      for (const p of empties) {
        if (si >= singles.length) break
        grid[p.r][p.c] = singles[si].cells[0]
        si++
      }
      return placedPairs
    },

    // 随机排表：按「随机单位」把区域内容打乱，单位即最小不可分割部分。
    //  - last（默认）按最后一次分割的最小单位：组块 > 同桌对/单座
    //  - student 同学（1 人）/ deskmate 同桌（2 人）/ six 相邻六位 / four 相邻四位
    //  - whole 一大组 / column 一列
    applyRandom(grid, region, node) {
      const students = region.map(p => grid[p.r][p.c]).filter(s => s)
      const unit = (node && node.option) || 'last'
      if (unit === 'last') {
        const blocks = this.blockMap[this.regionKey(region)]
        if (blocks && blocks.length) this.permuteBlocks(grid, blocks)
        else this.shufflePairs(grid, region)
      } else if (unit === 'student') {
        // 每个学生为最小单位，打散（不拼同桌）
        const units = students.map(s => ({ cells: [s], indivisible: false }))
        this.fillSlots(grid, region, this.regionSlots(region), shuffle(units))
      } else if (unit === 'deskmate') {
        this.shufflePairs(grid, region)
      } else {
        // 几何块单位：仅对整个区域有意义；子区域（如组块内）退化为按同桌/单座打乱
        const whole = region.length === this.rows * this.cols
        if (whole) this.permuteBlocks(grid, this.buildBlocksBy(unit))
        else this.shufflePairs(grid, region)
      }
      this.trackSatisfaction('random', students.length, students.length)
    },

    // 把组块内容整块打乱（块为最小不可分割单位，成员不跨块）
    permuteBlocks(grid, blocks) {
      const contents = blocks.map(b => b.pos.map(p => grid[p.r][p.c]))
      const n = blocks.length
      const perm = Array.from({ length: n }, (_, i) => i)
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[perm[i], perm[j]] = [perm[j], perm[i]]
      }
      const newGrid = grid.map(row => row.map(() => null))
      blocks.forEach((b, i) => {
        const src = contents[perm[i]]
        b.pos.forEach((p, k) => { newGrid[p.r][p.c] = src[k] ?? null })
      })
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) grid[r][c] = newGrid[r][c]
      }
    },
    // 以当前已成对的同桌/单座为单元打乱（对内左右随机）
    shufflePairs(grid, region) {
      const students = region.map(p => grid[p.r][p.c]).filter(s => s)
      const regionIds = new Set(students.map(s => s.id))
      const { pairs } = this.extractGridPairs(grid, region)
      const units = []
      const used = new Set()
      for (const [a, b] of pairs) {
        if (regionIds.has(a.id) && regionIds.has(b.id)) {
          units.push({ cells: Math.random() < 0.5 ? [a, b] : [b, a], indivisible: true })
          used.add(a.id); used.add(b.id)
        }
      }
      for (const s of students) {
        if (!used.has(s.id)) { units.push({ cells: [s], indivisible: false }); used.add(s.id) }
      }
      this.fillSlots(grid, region, this.regionSlots(region), shuffle(units))
    },

    // 区域唯一标识（用于记录该区域的分组块结构）
    regionKey(region) {
      return region.map(p => p.r + ',' + p.c).sort().join('|')
    },

    // 从当前网格区域内提取已相邻的同桌对（与 regionSlots 同规则）与单座
    extractGridPairs(grid, region) {
      const pairs = []
      const singles = []
      const used = new Set()
      for (const slot of this.regionSlots(region)) {
        if (slot.length === 2) {
          const a = grid[slot[0].r][slot[0].c]
          const b = grid[slot[1].r][slot[1].c]
          if (a && b) { pairs.push([a, b]); used.add(a.id); used.add(b.id) }
          else if (a) { singles.push(a); used.add(a.id) }
          else if (b) { singles.push(b); used.add(b.id) }
        } else {
          const s = grid[slot[0].r][slot[0].c]
          if (s) { singles.push(s); used.add(s.id) }
        }
      }
      return { pairs, singles }
    },

    // 性别选择：按性别把区域内学生配成同桌（same=同性别，mixed=异性别），单座保持单座
    applyGender(grid, region, node) {
      const genderMode = node.option // 'same' | 'mixed'
      const students = region.map(p => grid[p.r][p.c]).filter(s => s)
      const boys = students.filter(s => s.性别 === '男')
      const girls = students.filter(s => s.性别 === '女')
      const others = students.filter(s => s.性别 !== '男' && s.性别 !== '女')
      const pairTwo = arr => { const out = []; for (let i = 0; i < arr.length; i += 2) out.push(arr.slice(i, i + 2)); return out }
      const units = []
      if (genderMode === 'same') {
        for (const g of [pairTwo(boys), pairTwo(girls), pairTwo(others)]) {
          for (const p of g) {
            units.push(p.length === 2 ? { cells: [p[0], p[1]], indivisible: true } : { cells: [p[0]], indivisible: false })
          }
        }
      } else {
        const max = Math.max(boys.length, girls.length)
        for (let i = 0; i < max; i++) {
          const b = boys[i], g = girls[i]
          if (b && g) units.push({ cells: [b, g], indivisible: true })
          else if (b) units.push({ cells: [b], indivisible: false })
          else if (g) units.push({ cells: [g], indivisible: false })
        }
        for (const o of others) units.push({ cells: [o], indivisible: false })
      }
      this.fillSlots(grid, region, this.regionSlots(region), units)
      // 满足率：同桌对符合性别规则 + 单座视为满足
      let satisfied = 0
      for (const u of units) {
        if (u.indivisible) {
          const [x, y] = u.cells
          if (genderMode === 'same' && x.性别 === y.性别) satisfied += 2
          else if (genderMode === 'mixed' && x.性别 !== y.性别) satisfied += 2
        } else {
          satisfied += 1
        }
      }
      this.trackSatisfaction('gender', satisfied, students.length)
    },

    // 锁定同桌：保留区域内原座位表已达成的同桌对（对内坐序按 lockMode 控制），单座保持单座
    applyLockDeskmate(grid, region, node) {
      const lockMode = node.option || 'no-swap'
      const students = region.map(p => grid[p.r][p.c]).filter(s => s)
      const regionIds = new Set(students.map(s => s.id))
      const orig = this.extractOriginalPairs()
      const units = []
      const used = new Set()
      let pairsInRegion = 0
      for (const [a, b] of orig.pairs) {
        if (regionIds.has(a.id) && regionIds.has(b.id)) {
          pairsInRegion++
          let cells = [a, b]
          if (lockMode === 'swap') cells = [b, a]
          else if (lockMode === 'random-swap' && Math.random() < 0.5) cells = [b, a]
          units.push({ cells, indivisible: true })
          used.add(a.id); used.add(b.id)
        }
      }
      for (const s of students) {
        if (!used.has(s.id)) { units.push({ cells: [s], indivisible: false }); used.add(s.id) }
      }
      const placedPairs = this.fillSlots(grid, region, this.regionSlots(region), units)
      this.trackSatisfaction('lock-deskmate', placedPairs, pairsInRegion)
    },

    // 特殊关系：作用域内修复。
    //  - 无组内排表：以传入区域（全局）为作用域，A、B 须都在区域内；
    //  - 存在组内排表：A、B 必须在同一组块内才可能"靠近"满足（作为同桌/坐在周围）。
    //    跨组的关系不可能满足（统计 0%），且绝不跨组移动学生，避免破坏组结构。
    applyRelationCondition(grid, region, node) {
      const pair = node.pair || {}
      const a = pair.a, b = pair.b
      const type = node.relationType || 'deskmate'
      if (!a || !b || a === b) return
      const pa = this.findPos(grid, a)
      const pb = this.findPos(grid, b)
      if (!pa || !pb) return

      let effRegion = region
      const groupCfg = this.groupConfig()
      if (groupCfg) {
        const blocks = this.buildBlocksBy(groupCfg.groupBy).blocks
        const blockOf = (r, c) => blocks.findIndex(b => b.pos.some(p => p.r === r && p.c === c))
        const bi = blockOf(pa[0], pa[1])
        const bj = blockOf(pb[0], pb[1])
        const needSameBlock = type === 'deskmate' || type === 'nearby'
        if (bi < 0 || bi !== bj) {
          if (needSameBlock) {
            // 跨组：作为同桌 / 坐在周围 不可能满足，不做跨组移动
            this.trackSatisfaction('relation:' + a + '-' + b, 0, 1)
            return
          }
          // 跨组分离型：不同组即已分离（不作为同桌天然满足；不坐在周围按实际距离判定）
          const ok = type === 'not-deskmate' ? !this.isTwoAdjacent(pa, pb) : !this.isTwoNearby(pa, pb)
          this.trackSatisfaction('relation:' + a + '-' + b, ok ? 1 : 0, 1)
          return
        }
        // A、B 在同一组块内：只在该组块内移动，绝不越界到其他组
        effRegion = blocks[bi].pos
      }
      const regionSet = new Set(effRegion.map(p => p.r + ',' + p.c))
      const inRegion = pos => regionSet.has(pos[0] + ',' + pos[1])
      let ok = false
      if (type === 'deskmate') {
        ok = this.isTwoAdjacent(pa, pb)
        if (!ok) ok = this.tryTogetherInRegion(grid, pa, pb, inRegion)
      } else if (type === 'not-deskmate') {
        ok = !this.isTwoAdjacent(pa, pb)
        if (!ok) ok = this.trySeparateInRegion(grid, pa, pb, inRegion, type)
      } else if (type === 'nearby') {
        ok = this.isTwoNearby(pa, pb)
        if (!ok) ok = this.tryNearbyInRegion(grid, pa, pb, inRegion)
      } else { // not-nearby
        ok = !this.isTwoNearby(pa, pb)
        if (!ok) ok = this.trySeparateInRegion(grid, pa, pb, inRegion, type)
      }
      this.trackSatisfaction('relation:' + a + '-' + b, ok ? 1 : 0, 1)
    },

    // 特殊关系：作为同桌 → 把 b 移到 a 的相邻空位（区域内，且不隔走廊）
    tryTogetherInRegion(grid, pa, pb, inRegion) {
      const movedStudent = grid[pb[0]][pb[1]]
      if (!movedStudent) return false
      const [ra, ca] = pa
      for (const dc of [-1, 1]) {
        const nc = ca + dc
        if (!inRegion([ra, nc])) continue
        if (grid[ra][nc] !== null) continue
        // 双人桌模式下必须组成偶数列开头的同桌对（隔走廊不算同桌）
        if (this.mode !== 'single' && Math.min(ca, nc) % 2 !== 0) continue
        grid[ra][nc] = movedStudent
        grid[pb[0]][pb[1]] = null
        return true
      }
      return false
    },
    // 特殊关系：坐在周围 → 把 b 移到 a 的相邻一格（含对角，区域内）
    tryNearbyInRegion(grid, pa, pb, inRegion) {
      const movedStudent = grid[pb[0]][pb[1]]
      if (!movedStudent) return false
      const [ra, ca] = pa
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = ra + dr, nc = ca + dc
          if (nr < 0 || nr >= grid.length) continue
          if (nc < 0 || nc >= grid[nr].length) continue
          if (!inRegion([nr, nc])) continue
          if (nr === pb[0] && nc === pb[1]) continue
          if (grid[nr][nc] === null) {
            grid[nr][nc] = movedStudent
            grid[pb[0]][pb[1]] = null
            return true
          }
        }
      }
      return false
    },
    // 特殊关系：不作为同桌 / 不坐在周围 → 把其中一人移到远处（区域内空位优先，否则与远处学生最小交换）
    trySeparateInRegion(grid, pa, pb, inRegion, type) {
      const moved = Math.random() < 0.5 ? pa : pb
      const other = moved === pa ? pb : pa
      const movedStudent = grid[moved[0]][moved[1]]
      if (!movedStudent) return false
      const isFar = (r, c) => {
        if (type === 'not-deskmate') return !this.isTwoAdjacent([r, c], other)
        return Math.max(Math.abs(r - other[0]), Math.abs(c - other[1])) > 1
      }
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (!inRegion([r, c])) continue
          if (r === moved[0] && c === moved[1]) continue
          if (r === other[0] && c === other[1]) continue
          if (grid[r][c] === null && isFar(r, c)) {
            grid[r][c] = movedStudent
            grid[moved[0]][moved[1]] = null
            return true
          }
        }
      }
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (!inRegion([r, c])) continue
          if (r === moved[0] && c === moved[1]) continue
          if (r === other[0] && c === other[1]) continue
          const occ = grid[r][c]
          if (occ && isFar(r, c)) {
            grid[moved[0]][moved[1]] = occ
            grid[r][c] = movedStudent
            return true
          }
        }
      }
      return false
    },

    // 记录满足率
    trackSatisfaction(key, done, total) {
      if (!this.satisfaction[key]) this.satisfaction[key] = { done: 0, total: 0 }
      this.satisfaction[key].done += done
      this.satisfaction[key].total += total
    },
    satisfactionKey(node) {
      if (node.key === 'relation') return 'relation:' + node.pair.a + '-' + node.pair.b
      return node.key
    },
    // 某条件的满足率（未排表或无统计时返回 null）：内联显示在每行条件右侧
    satisfactionOf(node) {
      const key = this.satisfactionKey(node)
      if (!key || !this.satisfaction[key]) return null
      const { done, total } = this.satisfaction[key]
      return total ? Math.round((done / total) * 100) : 0
    },

    // 生成排表结果：保证每次"开始排表/换一换"布局与当前预览不同
    generatePreview() {
      let result = this.buildSeats()
      let guard = 0
      while (guard < 30 && this.previewSeats && this.previewSeats.length && this.sameLayout(result, this.previewSeats)) {
        result = this.buildSeats()
        guard++
      }
      this.previewSeats = result
      this.previewVersion++
    },

    // 判断两张座次网格是否完全相同（任一学生位置不同即视为不同）
    sameLayout(a, b) {
      if (!a || !b || a.length !== b.length) return false
      for (let r = 0; r < a.length; r++) {
        const rowA = a[r] || []
        const rowB = b[r] || []
        for (let c = 0; c < rowA.length; c++) {
          const ia = rowA[c]?.id ?? null
          const ib = rowB[c]?.id ?? null
          if (ia !== ib) return false
        }
      }
      return true
    },

    // ==================== 组内排表整块工具 ====================
    // 按分组方式把座位网格划分成组块，返回 { blockRows, blockCols, blocks: [{ br, bc, pos: [{r,c}] }] }
    buildGroupBlocks() {
      const cfg = this.groupConfig()
      const groupBy = cfg?.groupBy || 'six'
      const { blockRows, blockCols, blocks } = this.buildBlocksBy(groupBy)
      return { blockRows, blockCols, blocks }
    },
    // 按几何方式（six/four/whole/column）把整张网格切成块（随机排表的"随机单位"复用此几何规则）
    // 相邻六位 = 2列×3行（国内常见 6 人组排布，与双人桌 2 列一桌的边界对齐，保证同桌不跨组）
    buildBlocksBy(groupBy) {
      let rSpan, cSpan
      if (groupBy === 'column') { rSpan = this.rows; cSpan = 1 }
      else if (groupBy === 'whole') { rSpan = this.rows; cSpan = this.cols }
      else if (groupBy === 'six') { rSpan = 3; cSpan = 2 }
      else { rSpan = 2; cSpan = 2 } // 'four'：2列×2行
      const blockRows = Math.ceil(this.rows / rSpan)
      const blockCols = Math.ceil(this.cols / cSpan)
      const blocks = []
      for (let br = 0; br < blockRows; br++) {
        for (let bc = 0; bc < blockCols; bc++) {
          const pos = []
          const rStart = br * rSpan
          const rEnd = Math.min(rStart + rSpan - 1, this.rows - 1)
          const cStart = bc * cSpan
          const cEnd = Math.min(cStart + cSpan - 1, this.cols - 1)
          for (let r = rStart; r <= rEnd; r++) {
            for (let c = cStart; c <= cEnd; c++) pos.push({ r, c })
          }
          blocks.push({ br, bc, pos })
        }
      }
      return { blockRows, blockCols, blocks }
    },
    // 取每个组块当前位置上的学生内容（按自然顺序排列成数组）
    extractGroupContents(grid, blocks) {
      return blocks.map(b => b.pos.map(p => grid[p.r][p.c]))
    },
    // 生成组块内容的置换顺序（新块 i 放置旧块 perm[i] 的内容）
    buildGroupPerm(blocks, blockRows, blockCols) {
      const cfg = this.groupConfig()
      const swapType = cfg?.swapType || 'random'
      const n = blocks.length
      const idx = b => b.br * blockCols + b.bc
      if (swapType === 'random') {
        const perm = blocks.map((_, i) => i)
        for (let i = perm.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[perm[i], perm[j]] = [perm[j], perm[i]]
        }
        return perm
      }
      if (swapType === 'updown') {
        const perm = new Array(n)
        blocks.forEach(b => { perm[idx(b)] = idx({ br: blockRows - 1 - b.br, bc: b.bc }) })
        return perm
      }
      const path = []
      for (let bc = 0; bc < blockCols; bc++) {
        for (let bb = 0; bb < blockRows; bb++) {
          const br = bc % 2 === 0 ? bb : blockRows - 1 - bb
          path.push(idx({ br, bc }))
        }
      }
      const perm = new Array(n)
      for (let i = 0; i < path.length; i++) {
        perm[path[i]] = path[(i - 1 + path.length) % path.length]
      }
      return perm
    },
    // 应用组内排表：整块移动（成员不跨组、不丢学生）
    applyGroupSwap(grid) {
      const { blockRows, blockCols, blocks } = this.buildGroupBlocks()
      const contents = this.extractGroupContents(grid, blocks)
      const sizes = blocks.map(b => b.pos.length)
      const n = blocks.length
      const perm = new Array(n)
      const allSame = sizes.every(s => s === sizes[0])
      if (allSame) {
        const p = this.buildGroupPerm(blocks, blockRows, blockCols)
        p.forEach((v, i) => { perm[i] = v })
      } else {
        const bySize = {}
        blocks.forEach((b, i) => { (bySize[sizes[i]] = bySize[sizes[i]] || []).push(i) })
        for (const sz in bySize) {
          const idxs = bySize[sz]
          const p = idxs.map((_, i) => i)
          for (let i = p.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[p[i], p[j]] = [p[j], p[i]]
          }
          idxs.forEach((orig, k) => { perm[orig] = idxs[p[k]] })
        }
      }
      const newGrid = grid.map(row => row.map(() => null))
      blocks.forEach((b, i) => {
        const src = contents[perm[i]]
        b.pos.forEach((p, k) => { newGrid[p.r][p.c] = src[k] ?? null })
      })
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) grid[r][c] = newGrid[r][c]
      }
    },

    // ==================== 位置工具 ====================
    // 返回学生 id 在座位网格中的位置 [r, c]
    findPos(seats, id) {
      for (let r = 0; r < seats.length; r++) {
        for (let c = 0; c < seats[r].length; c++) {
          if (seats[r][c] && seats[r][c].id === id) return [r, c]
        }
      }
      return null
    },
    // 是否同桌：同一行左右紧邻，且双人桌模式下必须是偶数列开头的同桌对（隔走廊不算同桌）
    isTwoAdjacent(pa, pb) {
      if (pa[0] !== pb[0]) return false
      if (Math.abs(pa[1] - pb[1]) !== 1) return false
      if (this.mode !== 'single') {
        return Math.min(pa[1], pb[1]) % 2 === 0
      }
      return true
    },
    // 是否在周围（前后左右 + 斜对角，即切比雪夫距离 <= 1）
    isTwoNearby(pa, pb) {
      return Math.max(Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1])) <= 1
    },

    // ==================== 条件树拖拽交互 ====================
    onOptionDragStart(e, opt) {
      e.dataTransfer.setData('text/plain', opt.key)
      e.dataTransfer.effectAllowed = 'copy'
    },
    onNodeDragStart(e, node) {
      e.dataTransfer.setData('text/plain', node.key)
      e.dataTransfer.effectAllowed = 'copy'
    },
    // 开始排表 / 换一换
    startArrange() {
      this.generatePreview()
      this.arranged = true
    },
    // 条件变更后重置为"开始排表"（预览回到未改动的座位表）
    resetArranged() {
      this.arranged = false
      this.previewSeats = this.buildInitialSeats()
      this.previewVersion++
    },
    // 将当前座位表（id 网格）映射为预览用的学生对象网格
    buildInitialSeats() {
      const grid = []
      const src = this.initialSeats
      for (let r = 0; r < this.rows; r++) {
        const row = []
        for (let c = 0; c < this.cols; c++) {
          const val = src?.[r]?.[c]
          let student = null
          if (typeof val === 'number') student = this.students.find(s => s.id === val) || null
          else if (val && typeof val === 'object') student = val
          row.push(student)
        }
        grid.push(row)
      }
      return grid
    },
    // 从原座位表提取已达成的同桌对：同一行相邻两列（第0、1、2、3…）的学生两两为一对
    // 返回 { pairs: [[学生,学生],...], singles: [学生,...], orphans: [学生,...] }
    extractOriginalPairs() {
      const pairs = []
      const singles = []
      const used = new Set()
      const src = this.initialSeats
      for (let r = 0; r < this.rows; r++) {
        const row = src?.[r] || []
        for (let c = 0; c < this.cols; c += 2) {
          const a = row[c]
          const b = row[c + 1]
          const sa = typeof a === 'number' ? this.students.find(s => s.id === a) : null
          const sb = typeof b === 'number' ? this.students.find(s => s.id === b) : null
          if (sa && sb) {
            pairs.push([sa, sb])
            used.add(sa.id)
            used.add(sb.id)
          } else if (sa) {
            singles.push(sa)
            used.add(sa.id)
          } else if (sb) {
            singles.push(sb)
            used.add(sb.id)
          }
        }
      }
      const orphans = this.students.filter(s => !used.has(s.id))
      return { pairs, singles, orphans }
    },
    // 拖到空白区：作为新的顶级排表方式（特殊关系可作一级，其余限制条件仍拒绝）
    onDropTop(e) {
      const opt = this.findOption(e)
      if (!opt) return
      // 限制条件默认不能作为一级条件，拒绝拖拽（特殊关系除外）
      if (opt.type === 'constraint' && !opt.canTop) {
        this.rejectText = `"${opt.label}" 是限制条件，只能拖到某排表方式下方作为附加条件`
        this.showReject()
        return
      }
      if (!this.tree.some(n => n.key === opt.key)) {
        this.tree.push({
          key: opt.key, label: opt.label, children: [],
          option: opt.options ? opt.options[0].value : undefined,
          ...this.initExtra(opt)
        })
        this.resetArranged()
      }
    },
    // 拒绝提示
    showReject() {
      clearTimeout(this._rejectTimer)
      this._rejectTimer = setTimeout(() => { this.rejectText = '' }, 2500)
    },
    // 取某条件的可配置参数定义（无下拉则返回 null）
    optionDef(key) {
      const opt = OPTIONS.find(o => o.key === key)
      return opt && opt.options ? opt : null
    },
    // 特殊关系条件的可选关系类型定义
    relationOptionDef() {
      return OPTIONS.find(o => o.key === 'relation')
    },
    // 拖入节点时补充特殊关系所需字段
    initExtra(opt) {
      if (opt.key === 'relation') {
        return { pair: { a: '', b: '' }, relationType: 'deskmate' }
      }
      if (opt.key === 'group') {
        return { groupBy: 'six', swapType: 'random' }
      }
      return {}
    },
    // 组内排表：分组方式选项
    groupOptions() {
      return [
        { value: 'column', label: '一列' },
        { value: 'whole', label: '一大组' },
        { value: 'six', label: '相邻六位' },
        { value: 'four', label: '相邻四位' }
      ]
    },
    // 组内排表：交换方式选项（仅相邻六位支持 Z字形 / 上下交换型）
    swapTypeOptions(groupBy) {
      const base = [{ value: 'random', label: '随机型' }]
      if (groupBy === 'six') {
        return [
          { value: 'z', label: 'Z字形' },
          { value: 'updown', label: '上下交换型' },
          ...base
        ]
      }
      return base
    },
    // 拖到某个父级方式下：作为其附加条件（缩进）
    onDropChild(e, node) {
      const opt = this.findOption(e)
      if (!opt) return
      if (opt.key === node.key) return
      if (!node.children.some(c => c.key === opt.key)) {
        node.children.push({
          key: opt.key,
          label: opt.label,
          children: [],
          option: opt.options ? opt.options[0].value : undefined,
          ...this.initExtra(opt)
        })
        this.resetArranged()
      }
    },
    // 拖到某个"组内排表"子级下方：作为其附加条件（孙子级）
    onDropGrandChild(e, ni, ci) {
      const opt = this.findOption(e)
      if (!opt) return
      const child = this.tree[ni]?.children?.[ci]
      if (!child) return
      if (opt.key === child.key) return
      if (!child.children) child.children = []
      if (!child.children.some(c => c.key === opt.key)) {
        child.children.push({
          key: opt.key,
          label: opt.label,
          children: [],
          option: opt.options ? opt.options[0].value : undefined,
          ...this.initExtra(opt)
        })
        this.resetArranged()
      }
    },
    findOption(e) {
      const key = e.dataTransfer.getData('text/plain')
      return OPTIONS.find(o => o.key === key)
    },
    removeNode(ni) {
      this.tree.splice(ni, 1)
      this.resetArranged()
    },
    removeChild(ni, ci) {
      this.tree[ni]?.children.splice(ci, 1)
      this.resetArranged()
    },
    removeGrandChild(ni, ci, gi) {
      this.tree[ni]?.children?.[ci]?.children?.splice(gi, 1)
      this.resetArranged()
    },
    // 折叠/展开条件节点（纯 UI 操作：状态独立存储，不触发条件变更监听）
    toggleCollapse(node) {
      this.collapsedMap.set(node, !this.collapsedMap.get(node))
    },
    isCollapsed(node) {
      return !!this.collapsedMap.get(node)
    },

    // 构建 GridView 预览用的显示行
    buildPreviewRows(seats) {
      const displayCols = this.getDisplayColCount(this.cols, this.mode, this.showAisle)
      const result = []
      result.push({ _rowKey: 'podium', label: '讲  台', _isPodium: true, _isReadonly: true, cells: [] })
      for (let r = 0; r < this.rows; r++) {
        const rowCells = []
        let realCol = 0
        for (let d = 0; d < displayCols; d++) {
          if (this.isAisleCol(d, this.cols, this.mode, this.showAisle)) {
            if (r === 0) rowCells.push({ course: '走廊', _isAisle: true, _aisleRowSpan: this.rows, _isAisleHidden: false })
            else rowCells.push({ course: '', _isAisle: false, _isAisleHidden: true })
          } else {
            const student = seats[r]?.[realCol]
            rowCells.push({ course: student?.姓名 || '', _isAisle: false, _isAisleHidden: false, _studentId: student?.id ?? null })
            realCol++
          }
        }
        result.push({ _rowKey: `row_${r}`, label: `第${r + 1}行`, cells: rowCells, _isReadonly: true, _lessonIdx: r, _periodRowSpan: 0, periodLabel: '' })
      }
      return result
    },

    cancel() { this.$emit('cancel') },
    confirm() {
      // 输出为座位表数据：二维数组，元素为学生 id 或 null
      const seatsOut = this.previewSeats.map(row => row.map(s => (s ? s.id : null)))
      this.$emit('confirm', { seats: seatsOut })
    }
  }
}
</script>