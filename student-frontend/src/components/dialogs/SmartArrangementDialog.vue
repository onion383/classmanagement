<template>
  <Teleport to="body">
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
    <div class="bg-surface rounded-lg p-5 shadow-card dialog-card flex flex-col overflow-hidden" style="width: 960px; height: 800px; max-width: 90vw; max-height: 90vh;">
      <h3 class="text-lg font-bold mb-4">🧠 智能排表</h3>

      <!-- 新同学确认：座位表里有班级学生信息表不存在的名字时提示 -->
      <NewComerConfirm :visible="showNewPrompt" :names="strangers" action="排表" @participate="onParticipate" @not="onNot" />

      <!-- 草稿确认：本次结果来自草稿（恢复或刚保存）时，应用前确认一次，正式应用会清空草稿 -->
      <ConfirmDialog
        :visible="draftConfirmVisible"
        title="确认应用草稿"
        message="检测到你使用了草稿，是否确认应用？<br>点击「确认」正式应用到座位表后，草稿将会被清空。"
        confirm-text="确认"
        cancel-text="取消"
        :show-cancel="true"
        @confirm="applyConfirm"
        @cancel="draftConfirmVisible = false"
      />

      <!-- 排表条件：标题与「开始排表」按钮独立在毛玻璃外；条件行 + 底部拖放位同处一块毛玻璃 -->
      <div class="mb-3">
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-medium block">排表条件</label>
          <button @click="startArrange" class="bg-primary text-text-inverse px-3 py-1.5 rounded border-none cursor-pointer text-sm">{{ arranged ? '🔀 换一换' : '▶ 开始排表' }}</button>
        </div>
        <div
          class="border border-dashed border-border rounded-lg p-2 bg-surface/55 backdrop-blur-md"
          @dragover.prevent
          @drop="onDropZone"
        >
          <div class="max-h-[260px] overflow-auto">
            <div v-if="conditions.length === 0" class="text-sm text-text-muted py-1">把下方的条件选项拖到这里添加</div>
            <div
              v-for="(node, ni) in conditions"
              :key="node.uid"
              class="mb-1 last:mb-0"
              @dragover.prevent
              @drop.stop="onDropOnRow($event, ni)"
            >
              <div class="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded bg-primary text-text-inverse text-sm">
                <span class="cursor-grab select-none text-text-inverse/70" draggable="true" @dragstart="onRowDragStart($event, ni)">⠿</span>
                <!-- 条件名字：语义句前先亮明是哪个条件 -->
                <span class="font-semibold whitespace-nowrap">{{ node.label }}</span>
                <!-- 语义句：文案段 + 下拉位，由条件注册表驱动 -->
                <template v-for="s in segmentsOf(node)" :key="s.idx">
                  <span v-if="s.t === 'text'" class="text-text-inverse/90">{{ s.v }}</span>
                  <AppSelect
                    v-else
                    :model-value="getField(node, s.path)"
                    :options="s.options"
                    :placeholder="s.placeholder"
                    :class="s.width"
                    @update:model-value="v => setField(node, s.path, v)"
                  />
                </template>
                <span v-if="satisfactionOf(node) !== null" class="ml-auto text-xs px-1.5 py-0.5 rounded bg-white/20 text-text-inverse border border-white/30">满足 {{ satisfactionOf(node) }}%</span>
                <button @click="removeCondition(ni)" class="cursor-pointer text-text-inverse/80 hover:text-text-inverse font-bold leading-none text-base">×</button>
              </div>
            </div>
          </div>
          <!-- 新增条件行：常驻在条件列表下方（条件多时列表内部滚动，此行不随之滚走），
               把上方条件选项拖到这里即追加到末尾。样式对齐值日表智能排表的投放虚线框 -->
          <div
            class="mt-1 text-xs text-text-muted px-2 py-1 rounded border border-dashed border-info/40 flex items-center select-none"
            @dragover.prevent
            @drop.stop="onDropZone"
          >拖动到这里新增条件</div>
        </div>
      </div>

      <!-- 优先级提示（满足率已内联显示在每行条件右侧） -->
      <div class="mb-3 text-xs text-text-muted">条件按顺序依次生效，越靠后的条件越重要，可部分覆盖前面的结果。</div>

      <!-- 条件选项：6 个按钮，拖到上方即可添加（可重复添加，不限数量） -->
      <div class="mb-4">
        <label class="text-sm font-medium mb-2 block">条件选项（拖到上方添加，可重复添加）</label>
        <div class="flex flex-wrap gap-2">
          <div
            v-for="opt in conditionButtons"
            :key="opt.key"
            draggable="true"
            @dragstart="onOptionDragStart($event, opt.key)"
            class="px-3 py-2 rounded border border-border bg-primary text-text-inverse cursor-grab select-none text-sm shadow-sm hover:border-info"
          >
            {{ opt.label }}
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

      <div class="flex items-center justify-end gap-2">
        <!-- 保存草稿：把当前预览结果 + 条件存到后端，下次启动据此提示「已恢复上一次的草稿表」 -->
        <button
          @click="saveDraft"
          :disabled="!arranged || savingDraft"
          class="bg-surface-hover px-4 py-2 rounded text-text border border-border mr-auto disabled:opacity-40 disabled:cursor-not-allowed"
        >{{ savingDraft ? '保存中…' : '保存草稿' }}</button>
        <button @click="cancel" class="bg-surface-hover px-4 py-2 rounded text-text border border-border">取消</button>
        <button @click="confirm" class="bg-info text-text-inverse px-4 py-2 rounded border-none">确定</button>
      </div>
    </div>
  </div>
  </Transition>
  </Teleport>
</template>

<script>
import GridView from '../tables/GridView.vue';
import NewComerConfirm from './NewComerConfirm.vue';
import ConfirmDialog from '../base/ConfirmDialog.vue';
import AppSelect from '../base/AppSelect.vue';
import { useSeatDraft } from '../../composables/useSeatDraft.js'
import { useNotification } from '../../composables/useNotification.js'
import '../../styles/dialog-transition.css'

// Fisher-Yates 洗牌
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 条件注册表：每类条件在此登记 —— 执行函数名(apply) + 语义句段(segments) + 初始参数(defaults)。
// 模板里的条件行 UI 与流水线的条件分发都由本表驱动：
//   新增一类条件，只需在此加一条 + 一个 apply 方法，无需再改动模板或 if/else。
// segments 每段：{ t:'text', v } 为纯文案段；{ t:'select', path, options, width, placeholder } 为下拉位。
// options 取值：groups(分组单位) | students(可选学生) | relation(关系类型) | swapTypes(分组方式)
//              | lockModes(同桌内部) | genders(性别) | innerOrder(组内排序)
// 六句语义文案逐字保留（位置公平用「中」，其余用「内」）：
//   特殊选项：在[范围]内 尽量满足[学生A]和[学生B]同学 [作为同桌/不作为同桌/坐在附近/不坐在附近]
//   分组选项：在[范围]内 按照[单位]为一组 [Z字形/上下交换形/随机性分组]
//   随机选项：在[范围]内 按照[单位]为操作单元 随机排布
//   同桌关系：在[范围]内 同桌不变为一组 随机排布 并且 内部 同桌 [交换位置/不交换位置/不变]
//   性别选项：在[范围]内 按照同桌为一组 [相同性别/不同性别] 坐在一起
//   位置公平选项：在[范围]中 按照[单位]为一组 整体调整使得位置更加公平 并且 [可以/不可以] 调整组内排序 使得位置更加公平
const CONDITION_REGISTRY = {
  relation: {
    label: '特殊选项',
    apply: 'applyRelation',
    defaults: () => ({ scope: 'whole', pair: { a: '', b: '' }, relationType: 'deskmate' }),
    segments: [
      { t: 'text', v: '在' }, { t: 'select', path: 'scope', options: 'groups', width: 'w-24' },
      { t: 'text', v: '内 尽量满足' }, { t: 'select', path: 'pair.a', options: 'students', width: 'w-24', placeholder: '选择学生' },
      { t: 'text', v: '和' }, { t: 'select', path: 'pair.b', options: 'students', width: 'w-24', placeholder: '选择学生' },
      { t: 'text', v: '同学' }, { t: 'select', path: 'relationType', options: 'relation', width: 'w-28' }
    ]
  },
  group: {
    label: '分组选项',
    apply: 'applyGroupAction',
    defaults: () => ({ scope: 'whole', unit: 'six', swapType: 'random' }),
    segments: [
      { t: 'text', v: '在' }, { t: 'select', path: 'scope', options: 'groups', width: 'w-24' },
      { t: 'text', v: '内 按照' }, { t: 'select', path: 'unit', options: 'groups', width: 'w-24' },
      { t: 'text', v: '为一组' }, { t: 'select', path: 'swapType', options: 'swapTypes', width: 'w-32' }
    ]
  },
  random: {
    label: '随机选项',
    apply: 'applyRandom',
    defaults: () => ({ scope: 'whole', unit: 'six' }),
    segments: [
      { t: 'text', v: '在' }, { t: 'select', path: 'scope', options: 'groups', width: 'w-24' },
      { t: 'text', v: '内 按照' }, { t: 'select', path: 'unit', options: 'groups', width: 'w-24' },
      { t: 'text', v: '为操作单元 随机排布' }
    ]
  },
  'lock-deskmate': {
    label: '同桌关系',
    apply: 'applyLockDeskmate',
    defaults: () => ({ scope: 'whole', lockMode: 'no-swap' }),
    segments: [
      { t: 'text', v: '在' }, { t: 'select', path: 'scope', options: 'groups', width: 'w-24' },
      { t: 'text', v: '内 同桌不变为一组 随机排布 并且 内部 同桌' },
      { t: 'select', path: 'lockMode', options: 'lockModes', width: 'w-32' }
    ]
  },
  gender: {
    label: '性别选项',
    apply: 'applyGender',
    defaults: () => ({ scope: 'whole', genderMode: 'same' }),
    segments: [
      { t: 'text', v: '在' }, { t: 'select', path: 'scope', options: 'groups', width: 'w-24' },
      { t: 'text', v: '内 按照同桌为一组' },
      { t: 'select', path: 'genderMode', options: 'genders', width: 'w-28' },
      { t: 'text', v: '坐在一起' }
    ]
  },
  fair: {
    label: '位置公平选项',
    apply: 'applyFair',
    defaults: () => ({ scope: 'whole', unit: 'six', innerOrder: 'no' }),
    segments: [
      { t: 'text', v: '在' }, { t: 'select', path: 'scope', options: 'groups', width: 'w-24' },
      { t: 'text', v: '中 按照' }, { t: 'select', path: 'unit', options: 'groups', width: 'w-24' },
      { t: 'text', v: '为一组 整体调整使得位置更加公平 并且' },
      { t: 'select', path: 'innerOrder', options: 'innerOrder', width: 'w-32' },
      { t: 'text', v: '调整组内排序 使得位置更加公平' }
    ]
  }
}

// 底部按钮顺序（与六句语义条件一一对应）
const CONDITION_ORDER = ['relation', 'group', 'random', 'lock-deskmate', 'gender', 'fair']

export default {
  name: 'SmartArrangementDialog',
  components: { GridView, NewComerConfirm, ConfirmDialog, AppSelect },
  props: {
    visible: Boolean,
    rows: { type: Number, default: 6 },
    cols: { type: Number, default: 7 },
    mode: { type: String, default: 'single' },
    showAisle: { type: Boolean, default: true },
    students: { type: Array, default: () => [] },
    // 当前未改动的座位表（二维数组，元素为学生 id 或 null），用于初始/条件变更时预览
    initialSeats: { type: Array, default: () => [] },
    // 位置权重矩阵（rows×cols）与「座位指数账本」（学生 id → 截至今日之前累计的座位权重），供「位置公平」使用
    weights: { type: Array, default: () => [] },
    ledger: { type: Object, default: () => ({}) }
  },
  emits: ['cancel', 'confirm'],
  data() {
    return {
      // 排表条件：一层平铺，一行一条件（可拖拽排序、可重复添加、不限数量）
      conditions: [{ uid: 0, key: 'random', label: '随机选项', scope: 'whole', unit: 'six' }],
      nextUid: 1,
      previewSeats: [],
      previewVersion: 0,
      // 是否已排表：false 显示"开始排表"，true 显示"换一换"
      arranged: false,
      // 每个条件的满足率统计：uid -> { done, total }
      satisfaction: {},
      // 新同学校验：座位表里有名字不在班级学生信息表中，参与排表前弹窗确认
      showNewPrompt: false,
      excludeNew: false,
      // 恢复的草稿座位（二维数组，学生 id / 新同学名字 / null）；为空表示没有草稿，
      // 预览与后续排表都以它优先于 props.initialSeats 作为基准
      draftSeats: null,
      // 保存草稿中：按钮置灰防重复点击
      savingDraft: false,
      // 本次结果是否来自草稿（打开时恢复了草稿，或刚点过保存草稿）：为真时「确定」前先弹确认框
      draftInUse: false,
      // 草稿确认弹窗：标题「确认应用草稿」，取消则留在弹窗内继续调整
      draftConfirmVisible: false,
      // 恢复草稿的过程中暂缓条件变更监听，避免恢复动作本身把 arranged 重置掉
      restoring: false
    }
  },
  computed: {
    // 排表基准座位：有草稿用草稿，否则用父组件传入的当前座位表
    baseSeats() {
      return this.draftSeats || this.initialSeats
    },
    // 座位表里有名字但班级学生信息表里不存在的名字集合
    // 座位表数据：班级学生存 id(数字)，未被识别的自由文本名字(新同学)以字符串形式存储
    strangerNames() {
      const known = new Set(this.students.map(s => String(s.姓名 || '').trim()).filter(Boolean))
      const out = new Set()
      for (const row of this.baseSeats || [])
        for (const val of row || []) {
          let n = ''
          if (typeof val === 'string') n = val.trim()
          else if (val && typeof val === 'object') n = String(val.姓名 || '').trim()
          if (n && !known.has(n)) out.add(n)
        }
      return out
    },
    strangers() {
      return [...this.strangerNames]
    },
    previewKey() {
      const sig = this.conditions.map(c => c.key + ':' + c.uid).join('-') || 'empty'
      return this.visible ? `arrange-${this.rows}-${this.cols}-${sig}-${this.previewVersion}` : 'closed'
    },
    previewColHeaders() {
      return this.generateColHeaders(this.cols, this.mode, this.showAisle)
    },
    previewRows() {
      return this.buildPreviewRows(this.previewSeats)
    },
    // 底部条件按钮（六类条件，拖到上方即添加，可重复添加）
    conditionButtons() {
      return CONDITION_ORDER.map(k => ({ key: k, label: CONDITION_REGISTRY[k].label }))
    },
    // 特殊关系可选学生（转为 { value: id, label: 姓名 }）
    studentOptions() {
      return this.students.map(s => ({ value: s.id, label: s.姓名 }))
    }
  },
  watch: {
    async visible(v) {
      if (!v) return
      this.showNewPrompt = false
      this.excludeNew = false
      this.arranged = false
      this.draftConfirmVisible = false
      // 有草稿则恢复上次草稿（座位结果 + 排表条件）；没有则显示未改动的当前座位表，不自动排表
      const { draft, fetchDraft } = useSeatDraft()
      if (!draft.loaded) await fetchDraft()
      if (draft.exists) {
        // restoring 期间暂缓 conditions 监听，避免恢复条件本身把 arranged 重置为未排表
        this.restoring = true
        this.draftSeats = draft.seats
        this.draftInUse = true
        this.restoreConditions(draft.conditions)
        await this.$nextTick()
        this.restoring = false
        this.arranged = true
      } else {
        this.draftSeats = null
        this.draftInUse = false
      }
      this.previewSeats = this.buildInitialSeats()
      this.previewVersion++
    },
    // 任一条件（含下拉选项、顺序）变更：重置为"开始排表"
    conditions: {
      deep: true,
      handler() {
        if (this.restoring) return
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

    // ==================== 统一条件流水线（一层平铺，线性执行） ====================
    // 依据当前条件列表构建一张新的座位网格。
    // 每条条件都自带「作用域 scope」：先把区域按 scope 切成若干作用块，条件在每个块内生效；
    // 列表按顺序依次执行，越靠后的条件越晚执行、可部分覆盖前面的结果（越靠后越重要）。
    buildSeats() {
      this.satisfaction = {}
      const grid = this.initGrid()
      const all = this.allCells()
      for (const node of this.conditions) {
        // 作用域切块后取各块的格子列表，作为「区域」交给条件（条件内部再按 unit 切块）
        const regions = this.splitRegion(all, node.scope).map(b => b.pos)
        this.applyCondition(grid, regions, node)
      }
      return grid
    },

    // 应用单条条件（按条件类注册表查表分发）
    applyCondition(grid, regions, node) {
      if (!node) return
      const reg = CONDITION_REGISTRY[node.key]
      const fn = reg && reg.apply
      if (fn) this[fn](grid, regions, node)
    },

    // 初始化网格：从原座位表填满学生，未出现的学生补到空位
    initGrid() {
      const grid = Array.from({ length: this.rows }, () => new Array(this.cols).fill(null))
      const used = new Set()
      // 新同学(字符串名字)没有真实 id，给一个负 id 占位，使其能走通排表流水线
      let pseudoId = -1
      const pseudoCache = {}
      const ensurePseudo = n => {
        if (!pseudoCache[n]) pseudoCache[n] = { id: pseudoId--, 姓名: n }
        return pseudoCache[n]
      }
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const val = this.baseSeats?.[r]?.[c]
          let s = null
          if (typeof val === 'number') {
            s = this.students.find(x => x.id === val)
          } else if (typeof val === 'string') {
            // 班级学生存 id，字符串名字均为"新同学"（未识别的自由文本）
            const n = val.trim()
            if (n && !(this.excludeNew && this.strangerNames.has(n))) s = ensurePseudo(n)
          } else if (val && typeof val === 'object') {
            const n = String(val.姓名 || '').trim()
            if (!(this.excludeNew && this.strangerNames.has(n))) {
              s = n ? ensurePseudo(n) : val
            }
          }
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

    // 几何切块规则：column 一列（每列一块）| whole 一大组（整块）| six 相邻六位(3行×2列) | four 相邻四位(2行×2列)
    //             | student 同学（一人一格一块）| deskmate 同桌（同行左右相邻两人一块）
    shapeSpans(shape) {
      if (shape === 'column') return { rSpan: this.rows, cSpan: 1 }
      if (shape === 'whole') return { rSpan: this.rows, cSpan: this.cols }
      if (shape === 'six') return { rSpan: 3, cSpan: 2 }
      if (shape === 'student') return { rSpan: 1, cSpan: 1 }
      return { rSpan: 2, cSpan: 2 }
    },
    // 把区域按几何方式切成若干子块（scope 与 unit 共用此规则）
    splitRegion(region, shape) {
      // 同桌：不按矩形切，改按「同行相邻两列」成对（与人数桌模式无关，单/双人桌都适用）
      if (shape === 'deskmate') {
        const map = new Map()
        for (const p of region) {
          const k = p.r + ',' + Math.floor(p.c / 2)
          let b = map.get(k)
          if (!b) { b = { br: p.r, bc: Math.floor(p.c / 2), pos: [] }; map.set(k, b) }
          b.pos.push(p)
        }
        return [...map.values()]
      }
      const { rSpan, cSpan } = this.shapeSpans(shape)
      const map = new Map()
      for (const p of region) {
        const br = Math.floor(p.r / rSpan), bc = Math.floor(p.c / cSpan)
        const k = br + ',' + bc
        let b = map.get(k)
        if (!b) { b = { br, bc, pos: [] }; map.set(k, b) }
        b.pos.push(p)
      }
      return [...map.values()]
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

    // 随机排表：在「作用域」内，按「操作单元」把内容整块打乱（单元即最小不可分割单位，成员不跨块）
    applyRandom(grid, regions, node) {
      const unit = node.unit || 'six'
      let total = 0
      for (const region of regions) {
        const blocks = this.splitRegion(region, unit)
        if (blocks.length >= 2) {
          this.applyPerm(grid, blocks, this.permWithinSizes(blocks))
        } else {
          // 只有一块时退化为「逐个学生」打乱，保证"换一换"仍能换出不同布局
          this.shuffleSingles(grid, region)
        }
        total += region.filter(p => grid[p.r][p.c]).length
      }
      this.trackSatisfaction(node.uid, total, total)
    },

    // 以「个人」为最小单位打乱（每个学生独立，不保留同桌对）
    shuffleSingles(grid, region) {
      const students = region.map(p => grid[p.r][p.c]).filter(s => s)
      const units = students.map(s => ({ cells: [s], indivisible: false }))
      this.fillSlots(grid, region, this.regionSlots(region), shuffle(units))
    },

    // ==================== 组块置换工具 ====================
    // 按置换把组块内容整块搬到目标位置（块内成员不拆分；只写回这些区块，区域外不受影响）
    applyPerm(grid, blocks, perm) {
      const contents = blocks.map(b => b.pos.map(p => grid[p.r][p.c]))
      const writes = []
      blocks.forEach((b, i) => {
        const src = contents[perm[i]] || []
        b.pos.forEach((p, k) => { writes.push([p, src[k] ?? null]) })
      })
      for (const [p, v] of writes) grid[p.r][p.c] = v
    },
    // 同大小组块之间随机置换（避免大小不同的区块互相搬运导致学生丢失）
    permWithinSizes(blocks) {
      const sizes = blocks.map(b => b.pos.length)
      const bySize = new Map()
      blocks.forEach((b, i) => {
        const k = sizes[i]
        if (!bySize.has(k)) bySize.set(k, [])
        bySize.get(k).push(i)
      })
      const perm = new Array(blocks.length)
      for (const [, idxs] of bySize) {
        const sh = shuffle(idxs)
        idxs.forEach((orig, k) => { perm[orig] = sh[k] })
      }
      return perm
    },
    // 分组方式置换：随机 → 同大小随机；Z字形 / 上下交换形 → 在块阵列内按路径置换
    buildGroupPerm(blocks, swapType) {
      const n = blocks.length
      if (swapType !== 'updown' && swapType !== 'z') return this.permWithinSizes(blocks)
      const brs = blocks.map(b => b.br), bcs = blocks.map(b => b.bc)
      const minBr = Math.min(...brs), minBc = Math.min(...bcs)
      const rows = Math.max(...brs) - minBr + 1
      const cols = Math.max(...bcs) - minBc + 1
      const indexOf = new Array(rows * cols).fill(-1)
      blocks.forEach((b, i) => { indexOf[(b.br - minBr) * cols + (b.bc - minBc)] = i })
      const perm = new Array(n).fill(-1)
      if (swapType === 'updown') {
        blocks.forEach((b, i) => {
          const lr = rows - 1 - (b.br - minBr)
          const lc = b.bc - minBc
          const j = indexOf[lr * cols + lc]
          perm[i] = j >= 0 ? j : i
        })
      } else {
        // Z字形路径：逐列蛇形（偶数列自上而下，奇数列自下而上），沿路径整体前移一位
        const path = []
        for (let lc = 0; lc < cols; lc++) {
          for (let lb = 0; lb < rows; lb++) {
            const lr = lc % 2 === 0 ? lb : rows - 1 - lb
            const j = indexOf[lr * cols + lc]
            if (j >= 0) path.push(j)
          }
        }
        for (let i = 0; i < path.length; i++) perm[path[i]] = path[(i - 1 + path.length) % path.length]
      }
      for (let i = 0; i < n; i++) if (perm[i] < 0) perm[i] = i
      return perm
    },
    // 分组选项：在「作用域」内按「单位」切块，再按「分组方式」整块换位（成员不跨块、不丢学生）
    applyGroupAction(grid, regions, node) {
      const swapType = node.swapType || 'random'
      const unit = node.unit || 'six'
      let total = 0
      for (const region of regions) {
        const blocks = this.splitRegion(region, unit)
        if (blocks.length >= 2) {
          const sizes = blocks.map(b => b.pos.length)
          const allSame = sizes.every(s => s === sizes[0])
          // Z字形 / 上下交换形要求各块大小一致，否则退化为同大小随机
          const perm = allSame ? this.buildGroupPerm(blocks, swapType) : this.permWithinSizes(blocks)
          this.applyPerm(grid, blocks, perm)
        }
        total += region.filter(p => grid[p.r][p.c]).length
      }
      this.trackSatisfaction(node.uid, total, total)
    },

    // 性别选择：在「作用域」内，按性别把学生配成同桌（same=同性别，mixed=异性别），单座保持单座
    applyGender(grid, regions, node) {
      const genderMode = node.genderMode
      let satisfied = 0, total = 0
      for (const region of regions) {
        const students = region.map(p => grid[p.r][p.c]).filter(s => s)
        total += students.length
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
        for (const u of units) {
          if (u.indivisible) {
            const [x, y] = u.cells
            if (genderMode === 'same' && x.性别 === y.性别) satisfied += 2
            else if (genderMode === 'mixed' && x.性别 !== y.性别) satisfied += 2
          } else {
            satisfied += 1
          }
        }
      }
      this.trackSatisfaction(node.uid, satisfied, total)
    },

    // 同桌关系：在「作用域」内，保留原座位表达成的同桌对（内部坐序按 lockMode 控制），单座保持单座
    applyLockDeskmate(grid, regions, node) {
      const lockMode = node.lockMode || 'no-swap'
      const orig = this.extractOriginalPairs()
      let placedTotal = 0, pairsTotal = 0
      for (const region of regions) {
        const students = region.map(p => grid[p.r][p.c]).filter(s => s)
        const regionIds = new Set(students.map(s => s.id))
        let localPairs = 0
        const units = []
        const used = new Set()
        for (const [a, b] of orig.pairs) {
          if (regionIds.has(a.id) && regionIds.has(b.id)) {
            localPairs++
            units.push({ cells: [a, b], indivisible: true })
            used.add(a.id); used.add(b.id)
          }
        }
        for (const s of students) {
          if (!used.has(s.id)) { units.push({ cells: [s], indivisible: false }); used.add(s.id) }
        }
        pairsTotal += localPairs
        if (lockMode === 'none') {
          // 不变：座位原样保留，仅统计满足情况
          placedTotal += localPairs
          continue
        }
        if (lockMode === 'swap') {
          units.forEach(u => { if (u.indivisible) u.cells = [u.cells[1], u.cells[0]] })
        }
        placedTotal += this.fillSlots(grid, region, this.regionSlots(region), units)
      }
      this.trackSatisfaction(node.uid, placedTotal, pairsTotal)
    },

    // 特殊关系：在「作用域」内修复两人关系。
    //  - 两人同处一个作用块 → 在该块内移动（靠拢型/分离型）；
    //  - 两人分处不同作用块 → 靠拢型不可能满足（统计 0%），分离型按实际距离判定，且绝不跨块移动学生。
    applyRelation(grid, regions, node) {
      const pair = node.pair || {}
      const a = pair.a, b = pair.b
      const type = node.relationType || 'deskmate'
      if (!a || !b || a === b) return
      const pa = this.findPos(grid, a)
      const pb = this.findPos(grid, b)
      if (!pa || !pb) return

      const contains = (region, pos) => region.some(p => p.r === pos[0] && p.c === pos[1])
      const regionA = regions.find(r => contains(r, pa))
      const regionB = regions.find(r => contains(r, pb))
      const needSame = type === 'deskmate' || type === 'nearby'
      if (!regionA || !regionB || regionA !== regionB) {
        const ok = type === 'not-deskmate' ? !this.isTwoAdjacent(pa, pb) : !this.isTwoNearby(pa, pb)
        this.trackSatisfaction(node.uid, needSame ? 0 : (ok ? 1 : 0), 1)
        return
      }

      const effRegion = regionA
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
      this.trackSatisfaction(node.uid, ok ? 1 : 0, 1)
    },

    // 特殊关系：作为同桌 → 把 b 移到 a 的相邻空位（作用域内，且不隔走廊）
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
    // 特殊关系：坐在附近 → 把 b 移到 a 的相邻一格（含对角，作用域内）
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
    // 特殊关系：不作为同桌 / 不坐在附近 → 把其中一人移到远处（作用域内空位优先，否则与远处学生最小交换）
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

    // ==================== 位置公平（公平排表算法） ====================
    // 与「公平权重算法」解耦：权重矩阵 + 座位指数账本由外部传入，这里只负责排表。
    // 目标：最小化 Σ(账本_学生 × 权重_新位置)。该式与「最小化各人公平指数(账本+权重)的方差」等价，
    // 即让累计坐过好位置的同学，接下来坐相对靠后/边缘的位置，使整体更公平。
    // 步骤：① 按「按照 X 为一组」切块，整体调整组块顺序；
    //       ② 若允许，则再「组不动、只换人」调整组内排序。
    applyFair(grid, regions, node) {
      const weights = this.weights || []
      const ledger = this.ledger || {}
      const unit = node.unit || 'six'
      const allowInner = node.innerOrder === 'yes'
      const wOf = (r, c) => (typeof weights[r]?.[c] === 'number' ? weights[r][c] : 0)
      const lOf = s => (s && s.id != null && typeof ledger[s.id] === 'number') ? ledger[s.id] : 0

      let doneTotal = 0, allTotal = 0
      for (const region of regions) {
        const students = region.map(p => grid[p.r][p.c]).filter(Boolean)
        allTotal += students.length
        // 作用域内的组块
        const blocks = this.splitRegion(region, unit)
        const active = blocks.map(b => ({ pos: b.pos })).filter(b => b.pos.length > 0)
        if (active.length < 2 || students.length < 2) { doneTotal += students.length; continue }

        // 每组块：当前学生（按位置原序）与该块各位置的权重
        const groups = active.map(b => ({
          studs: b.pos.map(p => grid[p.r][p.c]).filter(Boolean),
          posW: b.pos.map(p => wOf(p.r, p.c))
        }))

        // 把「学生组 i」放到「位置块 j」的代价（可调整组内排序时按 账本降序×权重升序 的最优配对计）
        const costOf = (i, j) => {
          let ls = groups[i].studs.map(lOf)
          let ws = groups[j].posW
          if (allowInner) {
            ls = [...ls].sort((a, b) => b - a)
            ws = [...ws].sort((a, b) => a - b)
          }
          let sum = 0
          const m = Math.min(ls.length, ws.length)
          for (let k = 0; k < m; k++) sum += ls[k] * ws[k]
          return sum
        }

        // 求组→块的最优一一对应：组数少时暴力枚举全排列，多时用贪心
        const n = groups.length
        let best = null
        if (n <= 7) {
          const arr = Array.from({ length: n }, (_, i) => i)
          let bestCost = Infinity
          const permute = (a, k) => {
            if (k === a.length) {
              let c = 0
              for (let i = 0; i < n; i++) c += costOf(i, a[i])
              if (c < bestCost - 1e-9) { bestCost = c; best = [...a] }
              return
            }
            for (let i = k; i < n; i++) {
              ;[a[k], a[i]] = [a[i], a[k]]
              permute(a, k + 1)
              ;[a[k], a[i]] = [a[i], a[k]]
            }
          }
          permute(arr, 0)
        } else {
          const sumLedger = i => groups[i].studs.reduce((t, s) => t + lOf(s), 0)
          const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => sumLedger(b) - sumLedger(a))
          best = new Array(n).fill(-1)
          const used = new Set()
          for (const i of order) {
            let pick = -1, pc = Infinity
            for (let j = 0; j < n; j++) {
              if (used.has(j)) continue
              const c = costOf(i, j)
              if (c < pc - 1e-9) { pc = c; pick = j }
            }
            best[i] = pick
            used.add(pick)
          }
        }

        // 落盘：组块整体移位；允许时组内再按 账本降序→低权重位置 落座
        const writes = []
        for (let i = 0; i < n; i++) {
          const target = active[best[i]].pos
          const studs = [...groups[i].studs]
          if (allowInner) {
            studs.sort((a, b) => lOf(b) - lOf(a))
            const posSorted = [...target].sort((a, b) => wOf(a.r, a.c) - wOf(b.r, b.c))
            posSorted.forEach((p, k) => writes.push([p, studs[k] || null]))
          } else {
            target.forEach((p, k) => writes.push([p, studs[k] || null]))
          }
        }
        for (const [p, v] of writes) grid[p.r][p.c] = v
        doneTotal += students.length
      }
      this.trackSatisfaction(node.uid, doneTotal, allTotal)
    },

    // 记录满足率
    trackSatisfaction(key, done, total) {
      if (!this.satisfaction[key]) this.satisfaction[key] = { done: 0, total: 0 }
      this.satisfaction[key].done += done
      this.satisfaction[key].total += total
    },
    // 某条件的满足率（未排表或无统计时返回 null）：内联显示在每行条件右侧
    satisfactionOf(node) {
      const st = this.satisfaction[node.uid]
      if (!st) return null
      return st.total ? Math.round((st.done / st.total) * 100) : 0
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
    // 是否在附近（前后左右 + 斜对角，即切比雪夫距离 <= 1）
    isTwoNearby(pa, pb) {
      return Math.max(Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1])) <= 1
    },

    // ==================== 条件行交互（拖拽添加 / 拖拽排序） ====================
    onOptionDragStart(e, key) {
      e.dataTransfer.setData('text/plain', key)
      e.dataTransfer.setData('text/drag-kind', 'option')
      e.dataTransfer.effectAllowed = 'copy'
    },
    onRowDragStart(e, index) {
      e.dataTransfer.setData('text/row', String(index))
      e.dataTransfer.setData('text/drag-kind', 'row')
      e.dataTransfer.effectAllowed = 'move'
    },
    // 拖到空白区：追加到末尾
    onDropZone(e) {
      this.handleDrop(e, this.conditions.length)
    },
    // 拖到某行上：插入到该行之前
    onDropOnRow(e, index) {
      this.handleDrop(e, index)
    },
    handleDrop(e, index) {
      const kind = e.dataTransfer.getData('text/drag-kind')
      if (kind === 'row') {
        const from = Number(e.dataTransfer.getData('text/row'))
        this.moveCondition(from, index)
      } else {
        const key = e.dataTransfer.getData('text/plain')
        if (key) this.addCondition(key, index)
      }
    },
    // 添加条件（可重复添加，不限数量）
    addCondition(key, index) {
      const reg = CONDITION_REGISTRY[key]
      if (!reg) return
      const node = { uid: this.nextUid++, key, label: reg.label, ...(reg.defaults ? reg.defaults() : {}) }
      const at = Math.max(0, Math.min(index, this.conditions.length))
      this.conditions.splice(at, 0, node)
      this.resetArranged()
    },
    // 拖拽排序：把 from 行移动到 to 行之前
    moveCondition(from, to) {
      if (from < 0 || from >= this.conditions.length || from === to) return
      const node = this.conditions[from]
      this.conditions.splice(from, 1)
      const at = from < to ? to - 1 : to
      this.conditions.splice(Math.max(0, Math.min(at, this.conditions.length)), 0, node)
      this.resetArranged()
    },
    removeCondition(index) {
      this.conditions.splice(index, 1)
      this.resetArranged()
    },
    // 取某条件的语义句段（纯文案 + 下拉位），供通用渲染器产出 UI
    segmentsOf(node) {
      const reg = CONDITION_REGISTRY[node.key]
      if (!reg || !reg.segments) return []
      return reg.segments.map((s, idx) => s.t === 'text'
        ? { ...s, idx }
        : { ...s, idx, options: this.resolveOptions(s.options, node) })
    },
    // 把注册表里的选项标识解析成实际选项数组
    resolveOptions(kind, node) {
      switch (kind) {
        case 'groups': return this.groupOptions()
        case 'students': return this.studentOptions
        case 'relation': return this.relationOptions()
        case 'swapTypes': return this.swapTypeOptions(node.unit)
        case 'lockModes': return this.lockModeOptions()
        case 'genders': return this.genderOptions()
        case 'innerOrder': return this.innerOrderOptions()
        default: return []
      }
    },
    // 读取/写入节点上的字段（支持 'pair.a' 这类嵌套路径）
    getField(node, path) {
      return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), node)
    },
    setField(node, path, value) {
      const ks = path.split('.')
      let o = node
      for (let i = 0; i < ks.length - 1; i++) {
        if (o[ks[i]] == null) o[ks[i]] = {}
        o = o[ks[i]]
      }
      o[ks[ks.length - 1]] = value
    },

    // ==================== 选项列表（范围 / 单位 / 关系 / 方式等） ====================
    // 范围与单位同源：原分组选项 + 同学 / 同桌
    groupOptions() {
      return [
        { value: 'student', label: '同学' },
        { value: 'deskmate', label: '同桌' },
        { value: 'column', label: '一列' },
        { value: 'whole', label: '一大组' },
        { value: 'four', label: '相邻四位' },
        { value: 'six', label: '相邻六位' }
      ]
    },
    // 分组方式（仅相邻六位支持 Z字形 / 上下交换形）
    swapTypeOptions(unit) {
      if (unit === 'six') {
        return [
          { value: 'z', label: 'Z字形' },
          { value: 'updown', label: '上下交换形' },
          { value: 'random', label: '随机性分组' }
        ]
      }
      return [{ value: 'random', label: '随机性分组' }]
    },
    // 特殊关系类型
    relationOptions() {
      return [
        { value: 'deskmate', label: '作为同桌' },
        { value: 'not-deskmate', label: '不作为同桌' },
        { value: 'nearby', label: '坐在附近' },
        { value: 'not-nearby', label: '不坐在附近' }
      ]
    },
    // 同桌内部坐序
    lockModeOptions() {
      return [
        { value: 'swap', label: '交换位置' },
        { value: 'no-swap', label: '不交换位置' },
        { value: 'none', label: '不变' }
      ]
    },
    // 性别
    genderOptions() {
      return [
        { value: 'same', label: '相同性别' },
        { value: 'mixed', label: '不同性别' }
      ]
    },
    // 位置公平：是否允许在「组不动」的前提下再调整组内排序
    innerOrderOptions() {
      return [
        { value: 'no', label: '不可以' },
        { value: 'yes', label: '可以' }
      ]
    },

    // 开始排表 / 换一换
    startArrange() {
      // 首次排表且座位表里有新同学时，先弹窗确认是否参与
      if (!this.arranged && this.strangers.length > 0) { this.showNewPrompt = true; return }
      this.generatePreview()
      this.arranged = true
    },
    onParticipate() {
      this.showNewPrompt = false
      this.excludeNew = false
      this.generatePreview()
      this.arranged = true
    },
    onNot() {
      this.showNewPrompt = false
      this.excludeNew = true
      this.generatePreview()
      this.arranged = true
    },
    // 条件变更后重置为"开始排表"（预览回到未改动的座位表）
    resetArranged() {
      this.arranged = false
      this.previewSeats = this.buildInitialSeats()
      this.previewVersion++
    },
    // 将当前座位表（id/字符串网格）映射为预览用的学生对象网格
    buildInitialSeats() {
      const grid = []
      const src = this.baseSeats
      let pseudoId = -1
      const pseudoCache = {}
      for (let r = 0; r < this.rows; r++) {
        const row = []
        for (let c = 0; c < this.cols; c++) {
          const val = src?.[r]?.[c]
          let student = null
          if (typeof val === 'number') student = this.students.find(s => s.id === val) || null
          else if (typeof val === 'string' && val.trim()) {
            const n = val.trim()
            if (!pseudoCache[n]) pseudoCache[n] = { id: pseudoId--, 姓名: n }
            student = pseudoCache[n]
          } else if (val && typeof val === 'object') student = val
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
      const src = this.baseSeats
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

    // 预览学生对象网格 → 座位表数据：元素为班级学生 id、新同学名字(字符串)或 null
    buildSeatsOut() {
      return this.previewSeats.map(row => row.map(s => {
        if (!s) return null
        // 真实 id(>=0)的班级学生存 id；新同学(伪对象，负 id 或无 id 对象)存原名
        return (s.id != null && s.id >= 0) ? s.id : (s.姓名 || null)
      }))
    },

    // 把草稿里的条件还原成界面条件：重新分配 uid、补默认字段、忽略已不存在的条件类型
    restoreConditions(list) {
      const arr = (list || []).filter(c => c && CONDITION_REGISTRY[c.key])
      // 草稿里没有可用条件时保留当前条件列表，避免恢复后条件区变成空的
      if (arr.length === 0) return
      this.conditions = arr.map(c => {
        const reg = CONDITION_REGISTRY[c.key]
        // 深拷贝：避免多条条件共享 defaults 里的同一对象（如特殊关系的学生对）
        const merged = JSON.parse(JSON.stringify({ ...reg.defaults(), ...c }))
        merged.uid = this.nextUid++
        merged.label = reg.label
        return merged
      })
    },

    // 保存草稿：存当前预览结果 + 本次排表条件（uid/label 属界面字段，不入库）
    async saveDraft() {
      if (!this.arranged || this.savingDraft) return
      this.savingDraft = true
      try {
        const { saveDraft } = useSeatDraft()
        await saveDraft({
          seats: this.buildSeatsOut(),
          conditions: this.conditions.map(c => {
            const copy = { ...c }
            delete copy.uid
            delete copy.label
            return copy
          }),
          rows: this.rows,
          cols: this.cols,
          mode: this.mode,
          showAisle: this.showAisle
        })
        // 刚保存的这份就是当前预览结果：后续「确定」需先确认会清空草稿
        this.draftInUse = true
        useNotification().success('草稿已保存')
      } catch (err) {
        const msg = err?.response?.data?.error || '草稿保存失败'
        useNotification().error(msg)
      } finally {
        this.savingDraft = false
      }
    },

    cancel() { this.$emit('cancel') },

    // 「确定」：本次结果来自草稿时先弹确认框（正式应用会清空草稿），确认后才真正应用
    confirm() {
      if (this.draftInUse) {
        this.draftConfirmVisible = true
        return
      }
      this.emitConfirm()
    },

    // 确认框点「确认」：清掉草稿再应用（草稿已被采用，避免下次启动重复提示已恢复草稿）
    applyConfirm() {
      this.draftConfirmVisible = false
      const { clearDraft } = useSeatDraft()
      clearDraft()
      this.draftInUse = false
      this.draftSeats = null
      this.emitConfirm()
    },

    emitConfirm() {
      this.$emit('confirm', { seats: this.buildSeatsOut() })
    }
  }
}
</script>

<style scoped>
/* 智能排表条件行内的下拉框：压低触发框高度，让条件行更紧凑 */
:deep(.av-select__trigger) {
  padding: 4px 8px;
}
</style>
