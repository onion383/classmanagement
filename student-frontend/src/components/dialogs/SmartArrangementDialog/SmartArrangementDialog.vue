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
import GridView from '../../tables/GridView/GridView.vue';
import NewComerConfirm from '../NewComerConfirm.vue';
import ConfirmDialog from '../../base/ConfirmDialog.vue';
import AppSelect from '../../base/AppSelect.vue';
import { useSeatDraft } from '../../../composables/useSeatDraft.js'
import { useNotification } from '../../../composables/useNotification.js'
import { useSmartArrangementPipeline } from './SmartArrangementDialog.pipeline.js'
import { useSmartArrangementBlocks } from './SmartArrangementDialog.blocks.js'
import { useSmartArrangementOptions } from './SmartArrangementDialog.options.js'
import '../../../styles/dialog-transition.css'

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
    ...useSmartArrangementPipeline(CONDITION_REGISTRY),
    ...useSmartArrangementBlocks(),
    ...useSmartArrangementOptions(CONDITION_REGISTRY),
  }
}
</script>

<style scoped>
/* 智能排表条件行内的下拉框：压低触发框高度，让条件行更紧凑 */
:deep(.av-select__trigger) {
  padding: 4px 8px;
}
</style>
