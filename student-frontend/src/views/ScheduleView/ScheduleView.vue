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
              :emptyReady="_activeLoadOk"
              :loadError="activeError"
              errorText="课表加载失败"
              @update:cells="onActiveCellsUpdate"
              @swapRows="onActiveSwapRows"
              @swapColumns="onActiveSwapColumns"
              @update:row-meta="onActiveRowMeta"
              @retry="loadActive"
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
              :emptyReady="_masterLoadOk"
              :loadError="masterError"
              errorText="课表加载失败"
              @update:cells="onMasterCellsUpdate"
              @swapRows="onMasterSwapRows"
              @swapColumns="onMasterSwapColumns"
              @update:row-meta="onMasterRowMeta"
              @retry="loadMaster"
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
              <!-- 表头先行：加载中也渲染 GridView（列头默认周一~周五，快照到了再校正），
                   仅在「加载完且无快照」时才换 EmptySnapshot -->
              <EmptySnapshot v-if="!historyLoading && !historySnapshot" />
              <GridView
                v-else
                :colHeaders="historyColHeaders"
                :title="activeTitle"
                :rows="historySnapshot ? historyDisplayRows : []"
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


<script setup>
import { ref, computed, watch, onMounted, onActivated, getCurrentInstance, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';
import EmptySnapshot from '../../components/base/EmptySnapshot.vue';
import GridView from '../../components/tables/GridView/GridView.vue';
import Tabs from '../../components/base/Tabs.vue';
import WeekSwitcher from '../../components/base/WeekSwitcher.vue';
import { shiftDateStr } from '../../utils/dateTime.js';
import { useNotification } from '../../composables/useNotification.js';
import { useUndoShortcut } from '../../composables/useUndo.js';
import { createRowReuseCache } from '../../utils/rowReuse.js';
import { useScheduleCommon } from './ScheduleView.common.js';
import { useScheduleMaster } from './ScheduleView.master.js';
import { useScheduleActive } from './ScheduleView.active.js';
import { useScheduleHistory } from './ScheduleView.history.js';

defineOptions({ name: 'ScheduleView' })

// 弹窗类组件懒加载：打开时才加载对应 chunk。loader 抽出为命名函数，
// 可用 v-preload="loadXxx" 在悬停按钮时预取，点击时即时弹出。
const loadSettingsDialog = () => import('../../components/dialogs/SettingsDialog.vue');
const SettingsDialog = defineAsyncComponent(loadSettingsDialog);
const ExportExcel = defineAsyncComponent(() => import('../../components/import-export/ExportExcel/ExportExcel.vue'));
const ConfirmDialog = defineAsyncComponent(() => import('../../components/base/ConfirmDialog.vue'));

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

const route = useRoute()
// applyRouteRowFocus 的 host 契约：需要 $route/$router/$el 且对象身份稳定（内部按 host 记签名）
const inst = getCurrentInstance()
const { success: notifySuccess, error: notifyError } = useNotification()

// 行对象复用缓存（非响应式）：编辑一格时只重建真正变化的那一行，避免整表重画
const masterRowReuse = createRowReuseCache();
const activeRowReuse = createRowReuseCache();

// ========== 一般课表 ==========
const masterColHeaders = ref(['周一', '周二', '周三', '周四', '周五'])
const masterCells = ref([])
const masterSettings = ref({
  sections: null,
  periods: [],
  days: ['周一', '周二', '周三', '周四', '周五']
})
const masterSettingsVisible = ref(false)
const masterSettingsMounted = ref(false)
const masterExportVisible = ref(false)
const masterExportMounted = ref(false)

// ========== 实行课表 ==========
const activeColHeaders = ref(['周一', '周二', '周三', '周四', '周五'])
const activeCells = ref([])
const activeSettings = ref({
  sections: null,
  periods: [],
  days: ['周一', '周二', '周三', '周四', '周五']
})
const activeSettingsVisible = ref(false)
const activeSettingsMounted = ref(false)
const activeExportVisible = ref(false)
const activeExportMounted = ref(false)

// ========== 全局 ==========
const semesterStart = ref('')
// 加载状态：_xxInFlight 防重复请求；_xxLoadOk 记录是否成功，供重进页面时补拉失败项
// 驱动表格「加载失败态」（告警 + 重试）。和 _xxLoadOk 的区别：
// 那个是「最近一次拉取是否成功」，这个只在失败时亮起、成功即熄灭，
// 用来区分「还没加载过」和「加载失败了」。
const activeError = ref(false)
const masterError = ref(false)
const activeTab = ref('schedule')
const tabItems = [
  { label: '课程表管理', value: 'schedule' },
  { label: '历史课程表记录', value: 'history' }
]
const historyWeeks = ref([])
const historyCurrentWeek = ref('')
const historySnapshot = ref(null)
const historyCells = ref([])
const historySettings = ref({ sections: null, periods: [], days: ['周一','周二','周三','周四','周五'] })
const historyColHeaders = ref(['周一','周二','周三','周四','周五'])
const historyLoading = ref(false)
// 周切换滑动方向：上一周="prev" 从右滑入，下一周="next" 从左滑入（应用于历史表格）
const slideDir = ref('next')
const deleteSnapshotVisible = ref(false)
const deleteSnapshotMounted = ref(false)
const applyMasterVisible = ref(false)
const applyMasterMounted = ref(false)
const applyActiveVisible = ref(false)
const applyActiveMounted = ref(false)
const courseCandidates = COURSE_CANDIDATES;
// 空态就绪标记（模板绑定；由加载流程置位）
const _activeLoadOk = ref(false)
const _masterLoadOk = ref(false)

// 跨模块共享的上下文：状态为 ref（模块内 .value 访问），临时字段与方法直接挂上；
// 四个 useXxx 的返回方法在下方 Object.assign 回填，模块间经 ctx 互相调用（运行时解析）
const ctx = {
  masterColHeaders, masterCells, masterSettings,
  masterSettingsVisible, masterSettingsMounted, masterExportVisible, masterExportMounted,
  activeColHeaders, activeCells, activeSettings,
  activeSettingsVisible, activeSettingsMounted, activeExportVisible, activeExportMounted,
  semesterStart, activeError, masterError, activeTab,
  historyWeeks, historyCurrentWeek, historySnapshot, historyCells, historySettings, historyColHeaders,
  historyLoading, slideDir,
  deleteSnapshotVisible, deleteSnapshotMounted,
  applyMasterVisible, applyMasterMounted, applyActiveVisible, applyActiveMounted,
  _activeLoadOk, _masterLoadOk,
  // 非响应式实例状态（加载防重 / 串行保存器 / 错误提示去重）
  _activeInFlight: 0,
  _masterInFlight: 0,
  _activeSaver: null,
  _masterSaver: null,
  _activeSaveErrorShown: false,
  _masterSaveErrorShown: false,
  masterRowReuse, activeRowReuse,
  notifySuccess, notifyError,
  host: inst.proxy,
  emit: () => {},
}
const common = useScheduleCommon(ctx, { SECTION_NAMES })
const master = useScheduleMaster(ctx, { API_BASE, DEFAULT_SECTIONS })
const active = useScheduleActive(ctx, { API_BASE, DEFAULT_SECTIONS })
const history = useScheduleHistory(ctx, API_BASE)
Object.assign(ctx, common, master, active, history)

// 供模板调用的顶层绑定
const {
  loadMaster, loadActive, refreshMaster, refreshActive,
  saveMasterSettings, saveActiveSettings, openMasterExport, openActiveExport,
  onMasterCellsUpdate, onActiveCellsUpdate, onMasterRowMeta, onActiveRowMeta,
  applyMasterToActive, applyActiveToMaster,
} = { ...master, ...active }
const {
  captureHistorySnapshot, requestDeleteHistorySnapshot, confirmDeleteHistorySnapshot, onSwitchWeek,
} = history
const { retryFailedLoads, _applyRowFocus } = common

// ---- 一般课表显示行 ----
const masterDisplayRows = computed(() =>
  masterRowReuse(ctx.buildDisplayRows(masterCells.value, masterSettings.value)));
const masterExportFields = computed(() => {
  const fields = [{ name: '行号' }];
  masterColHeaders.value.forEach(h => fields.push({ name: h }));
  return fields;
});
const masterExportRows = computed(() => {
  const headers = masterColHeaders.value;
  const rows = masterDisplayRows.value;
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
});

// ---- 实行课表显示行（顶部自动添加周数标题行） ----
const activeDisplayRows = computed(() =>
  activeRowReuse(ctx.buildDisplayRows(activeCells.value, activeSettings.value)));

const activeExportFields = computed(() => {
  const fields = [{ name: '行号' }];
  // 将当前显示的列头（包括“走廊”）都作为导出列
  activeColHeaders.value.forEach(h => fields.push({ name: h }));
  return fields;
});
const activeExportRows = computed(() => {
  const headers = activeColHeaders.value; // 包含“走廊”的列头数组
  const rows = activeDisplayRows.value;   // 包含讲台行和普通行
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
});
const historyDisplayRows = computed(() => {
  const rows = ctx.buildDisplayRows(historyCells.value, historySettings.value);
  return rows.map(row => ({ ...row, _isReadonly: true }));
});
const weekNumber = computed(() => {
  if (!semesterStart.value) return '';
  const start = new Date(semesterStart.value);
  const now = new Date();
  const diff = now - start;
  if (diff < 0) return '未开始';
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
});
const activeTitle = computed(() =>
  semesterStart.value ? `第 ${weekNumber.value} 周 课程表` : '课程表');
const canDeleteHistorySnapshot = computed(() =>
  !!historyCurrentWeek.value && historyWeeks.value.some(w => w.week_start === historyCurrentWeek.value));
const deleteSnapshotMessage = computed(() => {
  const w = historyCurrentWeek.value;
  if (!w) return '';
  // 日期区间用字符串级偏移：week_start 本身已是 YYYY-MM-DD。
  // 不要绕 new Date + toISOString —— 那是 UTC 口径，UTC 以西的时区会差一天。
  return `确定删除 ${String(w).slice(0, 10)} ~ ${shiftDateStr(w, 6)} 的历史快照吗？删除后不可恢复。`;
});

watch(activeTab, (newTab) => {
  if (newTab === 'history') {
    if (historyWeeks.value.length === 0) {
      ctx.fetchHistoryWeeks();
    } else {
      // 确保当前周存在，若不存在则重载
      if (!historyCurrentWeek.value || !historyWeeks.value.some(w => w.week_start === historyCurrentWeek.value)) {
        if (historyWeeks.value.length > 0) {
          historyCurrentWeek.value = historyWeeks.value[0].week_start;
        }
        ctx.loadHistorySnapshot();
      }
    }
  }
})
// 跨页定位：/schedule?focus=s:节次:周几（s=实行课表，m=一般课表）→ 切到课程表页签并高亮该格
watch(() => route.query.focus, () => { _applyRowFocus() })
// 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
watch(masterSettingsVisible, (n) => { if (n) masterSettingsMounted.value = true })
watch(masterExportVisible, (n) => { if (n) masterExportMounted.value = true })
watch(activeSettingsVisible, (n) => { if (n) activeSettingsMounted.value = true })
watch(activeExportVisible, (n) => { if (n) activeExportMounted.value = true })
watch(deleteSnapshotVisible, (n) => { if (n) deleteSnapshotMounted.value = true })
watch(applyMasterVisible, (n) => { if (n) applyMasterMounted.value = true })
watch(applyActiveVisible, (n) => { if (n) applyActiveMounted.value = true })

// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销/重做课表（当前页，含实行+一般两张表）
useUndoShortcut('课程表', {
  onAfterUndo: async (label) => { await Promise.all([ctx.loadMaster(), ctx.loadActive()]); notifySuccess(label ? `已撤销：${label}` : '已撤销') },
  onAfterRedo: async (label) => { await Promise.all([ctx.loadMaster(), ctx.loadActive()]); notifySuccess(label ? `已重做：${label}` : '已重做') }
})

onMounted(() => {
  loadMaster();
  loadActive();
  ctx.fetchHistoryWeeks();
  _applyRowFocus();
})
onActivated(() => {
  _applyRowFocus();
  // KeepAlive 缓存：再次进入页面时补拉上次失败的表，避免一次失败后长期空白
  retryFailedLoads();
})
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
