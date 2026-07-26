<template>
  <div>
    <div class="w-full bg-gradient-to-r from-blue-80 to-blue-100 shadow-md rounded-xl mb-6 px-6 py-5">
      <h1 class="text-2xl font-bold text-gray-800">🪑 座位管理</h1>
    </div>

    <Tabs :tabs="tabItems" v-model="activeTab">
      <template #default="{ activeTab }">
        <div v-if="activeTab === 'seat'">
          <section class="mb-10">
            <h2 class="text-xl font-semibold mb-4">🪑 当前座位</h2>
            <div class="mb-4 flex flex-wrap items-center gap-3">
              <button @click="openSettings('active')" class="bg-purple-500 text-white px-4 py-2 rounded">⚙️ 设置</button>
              <button @click="loadActive" class="bg-gray-500 text-white px-4 py-2 rounded">🔄 刷新</button>
              <button @click="applyMasterToActive" class="bg-green-500 text-white px-4 py-2 rounded">📥 从模板导入</button>
              <button @click="$refs.activeExportDialog.open()" class="bg-yellow-500 text-white px-4 py-2 rounded">📥 导出 Excel</button>
            </div>

            <div v-if="!activeLoaded" class="text-center py-10 text-gray-500">加载中...</div>
            <GridView
              v-else
              ref="activeGrid"
              :colHeaders="activeColHeaders"
              :rows="activeDisplayRows"
              :hideMetaColumns="true"
              :showRowNumber="true"
              :enableCandidate="true"
              :candidateItems="allStudents"
              :candidateExcludeIds="currentEditExcludeIds"
              @cell-dblclick="onActiveCellDblClick"
              @update:cells="onActiveCellsUpdate"
              @swapRows="onActiveSwapRows"
              @swapColumns="onActiveSwapColumns"
            />

            <div v-if="showSettingsDialog" class="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center">
              <div class="bg-white rounded-lg p-6 w-80">
                <h3 class="text-lg font-bold mb-4">{{ settingsTarget === 'active' ? '当前座位' : '座位模板' }} 设置</h3>
                <div class="mb-3">
                  <label class="block text-sm font-medium">行数</label>
                  <input v-model.number="tempRows" type="number" min="1" class="w-full border px-3 py-2 rounded" />
                </div>
                <div class="mb-3">
                  <label class="block text-sm font-medium">列数（实际座位列数）</label>
                  <input v-model.number="tempCols" type="number" min="1" class="w-full border px-3 py-2 rounded" />
                </div>
                <div class="mb-3">
                  <label class="block text-sm font-medium mb-1">座位模式</label>
                  <div class="flex gap-4">
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="radio" v-model="tempMode" value="single" /> 单桌
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                      <input type="radio" v-model="tempMode" value="double" /> 同桌
                    </label>
                  </div>
                </div>
                <div class="mb-4">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" v-model="tempShowAisle" /> 显示走廊
                  </label>
                  <p class="text-xs text-gray-500 mt-1">单桌：每列间有走廊；同桌：每两列为一组，组间有走廊。</p>
                </div>
                <div class="flex justify-end gap-2">
                  <button @click="showSettingsDialog = false" class="bg-gray-300 px-4 py-2 rounded">取消</button>
                  <button @click="saveSettings" class="bg-blue-500 text-white px-4 py-2 rounded">保存</button>
                </div>
              </div>
            </div>

            <ExportExcel ref="activeExportDialog" :rows="activeExportRows" :fields="activeExportFields" defaultFilename="当前座位表" />
          </section>

          <div class="mb-8"></div>

          <section>
            <h2 class="text-xl font-semibold mb-4">📋 座位模板</h2>
            <div class="mb-4 flex flex-wrap items-center gap-3">
              <button @click="openSettings('master')" class="bg-purple-500 text-white px-4 py-2 rounded">⚙️ 设置</button>
              <button @click="loadMaster" class="bg-gray-500 text-white px-4 py-2 rounded">🔄 刷新</button>
              <button @click="$refs.masterExportDialog.open()" class="bg-yellow-500 text-white px-4 py-2 rounded">📥 导出 Excel</button>
            </div>

            <div v-if="!masterLoaded" class="text-center py-10 text-gray-500">加载中...</div>
            <GridView
              v-else
              ref="masterGrid"
              :colHeaders="masterColHeaders"
              :rows="masterDisplayRows"
              :hideMetaColumns="true"
              :showRowNumber="true"
              :enableCandidate="true"
              :candidateItems="allStudents"
              :candidateExcludeIds="currentMasterEditExcludeIds"
              @cell-dblclick="onMasterCellDblClick"
              @update:cells="onMasterCellsUpdate"
              @swapRows="onMasterSwapRows"
              @swapColumns="onMasterSwapColumns"
            />
            <ExportExcel ref="masterExportDialog" :rows="masterExportRows" :fields="masterExportFields" defaultFilename="座位模板" />
          </section>
        </div>

        <div v-else-if="activeTab === 'history'">
          <div v-if="historyLoading" class="text-center py-10">加载中...</div>
          <div v-else-if="!historySnapshot" class="text-center py-10 text-gray-500">该周暂无快照</div>
          <GridView v-else :colHeaders="historyColHeaders" :rows="historyDisplayRows" :hideMetaColumns="true" :showRowNumber="true" />
          <WeekSwitcher v-model:currentWeek="historyCurrentWeek" :weeks="historyWeeks" @update:currentWeek="loadHistorySnapshot" />
          <div class="text-center mt-4">
            <button @click="captureHistorySnapshot" class="bg-green-500 text-white px-4 py-2 rounded">📸 保存本周快照</button>
          </div>
        </div>
      </template>
    </Tabs>
  </div>
</template>

<script>
import axios from 'axios'
import GridView from '../components/GridView.vue'
import ExportExcel from '../components/ExportExcel.vue'
import Tabs from '../components/Tabs.vue'
import WeekSwitcher from '../components/WeekSwitcher.vue'

const API_BASE = '/api'

export default {
  name: 'SeatView',
  components: { GridView, ExportExcel, Tabs, WeekSwitcher },
  data() {
    return {
      activeTab: 'seat',
      tabItems: [
        { label: '座位管理', value: 'seat' },
        { label: '历史记录', value: 'history' }
      ],
      activeLoaded: false,
      masterLoaded: false,
      activeRows: 6,
      activeCols: 7,
      activeSeats: [],
      activeMode: 'single',
      activeShowAisle: true,
      activeSettings: {},
      currentEditExcludeIds: [],
      masterRows: 6,
      masterCols: 7,
      masterSeats: [],
      masterMode: 'single',
      masterShowAisle: true,
      masterSettings: {},
      currentMasterEditExcludeIds: [],
      allStudents: [],
      studentMap: {},
      showSettingsDialog: false,
      settingsTarget: 'active',
      tempRows: 6,
      tempCols: 7,
      tempMode: 'single',
      tempShowAisle: true,
      historyWeeks: [],
      historyCurrentWeek: '',
      historySnapshot: null,
      historyData: { mode: 'single', rows: 0, cols: 0, seats: [], showAisle: true },
      historyLoading: false
    }
  },
  computed: {
    activeColHeaders() { return this.generateColHeaders(this.activeCols, this.activeMode, this.activeShowAisle) },
    masterColHeaders() { return this.generateColHeaders(this.masterCols, this.masterMode, this.masterShowAisle) },
    historyColHeaders() { const { cols, mode, showAisle } = this.historyData; return this.generateColHeaders(cols, mode, showAisle) },
    activeDisplayRows() { return this.buildDisplayRows('active') },
    masterDisplayRows() { return this.buildDisplayRows('master') },
    historyDisplayRows() { return this.buildDisplayRows('history') },
    activeExportFields() {
      const fields = [{ name: '行号' }]
      for (let i = 0; i < this.activeCols; i++) fields.push({ name: `列${i + 1}` })
      return fields
    },
    activeExportRows() {
      if (!Array.isArray(this.activeSeats)) return []
      return this.activeSeats.map((row, rIdx) => {
        const obj = { '行号': `第${rIdx + 1}行` }
        if (Array.isArray(row)) {
          row.forEach((id, cIdx) => { obj[`列${cIdx + 1}`] = id ? (this.studentMap[id]?.姓名 || '') : '' })
        }
        return obj
      })
    },
    masterExportFields() {
      const fields = [{ name: '行号' }]
      for (let i = 0; i < this.masterCols; i++) fields.push({ name: `列${i + 1}` })
      return fields
    },
    masterExportRows() {
      if (!Array.isArray(this.masterSeats)) return []
      return this.masterSeats.map((row, rIdx) => {
        const obj = { '行号': `第${rIdx + 1}行` }
        if (Array.isArray(row)) {
          row.forEach((id, cIdx) => { obj[`列${cIdx + 1}`] = id ? (this.studentMap[id]?.姓名 || '') : '' })
        }
        return obj
      })
    }
  },
  methods: {
    async fetchAllStudents() {
      try {
        const res = await axios.get(`${API_BASE}/students`)
        this.allStudents = res.data.data || res.data
        this.studentMap = {}
        this.allStudents.forEach(s => { this.studentMap[s.id] = s })
      } catch (e) { console.error(e) }
    },
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
    buildDisplayRows(target) {
      let seats, rows, cols, mode, showAisle, readonly = false
      if (target === 'active') {
        seats = this.activeSeats; rows = this.activeRows; cols = this.activeCols; mode = this.activeMode; showAisle = this.activeShowAisle
      } else if (target === 'master') {
        seats = this.masterSeats; rows = this.masterRows; cols = this.masterCols; mode = this.masterMode; showAisle = this.masterShowAisle
      } else {
        const d = this.historyData
        seats = d.seats; rows = d.rows; cols = d.cols; mode = d.mode; showAisle = d.showAisle; readonly = true
      }
      const displayCols = this.getDisplayColCount(cols, mode, showAisle)
      const result = []
      if (!readonly) {
        result.push({ _rowKey: 'podium', label: '讲  台', _isPodium: true, _isSeparator: false, _mergeCells: false, _isReadonly: true, cells: [] })
      }
      for (let r = 0; r < rows; r++) {
        const rowCells = []
        let realCol = 0
        for (let d = 0; d < displayCols; d++) {
          if (this.isAisleCol(d, cols, mode, showAisle)) {
            if (r === 0) {
              rowCells.push({ course: '走廊', _isAisle: true, _aisleRowSpan: rows, _isAisleHidden: false })
            } else {
              rowCells.push({ course: '', _isAisle: false, _isAisleHidden: true })
            }
          } else {
            const studentId = seats[r]?.[realCol] || null
            rowCells.push({ course: studentId ? (this.studentMap[studentId]?.姓名 || '') : '', _isAisle: false, _isAisleHidden: false, _studentId: studentId })
            realCol++
          }
        }
        result.push({ _rowKey: `row_${r}`, label: `第${r + 1}行`, cells: rowCells, _isReadonly: readonly, _lessonIdx: r, _periodRowSpan: 0, periodLabel: '' })
      }
      return result
    },
    syncCellsToSeats(newRows, target) {
      let cols, mode, showAisle
      if (target === 'active') { cols = this.activeCols; mode = this.activeMode; showAisle = this.activeShowAisle }
      else { cols = this.masterCols; mode = this.masterMode; showAisle = this.masterShowAisle }
      const newSeats = []
      for (let r = 0; r < newRows.length; r++) {
        const row = newRows[r]
        if (row._isPodium) continue
        const seatRow = []
        let realCol = 0
        for (let d = 0; d < row.cells.length; d++) {
          if (this.isAisleCol(d, cols, mode, showAisle)) continue
          const cell = row.cells[d]
          const name = cell?.course || ''
          const student = this.allStudents.find(s => s.姓名 === name)
          seatRow.push(student ? student.id : null)
          realCol++
        }
        newSeats.push(seatRow)
      }
      if (target === 'active') this.activeSeats = newSeats
      else this.masterSeats = newSeats
    },
    async loadActive() {
      await this.fetchAllStudents()
      try {
        const res = await axios.get(`${API_BASE}/seats`)
        this.activeRows = res.data.rows
        this.activeCols = res.data.cols
        this.activeSeats = res.data.seats || []
        this.activeMode = res.data.mode || 'single'
        this.activeSettings = res.data.settings || {}
        this.activeShowAisle = this.activeSettings.showAisle !== false
        this.activeLoaded = true
      } catch (e) { console.error(e) }
    },
    async saveActive() {
      await axios.put(`${API_BASE}/seats`, { rows: this.activeRows, cols: this.activeCols, seats: this.activeSeats, mode: this.activeMode, settings: { showAisle: this.activeShowAisle } })
    },
    onActiveCellsUpdate(newRows) { this.syncCellsToSeats(newRows, 'active'); this.saveActive() },
    // ===== 行交换修正 =====
    onActiveSwapRows(fromIdx, toIdx) {
      if (fromIdx === 0 || toIdx === 0) return // 讲台行不可拖动
      const seatFrom = fromIdx - 1
      const seatTo = toIdx - 1
      if (seatFrom < 0 || seatTo < 0 || seatFrom >= this.activeSeats.length || seatTo >= this.activeSeats.length) return
      const s = [...this.activeSeats]
      ;[s[seatFrom], s[seatTo]] = [s[seatTo], s[seatFrom]]
      this.activeSeats = s
      this.saveActive()
    },
    onActiveSwapColumns(fromDisplayIdx, toDisplayIdx) {
      const cols = this.activeCols, mode = this.activeMode, showAisle = this.activeShowAisle
      const map = []; let real = 0; const total = this.getDisplayColCount(cols, mode, showAisle)
      for (let d = 0; d < total; d++) { if (!this.isAisleCol(d, cols, mode, showAisle)) map[d] = real++; else map[d] = -1 }
      const from = map[fromDisplayIdx], to = map[toDisplayIdx]
      if (from === -1 || to === -1) return
      const newSeats = this.activeSeats.map(r => { const nr = [...r]; [nr[from], nr[to]] = [nr[to], nr[from]]; return nr })
      this.activeSeats = newSeats; this.saveActive()
    },
    // ===== 双击编辑修正 =====
    onActiveCellDblClick({ rowIdx, colIdx: displayColIdx }) {
      const row = this.activeDisplayRows[rowIdx]
      if (!row || row._isReadonly || row._isPodium) return
      const cell = row.cells[displayColIdx]
      if (cell._isAisle || cell._isAisleHidden) return

      const seatRowIdx = rowIdx - 1
      if (seatRowIdx < 0 || seatRowIdx >= this.activeSeats.length) return

      let realCol = 0
      for (let d = 0; d < displayColIdx; d++) { if (!this.isAisleCol(d, this.activeCols, this.activeMode, this.activeShowAisle)) realCol++ }
      const occupied = new Set()
      this.activeSeats.forEach((r, ri) => {
        r.forEach((id, ci) => {
          if (id && !(ri === seatRowIdx && ci === realCol)) occupied.add(id)
        })
      })
      this.currentEditExcludeIds = Array.from(occupied)
    },
    async loadMaster() {
      try {
        const res = await axios.get(`${API_BASE}/seats/master`)
        this.masterRows = res.data.rows; this.masterCols = res.data.cols; this.masterSeats = res.data.seats || []; this.masterMode = res.data.mode || 'single'
        this.masterSettings = res.data.settings || {}; this.masterShowAisle = this.masterSettings.showAisle !== false; this.masterLoaded = true
      } catch (e) { console.error(e) }
    },
    async saveMaster() {
      await axios.put(`${API_BASE}/seats/master`, { rows: this.masterRows, cols: this.masterCols, seats: this.masterSeats, mode: this.masterMode, settings: { showAisle: this.masterShowAisle } })
    },
    onMasterCellsUpdate(newRows) { this.syncCellsToSeats(newRows, 'master'); this.saveMaster() },
    // ===== 模板行交换修正 =====
    onMasterSwapRows(fromIdx, toIdx) {
      if (fromIdx === 0 || toIdx === 0) return
      const seatFrom = fromIdx - 1
      const seatTo = toIdx - 1
      if (seatFrom < 0 || seatTo < 0 || seatFrom >= this.masterSeats.length || seatTo >= this.masterSeats.length) return
      const s = [...this.masterSeats]
      ;[s[seatFrom], s[seatTo]] = [s[seatTo], s[seatFrom]]
      this.masterSeats = s
      this.saveMaster()
    },
    onMasterSwapColumns(fromDisplayIdx, toDisplayIdx) {
      const cols = this.masterCols, mode = this.masterMode, showAisle = this.masterShowAisle
      const map = []; let real = 0; const total = this.getDisplayColCount(cols, mode, showAisle)
      for (let d = 0; d < total; d++) { if (!this.isAisleCol(d, cols, mode, showAisle)) map[d] = real++; else map[d] = -1 }
      const from = map[fromDisplayIdx], to = map[toDisplayIdx]
      if (from === -1 || to === -1) return
      const newSeats = this.masterSeats.map(r => { const nr = [...r]; [nr[from], nr[to]] = [nr[to], nr[from]]; return nr })
      this.masterSeats = newSeats; this.saveMaster()
    },
    // ===== 模板双击编辑修正 =====
    onMasterCellDblClick({ rowIdx, colIdx: displayColIdx }) {
      const row = this.masterDisplayRows[rowIdx]
      if (!row || row._isReadonly || row._isPodium) return
      const cell = row.cells[displayColIdx]
      if (cell._isAisle || cell._isAisleHidden) return

      const seatRowIdx = rowIdx - 1
      if (seatRowIdx < 0 || seatRowIdx >= this.masterSeats.length) return

      let realCol = 0
      for (let d = 0; d < displayColIdx; d++) { if (!this.isAisleCol(d, this.masterCols, this.masterMode, this.masterShowAisle)) realCol++ }
      const occupied = new Set()
      this.masterSeats.forEach((r, ri) => {
        r.forEach((id, ci) => {
          if (id && !(ri === seatRowIdx && ci === realCol)) occupied.add(id)
        })
      })
      this.currentMasterEditExcludeIds = Array.from(occupied)
    },
    openSettings(target) {
      this.settingsTarget = target
      if (target === 'active') {
        this.tempRows = this.activeRows; this.tempCols = this.activeCols; this.tempMode = this.activeMode; this.tempShowAisle = this.activeShowAisle
      } else {
        this.tempRows = this.masterRows; this.tempCols = this.masterCols; this.tempMode = this.masterMode; this.tempShowAisle = this.masterShowAisle
      }
      this.showSettingsDialog = true
    },
    async saveSettings() {
      const target = this.settingsTarget
      if (this.tempRows <= 0 || this.tempCols <= 0) return
      if (target === 'active') {
        this.activeRows = this.tempRows; this.activeCols = this.tempCols; this.activeMode = this.tempMode; this.activeShowAisle = this.tempShowAisle
        const ns = []; for (let r = 0; r < this.activeRows; r++) { const row = this.activeSeats[r] ? [...this.activeSeats[r]].slice(0, this.activeCols) : []; while (row.length < this.activeCols) row.push(null); ns.push(row) }
        this.activeSeats = ns; await this.saveActive()
      } else {
        this.masterRows = this.tempRows; this.masterCols = this.tempCols; this.masterMode = this.tempMode; this.masterShowAisle = this.tempShowAisle
        const ns = []; for (let r = 0; r < this.masterRows; r++) { const row = this.masterSeats[r] ? [...this.masterSeats[r]].slice(0, this.masterCols) : []; while (row.length < this.masterCols) row.push(null); ns.push(row) }
        this.masterSeats = ns; await this.saveMaster()
      }
      this.showSettingsDialog = false
    },
    applyMasterToActive() {
      if (!confirm('确定用模板覆盖当前座位吗？')) return
      axios.post(`${API_BASE}/seats/apply-master`).then(() => this.loadActive()).catch(e => alert('应用失败'))
    },
    async fetchHistoryWeeks() {
      try {
        const res = await axios.get(`${API_BASE}/seats/history`)
        this.historyWeeks = res.data || []
        if (this.historyCurrentWeek && !this.historyWeeks.some(w => w.week_start === this.historyCurrentWeek)) this.historyCurrentWeek = ''
        if (!this.historyCurrentWeek && this.historyWeeks.length > 0) this.historyCurrentWeek = this.historyWeeks[0].week_start
        if (this.historyCurrentWeek) await this.loadHistorySnapshot()
      } catch (e) { console.error(e) }
    },
    async loadHistorySnapshot() {
      if (!this.historyCurrentWeek) return
      this.historyLoading = true
      try {
        const res = await axios.get(`${API_BASE}/seats/history/${this.historyCurrentWeek}`)
        this.historySnapshot = res.data
        if (res.data) {
          this.historyData = { mode: res.data.mode || 'single', rows: res.data.rows, cols: res.data.cols, seats: res.data.seats, showAisle: (res.data.settings && res.data.settings.showAisle) || false }
        } else {
          this.historyData = { mode: 'single', rows: 0, cols: 0, seats: [], showAisle: false }
        }
      } catch (e) { console.error(e) } finally { this.historyLoading = false }
    },
    getMonday(date) {
      const d = new Date(date)
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      return new Date(d.setDate(diff))
    },
    async captureHistorySnapshot() {
      try {
        const weekStart = this.getMonday(new Date()).toISOString().slice(0, 10)
        await axios.post(`${API_BASE}/seats/snapshot`, { week_start: weekStart, mode: this.activeMode, rows: this.activeRows, cols: this.activeCols, seats: this.activeSeats, settings: { showAisle: this.activeShowAisle } })
        alert('本周快照已保存')
        await this.fetchHistoryWeeks()
      } catch (e) { alert('保存失败') }
    }
  },
  watch: { activeTab(newTab) { if (newTab === 'history') this.fetchHistoryWeeks() } },
  mounted() { this.loadActive(); this.loadMaster(); this.fetchAllStudents() }
}
</script>