<template>
  <div>
    <!-- 顶部标题栏 -->
    <div class="w-full bg-gradient-to-r from-blue-80 to-blue-100 shadow-md rounded-xl mb-6  px-6 py-5 ">
      <h1 class="text-2xl font-bold text-gray-800">📅 课程表</h1>
    </div>

    <!-- 标签切换 -->
    <Tabs :tabs="tabItems" v-model="activeTab">
      <template #default="{ activeTab }">
        <!-- ==================== 课程表管理标签页 ==================== -->
        <div v-if="activeTab === 'schedule'">
          <!-- 实行课表（临时） -->
          <section class="mb-10">
            <h2 class="text-xl font-semibold mb-4">📅 实行课表（临时）</h2>
            <div class="mb-4 flex items-center gap-3">
              <button @click="activeSettingsVisible = true" class="bg-purple-500 text-white px-4 py-2 rounded">⚙️ 设置</button>
              <button @click="loadActive" class="bg-gray-500 text-white px-4 py-2 rounded">🔄 刷新</button>
              <button @click="applyMasterToActive" class="bg-green-500 text-white px-4 py-2 rounded">📥 从一般课表导入</button>
              <button @click="$refs.activeExportDialog.open()" class="bg-yellow-500 text-white px-4 py-2 rounded">📥 导出 Excel</button>
            </div>

            <GridView
              :title="activeTitle"    
              :colHeaders="activeColHeaders"
              :rows="activeDisplayRows"
              :showPeriodColumn="true"
              @update:cells="onActiveCellsUpdate"
              @swapRows="onActiveSwapRows"
              @swapColumns="onActiveSwapColumns"
              @update:row-meta="onActiveRowMeta"
              

            />

            <SettingsDialog
              :visible="activeSettingsVisible"
              :settings="activeSettings"
              :semesterStart="semesterStart"
              :showSemesterStart="true"
              @save="saveActiveSettings"
              @cancel="activeSettingsVisible = false"
              @update:semesterStart="semesterStart = $event"
            />

            <ExportExcel
              ref="activeExportDialog"
              :rows="activeExportRows"
              :fields="activeExportFields"
              defaultFilename="实行课表"
              @export-finish="() => {}"
            />
          </section>

          <!-- 分隔 -->
          <div class="mb-4"></div>

          <!-- 一般课表（模板） -->
          <section>
            <h2 class="text-xl font-semibold mb-4">📋 一般课表（模板）</h2>
            <div class="mb-4 flex items-center gap-3">
              <button @click="masterSettingsVisible = true" class="bg-purple-500 text-white px-4 py-2 rounded">⚙️ 设置</button>
              <button @click="loadMaster" class="bg-gray-500 text-white px-4 py-2 rounded">🔄 刷新</button>
              <button @click="$refs.masterExportDialog.open()" class="bg-yellow-500 text-white px-4 py-2 rounded">📥 导出 Excel</button>
            </div>

            <GridView
              :colHeaders="masterColHeaders"
              :rows="masterDisplayRows"
              :showPeriodColumn="true"
              @update:cells="onMasterCellsUpdate"
              @swapRows="onMasterSwapRows"
              @swapColumns="onMasterSwapColumns"
              @update:row-meta="onMasterRowMeta"
            />

            <SettingsDialog
              :visible="masterSettingsVisible"
              :settings="masterSettings"
              :semesterStart="''"
              :showSemesterStart="false"
              @save="saveMasterSettings"
              @cancel="masterSettingsVisible = false"
              @update:semesterStart="() => {}"
            />

            <ExportExcel
              ref="masterExportDialog"
              :rows="masterExportRows"
              :fields="masterExportFields"
              defaultFilename="一般课表"
              @export-finish="() => {}"
            />
          </section>
        </div>

        <!-- ==================== 历史课程表记录标签页（占位） ==================== -->
        <div v-else-if="activeTab === 'history'">
          
          <div v-if="historyLoading" class="text-center py-10">加载中...</div>
          <div v-else-if="!historySnapshot" class="text-center py-10 text-gray-500">该周暂无快照</div>
          <GridView
            v-else
            :colHeaders="historyColHeaders"
            :title="activeTitle"
            :rows="historyDisplayRows"
            :showPeriodColumn="true"
            @update:cells="() => {}"
            @swapRows="() => {}"
            @swapColumns="() => {}"
            @update:row-meta="() => {}"
          />
          <WeekSwitcher
            v-model:currentWeek="historyCurrentWeek"
            :weeks="historyWeeks"
            @update:currentWeek="loadHistorySnapshot"
          />
          <div class="text-center mt-4">
            <button @click="captureHistorySnapshot" class="bg-green-500 text-white px-4 py-2 rounded">
              📸 保存本周快照
            </button>
          </div>
        </div>
      </template>
    </Tabs>
  </div>
</template>


<script>
import axios from 'axios';
import GridView from '../components/GridView.vue';
import SettingsDialog from '../components/SettingsDialog.vue';
import ExportExcel from '../components/ExportExcel.vue';
import Tabs from '../components/Tabs.vue';
import WeekSwitcher from '../components/WeekSwitcher.vue';

const API_BASE = '/api';

const DEFAULT_SECTIONS = {
  morning: [
    { name: '第1节', start: '08:10', end: '08:55', type: 'lesson' },
    { name: '第2节', start: '09:05', end: '09:50', type: 'lesson' },
    { name: '大课间', start: '09:50', end: '10:20', type: 'rest' },
    { name: '第3节', start: '10:20', end: '11:05', type: 'lesson' },
    { name: '第4节', start: '11:15', end: '12:00', type: 'lesson' }
  ],
  noon: [
    { name: '午休', start: '12:00', end: '14:00', type: 'rest' }
  ],
  afternoon: [
    { name: '第5节', start: '14:30', end: '15:15', type: 'lesson' },
    { name: '第6节', start: '15:25', end: '16:10', type: 'lesson' }
  ],
  evening: [
    { name: '休息', start: '17:00', end: '18:30', type: 'rest' }
  ],
  night: [
    { name: '晚修1', start: '19:00', end: '19:45', type: 'lesson' },
    { name: '晚修2', start: '19:55', end: '20:40', type: 'lesson' }
  ]
};

const SECTION_NAMES = {
  morning: '上午',
  noon: '中午',
  afternoon: '下午',
  evening: '傍晚',
  night: '晚上'
};

export default {
  name: 'ScheduleView',
  components: { GridView, SettingsDialog, ExportExcel,Tabs,WeekSwitcher },
  data() {
    return {
      // ========== 一般课表 ==========
      masterColHeaders: ['周一', '周二', '周三', '周四', '周五'],
      masterCells: [],
      masterSettings: {
        sections: null,
        periods: [],
        days: ['周一', '周二', '周三', '周四', '周五']
      },
      masterSettingsVisible: false,

      // ========== 实行课表 ==========
      activeColHeaders: ['周一', '周二', '周三', '周四', '周五'],
      activeCells: [],
      activeSettings: {
        sections: null,
        periods: [],
        days: ['周一', '周二', '周三', '周四', '周五']
      },
      activeSettingsVisible: false,

      // ========== 全局 ==========
      semesterStart: '',
      loaded: false,
      activeTab: 'schedule',
      tabItems: [
        { label: '课程表管理', value: 'schedule' },
        { label: '历史课程表记录', value: 'history' }
      ],
      historyWeeks: [],
      historyCurrentWeek: '',
      historySnapshot: null,
      historyCells: [],
      historySettings: { sections: null, periods: [], days: ['周一','周二','周三','周四','周五'] },
      historyColHeaders: ['周一','周二','周三','周四','周五'],
      historyLoading: false,
    };
  },
  watch: {
    activeTab(newTab) {
      if (newTab === 'history') {
        if (this.historyWeeks.length === 0) {
          this.fetchHistoryWeeks();
        } else {
          // 确保当前周存在，若不存在则重载
          if (!this.historyCurrentWeek || !this.historyWeeks.some(w => w.week_start === this.historyCurrentWeek)) {
            if (this.historyWeeks.length > 0) {
              this.historyCurrentWeek = this.historyWeeks[0].week_start;
            }
            this.loadHistorySnapshot();
          }
        }
      }
    }
  },
  computed: {
    // ---- 一般课表显示行 ----
    masterDisplayRows() {
      return this.buildDisplayRows(this.masterCells, this.masterSettings);
    },
    masterExportFields() {
      const fields = [{ name: '行号' }];
      this.masterColHeaders.forEach(h => fields.push({ name: h }));
      return fields;
    },
    masterExportRows() {
      const headers = this.masterColHeaders;
      const rows = this.masterDisplayRows;
      return rows.map(row => {
        if (row._isPodium) {
          return {
            '行号': '讲台',
            _isPodium: true,
            label: '讲  台'
          };
        }
        const obj = { '行号': row.label };
        row.cells.forEach((cell, idx) => {
          const headerName = headers[idx] || `列${idx+1}`;
          if (cell._isAisle) {
            obj[headerName] = '走廊';
            obj._aisleCell = true;
          } else if (cell._isAisleHidden) {
            obj[headerName] = '';
          } else {
            obj[headerName] = cell.course || '';
          }
        });
        return obj;
      });
    },

    // ---- 实行课表显示行（顶部自动添加周数标题行） ----
    activeDisplayRows() {
      return this.buildDisplayRows(this.activeCells, this.activeSettings);
    },

    activeExportFields() {
      const fields = [{ name: '行号' }];
      // 将当前显示的列头（包括“走廊”）都作为导出列
      this.activeColHeaders.forEach(h => fields.push({ name: h }));
      return fields;
    },
    activeExportRows() {
      const headers = this.activeColHeaders; // 包含“走廊”的列头数组
      const rows = this.activeDisplayRows;   // 包含讲台行和普通行
      return rows.map(row => {
        if (row._isPodium) {
          return {
            '行号': '讲台',
            _isPodium: true,
            label: '讲  台'
          };
        }
        // 普通行：行号列是 row.label（例如“第1行”），其他列按 cells 顺序填充
        const obj = { '行号': row.label };
        row.cells.forEach((cell, idx) => {
          const headerName = headers[idx] || `列${idx+1}`;
          if (cell._isAisle) {
            obj[headerName] = '走廊';
            obj._aisleCell = true; // 标记为走廊单元格
          } else if (cell._isAisleHidden) {
            obj[headerName] = ''; // 隐藏的占位列
          } else {
            obj[headerName] = cell.course || '';
          }
        });
        return obj;
      });
    },
    historyDisplayRows() {
      const rows = this.buildDisplayRows(this.historyCells, this.historySettings);
      return rows.map(row => ({ ...row, _isReadonly: true }));
    },
    weekNumber() {
      if (!this.semesterStart) return '';
      const start = new Date(this.semesterStart);
      const now = new Date();
      const diff = now - start;
      if (diff < 0) return '未开始';
      return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
    },
    activeTitle() {
      return this.semesterStart ? `第 ${this.weekNumber} 周 课程表` : '课程表';
    },
  },
  methods: {
    // ============= 公共：构建显示行 =============
    buildDisplayRows(cells, settings) {
      const sections = settings.sections;
      if (!sections) return [];
      let lessonIdx = 0;
      const rows = [];
      const order = ['morning', 'noon', 'afternoon', 'evening', 'night'];
      const days = settings.days || this.masterColHeaders;

      order.forEach(secKey => {
        const items = sections[secKey] || [];
        const sectionName = SECTION_NAMES[secKey] || secKey;
        const sectionRowCount = items.length;

        items.forEach((item, idx) => {
          const row = {
            _rowKey: `${secKey}_${idx}`,
            label: item.name,
            time: `${item.start}-${item.end}`,
            _isSeparator: false,
            cells: [],
            _isReadonly: item.type !== 'lesson',
            _mergeCells: item.type !== 'lesson',
            periodLabel: idx === 0 ? sectionName : '',
            _periodRowSpan: idx === 0 ? sectionRowCount : 0,
          };

          if (item.type === 'lesson') {
            const lessonCells = cells[lessonIdx] || Array(days.length).fill({ course: '' });
            while (lessonCells.length < days.length) lessonCells.push({ course: '' });
            row.cells = lessonCells.slice(0, days.length);
            row._lessonIdx = lessonIdx;
            lessonIdx++;
          } else {
            row.cells = Array(days.length).fill({ course: '' });
          }
          rows.push(row);
        });
      });
      return rows;
    },

    // ============= 公共：构建导出行 =============
    buildExportRows(cells, settings) {
      const sections = settings.sections;
      if (!sections) return [];
      const order = ['morning', 'noon', 'afternoon', 'evening', 'night'];
      let lessonIdx = 0;
      const output = [];
      const days = settings.days || this.masterColHeaders;

      order.forEach(secKey => {
        const items = sections[secKey] || [];
        if (items.length === 0) return;

        const hasLesson = items.some(it => it.type === 'lesson');
        if (!hasLesson) {
          items.forEach(item => {
            output.push({
              type: 'globalRest',
              label: item.name,
              time: `${item.start}-${item.end}`,
              section: secKey
            });
          });
          return;
        }

        const lessonRows = [];
        items.forEach(item => {
          if (item.type === 'lesson') {
            const lessonCells = cells[lessonIdx] || Array(days.length).fill({ course: '' });
            lessonIdx++;
            lessonRows.push({
              type: 'lesson',
              label: item.name,
              time: `${item.start}-${item.end}`,
              section: secKey,
              cells: lessonCells,
              _rowSpan: 0
            });
          }
        });

        let lessonCursor = 0;
        items.forEach(item => {
          if (item.type === 'lesson') {
            output.push(lessonRows[lessonCursor]);
            lessonCursor++;
          } else {
            output.push({
              type: 'innerRest',
              label: item.name,
              time: `${item.start}-${item.end}`,
              section: secKey
            });
          }
        });
      });

      // 重新计算时段列竖向合并跨度
      let currentSection = null;
      let firstLessonIdx = -1;
      for (let i = 0; i < output.length; i++) {
        const row = output[i];
        if (row.section !== currentSection) {
          if (currentSection !== null && firstLessonIdx >= 0) {
            const span = i - firstLessonIdx;
            output[firstLessonIdx]._rowSpan = span;
            output[firstLessonIdx]._isFirstInBlock = true;
            for (let j = firstLessonIdx + 1; j < i; j++) {
              if (output[j].type === 'lesson') {
                output[j]._rowSpan = 0;
                output[j]._isFirstInBlock = false;
              }
            }
          }
          currentSection = row.section;
          firstLessonIdx = row.type === 'lesson' ? i : -1;
        } else if (firstLessonIdx === -1 && row.type === 'lesson') {
          firstLessonIdx = i;
        }
      }
      if (currentSection !== null && firstLessonIdx >= 0) {
        const span = output.length - firstLessonIdx;
        output[firstLessonIdx]._rowSpan = span;
        output[firstLessonIdx]._isFirstInBlock = true;
        for (let j = firstLessonIdx + 1; j < output.length; j++) {
          if (output[j].type === 'lesson') {
            output[j]._rowSpan = 0;
            output[j]._isFirstInBlock = false;
          }
        }
      }

      return output;
    },

    // 辅助：按设置调整 cells 行列数
    adjustCells(cells, settings) {
      const sections = settings.sections;
      if (!sections) return cells;
      let lessonCount = 0;
      ['morning', 'noon', 'afternoon', 'evening', 'night'].forEach(key => {
        lessonCount += (sections[key] || []).filter(i => i.type === 'lesson').length;
      });
      const dayCount = (settings.days || ['周一', '周二', '周三', '周四', '周五']).length;
      while (cells.length < lessonCount) cells.push(Array(dayCount).fill({ course: '' }));
      cells = cells.slice(0, lessonCount).map(row => {
        while (row.length < dayCount) row.push({ course: '' });
        return row;
      });
      return cells;
    },

    // ============= 一般课表操作 =============
    async loadMaster() {
      try {
        const res = await axios.get(`${API_BASE}/schedule/master`);
        const { cells, settings } = res.data;
        this.masterCells = Array.isArray(cells) ? cells : [];
        if (settings && (settings.sections || settings.periods)) {
          this.masterSettings = {
            sections: settings.sections || null,
            periods: settings.periods || [],
            days: settings.days || this.masterColHeaders
          };
          this.masterColHeaders = this.masterSettings.days;
        } else {
          this.masterSettings = {
            sections: JSON.parse(JSON.stringify(DEFAULT_SECTIONS)),
            periods: [],
            days: this.masterColHeaders
          };
          this.masterColHeaders = this.masterSettings.days;
          await this.saveMaster();
        }
        this.masterCells = this.adjustCells(this.masterCells, this.masterSettings);
      } catch (e) { console.error(e); }
    },
    async saveMaster() {
      await axios.put(`${API_BASE}/schedule/master`, {
        cells: this.masterCells,
        settings: this.masterSettings
      });
    },
    onMasterCellsUpdate(newRows) {
      const newCells = [];
      newRows.forEach(row => {
        if (row._lessonIdx !== undefined) newCells[row._lessonIdx] = row.cells;
      });
      let lessonCount = 0;
      const sections = this.masterSettings.sections;
      if (sections) {
        ['morning', 'noon', 'afternoon', 'evening', 'night'].forEach(key => {
          lessonCount += (sections[key] || []).filter(i => i.type === 'lesson').length;
        });
      }
      for (let i = 0; i < lessonCount; i++) {
        if (!newCells[i]) newCells[i] = Array(this.masterColHeaders.length).fill({ course: '' });
      }
      this.masterCells = newCells;
      this.masterCells = this.adjustCells(this.masterCells, this.masterSettings);
      this.saveMaster();
    },
    onMasterSwapRows(fromIdx, toIdx) {
      const rows = this.masterDisplayRows.filter(r => !r._isSeparator && !r._mergeCells);
      const fromRow = rows[fromIdx], toRow = rows[toIdx];
      if (!fromRow || !toRow || fromRow._isReadonly || toRow._isReadonly) return;
      const fromLessonIdx = fromRow._lessonIdx, toLessonIdx = toRow._lessonIdx;
      if (fromLessonIdx === undefined || toLessonIdx === undefined) return;
      const newCells = [...this.masterCells];
      [newCells[fromLessonIdx], newCells[toLessonIdx]] = [newCells[toLessonIdx], newCells[fromLessonIdx]];
      this.masterCells = newCells;
      this.saveMaster();
    },
    onMasterSwapColumns(fromIdx, toIdx) {
      const newCells = this.masterCells.map(row => {
        const r = [...row];
        const [m] = r.splice(fromIdx, 1);
        r.splice(toIdx, 0, m);
        return r;
      });
      this.masterCells = newCells;
      this.saveMaster();
    },
    onMasterRowMeta({ rowIdx, field, value }) {
      const sections = JSON.parse(JSON.stringify(this.masterSettings.sections));
      const flat = [];
      ['morning', 'noon', 'afternoon', 'evening', 'night'].forEach(key => {
        (sections[key] || []).forEach(item => flat.push({ section: key, item }));
      });
      if (rowIdx < flat.length) {
        const target = flat[rowIdx].item;
        if (field === 'label') target.name = value;
        else if (field === 'time') {
          const parts = value.split('-');
          if (parts.length === 2) {
            target.start = parts[0].trim();
            target.end = parts[1].trim();
          }
        }
        this.masterSettings.sections = sections;
        this.saveMaster();
      }
    },
    async saveMasterSettings(settings) {
      this.masterSettings = {
        sections: settings.sections,
        periods: settings.periods,
        days: settings.days
      };
      this.masterColHeaders = settings.days;
      this.masterSettingsVisible = false;
      this.masterCells = this.adjustCells(this.masterCells, this.masterSettings);
      await this.saveMaster();
    },
    async applyMasterToActive() {
      if (!confirm('确定将一般课表覆盖到实行课表吗？')) return;
      try {
        await axios.post(`${API_BASE}/schedule/apply-master`);
        alert('已应用');
        await this.loadActive();
      } catch (e) {
        alert('应用失败');
      }
    },

    // ============= 实行课表操作 =============
    async loadActive() {
      try {
        const res = await axios.get(`${API_BASE}/schedule`);
        const { cells, settings } = res.data;
        this.activeCells = Array.isArray(cells) ? cells : [];
        if (settings && (settings.sections || settings.periods)) {
          this.activeSettings = {
            sections: settings.sections || null,
            periods: settings.periods || [],
            days: settings.days || this.activeColHeaders
          };
          this.activeColHeaders = this.activeSettings.days;
        } else {
          this.activeSettings = {
            sections: JSON.parse(JSON.stringify(DEFAULT_SECTIONS)),
            periods: [],
            days: this.activeColHeaders
          };
          this.activeColHeaders = this.activeSettings.days;
          await this.saveActive();
        }
        this.activeCells = this.adjustCells(this.activeCells, this.activeSettings);

        // 加载学期开始日期
        const setRes = await axios.get(`${API_BASE}/schedule/settings`);
        this.semesterStart = setRes.data?.semester_start || '';
      } catch (e) { console.error(e); }
    },
    async saveActive() {
      await axios.put(`${API_BASE}/schedule`, {
        cells: this.activeCells,
        settings: this.activeSettings
      });
    },
    onActiveCellsUpdate(newRows) {
      const newCells = [];
      newRows.forEach(row => {
        if (row._lessonIdx !== undefined) newCells[row._lessonIdx] = row.cells;
      });
      let lessonCount = 0;
      const sections = this.activeSettings.sections;
      if (sections) {
        ['morning', 'noon', 'afternoon', 'evening', 'night'].forEach(key => {
          lessonCount += (sections[key] || []).filter(i => i.type === 'lesson').length;
        });
      }
      for (let i = 0; i < lessonCount; i++) {
        if (!newCells[i]) newCells[i] = Array(this.activeColHeaders.length).fill({ course: '' });
      }
      this.activeCells = newCells;
      this.activeCells = this.adjustCells(this.activeCells, this.activeSettings);
      this.saveActive();
    },
    onActiveSwapRows(fromIdx, toIdx) {
      const rows = this.activeDisplayRows.filter(r => !r._isSeparator && !r._mergeCells);
      const fromRow = rows[fromIdx], toRow = rows[toIdx];
      if (!fromRow || !toRow || fromRow._isReadonly || toRow._isReadonly) return;
      const fromLessonIdx = fromRow._lessonIdx, toLessonIdx = toRow._lessonIdx;
      if (fromLessonIdx === undefined || toLessonIdx === undefined) return;
      const newCells = [...this.activeCells];
      [newCells[fromLessonIdx], newCells[toLessonIdx]] = [newCells[toLessonIdx], newCells[fromLessonIdx]];
      this.activeCells = newCells;
      this.saveActive();
    },
    onActiveSwapColumns(fromIdx, toIdx) {
      const newCells = this.activeCells.map(row => {
        const r = [...row];
        const [m] = r.splice(fromIdx, 1);
        r.splice(toIdx, 0, m);
        return r;
      });
      this.activeCells = newCells;
      this.saveActive();
    },
    onActiveRowMeta({ rowIdx, field, value }) {
      const sections = JSON.parse(JSON.stringify(this.activeSettings.sections));
      const flat = [];
      ['morning', 'noon', 'afternoon', 'evening', 'night'].forEach(key => {
        (sections[key] || []).forEach(item => flat.push({ section: key, item }));
      });
      if (rowIdx < flat.length) {
        const target = flat[rowIdx].item;
        if (field === 'label') target.name = value;
        else if (field === 'time') {
          const parts = value.split('-');
          if (parts.length === 2) {
            target.start = parts[0].trim();
            target.end = parts[1].trim();
          }
        }
        this.activeSettings.sections = sections;
        this.saveActive();
      }
    },
    // 获取所有快照周列表
    async fetchHistoryWeeks() {
      try {
        const res = await axios.get(`${API_BASE}/schedule/history`);
        this.historyWeeks = res.data || [];

        // 如果已有选中的周，检查是否仍在列表中
        if (this.historyCurrentWeek) {
          const stillExists = this.historyWeeks.some(w => w.week_start === this.historyCurrentWeek);
          if (!stillExists) this.historyCurrentWeek = '';
        }

        // 如果没有选中，自动选第一周
        if (!this.historyCurrentWeek && this.historyWeeks.length > 0) {
          this.historyCurrentWeek = this.historyWeeks[0].week_start;
        }

        // 如果有选中的周，加载其快照
        if (this.historyCurrentWeek) {
          await this.loadHistorySnapshot();
        }
      } catch (e) {
        console.error('获取历史周列表失败', e);
      }
    },

    // 加载当前周的课表快照
    async loadHistorySnapshot() {
      if (!this.historyCurrentWeek) return;
      this.historyLoading = true;
      try {
        const res = await axios.get(`${API_BASE}/schedule/history/${this.historyCurrentWeek}`);
        this.historySnapshot = res.data;
        if (this.historySnapshot) {
          this.historyCells = Array.isArray(this.historySnapshot.cells) ? this.historySnapshot.cells : [];
          const settings = this.historySnapshot.settings || {};
          this.historySettings = {
            sections: settings.sections || null,
            periods: settings.periods || [],
            days: settings.days || ['周一','周二','周三','周四','周五']
          };
          this.historyColHeaders = this.historySettings.days;
        } else {
          this.historyCells = [];
          this.historySettings = { sections: null, periods: [], days: ['周一','周二','周三','周四','周五'] };
          this.historyColHeaders = ['周一','周二','周三','周四','周五'];
        }
      } catch (e) { console.error(e); }
      finally { this.historyLoading = false; }
    },

    // 获取本周一的日期
    getMonday(date) {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(d.setDate(diff));
    },

    // 保存当前实行课表为本周快照
    async captureHistorySnapshot() {
      try {
        const activeRes = await axios.get(`${API_BASE}/schedule`);
        const { cells, settings } = activeRes.data;
        const weekStart = this.getMonday(new Date()).toISOString().slice(0, 10);
        await axios.post(`${API_BASE}/schedule/snapshot`, {
          week_start: weekStart,
          cells,
          settings
        });
        alert('本周快照已保存');
        await this.fetchHistoryWeeks();
      } catch (e) { alert('保存失败'); }
    },
    async saveActiveSettings(settings) {
      this.activeSettings = {
        sections: settings.sections,
        periods: settings.periods,
        days: settings.days
      };
      this.activeColHeaders = settings.days;
      this.activeSettingsVisible = false;
      this.activeCells = this.adjustCells(this.activeCells, this.activeSettings);

      // 保存学期开始日期
      await axios.put(`${API_BASE}/schedule/settings`, {
        semester_start: this.semesterStart
      });
      await this.saveActive();
    }
  },
  mounted() {
    this.loadMaster();
    this.loadActive();
    this.fetchHistoryWeeks();
  }
};
</script>