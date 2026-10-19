<template>
  <div>
    <!-- 顶部标题栏 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="schedule" /> 课程表</h1>
    </div>

    <!-- 标签切换 -->
    <Tabs :tabs="tabItems" v-model="activeTab">
      <template #default="{ activeTab }">
        <!-- ==================== 课程表管理标签页 ==================== -->
        <div v-if="activeTab === 'schedule'">
          <!-- 实行课表（临时） -->
          <section class="mb-10">
            <h2 class="text-xl font-semibold mb-4">📅 实行课表（临时）</h2>
            <div class="mb-4 flex items-center gap-3 opbar">
              <button @click="activeSettingsVisible = true" v-preload="loadSettingsDialog" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
              <button @click="refreshActive" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
              <button @click="applyMasterVisible = true" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="upload" :size="14" tint="current" /> 从模板导入</button>
              <button @click="openActiveExport" class="bg-warning text-text-inverse px-4 py-2 rounded">📥 导出 Excel</button>
            </div>

            <GridView
              :title="activeTitle"
              :anchorPrefix="'s'"
              :colHeaders="activeColHeaders"
              :rows="activeDisplayRows"
              :showPeriodColumn="true"
              :enableCandidate="true"
              :candidateItems="courseCandidates"
              candidateLabelField="label"
              candidatePlaceholder="输入科目"
              :allowDuplicate="true"
              @update:cells="onActiveCellsUpdate"
              @swapRows="onActiveSwapRows"
              @swapColumns="onActiveSwapColumns"
              @update:row-meta="onActiveRowMeta"
            />

            <SettingsDialog
              v-if="activeSettingsMounted"
              :visible="activeSettingsVisible"
              :settings="activeSettings"
              :semesterStart="semesterStart"
              :showSemesterStart="true"
              @save="saveActiveSettings"
              @cancel="activeSettingsVisible = false"
              @update:semesterStart="semesterStart = $event"
            />

            <ExportExcel
              v-if="activeExportMounted"
              :is-visible="activeExportVisible"
              :rows="activeExportRows"
              :fields="activeExportFields"
              defaultFilename="实行课表"
              @export-finish="() => {}"
              @update:is-visible="activeExportVisible = $event"
            />
          </section>

          <!-- 分隔 -->
          <div class="mb-4"></div>

          <!-- 一般课表（模板） -->
          <section>
            <h2 class="text-xl font-semibold mb-4 flex items-center gap-2"><IconGlyph name="clipboard" :size="20" /> 一般课表（模板）</h2>
            <div class="mb-4 flex items-center gap-3 opbar">
              <button @click="masterSettingsVisible = true" v-preload="loadSettingsDialog" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
              <button @click="refreshMaster" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
              <button @click="applyActiveVisible = true" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="upload" :size="14" tint="current" /> 从实行导入</button>
              <button @click="openMasterExport" class="bg-warning text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> 导出 Excel</button>
            </div>

            <GridView
              :anchorPrefix="'m'"
              :colHeaders="masterColHeaders"
              :rows="masterDisplayRows"
              :showPeriodColumn="true"
              :enableCandidate="true"
              :candidateItems="courseCandidates"
              candidateLabelField="label"
              candidatePlaceholder="输入科目"
              :allowDuplicate="true"
              @update:cells="onMasterCellsUpdate"
              @swapRows="onMasterSwapRows"
              @swapColumns="onMasterSwapColumns"
              @update:row-meta="onMasterRowMeta"
            />

            <SettingsDialog
              v-if="masterSettingsMounted"
              :visible="masterSettingsVisible"
              :settings="masterSettings"
              :semesterStart="''"
              :showSemesterStart="false"
              @save="saveMasterSettings"
              @cancel="masterSettingsVisible = false"
              @update:semesterStart="() => {}"
            />

            <ExportExcel
              v-if="masterExportMounted"
              :is-visible="masterExportVisible"
              :rows="masterExportRows"
              :fields="masterExportFields"
              defaultFilename="一般课表"
              @export-finish="() => {}"
              @update:is-visible="masterExportVisible = $event"
            />
          </section>
        </div>

        <!-- ==================== 历史课程表记录标签页（占位） ==================== -->
        <div v-else-if="activeTab === 'history'" class="relative">
          <Transition :name="slideDir">
            <div :key="historyCurrentWeek" class="history-content">
              <div v-if="historyLoading" class="skeleton-block"></div>
              <EmptySnapshot v-else-if="!historySnapshot" />
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
            </div>
          </Transition>
          <!-- 快照菜单栏：周切换 + 下拉框 + 保存/删除按钮，同处一条毛玻璃栏 -->
          <WeekSwitcher
            v-model:currentWeek="historyCurrentWeek"
            :weeks="historyWeeks"
            @update:currentWeek="loadHistorySnapshot"
            @direction="onSwitchWeek"
          >
            <template #actions>
              <button
                @click="captureHistorySnapshot"
                class="bg-primary text-text-inverse px-3 py-1.5 rounded whitespace-nowrap cursor-pointer"
              >📸 保存本周快照</button>
              <button
                @click="requestDeleteHistorySnapshot"
                :disabled="!canDeleteHistorySnapshot"
                class="bg-danger text-text-inverse px-3 py-1.5 rounded whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >🗑 删除本周快照</button>
            </template>
          </WeekSwitcher>
        </div>
      </template>
    </Tabs>

    <!-- 删除历史快照确认弹窗 -->
    <ConfirmDialog
      v-if="deleteSnapshotMounted"
      :visible="deleteSnapshotVisible"
      title="删除历史快照"
      :message="deleteSnapshotMessage"
      type="confirm"
      :showCancel="true"
      confirmText="删除"
      @confirm="confirmDeleteHistorySnapshot"
      @cancel="deleteSnapshotVisible = false"
    />

    <!-- 从模板导入确认弹窗 -->
    <ConfirmDialog
      v-if="applyMasterMounted"
      :visible="applyMasterVisible"
      title="从模板导入"
      message="确定将一般课表覆盖到实行课表吗？"
      type="confirm"
      :showCancel="true"
      confirmText="确定导入"
      @confirm="applyMasterToActive"
      @cancel="applyMasterVisible = false"
    />

    <!-- 从实行导入确认弹窗 -->
    <ConfirmDialog
      v-if="applyActiveMounted"
      :visible="applyActiveVisible"
      title="从实行导入"
      message="确定将实行课表覆盖到一般课表吗？"
      type="confirm"
      :showCancel="true"
      confirmText="确定导入"
      @confirm="applyActiveToMaster"
      @cancel="applyActiveVisible = false"
    />
  </div>
</template>


<script>
import axios from 'axios';
import { getCurrentInstance, defineAsyncComponent } from 'vue';
import EmptySnapshot from '../components/base/EmptySnapshot.vue';
import GridView from '../components/tables/GridView/GridView.vue';
import Tabs from '../components/base/Tabs.vue';
import WeekSwitcher from '../components/base/WeekSwitcher.vue';
import { useNotification } from '../composables/useNotification.js';
import { useUndoShortcut, recordGridCellUndo, recordGridSnapshotUndo } from '../composables/useUndo.js';
import { createRowReuseCache } from '../utils/rowReuse.js';
import { applyRouteRowFocus } from '../composables/useRowFocus.js';

// 弹窗类组件懒加载：打开时才加载对应 chunk。loader 抽出为命名函数，
// 可用 v-preload="loadXxx" 在悬停按钮时预取，点击时即时弹出。
const loadSettingsDialog = () => import('../components/dialogs/SettingsDialog.vue');
const SettingsDialog = defineAsyncComponent(loadSettingsDialog);
const ExportExcel = defineAsyncComponent(() => import('../components/import-export/ExportExcel/ExportExcel.vue'));
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'));

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

const COURSE_CANDIDATES = [
  '语文', '数学', '英语', '物理', '化学', '生物',
  '历史', '政治', '地理', '体育', '信息', '音乐', '美术', '班会'
].map((name, idx) => ({ id: idx, label: name, value: name }));

export default {
  name: 'ScheduleView',
  components: { GridView, SettingsDialog, ExportExcel,Tabs,WeekSwitcher,EmptySnapshot, ConfirmDialog },
  setup() {
    const { success, error } = useNotification()
    const inst = getCurrentInstance()
    // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销/重做课表（当前页，含实行+一般两张表）
    useUndoShortcut('课程表', {
      onAfterUndo: async (label) => { await Promise.all([inst.proxy.loadMaster(), inst.proxy.loadActive()]); success(label ? `已撤销：${label}` : '已撤销') },
      onAfterRedo: async (label) => { await Promise.all([inst.proxy.loadMaster(), inst.proxy.loadActive()]); success(label ? `已重做：${label}` : '已重做') }
    })
    // loadSettingsDialog 一并暴露：v-preload 的绑值在渲染函数里求值，模块作用域的加载器不挂实例会告警
    return { notifySuccess: success, notifyError: error, loadSettingsDialog }
  },
  data() {
    return {
      // 行对象复用缓存（非响应式实例状态）：编辑一格时只重建真正变化的那一行，避免整表重画
      masterRowReuse: createRowReuseCache(),
      activeRowReuse: createRowReuseCache(),
      // ========== 一般课表 ==========
      masterColHeaders: ['周一', '周二', '周三', '周四', '周五'],
      masterCells: [],
      masterSettings: {
        sections: null,
        periods: [],
        days: ['周一', '周二', '周三', '周四', '周五']
      },
      masterSettingsVisible: false,
      masterSettingsMounted: false,
      masterExportVisible: false,
      masterExportMounted: false,

      // ========== 实行课表 ==========
      activeColHeaders: ['周一', '周二', '周三', '周四', '周五'],
      activeCells: [],
      activeSettings: {
        sections: null,
        periods: [],
        days: ['周一', '周二', '周三', '周四', '周五']
      },
      activeSettingsVisible: false,
      activeSettingsMounted: false,
      activeExportVisible: false,
      activeExportMounted: false,

      // ========== 全局 ==========
      semesterStart: '',
      loaded: false,
      // 加载状态：_xxInFlight 防重复请求；_xxLoadOk 记录是否成功，供重进页面时补拉失败项
      _activeInFlight: 0,
      _activeLoadOk: false,
      _masterInFlight: 0,
      _masterLoadOk: false,
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
      // 周切换滑动方向：上一周="prev" 从右滑入，下一周="next" 从左滑入（应用于历史表格）
      slideDir: 'next',
      deleteSnapshotVisible: false,
      deleteSnapshotMounted: false,
      applyMasterVisible: false,
      applyMasterMounted: false,
      applyActiveVisible: false,
      applyActiveMounted: false,
      courseCandidates: COURSE_CANDIDATES,
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
    },
    // 跨页定位：/schedule?focus=s:节次:周几（s=实行课表，m=一般课表）→ 切到课程表页签并高亮该格
    '$route.query.focus'() { this._applyRowFocus() },
    // 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
    masterSettingsVisible(n) { if (n) this.masterSettingsMounted = true },
    masterExportVisible(n) { if (n) this.masterExportMounted = true },
    activeSettingsVisible(n) { if (n) this.activeSettingsMounted = true },
    activeExportVisible(n) { if (n) this.activeExportMounted = true },
    deleteSnapshotVisible(n) { if (n) this.deleteSnapshotMounted = true },
    applyMasterVisible(n) { if (n) this.applyMasterMounted = true },
    applyActiveVisible(n) { if (n) this.applyActiveMounted = true }
  },
  computed: {
    // ---- 一般课表显示行 ----
    masterDisplayRows() {
      return this.masterRowReuse(this.buildDisplayRows(this.masterCells, this.masterSettings));
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
      return this.activeRowReuse(this.buildDisplayRows(this.activeCells, this.activeSettings));
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
    canDeleteHistorySnapshot() {
      return !!this.historyCurrentWeek && this.historyWeeks.some(w => w.week_start === this.historyCurrentWeek);
    },
    deleteSnapshotMessage() {
      const w = this.historyCurrentWeek;
      if (!w) return '';
      const start = new Date(w);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return `确定删除 ${start.toISOString().slice(0, 10)} ~ ${end.toISOString().slice(0, 10)} 的历史快照吗？删除后不可恢复。`;
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

    // 重进页面（KeepAlive activated）时只补拉「上次失败」的表；
    // 已加载成功的表不再重复请求，保持原有行为，避免多余往返
    retryFailedLoads() {
      if (!this._activeLoadOk && !this._activeInFlight) this.loadActive();
      if (!this._masterLoadOk && !this._masterInFlight) this.loadMaster();
    },

    // 课表单元格里是否有实际课程内容（行结构始终存在，不能用行数判空）
    _applyRowFocus() {
      applyRouteRowFocus(this, {
        parse: (key) => {
          if (!/^[sm]:\d+:\d+$/.test(key)) return null
          if (this.activeTab !== 'schedule') this.activeTab = 'schedule'
          return key
        },
      })
    },
    hasScheduleData(cells) {
      return (cells || []).some(row => Array.isArray(row) && row.some(c => {
        const v = typeof c === 'string' ? c : (c && c.course)
        return String(v || '').trim() !== ''
      }))
    },
    // 导出课表：无数据时直接提示，不弹导出选项弹窗
    openActiveExport() {
      if (!this.hasScheduleData(this.activeCells)) return useNotification().info('暂无课表数据可导出')
      this.activeExportVisible = true
    },
    openMasterExport() {
      if (!this.hasScheduleData(this.masterCells)) return useNotification().info('课表模板为空，无法导出')
      this.masterExportVisible = true
    },
    // ============= 一般课表操作 =============
    async refreshMaster() {
      try {
        await this.loadMaster()
        if (this._masterLoadOk) this.notifySuccess('已刷新课程表模板')
      } catch (e) { /* 错误已在 loadMaster 内部处理 */ }
    },
    async loadMaster() {
      this._masterInFlight = (this._masterInFlight || 0) + 1;
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
        this._masterLoadOk = true;
      } catch (e) {
        // 加载失败不再静默：留标记供重进页面时补拉，并给出提示
        this._masterLoadOk = false;
        this.notifyError('一般课表加载失败，请稍后重试');
        console.error(e);
      } finally {
        this._masterInFlight = (this._masterInFlight || 1) - 1;
      }
    },
    async saveMaster() {
      await axios.put(`${API_BASE}/schedule/master`, {
        cells: this.masterCells,
        settings: this.masterSettings
      });
    },
    // 对比前后网格，逐格写入撤销记录（课表存 {course} 对象，只需比对 course 文本）
    recordCellsDiff(table, prev, next) {
      const maxR = Math.max(prev.length, next.length)
      for (let r = 0; r < maxR; r++) {
        const pr = prev[r] || [], nr = next[r] || []
        const maxC = Math.max(pr.length, nr.length)
        for (let c = 0; c < maxC; c++) {
          const a = pr[c], b = nr[c]
          const av = a && a.course !== undefined ? a.course : a
          const bv = b && b.course !== undefined ? b.course : b
          if (String(av ?? '') !== String(bv ?? '')) {
            recordGridCellUndo('课程表', table, r, c, a ?? null, b ?? null)
          }
        }
      }
    },
    onMasterCellsUpdate(newRows) {
      const prev = this.masterCells.map(r => [...r]);
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
      this.recordCellsDiff('master_schedule', prev, this.masterCells);
      this.saveMaster();
    },
    onMasterSwapRows(fromIdx, toIdx) {
      const rows = this.masterDisplayRows.filter(r => !r._isSeparator && !r._mergeCells);
      const fromRow = rows[fromIdx], toRow = rows[toIdx];
      if (!fromRow || !toRow || fromRow._isReadonly || toRow._isReadonly) return;
      const fromLessonIdx = fromRow._lessonIdx, toLessonIdx = toRow._lessonIdx;
      if (fromLessonIdx === undefined || toLessonIdx === undefined) return;
      const prev = JSON.parse(JSON.stringify(this.masterCells));
      // 移动语义：同上
      const newCells = [...this.masterCells];
      const [movedRow] = newCells.splice(fromLessonIdx, 1);
      newCells.splice(toLessonIdx, 0, movedRow);
      this.masterCells = newCells;
      recordGridSnapshotUndo('课程表', 'master_schedule', prev, JSON.parse(JSON.stringify(newCells)), `交换行：${fromRow.label} ↔ ${toRow.label}`);
      this.saveMaster();
    },
    onMasterSwapColumns(fromIdx, toIdx) {
      if (fromIdx === toIdx) return;
      const fromHeader = this.masterColHeaders[fromIdx] ?? `列${fromIdx + 1}`, toHeader = this.masterColHeaders[toIdx] ?? `列${toIdx + 1}`;
      const prev = JSON.parse(JSON.stringify(this.masterCells));
      // 移动语义：同 active 表（表头固定，只移动数据列）
      const newCells = this.masterCells.map(row => {
        const r = [...row];
        const [m] = r.splice(fromIdx, 1);
        r.splice(toIdx, 0, m);
        return r;
      });
      this.masterCells = newCells;
      recordGridSnapshotUndo('课程表', 'master_schedule', prev, JSON.parse(JSON.stringify(newCells)), `交换列：${fromHeader} ↔ ${toHeader}`);
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
      try {
        const before = JSON.parse(JSON.stringify(this.activeCells));
        await axios.post(`${API_BASE}/schedule/apply-master`);
        this.applyMasterVisible = false;
        this.notifySuccess('已应用');
        await this.loadActive();
        recordGridSnapshotUndo('课程表', 'schedule', before, JSON.parse(JSON.stringify(this.activeCells)), '从模板导入');
      } catch (e) {
        this.notifyError('应用失败');
      }
    },
    // 反向：把实行课表整块导入到一般课表（纯前端复制，无后端接口）
    async applyActiveToMaster() {
      try {
        const before = JSON.parse(JSON.stringify(this.masterCells));
        this.masterCells = JSON.parse(JSON.stringify(this.activeCells));
        this.masterSettings = JSON.parse(JSON.stringify(this.activeSettings));
        this.masterColHeaders = [...this.activeColHeaders];
        this.applyActiveVisible = false;
        await this.saveMaster();
        recordGridSnapshotUndo('课程表', 'master_schedule', before, JSON.parse(JSON.stringify(this.masterCells)), '从实行导入');
        this.notifySuccess('已从实行课表导入');
      } catch (e) {
        this.notifyError('导入失败');
      }
    },

    // ============= 实行课表操作 =============
    async refreshActive() {
      try {
        await this.loadActive()
        if (this._activeLoadOk) this.notifySuccess('已刷新实行课表')
      } catch (e) { /* 错误已在 loadActive 内部处理 */ }
    },
    async loadActive() {
      this._activeInFlight = (this._activeInFlight || 0) + 1;
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

        // 加载学期开始日期（单独兜底：失败不影响课表本身的加载判定）
        try {
          const setRes = await axios.get(`${API_BASE}/schedule/settings`);
          this.semesterStart = setRes.data?.semester_start || '';
        } catch (e) { console.error(e); }

        this._activeLoadOk = true;
      } catch (e) {
        // 加载失败不再静默：留标记供重进页面时补拉，并给出提示
        this._activeLoadOk = false;
        this.notifyError('实行课表加载失败，请稍后重试');
        console.error(e);
      } finally {
        this._activeInFlight = (this._activeInFlight || 1) - 1;
      }
    },
    async saveActive() {
      await axios.put(`${API_BASE}/schedule`, {
        cells: this.activeCells,
        settings: this.activeSettings
      });
    },
    onActiveCellsUpdate(newRows) {
      const prev = this.activeCells.map(r => [...r]);
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
      this.recordCellsDiff('schedule', prev, this.activeCells);
      this.saveActive();
    },
    onActiveSwapRows(fromIdx, toIdx) {
      const rows = this.activeDisplayRows.filter(r => !r._isSeparator && !r._mergeCells);
      const fromRow = rows[fromIdx], toRow = rows[toIdx];
      if (!fromRow || !toRow || fromRow._isReadonly || toRow._isReadonly) return;
      const fromLessonIdx = fromRow._lessonIdx, toLessonIdx = toRow._lessonIdx;
      if (fromLessonIdx === undefined || toLessonIdx === undefined) return;
      const prev = JSON.parse(JSON.stringify(this.activeCells));
      // 移动语义：与拖动时的让位预览一致（取出源行插入目标位置，中间行顺移）
      const newCells = [...this.activeCells];
      const [movedRow] = newCells.splice(fromLessonIdx, 1);
      newCells.splice(toLessonIdx, 0, movedRow);
      this.activeCells = newCells;
      recordGridSnapshotUndo('课程表', 'schedule', prev, JSON.parse(JSON.stringify(newCells)), `交换行：${fromRow.label} ↔ ${toRow.label}`);
      this.saveActive();
    },
    onActiveSwapColumns(fromIdx, toIdx) {
      if (fromIdx === toIdx) return;
      const fromHeader = this.activeColHeaders[fromIdx] ?? `列${fromIdx + 1}`, toHeader = this.activeColHeaders[toIdx] ?? `列${toIdx + 1}`;
      const prev = JSON.parse(JSON.stringify(this.activeCells));
      // 移动语义：取出源列插入目标位置，中间列的数据顺移（表头固定）
      const newCells = this.activeCells.map(row => {
        const r = [...row];
        const [m] = r.splice(fromIdx, 1);
        r.splice(toIdx, 0, m);
        return r;
      });
      this.activeCells = newCells;
      recordGridSnapshotUndo('课程表', 'schedule', prev, JSON.parse(JSON.stringify(newCells)), `交换列：${fromHeader} ↔ ${toHeader}`);
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
        this.notifySuccess('本周快照已保存');
        await this.fetchHistoryWeeks();
      } catch (e) { this.notifyError('保存失败'); console.error(e); }
    },
    requestDeleteHistorySnapshot() {
      if (!this.canDeleteHistorySnapshot) return;
      this.deleteSnapshotVisible = true;
    },
    onSwitchWeek(dir) {
      this.slideDir = dir;
    },
    async confirmDeleteHistorySnapshot() {
      this.deleteSnapshotVisible = false;
      const week = this.historyCurrentWeek;
      if (!week) return;
      try {
        await axios.delete(`${API_BASE}/schedule/history/${week}`);
        this.notifySuccess('该周快照已删除');
        if (this.historyCurrentWeek === week) this.historySnapshot = null;
        await this.fetchHistoryWeeks();
      } catch (e) { alert('删除失败'); console.error(e); }
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
    this._applyRowFocus();
  },
  activated() {
    this._applyRowFocus();
    // KeepAlive 缓存：再次进入页面时补拉上次失败的表，避免一次失败后长期空白
    this.retryFailedLoads();
  }
};
</script>

<style scoped>
/* 历史表格周切换滑动动画：新旧表同向并行滑动（推拉感），不影响 WeekSwitcher */
.history-content { width: 100%; }
.next-enter-active, .next-leave-active,
.prev-enter-active, .prev-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
/* 退场表绝对定位到容器顶部，与进场表重叠实现并行滑动 */
.next-leave-active, .prev-leave-active {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}
/* 下一周：向右推进（新表从左侧跟进向右移动，旧表向右滑出，同方向） */
.next-enter-from { transform: translateX(-60px); opacity: 0; }
.next-leave-to   { transform: translateX(60px); opacity: 0; }
/* 上一周：向左推进（新表从右侧跟进向左移动，旧表向左滑出，同方向） */
.prev-enter-from { transform: translateX(60px); opacity: 0; }
.prev-leave-to   { transform: translateX(-60px); opacity: 0; }
</style>