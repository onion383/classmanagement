<template>
  <Teleport to="body">
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
    <div class="bg-surface rounded-lg p-5 shadow-card dialog-card flex flex-col overflow-hidden" style="width: 860px; height: 620px; max-width: 90vw;">
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
          <label class="text-sm font-medium block">流水线条件</label>
          <button @click="startArrange" class="bg-primary text-text-inverse px-3 py-1.5 rounded border-none cursor-pointer text-sm">{{ arranged ? '🔀 换一换' : '▶ 开始排表' }}</button>
        </div>
        <div
          class="border border-dashed border-border rounded p-2 bg-surface-hover min-h-[44px]"
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
import '../../styles/dialog-transition.css'
import NewComerConfirm from './NewComerConfirm.vue'
import AppSelect from '../base/AppSelect.vue'

// Fisher-Yates 洗牌
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

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
    // ==================== 流水线条件操作 ====================
    addStage(type) {
      const s = { key: nextKey() }
      if (type === 'relation') Object.assign(s, { type: 'relation', kind: 'together', a: '', b: '' })
      else if (type === 'identity') Object.assign(s, { type: 'identity', kind: 'leader', studentId: '' })
      else Object.assign(s, { type: 'gender', mode: 'balanced' })
      this.stages.push(s)
    },
    removeStage(si) {
      this.stages.splice(si, 1)
    },

    // ==================== 拖拽交互（拖入添加 / 拖动手柄调序） ====================
    // 从下方选项区拖入：记录待添加的条件类型
    onChipDragStart(e, type) {
      this._pendingType = type
      this._dragIdx = null
      e.dataTransfer.setData('text/plain', 'chip')
      e.dataTransfer.effectAllowed = 'copy'
    },
    // 拖动已有条件的手柄：记录来源下标
    onStageDragStart(si, e) {
      this._dragIdx = si
      this._pendingType = null
      e.dataTransfer.setData('text/plain', 'stage')
      e.dataTransfer.effectAllowed = 'move'
    },
    // 悬停某行时计算插入位置（上半 → 之前，下半 → 之后）
    rowDragover(si, e) {
      e.preventDefault()
      e.stopPropagation()
      const rect = e.currentTarget.getBoundingClientRect()
      const next = e.clientY < rect.top + rect.height / 2 ? si : si + 1
      // 值未变化时不写响应式状态，避免拖拽过程中每帧触发整个条件列表重渲染
      if (this._overIdx !== next) this._overIdx = next
    },
    // 松开到条件区：处理拖入新条件 / 拖动手柄调序
    boxDrop(e) {
      e.preventDefault()
      if (this._dragIdx != null) {
        // 已有条件调序
        const from = this._dragIdx
        let to = this._overIdx
        if (to == null) to = this.stages.length
        const [moved] = this.stages.splice(from, 1)
        let insert = to
        if (from < to) insert = to - 1
        this.stages.splice(insert, 0, moved)
      } else if (this._pendingType) {
        // 从选项区拖入新条件（追加到末尾）
        this.addStage(this._pendingType)
      }
      this._dragIdx = null
      this._overIdx = null
      this._pendingType = null
    },
    satisfactionOf(st) {
      const key = st.key
      if (!this.satisfaction[key]) return null
      const { done, total } = this.satisfaction[key]
      return total ? Math.round((done / total) * 100) : 0
    },
    trackSatisfaction(key, done, total) {
      if (!this.satisfaction[key]) this.satisfaction[key] = { done: 0, total: 0 }
      this.satisfaction[key].done += done
      this.satisfaction[key].total += total
    },
    showReject(text) {
      this.rejectText = text
      clearTimeout(this._rejectTimer)
      this._rejectTimer = setTimeout(() => { this.rejectText = '' }, 2500)
    },

    // ==================== 流水线分组算法（核心） ====================
    // 把班级学生分配到 G 个小组；按 stages 顺序依次应用，后一条件可覆盖前一条件。
    // 返回 { members: Set[si] 每个组的学生下标, leaders: leaders[g]=学生下标|null,
    //         forcedLeaders: Set, notLeaders: Set }
    buildAssignment() {
      const roster = this.roster
      const G = this.groups.length
      this.satisfaction = {}
      const members = Array.from({ length: G }, () => new Set()) // 组 -> 学生下标集合
      const leaders = Array(G).fill(null)                          // 组 -> 组长学生下标
      const forcedLeaders = new Set()
      const notLeaders = new Set()

      // 初始：洗牌 + 均匀分配 (round-robin)
      const total = roster.length
      const target = Math.max(1, Math.ceil(total / G))
      const idxs = shuffle(roster.map((_, i) => i))
      idxs.forEach((si, i) => members[i % G].add(si))

      // 依次应用流水线条件
      for (const st of this.stages) {
        if (st.type === 'relation') this.applyRelation(st, roster, members, leaders, target, G)
        else if (st.type === 'identity') this.applyIdentity(st, roster, members, leaders, forcedLeaders, notLeaders)
        else if (st.type === 'gender') this.applyGender(st, roster, members, target, G)
      }

      // 收尾：保证指定组长的成立；补充每组一个组长
      for (const si of forcedLeaders) {
        const g = this.groupOf(members, si)
        if (g >= 0) leaders[g] = si
      }
      for (const si of notLeaders) {
        const g = this.groupOf(members, si)
        if (g >= 0 && leaders[g] === si) leaders[g] = null
      }
      for (let g = 0; g < G; g++) {
        if (members[g].size === 0 || leaders[g] !== null) continue
        for (const si of members[g]) {
          if (notLeaders.has(si)) continue
          leaders[g] = si
          break
        }
      }
      return { members, leaders, total, target }
    },

    groupOf(members, si) {
      for (let g = 0; g < members.length; g++) if (members[g].has(si)) return g
      return -1
    },
    moveBody(members, leaders, si, from, to) {
      members[from].delete(si)
      members[to].add(si)
      if (leaders[from] === si) leaders[from] = null
    },

    // 特殊关系：XXX 和 YYY 在一组 / 不在一组
    applyRelation(st, roster, members, leaders, target, G) {
      const a = st.a, b = st.b
      if (!a || !b) return
      const ia = roster.findIndex(s => String(s.id) === String(a))
      const ib = roster.findIndex(s => String(s.id) === String(b))
      if (ia < 0 || ib < 0 || ia === ib) return
      const ga = this.groupOf(members, ia)
      const gb = this.groupOf(members, ib)
      let ok = false
      if (st.kind === 'apart') {
        if (ga !== gb) {
          ok = true
        } else {
          // 把 b 移到另一个人数还够的小组
          for (let h = 0; h < G; h++) {
            if (h === ga || members[h].size >= target) continue
            this.moveBody(members, leaders, ib, gb, h)
            ok = true
            break
          }
        }
      } else { // together
        if (ga === gb) {
          ok = true
        } else {
          if (members[ga].size < target) { this.moveBody(members, leaders, ib, gb, ga); ok = true }
          else if (members[gb].size < target) { this.moveBody(members, leaders, ia, ga, gb); ok = true }
        }
      }
      this.trackSatisfaction(st.key, ok ? 1 : 0, 1)
    },

    // 指定身份：XXX 担任/不担任 组长
    applyIdentity(st, roster, members, leaders, forcedLeaders, notLeaders) {
      const id = st.studentId
      if (!id) return
      const si = roster.findIndex(s => String(s.id) === String(id))
      if (si < 0) return
      const g = this.groupOf(members, si)
      let ok = false
      if (st.kind === 'leader') {
        forcedLeaders.add(si)
        notLeaders.delete(si)
        if (g >= 0) {
          leaders[g] = si
          ok = true
        }
      } else { // not-leader
        notLeaders.add(si)
        forcedLeaders.delete(si)
        if (g >= 0 && leaders[g] === si) leaders[g] = null
        ok = true
      }
      this.trackSatisfaction(st.key, ok ? 1 : 0, 1)
    },

    // 性别比例：男女尽量均匀 / 全为男生或女生
    applyGender(st, roster, members, target, G) {
      const total = roster.length
      if (total === 0) return
      const isBoy = s => s.性别 === '男'
      const isGirl = s => s.性别 === '女'
      const boyIdx = [], girlIdx = [], otherIdx = []
      roster.forEach((s, i) => { if (isBoy(s)) boyIdx.push(i); else if (isGirl(s)) girlIdx.push(i); else otherIdx.push(i) })
      const totalBoy = boyIdx.length
      const totalGirl = girlIdx.length

      if (st.mode === 'single') {
        // 每组都放同一性别：男生组 + 女生组 按人数比例拆分
        let boyGroups = 0
        if (totalBoy > 0) {
          boyGroups = Math.max(1, Math.min(G - (totalGirl > 0 ? 1 : 0), Math.round(G * totalBoy / total)))
        }
        const boyGroupIdxs = Array.from({ length: boyGroups }, (_, i) => i)
        const girlGroupIdxs = Array.from({ length: G - boyGroups }, (_, i) => boyGroups + i)
        // 清空现有分配
        for (let g = 0; g < G; g++) members[g] = new Set()
        this.distributeInto(members, boyIdx, boyGroupIdxs, target)
        this.distributeInto(members, girlIdx.concat(otherIdx), girlGroupIdxs, target)
        // 满足率：男生进男生组、女生/其他进女生组
        let done = 0
        const inBoyGroups = new Set(boyGroupIdxs)
        for (const si of boyIdx) { const g = this.groupOf(members, si); if (inBoyGroups.has(g)) done++ }
        for (const si of girlIdx.concat(otherIdx)) { const g = this.groupOf(members, si); if (!inBoyGroups.has(g)) done++ }
        this.trackSatisfaction(st.key, done, total)
        return
      }

      // balanced：男女尽量均匀 —— 把多余的男生调到男生少、且人数不满的小组
      const desiredBoy = Math.round(totalBoy / G)
      const boysNow = Array(G).fill(0)
      boyIdx.forEach(si => boysNow[this.groupOf(members, si)]++)
      let guard = 0
      while (guard < 40) {
        guard++
        let moved = false
        for (let g = 0; g < G; g++) {
          if (boysNow[g] <= desiredBoy + 1) continue
          // 找一个男生少且未满的小组
          for (let h = 0; h < G; h++) {
            if (h === g || boysNow[h] >= desiredBoy || members[h].size >= target) continue
            const victim = [...members[g]].find(si => roster[si].性别 === '男')
            if (victim === undefined) break
            const fromG = this.groupOf(members, victim)
            this.moveBody(members, [], victim, fromG, h)
            boysNow[g]--; boysNow[h]++
            moved = true
            break
          }
          if (moved) break
        }
        if (!moved) break
      }
      // 满足率：落在 目标人数±1 小组里的男生数占比
      let done = 0
      for (const si of boyIdx) { const g = this.groupOf(members, si); if (Math.abs(boysNow[g] - desiredBoy) <= 1) done++ }
      this.trackSatisfaction(st.key, done, totalBoy || 1)
    },

    // 把一组学生均匀填入某些小组（循环放入，超过 target 则跳到下一组）
    distributeInto(members, studentIdxList, groupIdxs, target) {
      if (groupIdxs.length === 0) return
      let gi = 0
      for (const si of studentIdxList) {
        let guard = 0
        while (guard < groupIdxs.length && members[groupIdxs[gi % groupIdxs.length]].size >= target) { gi++; guard++ }
        if (guard >= groupIdxs.length) break // 无空位
        members[groupIdxs[gi % groupIdxs.length]].add(si)
        gi++
      }
    },

    // ==================== 生成预览 ====================
    generatePreview() {
      if (this.groups.length === 0) { this.showReject('当前维度还没有小组，请先添加小组'); return }
      if (this.roster.length === 0) { this.showReject('班级学生列表为空，无法分组'); return }
      const result = this.buildAssignment()
      // 保证"换一换"每次结果与上次预览不同
      let final = result
      let guard = 0
      while (guard < 20 && this.lastResult && this.sameResult(final, this.lastResult)) {
        final = this.buildAssignment()
        guard++
      }
      this.lastResult = final
      this.previewGroups = this.toPreview(final)
      this.arranged = true
    },
    sameResult(a, b) {
      const sig = (members) => members.map(g => [...g].sort((x, y) => x - y).join(',')).join('|')
      return sig(a.members) === sig(b.members)
    },
    // 把当前已有的分组数据转成预览格式（尚未排表时作为初始预览）
    // 每组为一个成员姓名对象数组（与 toPreview 结构一致：组长排最前）
    buildGroupsPreview() {
      return (this.groups || []).map(g =>
        (g.members || [])
          .map(m => String(m.member_name || '').trim())
          .filter(n => n)
          .map(n => ({ 姓名: n }))
      )
    },
    // 转成预览：每组的【组长排最前】的学生对象数组
    toPreview(result) {
      const { members, leaders } = result
      return members.map((set, g) => {
        const arr = [...set].map(si => ({ si, obj: this.roster[si] }))
        const li = leaders[g]
        if (li != null) {
          const idx = arr.findIndex(x => x.si === li)
          if (idx > 0) arr.unshift(arr.splice(idx, 1)[0])
        }
        return arr.map(x => x.obj)
      })
    },

    // 最终输出：Array(G)，每组为排好序（组长在前）的学生姓名数组
    outputGroups(result) {
      const { members, leaders } = result
      return members.map((set, g) => {
        const arr = [...set].map(si => ({ si, name: this.roster[si].姓名 }))
        const li = leaders[g]
        if (li != null) {
          const idx = arr.findIndex(x => x.si === li)
          if (idx > 0) { arr.unshift(arr.splice(idx, 1)[0]) }
        }
        return arr.map(x => x.name)
      })
    },

    // ==================== 按钮 ====================
    startArrange() {
      // 首次排表且小组里有新同学时，先弹窗确认是否参与
      if (!this.arranged && this.strangers.length > 0) { this.showNewPrompt = true; return }
      this.generatePreview()
    },
    onParticipate() {
      this.showNewPrompt = false
      this.includeNew = true
      this.generatePreview()
    },
    onNot() {
      this.showNewPrompt = false
      this.includeNew = false
      this.generatePreview()
    },
    cancel() { this.$emit('cancel') },
    confirm() {
      if (!this.arranged) return this.showReject('请先点击「开始排表」生成分组结果')
      const result = this.lastResult
      if (!result) return this.showReject('尚未生成分组结果')
      this.$emit('confirm', { groups: this.outputGroups(result) })
    }
  }
}
</script>