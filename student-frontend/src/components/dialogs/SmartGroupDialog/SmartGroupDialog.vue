<template>
  <Teleport to="body">
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
    <div class="bg-surface rounded-xl p-5 shadow-card dialog-card flex flex-col overflow-hidden" style="width: 860px; height: 620px; max-width: 90vw;">
      <h3 class="text-lg font-bold mb-4">🧠 智能分组</h3>

      <!-- 新同学确认：小组里有班级学生信息表不存在的名字时提示 -->
      <NewComerConfirm :visible="showNewPrompt" :names="strangers" action="分组" @participate="onParticipate" @not="onNot" />

      <!-- 拒绝/提示 -->
      <Transition name="dialog">
      <div v-if="rejectText" class="mb-3 px-3 py-2 rounded bg-warning/15 border border-warning/40 text-warning text-sm">
        {{ rejectText }}
      </div>
      </Transition>

      <!-- 流水线条件（拖入下方选项添加，拖动手柄调整顺序） -->
      <div class="mb-3">
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-medium block">排表条件</label>
          <button @click="startArrange" class="bg-primary text-text-inverse px-3 py-1.5 rounded border-none cursor-pointer text-sm">{{ arranged ? '🔀 换一换' : '▶ 开始排表' }}</button>
        </div>
        <div
          class="border border-dashed border-border rounded-lg p-2 bg-surface-hover min-h-[44px]"
          @dragover.prevent
          @drop="boxDrop"
        >
          <div v-if="stages.length === 0" class="text-sm text-text-muted py-1">拖入下方选项作为分组条件</div>
          <div v-for="(st, si) in stages" :key="st.key" class="mb-1 last:mb-0">
            <div
              class="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded bg-surface border border-border text-text text-sm"
              @dragover.stop.prevent="rowDragover(si, $event)"
            >
              <!-- 拖动手柄：拖动调整条件顺序 -->
              <span class="cursor-grab select-none text-text-muted" draggable="true" @dragstart="onStageDragStart(si, $event)" title="拖动调整顺序">⠿</span>
              <!-- 特殊关系 -->
              <template v-if="st.type === 'relation'">
                <AppSelect v-model="st.kind" :options="[{ value: 'together', label: '在一组' }, { value: 'apart', label: '不在一组' }]" class="w-28" />
                <AppSelect v-model="st.a" :options="students.map(s => ({ value: s.id, label: s.姓名 }))" placeholder="选择学生" class="w-32" />
                <span class="text-text-muted">和</span>
                <AppSelect v-model="st.b" :options="students.map(s => ({ value: s.id, label: s.姓名 }))" placeholder="选择学生" class="w-32" />
              </template>
              <!-- 指定身份 -->
              <template v-else-if="st.type === 'identity'">
                <AppSelect v-model="st.kind" :options="[{ value: 'leader', label: '担任' + leaderTitle }, { value: 'not-leader', label: '不担任' + leaderTitle }]" class="w-32" />
                <AppSelect v-model="st.studentId" :options="students.map(s => ({ value: s.id, label: s.姓名 }))" placeholder="选择学生" class="w-32" />
              </template>
              <!-- 性别比例 -->
              <template v-else-if="st.type === 'gender'">
                <span class="text-text-secondary">性别比例</span>
                <AppSelect v-model="st.mode" :options="[{ value: 'balanced', label: '男女尽量均匀' }, { value: 'single', label: '全为男生或女生（每组同一性别）' }]" class="w-64" />
              </template>
              <span v-if="satisfactionOf(st) !== null" class="ml-auto text-xs px-1.5 py-0.5 rounded bg-info/15 text-info border border-info/30">满足 {{ satisfactionOf(st) }}%</span>
              <button @click="removeStage(si)" class="cursor-pointer text-text-muted hover:text-text font-bold leading-none text-base">×</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 顺序提示 -->
      <div class="mb-3 text-xs text-text-muted">条件按顺序依次生效，越靠后的条件越重要，可部分覆盖前面的结果。</div>

      <!-- 可选条件（拖入上方作为分组条件，可复用） -->
      <div class="mb-4">
        <label class="text-sm font-medium mb-2 block">分组条件（拖到上方作为条件，拖动手柄调整顺序）</label>
        <div class="flex flex-wrap gap-2">
          <div
            v-for="chip in conditionChips"
            :key="chip.type"
            draggable="true"
            @dragstart="onChipDragStart($event, chip.type)"
            class="px-3 py-1.5 rounded border border-border bg-surface cursor-grab select-none text-sm shadow-sm hover:border-info"
          >＋ {{ chip.label }}</div>
        </div>
      </div>

      <!-- 分组预览 -->
      <div class="flex-1 overflow-auto border border-border rounded mb-4" style="min-height: 160px;">
        <div class="p-3" v-if="!arranged && previewGroups.length === 0">
          <p class="text-sm text-text-muted">点击上方「开始排表」预览分组结果；确认后写入当前维度的各小组。</p>
        </div>
        <div v-else class="flex flex-wrap gap-3 p-3 content-start">
          <div
            v-for="(g, gi) in previewGroups"
            :key="gi"
            class="border border-border rounded bg-surface-hover overflow-hidden flex flex-col"
            style="width: 150px;"
          >
            <div class="px-2 py-1 bg-primary/10 border-b border-border font-semibold text-xs text-text truncate">{{ groupLabel(gi) }}</div>
            <div class="px-2 py-1 text-xs">
              <template v-if="g.length">
                <div class="flex items-center gap-1">
                  <span class="text-info font-medium truncate">{{ g[0].姓名 }}</span>
                  <span class="text-text-muted text-[10px] flex-shrink-0">{{ leaderTitle }}</span>
                </div>
                <div v-for="(s, i) in g.slice(1)" :key="gi + '-' + i" class="text-text truncate">{{ s.姓名 }}</div>
              </template>
              <div v-else class="text-text-muted text-xs">（空组）</div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button @click="cancel" class="bg-surface-hover px-4 py-2 rounded text-text border border-border">取消</button>
        <button @click="confirm" class="bg-info text-text-inverse px-4 py-2 rounded border-none">确定</button>
      </div>
    </div>
  </div>
  </Transition>
  </Teleport>
</template>

<script>
import '../../../styles/dialog-transition.css'
import NewComerConfirm from '../NewComerConfirm.vue'
import AppSelect from '../../base/AppSelect.vue'
import { useSmartGroupPipeline } from './SmartGroupDialog.pipeline.js'
import { useSmartGroupConditions } from './SmartGroupDialog.conditions.js'
import { useSmartGroupPreview } from './SmartGroupDialog.preview.js'

let keySeq = 0
const nextKey = () => `st-${++keySeq}`

export default {
  name: 'SmartGroupDialog',
  components: { NewComerConfirm, AppSelect },
  props: {
    visible: Boolean,
    students: { type: Array, default: () => [] },
    groups: { type: Array, default: () => [] },
    leaderTitle: { type: String, default: '组长' }
  },
  emits: ['cancel', 'confirm'],
  data() {
    return {
      // 流水线：按顺序依次应用，越靠后越重要（可部分覆盖前面）
      stages: [{ type: 'gender', mode: 'balanced', key: nextKey() }],
      previewGroups: [],
      rejectText: '',
      arranged: false,
      satisfaction: {},
      lastResult: null,
      // 拖拽交互状态：stage 拖动排序 / chip 拖入添加
      _dragIdx: null,
      _overIdx: null,
      _pendingType: null,
      // 新同学校验：小组中有名字不在班级学生信息表中，参与分组前弹窗确认
      showNewPrompt: false,
      includeNew: false
    }
  },
  computed: {
    // 小组里出现但班级学生信息表里不存在的名字集合
    strangerNames() {
      const known = new Set(this.students.map(s => String(s.姓名 || '').trim()).filter(Boolean))
      const out = new Set()
      for (const g of this.groups)
        for (const m of (g.members || [])) {
          const n = String(m.member_name || '').trim()
          if (n && !known.has(n)) out.add(n)
        }
      return out
    },
    strangers() {
      return [...this.strangerNames]
    },
    // 参与分组的班级学生（去掉无名）；若用户选择「参与」，附上小组里的新同学一起分组
    roster() {
      const base = this.students.filter(s => String(s.姓名 || '').trim())
      if (!this.includeNew) return base
      const named = new Set(base.map(s => String(s.姓名).trim()))
      const extras = [...this.strangerNames].filter(n => !named.has(n)).map(n => ({ 姓名: n }))
      return extras.length ? base.concat(extras) : base
    },
    // 可选条件（可拖入上方，可复用）
    conditionChips() {
      return [
        { type: 'relation', label: '特殊关系' },
        { type: 'identity', label: '指定身份' },
        { type: 'gender', label: '性别比例' }
      ]
    }
  },
  watch: {
    visible(v) {
      if (v) {
        this.rejectText = ''
        // 打开时先显示当前已有的分组结果（尚未排表时作为初始预览）
        this.previewGroups = this.buildGroupsPreview()
        this.arranged = false
        this.satisfaction = {}
        this.lastResult = null
        this.showNewPrompt = false
        this.includeNew = false
      }
    },
    stages: {
      deep: true,
      handler() {
        this.arranged = false
        this.previewGroups = []
        this.lastResult = null
      }
    }
  },
  methods: {
    studentById(id) {
      return this.students.find(s => String(s.id) === String(id)) || null
    },
    leaderTitleLabel() {
      return this.leaderTitle || '组长'
    },
    groupLabel(gi) {
      const g = this.groups[gi]
      return (g && g.name) || `第${gi + 1}组`
    },
    ...useSmartGroupPipeline(),
    ...useSmartGroupConditions(nextKey),
    ...useSmartGroupPreview(),
  }
}
</script>
