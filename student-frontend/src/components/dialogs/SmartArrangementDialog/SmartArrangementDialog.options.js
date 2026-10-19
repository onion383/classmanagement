// ===== 智能排表：位置工具 + 条件行交互 + 选项列表 + 草稿/确认 =====
// 纯代码搬运自 SmartArrangementDialog.vue 的 methods，未改写逻辑。
import { useSeatDraft } from '../../../composables/useSeatDraft.js'
import { useNotification } from '../../../composables/useNotification.js'
export function useSmartArrangementOptions(CONDITION_REGISTRY) {
  return {
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
