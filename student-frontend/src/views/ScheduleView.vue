<template>
  <div>
    <!-- ========== 实行课表（临时） ========== -->
    <section>
      <h1 class="text-2xl font-bold mb-4">📅 一周实行课表</h1>

      <div class="mb-4 flex items-center gap-3">
        <button @click="activeSettingsVisible = true" class="bg-purple-500 text-white px-4 py-2 rounded">⚙️ 设置</button>
        <button @click="loadActive" class="bg-gray-500 text-white px-4 py-2 rounded">🔄 刷新</button>
        <button @click="applyMasterToActive" class="bg-green-500 text-white px-4 py-2 rounded">📥 从一般课表导入</button>
        <button @click="$refs.activeExportDialog.open()" class="bg-yellow-500 text-white px-4 py-2 rounded">📥 导出 Excel</button>
      </div>

      <GridView
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
    
    <div class="mb-8"></div>
    <!-- ========== 一般课表 ========== -->
    <section class="mb-10">

      <h1 class="text-2xl font-bold mb-4">📋 学期全局课表</h1>

      <div class="mb-4 flex items-center gap-3">
        <button @click="masterSettingsVisible = true" class="bg-purple-500 text-white px-4 py-2 rounded">⚙️ 设置</button>
        <button @click="loadMaster" class="bg-gray-500 text-white px-4 py-2 rounded">🔄 刷新</button>
        <button @click="applyMasterToActive" class="bg-green-500 text-white px-4 py-2 rounded">📥 应用到实行课表</button>
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
</template>

<script>
import axios from 'axios';
import GridView from '../components/GridView.vue';
import SettingsDialog from '../components/SettingsDialog.vue';
import ExportExcel from '../components/ExportExcel.vue';

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
  components: { GridView, SettingsDialog, ExportExcel },
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
      loaded: false
    };
  },
  computed: {
    // ---- 一般课表显示行 ----
    masterDisplayRows() {
      return this.buildDisplayRows(this.masterCells, this.masterSettings);
    },
    masterExportFields() {
      const fields = [{ name: '时段' }, { name: '节次' }, { name: '时间' }];
      this.masterColHeaders.forEach(d => fields.push({ name: d }));
      return fields;
    },
    masterExportRows() {
      return this.buildExportRows(this.masterCells, this.masterSettings);
    },

    // ---- 实行课表显示行（顶部自动添加周数标题行） ----
    activeDisplayRows() {
      const rows = this.buildDisplayRows(this.activeCells, this.activeSettings);
      if (this.semesterStart) {
        const weekLabel = `第 ${this.weekNumber} 周 课程表`;
        rows.unshift({ _rowKey: 'week_title', _isSeparator: true, label: weekLabel });
      }
      return rows;
    },
    activeExportFields() {
      const fields = [{ name: '时段' }, { name: '节次' }, { name: '时间' }];
      this.activeColHeaders.forEach(d => fields.push({ name: d }));
      return fields;
    },
    activeExportRows() {
      return this.buildExportRows(this.activeCells, this.activeSettings);
    },
    weekNumber() {
      if (!this.semesterStart) return '';
      const start = new Date(this.semesterStart);
      const now = new Date();
      const diff = now - start;
      if (diff < 0) return '未开始';
      return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
    }
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
  }
};
</script>