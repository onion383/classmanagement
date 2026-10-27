<template>
  <div class="grid-view-container" ref="gridContainer" :style="{ minHeight: rows.length ? 'auto' : minTableHeight + 'px', position: 'relative' }">
    <!--
      内层滚动容器：加 maxHeight 后内容超高即在此内部纵向滚动，不再把外层页面顶长。
      scrollbar-gutter 仅在真正超高时预留滚动条槽位，避免「滚动条出现/消失」引起列宽抖动。
      拖拽的边缘自动滚动（createEdgeAutoScroll）本就取这个元素作滚动容器，
      加了高度上限后它才真正可滚，拖到边缘会自动翻行。
    -->
    <div
      ref="gridTable"
      class="overflow-auto border rounded"
      :class="{ 'scrollbar-gutter-stable': vScroll }"
      :style="maxHeight > 0 ? { maxHeight: maxHeight + 'px' } : null"
    >
      <!-- 空态：**网状表不再显示**。
           课表 / 值日 / 座位这类表的「空」本身就是一张待填的网格 —— 有行列结构、
           格子能直接双击填，再盖一层「还没有数据 + 按钮」只会把这条路挡住，
           用户还得先点个按钮才能开始填。空表自己就是最好的指示。
           （列表型表格 DynamicTable 不适用这条：那边空表就是一片空白，必须给空态。）
           加载失败态保留 —— 它承载的信息空表给不了：到底是没数据还是没加载出来。 -->
      <div
        v-if="loadError"
        class="grid-empty grid-error"
        :style="{ minHeight: Math.max(0, minTableHeight - 2) + 'px' }"
      >
        <svg class="grid-empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M24 8 4 42h40L24 8Z" stroke-linejoin="round" opacity="0.75" />
          <path d="M24 20v10" stroke-linecap="round" />
          <circle cx="24" cy="36" r="1.6" fill="currentColor" stroke="none" />
        </svg>
        <p class="grid-empty-text">{{ errorText }}</p>
        <button type="button" class="grid-empty-btn" @click="$emit('retry')">重试</button>
      </div>

      <!-- 判定中（数据还没就绪）：只留同高静默占位，**不渲染表头**。
           课表 / 值日 / 座位的 rows 是「结构行」（按节次、劳动项目、座位行数生成），
           数据没回来时 rows 是空数组 —— 此时若直接渲染表格，就只有一排表头没有内容，
           数据到达后再变成满表，形成「表头先空着 → 突然长满」的跳变。
           所以先判定、再决定画占位还是画表格：表头要么一直有、要么一直不出现。
           minHeight 减 2 是为了抵掉外层容器上下各 1px 边框。 -->
      <div
        v-else-if="!emptyReady"
        class="grid-empty-pending"
        :style="{ minHeight: Math.max(0, minTableHeight - 2) + 'px' }"
        aria-hidden="true"
      ></div>

      <table v-else class="w-full border-collapse select-none">
        <thead>
          <!--
            标题行：只在有 title 时存在（课表在用）。它与下面的列头行都在 thead 里，
            两行都吸顶时必须错开 top，否则会叠在一起 —— 标题行 top:0、列头行 top 用
            --grid-title-h（由 measureScrollState 量出的标题行实际高度，见样式）。
          -->
          <tr v-if="title">
            <th :colspan="totalColumns" class="bg-primary text-text-inverse text-center py-2 text-lg font-bold grid-head-title">{{ title }}</th>
          </tr>
          <tr>
            <th v-if="showPeriodColumn && !hideMetaColumns" class="bg-primary text-text-inverse border border-border px-2 py-1 text-center" style="width: 80px;">时段</th>
            <th v-if="!hideMetaColumns" class="bg-primary text-text-inverse border border-border px-2 py-1 text-center" style="width: 100px;">节次</th>
            <th v-if="!hideMetaColumns" class="bg-primary text-text-inverse border border-border px-2 py-1 text-center" style="width: 130px;">时间</th>
            <th v-if="hideMetaColumns && showRowNumber" class="bg-primary text-text-inverse border border-border px-2 py-1 text-center" style="width: 110px;">{{ rowHeaderLabel }}</th>
            <th
              v-for="(col, colIdx) in colHeaders"
              :key="colIdx"
              :class="['bg-primary text-text-inverse border border-border px-2 py-1 text-center', col !== '走廊' ? 'cursor-pointer' : 'cursor-default bg-text-muted', { 'dt-col-src-hidden': colDragIdx === colIdx }]"
              :style="col === '走廊' ? 'width: 60px;' : ''"
            >
              <div v-if="col !== '走廊'" class="flex items-center justify-center gap-1">
                <span class="drag-handle cursor-grab text-text-inverse/70 hover:text-text-inverse" title="按住拖动列" @mousedown.prevent.stop="onColHandleDown($event, colIdx)" @contextmenu.stop.prevent>⠿</span>
                <span>{{ col }}</span>
              </div>
              <span v-else class="text-base text-text">走廊</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <!--
            行过渡容器只在「行的集合真正变化」的短窗口内（新增/删除行、数据初载）才是 TransitionGroup，
            其余时候退化成 Fragment。

            为什么必须这样分：Vue 的 TransitionGroup 在**每次更新**里都会对 prevChildren 逐个
            getBoundingClientRect()，并在 onUpdated 里 cloneNode → appendChild → getComputedStyle
            → removeChild 去探测 move 过渡。这两步都是「写 DOM 之后立刻读布局」，会强制同步样式重算 + 布局。
            而这些开销在「编辑一格、编辑态键入、Esc、框选、弹窗开合」等日常操作里毫无收益——
            行没增没减，Enter/Leave 动画本来就不会播。退化成 Fragment 后 TransitionGroup 的
            setup/hooks 完全不执行，强制布局随之消失（与 DynamicTable 同款处理）。
            行入场/离场的观感不变：CSS 类仍挂在 <tr> 上（.row-flip-*），只是容器按需切换。
          -->
          <component :is="rowsWrapper" :name="rowsAnimEnabled ? 'row-flip' : undefined" tag="">
            <tr
              v-for="(row, rowIdx) in rows"
              :key="row._rowKey || rowIdx"
              :class="[{ 'opacity-30': rowDragIdx === rowIdx, 'content-visibility-auto': true }, row._isSeparator ? 'bg-border h-8' : '', row._isPodium ? 'bg-warning/20 h-10' : '']"
            >
              <!-- 讲台行 -->
              <template v-if="row._isPodium">
                <td v-if="hideMetaColumns && showRowNumber" class="bg-primary text-text-inverse border border-border text-center text-sm font-bold py-2" style="width: 70px;">讲台</td>
                <td :colspan="totalColumns - (hideMetaColumns && showRowNumber ? 1 : 0)" class="text-center font-bold text-text py-3 bg-warning/30 border-b-2 border-warning/50 text-lg">讲  台</td>
              </template>
              <!-- 分隔行 -->
              <td v-else-if="row._isSeparator" :colspan="totalColumns" class="text-center font-bold text-text-secondary py-2 bg-info/10 border-b-2 border-info/30">{{ row.label }}</td>
              <!-- 合并行 -->
              <td v-else-if="row._mergeCells" :colspan="totalColumns" class="border border-border px-2 py-1 text-center bg-surface-hover text-sm font-semibold">{{ row.label }} {{ row.time }}</td>
              <!-- 普通行 -->
              <template v-else>
                <td v-if="showPeriodColumn && !hideMetaColumns && row._periodRowSpan > 0" :rowspan="row._periodRowSpan" class="bg-primary/10 border border-border px-2 py-1 text-center font-bold align-middle" style="vertical-align: middle;">{{ row.periodLabel }}</td>
                <td v-else-if="showPeriodColumn && !hideMetaColumns" class="hidden"></td>

                <td v-if="!hideMetaColumns" class="bg-primary text-text-inverse border border-border px-2 py-1 text-center font-bold" style="width: 100px;">
                  <div class="flex items-center justify-center gap-1">
                    <span v-if="canDragRow(row)" class="drag-handle select-none text-text-inverse/70"
                    :class="rowDragLocked ? 'cursor-not-allowed' : 'cursor-grab hover:text-text-inverse'"
                    :style="rowDragLocked ? 'opacity: 0.3;' : ''"
                    :title="rowDragLocked ? '编辑中，暂不可拖动' : '按住拖动行'"
                    @mousedown.prevent.stop="onRowHandleDown($event, rowIdx)" @contextmenu.stop.prevent>⠿</span>
                    <span @dblclick.stop="startEditMeta(rowIdx, 'label')">
                      <input v-if="editingMeta && editingMeta.row === rowIdx && editingMeta.field === 'label'" v-model="editingMetaValue" class="w-20 border border-border p-0 text-sm text-text" @keyup.enter="saveEditMeta(rowIdx)" @blur="saveEditMeta(rowIdx)" @mousedown.stop />
                      <span v-else>{{ row.label }}</span>
                    </span>
                  </div>
                </td>
                <td v-if="!hideMetaColumns" class="border border-border px-2 py-1 text-center text-sm" style="width: 130px;" @dblclick.stop="startEditMeta(rowIdx, 'time')">
                  <input v-if="editingMeta && editingMeta.row === rowIdx && editingMeta.field === 'time'" v-model="editingMetaValue" class="w-28 border p-0 text-sm" @keyup.enter="saveEditMeta(rowIdx)" @blur="saveEditMeta(rowIdx)" @mousedown.stop />
                  <span v-else>{{ row.time || '' }}</span>
                </td>

                <!-- 行号列（绿色背景；首子行跨行合并居中显示分组名，可拖拽排序） -->
                <td v-if="hideMetaColumns && showRowNumber && row._rowHeaderRowSpan !== 0" class="bg-primary text-text-inverse border border-border text-center text-sm font-bold align-middle" style="width: 110px; vertical-align: middle;" :rowspan="row._rowHeaderRowSpan > 0 ? row._rowHeaderRowSpan : undefined">
                  <div class="flex items-center justify-center gap-1">
                    <span v-if="!disableRowDrag && row._rowHeaderRowSpan !== 0 && canDragRow(row)" class="drag-handle select-none text-text-inverse/70"
                    :class="rowDragLocked ? 'cursor-not-allowed' : 'cursor-grab hover:text-text-inverse'"
                    :style="rowDragLocked ? 'opacity: 0.3;' : ''"
                    :title="rowDragLocked ? '编辑中，暂不可拖动' : '按住拖动行'"
                    @mousedown.prevent.stop="onRowHandleDown($event, rowIdx)" @contextmenu.stop.prevent>⠿</span>
                    <span>{{ row.label }}</span>
                  </div>
                </td>
                <td v-else-if="hideMetaColumns && showRowNumber" class="hidden"></td>

                <!-- 数据单元格 -->
                <template v-for="(cell, colIdx) in row.cells" :key="colIdx">
                  <td v-if="cell._isAisle && cell._aisleRowSpan" :rowspan="cell._aisleRowSpan" :data-col-idx="colIdx" class="border border-border bg-text-muted text-center align-middle" style="width: 60px; vertical-align: middle; font-size: 1.125rem; line-height: 1.2;">
                     <div style="writing-mode: vertical-lr; text-orientation: upright; display: inline-block;">走廊</div></td>
                  <td v-else-if="cell._isAisleHidden" style="display: none;"></td>
                  <td
                    v-else
                    :data-row-id="anchorPrefix && row._lessonIdx != null ? anchorPrefix + ':' + row._lessonIdx + ':' + colIdx : undefined"
                    :ref="el => setCellRef(rowIdx, colIdx, el)"
                    :class="['border border-border px-2 py-2 text-center transition-colors relative', colDragIdx === colIdx ? 'dt-col-src-hidden' : '', isDragTarget(rowIdx, colIdx) ? 'bg-info/10 outline outline-2 outline-info' : '', isCellSelected(rowIdx, colIdx) && !isEditing(rowIdx, colIdx) ? 'bg-info/10 outline outline-2 outline-info' : '', isEditing(rowIdx, colIdx) ? 'ring-2 ring-info ring-inset' : '', row._isReadonly ? '' : 'cursor-pointer', cell._bg != null ? 'cell-heat' : '', isEditing(rowIdx, colIdx) ? 'cell-editing' : '']"
                    :style="{
                      '--cell-heat-bg': cell._bg != null ? cell._bg : undefined,
                      '--cell-heat-fg': cell._fg != null ? cell._fg : undefined,
                      backgroundColor: isEditing(rowIdx, colIdx) ? '' : getCellColor(cell),
                      color: isEditing(rowIdx, colIdx) ? '#000' : getCellTextColor(cell),
                      height: '40px', minHeight: '40px'
                    }"
                    @mousedown="onCellMouseDown($event, rowIdx, colIdx)"
                    @mouseenter="onCellMouseEnter(rowIdx, colIdx)"
                    @dblclick="onCellDoubleClick($event, rowIdx, colIdx)"
                  >
                    <div v-if="isEditing(rowIdx, colIdx)" class="absolute inset-0 flex items-center justify-center">
                      <input
                        v-model="editingCellData.course"
                        class="w-full h-full text-center text-sm bg-transparent outline-none border-none m-0 p-0"
                        style="box-sizing: border-box;"
                        :placeholder="candidatePlaceholder || (enableCandidate ? '输入姓名' : '输入课程')"
                        @keydown.down.prevent="candidateHighlightNext"
                        @keydown.up.prevent="candidateHighlightPrev"
                        @keydown.enter.prevent="candidateSelectHighlighted"
                        @keydown.escape.prevent="cancelEdit"
                        @blur="onEditBlur"
                        @input="onEditInput(rowIdx, colIdx)"
                        @mousedown.stop
                      />
                    </div>
                    <template v-else>
                      {{ cell.course || '' }}
                    </template>
                  </td>
                </template>
              </template>
            </tr>
          </component>
        </tbody>
      </table>

      <!--
        候选弹窗：用 <Teleport to="body"> 把弹窗渲染到 body 下，
        彻底跳出 .grid-view-container 的 backdrop-filter 包含块。
        为什么必须 Teleport：毛玻璃主题下 .grid-view-container 有 backdrop-filter: blur(16px)，
        根据 CSS 规范它会作为 position: fixed 的包含块祖先，使 fixed 不再相对视口。
        即便坐标用 getBoundingClientRect()（视口坐标）算对了，弹窗位置仍会偏移。
        Teleport 到 body 后，弹窗没有 backdrop-filter 祖先，fixed 才真正相对视口定位。
        配合 event.currentTarget 拿到用户实际双击的 td，定位完全准确。
      -->
      <Teleport to="body">
        <div
          v-if="showCandidatePopup"
          class="candidate-popup fixed z-[10002] bg-surface border border-info shadow-lg rounded"
          :style="{ left: candidatePopupX + 'px', top: candidatePopupY + 'px', width: '180px', maxHeight: '200px', overflow: 'auto' }"
          @mousedown.stop
        >
          <div v-if="filteredCandidates.length > 0">
            <div
              v-for="(item, idx) in filteredCandidates"
              :key="item.id"
              :class="['px-3 py-2 text-sm cursor-pointer hover:bg-info/10', { 'bg-info/20': idx === candidateHighlightIndex }]"
              @mousedown.prevent="candidateSelect(item)"
              @mouseenter="candidateHighlightIndex = idx"
            >
              {{ getCandidateLabel(item) }}
            </div>
          </div>
          <div v-else class="px-3 py-2 text-sm text-text-muted">无匹配项</div>
        </div>
      </Teleport>
    </div>
  </div>
</template>

<script>
import { TransitionGroup } from 'vue';
import { useGridViewDrag } from './GridView.drag.js';

// 无动画时的「透明包裹」组件：只把默认插槽原样渲染成 Fragment，不产生任何真实 DOM 元素，
// 保证 <tr> 仍是 <tbody> 的直接子节点。
// 注意：不能直接 <component :is="Fragment">，也不能用字符串 'template'：
//   - 编译器会把 <component> 的子节点编译成「默认插槽」，而 Fragment 不消费插槽 → 所有行都不渲染；
//   - 'template' 会生成真实的 <template> DOM 元素，同样不渲染任何行。
const RowsFragment = {
  name: 'RowsFragment',
  inheritAttrs: false,
  props: {
    name: { type: String, default: undefined },
    tag: { type: String, default: '' },
  },
  render() {
    return this.$slots.default ? this.$slots.default() : null
  },
}

const COURSE_COLORS = {
  '语文': '#FFE4E1', '数学': '#E0F7FA', '英语': '#F3E5F5', '物理': '#E8F5E9', '化学': '#FFF3E0',
  '生物': '#F1F8E9', '历史': '#FBE9E7', '地理': '#E0F2F1', '政治': '#F9FBE7', '体育': '#DCEDC8',
  '音乐': '#F8BBD0', '美术': '#C8E6C9', '信息技术': '#BBDEFB', '自习': '#F5F5F5',
};

export default {
  name: 'GridView',
  props: {
    colHeaders: { type: Array, required: true },
    rows: { type: Array, required: true },
    showPeriodColumn: { type: Boolean, default: false },
    // 单元格锚点前缀：为空时不给单元格输出 data-row-id（其它页面零影响）；
    // 传值时输出 `${anchorPrefix}:${节次索引}:${列索引}`（如 s:0:0），供全局搜索按记录定位。
    anchorPrefix: { type: String, default: '' },
    title: { type: String, default: '' },
    hideMetaColumns: { type: Boolean, default: false },
    showRowNumber: { type: Boolean, default: false },
    enableCandidate: { type: Boolean, default: false },
    candidateItems: { type: Array, default: () => [] },
    candidateExcludeIds: { type: Array, default: () => [] },
    candidateLabelField: { type: String, default: '姓名' },
    candidateValueField: { type: String, default: '' },
    candidatePlaceholder: { type: String, default: '' },
    allowDuplicate: { type: Boolean, default: false },
    minTableHeight: { type: Number, default: 400 },
    // ---- 以下是加载状态相关的 props ----
    // 网状表（课表/值日/座位）**不再渲染空态**：空表本身就是一张待填的网格，
    // 有行列结构、格子能直接双击填，再盖一层「还没有数据 + 按钮」只会挡路。
    // emptyReady 仍需要：它决定「数据还没就绪」时画占位还是画表格。
    // rows 为空到底是「正在加载」还是「确实没有数据」，组件无从判断，必须由调用方告知。
    // false 时不渲染表格，保持同高静默占位。
    emptyReady: { type: Boolean, default: true },
    // 加载失败：与「没有数据」必须区分开。失败时显示告警图标 + 重试按钮，
    // 而不是让用户对着一张空表猜「是不是数据丢了」。
    loadError: { type: Boolean, default: false },
    errorText: { type: String, default: '表格加载失败' },
    // 内层滚动容器的最大高度（px），内容超高即容器内纵向滚动、表头吸顶；<= 0 表示不限制
    // （保持旧行为：表格随内容撑高，滚的是外层页面）。与 DynamicTable 的 maxHeight 同款语义。
    // 默认 560 的取值：数据格固定 40px 高，560 ≈ 表头 + 12 行。座位表（6 行）、值日表
    // （十几行）日常不会触发，课表满课（8~12 节）刚好不滚；再多（跨时段分隔行、大值日表）
    // 才内部滚动 —— 即「正常表格零变化，超长才滚」。
    maxHeight: { type: Number, default: 560 },
    rowHeaderLabel: { type: String, default: '行号' },  // 新增：行号/首列表头文案（座位用「行号」，值日用「劳动项目」）
    disableRowDrag: { type: Boolean, default: false },  // 新增：禁用行号列的整行拖拽排序（值日多行分组时关闭，避免拖单个子行）
  },
  // retry：加载失败态里的「重试」被按下，由父组件重新拉数据。
  emits: ['update:cells', 'swapRows', 'swapColumns', 'update:row-meta', 'cell-dblclick', 'retry'],
  data() {
    return {
      selecting: false, selectionStart: null, selectionEnd: null, longPressTimer: null, longPressActive: false,
      dragSource: null, dragTarget: null, _cellGhost: null,
      rowDragIdx: null, rowDragOverIdx: null, _rowGhost: null, _rowGrab: null, _rowMove: null, _rowUp: null, _rowDropBox: null,
      colDragIdx: null, colDragOverIdx: null, _colGhost: null, _colGrab: null, _colMove: null, _colUp: null, _colDropBox: null,
      firstActivate: true, _tableEnterCleanup: null,
      // 行过渡容器是否启用（见模板说明）：只在行集合真正变化的短窗口内为 true，
      // 日常编辑/键入/框选时退化成 Fragment，避免 TransitionGroup 每次更新的强制同步布局。
      rowsAnimEnabled: false, _rowsAnimTimer: null,
      // 内容是否超出 maxHeight（超出才内部滚动 + 预留滚动条槽位，见模板内层容器说明）
      vScroll: false,
      editingCell: null, editingCellData: { course: '' }, editingMeta: null, editingMetaValue: '',
      candidateHighlightIndex: 0, showCandidatePopup: false, candidatePopupX: 0, candidatePopupY: 0,
      cellRefs: {},
    };
  },
  computed: {
    totalColumns() {
      let count = this.colHeaders.length;
      if (!this.hideMetaColumns) count += 2;
      if (this.showPeriodColumn && !this.hideMetaColumns) count += 1;
      if (this.hideMetaColumns && this.showRowNumber) count += 1;
      return count;
    },
    // 行容器组件：开动画窗时用 TransitionGroup，否则用 RowsFragment 做「透明包裹」，
    // 让 <tr> 始终是 <tbody> 的直接子节点。两者都必须能在实例上取到（模板表达式不会
    // 自动解析 components 选项，直接写 TransitionGroup 会得到 undefined 而整表不渲染）。
    rowsWrapper() { return this.rowsAnimEnabled ? TransitionGroup : RowsFragment; },
    // 行集合指纹（只看 _rowKey 序列）：行增删/换表才会变，改格子内容不变。
    // 用它驱动「动画窗」的开关，避免每次数据变化都白白启用 TransitionGroup。
    rowsKeySig() { return (this.rows || []).map(r => (r._rowKey != null ? r._rowKey : '')).join('|'); },
    filteredCandidates() {
      if (!this.enableCandidate || !this.editingCell) return [];
      const list = this.candidateBaseList;
      const text = this.editingCellData.course?.trim() || '';
      if (text) {
        const kw = text.toLowerCase();
        // 用预缓存的标签小写，避免每次击键都对每个候选现场 String+toLowerCase 分配（同行为、更快）
        const cache = this.candidateLabelCache;
        return list.filter(s => cache.get(s).includes(kw));
      }
      return list;
    },
    // 候选基础列表（已剔除已被占用的学生）：只在候选数据/排除集合变化时重建一次。
    // 进入编辑时编辑框每次按键都会重算 filteredCandidates，这里把「造数组 + 逐个 includes」
    // 挪出击键路径（排除集合改成 Set 命中，也不再复制一遍整个候选数组）。
    candidateBaseList() {
      if (!this.enableCandidate) return [];
      if (this.allowDuplicate) return this.candidateItems;
      const exclude = new Set(this.candidateExcludeIds);
      return this.candidateItems.filter(s => !exclude.has(s.id));
    },
    // 候选标签小写缓存：仅当候选列表变更时重建一次，供过滤 O(1) 命中，避免击键时逐项构造字符串。
    candidateLabelCache() {
      const field = this.candidateLabelField;
      const map = new Map();
      for (const item of this.candidateItems) {
        map.set(item, String(item[field] ?? item.姓名 ?? '').toLowerCase());
      }
      return map;
    },
    // 选中坐标缓存：框选/拖拽时 mouseenter/重渲染会高频触发，预构造成 Set 供 isCellSelected O(1) 判断，
    // 避免每个单元格每次渲染都重建整个选区数组做线性查找（INP 优化）。
    selectionCoords() {
      const set = new Set();
      if (!this.selectionStart || !this.selectionEnd || this.longPressActive) return set;
      const minR = Math.min(this.selectionStart.row, this.selectionEnd.row), maxR = Math.max(this.selectionStart.row, this.selectionEnd.row);
      const minC = Math.min(this.selectionStart.col, this.selectionEnd.col), maxC = Math.max(this.selectionStart.col, this.selectionEnd.col);
      for (let r = minR; r <= maxR; r++) {
        const row = this.rows[r]; if (!row || row._isSeparator || row._mergeCells || row._isPodium) continue;
        for (let c = minC; c <= maxC; c++) set.add(r + ',' + c);
      }
      return set;
    },
    // 单元格编辑中：行拖动手柄保留展示但锁定（不再随编辑消失）
    rowDragLocked() { return !!this.editingCell },
  },
  methods: {
    ...useGridViewDrag(),
    // 测量表格完整内容高度（scrollHeight 不被容器裁剪），判断是否超出 maxHeight。
    // 只写一个布尔值给 vScroll，不参与滚动位置计算，代价可忽略。
    measureScrollState() {
      const wrap = this.$refs.gridTable;
      const tbl = wrap && wrap.querySelector('table');
      // 表格挂在 Teleport/过渡尚未完成时可能拿不到，退回「不确定」：保持旧值，下一帧再测
      if (!tbl) return;
      if (this.maxHeight > 0) this.vScroll = tbl.scrollHeight > this.maxHeight;
      else if (this.vScroll) this.vScroll = false;
      // 标题行（课表在用）若存在，量出它的高度给列头行的 sticky top，让两行吸顶不重叠。
      // 与 maxHeight 无关：即使不限制高度，吸顶偏移也得对。
      const titleTh = tbl.querySelector('thead .grid-head-title');
      const h = titleTh ? Math.round(titleTh.getBoundingClientRect().height) : 0;
      if (h !== this._titleHeadH) {
        this._titleHeadH = h;
        tbl.style.setProperty('--grid-title-h', h + 'px');
      }
    },
    // 排到「DOM 落地之后」再量：行是 TransitionGroup 挂载的，watch 触发时表格还没画完。
    // 双保险 = nextTick（等 Vue patch 完）+ rAF（等浏览器完成布局，量到的才是真实高度）。
    scheduleMeasure() {
      if (this._measureTimer) clearTimeout(this._measureTimer);
      if (this._measureRaf) cancelAnimationFrame(this._measureRaf);
      this.$nextTick(() => {
        this._measureRaf = requestAnimationFrame(() => {
          this._measureRaf = 0;
          this.measureScrollState();
        });
      });
    },
    onWindowResize() {
      // resize 高频，用 120ms 尾巴合并；只为了重判 vScroll，无需逐帧跟手
      if (this._measureTimer) clearTimeout(this._measureTimer);
      this._measureTimer = setTimeout(() => { this._measureTimer = null; this.measureScrollState(); }, 120);
    },
    setCellRef(rowIdx, colIdx, el) { if (el) { if (!this.cellRefs[rowIdx]) this.cellRefs[rowIdx] = {}; this.cellRefs[rowIdx][colIdx] = el; } },
    // 行是否可拖（只看行本身类型；编辑中与否由 rowDragLocked 决定「锁定」而非「隐藏」）
    canDragRow(row) {
      return !row._isSeparator && !row._mergeCells && !row._isReadonly && !row._isPodium;
    },
    onCellMouseDown(event, rowIdx, colIdx) {
      if (event.button !== 0) return;
      const row = this.rows[rowIdx];
      if (this.editingCell || row._isSeparator || row._mergeCells || row._isPodium) return;
      if (this.editingMeta) { const metaRow = this.editingMeta.row; requestAnimationFrame(() => this.saveEditMeta(metaRow)); }
      this.selecting = true; this.selectionStart = { row: rowIdx, col: colIdx }; this.selectionEnd = { row: rowIdx, col: colIdx };
      this.longPressActive = false; this.clearLongPress();
      this.longPressTimer = setTimeout(() => {
        this.longPressActive = true; this.dragSource = { row: rowIdx, col: colIdx }; this.dragTarget = null;
        this.createCellGhost(rowIdx, colIdx); this.selecting = false; this.selectionStart = null; this.selectionEnd = null;
      }, 400);
    },
    onCellMouseEnter(rowIdx, colIdx) {
      const row = this.rows[rowIdx]; if (!row || row._isSeparator || row._mergeCells || row._isPodium) return;
      if (this.selecting) this.selectionEnd = { row: rowIdx, col: colIdx };
      else if (this.longPressActive && this.dragSource) {
        if (this.dragSource.row !== rowIdx || this.dragSource.col !== colIdx) this.dragTarget = { row: rowIdx, col: colIdx };
        else this.dragTarget = null;
      }
    },
    handleGlobalMouseUp() {
      if (this.longPressActive && this.dragSource && this.dragTarget) this.swapCells(this.dragSource.row, this.dragSource.col, this.dragTarget.row, this.dragTarget.col);
      this.selecting = false; this.longPressActive = false; this.clearLongPress(); this.dragSource = null; this.dragTarget = null; this.removeCellGhost();
    },
    clearLongPress() { if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; } },
    createCellGhost(rowIdx, colIdx) {
      const cell = this.rows[rowIdx].cells[colIdx];
      const ghost = document.createElement('div');
      ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;padding:4px 10px;background:#eff6ff;color:#1e3a8a;border:1px solid #93c5fd;border-radius:var(--radius-xs,4px);font-size:14px;';
      ghost.textContent = cell.course || '(空)'; document.body.appendChild(ghost); this._cellGhost = ghost;
      const moveHandler = (e) => { ghost.style.left = (e.clientX + 15) + 'px'; ghost.style.top = (e.clientY - 25) + 'px'; };
      document.addEventListener('mousemove', moveHandler); this._cellGhostMoveHandler = moveHandler;
    },
    removeCellGhost() { if (this._cellGhost) { document.body.removeChild(this._cellGhost); this._cellGhost = null; } if (this._cellGhostMoveHandler) { document.removeEventListener('mousemove', this._cellGhostMoveHandler); } },
    isCellSelected(rowIdx, colIdx) { return this.longPressActive ? false : this.selectionCoords.has(String(rowIdx) + ',' + String(colIdx)); },
    isDragTarget(rowIdx, colIdx) { return this.dragTarget && this.dragTarget.row === rowIdx && this.dragTarget.col === colIdx; },
    swapCells(r1, c1, r2, c2) {
      if (r1 === r2 && c1 === c2) return;
      const newRows = this.rows.map(r => (r._isSeparator || r._mergeCells || r._isPodium) ? r : { ...r, cells: [...r.cells] });
      [newRows[r1].cells[c1], newRows[r2].cells[c2]] = [{ ...newRows[r2].cells[c2] }, { ...newRows[r1].cells[c1] }];
      this.$emit('update:cells', newRows);
    },
    onCellDoubleClick(event, rowIdx, colIdx) {
      const row = this.rows[rowIdx]; if (!row || row._isSeparator || row._mergeCells || row._isReadonly || row._isPodium) return;
      if (this.editingCell) requestAnimationFrame(() => this.saveEditCell());
      this.$emit('cell-dblclick', { rowIdx, colIdx, row, cell: row.cells[colIdx] });
      this.clearLongPress(); this.selectionStart = null; this.selectionEnd = null;
      this.editingCell = { row: rowIdx, col: colIdx }; this.editingCellData = { ...row.cells[colIdx] };
      this.candidateHighlightIndex = 0; this.showCandidatePopup = this.enableCandidate;
      // 关键：用 event.currentTarget 拿到用户实际双击的 td（避免 cellRefs 错位）。
      // event.currentTarget 在同步代码中有效，保存到 cellEl 供 nextTick 使用。
      const cellEl = event && event.currentTarget ? event.currentTarget : this.cellRefs[rowIdx]?.[colIdx];
      this.$nextTick(() => {
        if (cellEl) { const input = cellEl.querySelector('input'); if (input) input.focus(); }
        if (this.enableCandidate) this.positionPopupFromEl(cellEl);
      });
    },
    positionPopupFromEl(cellEl) {
      if (!cellEl) return;
      // 用 cellEl 的 getBoundingClientRect() 拿视口坐标，pop 用 position: fixed 相对视口定位。
      // cellEl 是 event.currentTarget（用户实际双击的 td），rect 一定反映该 cell 的真实视口位置。
      const cellRect = cellEl.getBoundingClientRect();
      const popupW = 180;
      const popupH = 200;
      let x = cellRect.left;
      let y = cellRect.bottom + 2;
      // 防止超出视口右/下边缘
      if (x + popupW > window.innerWidth) x = Math.max(0, window.innerWidth - popupW - 8);
      if (y + popupH > window.innerHeight) y = Math.max(0, window.innerHeight - popupH - 8);
      this.candidatePopupX = x;
      this.candidatePopupY = y;
    },
    positionPopup(rowIdx, colIdx) { /* 兼容保留：内部已用 event.currentTarget 路径 */ },
    onEditInput(rowIdx, colIdx) { this.candidateHighlightIndex = 0; if (this.showCandidatePopup) this.positionPopup(rowIdx, colIdx); },
    // ---------- 保存编辑 ----------
    saveEditCell() {
      if (!this.editingCell) return;

      // 候选模式：若输入姓名不在全部学生列表中，则还原原值（防止清空或错误输入）
      // if (this.enableCandidate) {
      //   const name = this.editingCellData.course.trim();
      //   if (name && !this.candidateItems.some(s => s.姓名 === name)) {
      //     const originalCell = this.rows[this.editingCell.row].cells[this.editingCell.col];
      //     this.editingCellData.course = originalCell?.course || '';
      //   }
      // }

      const { row, col } = this.editingCell;
      const newRows = this.rows.map(r => (r._isSeparator || r._mergeCells || r._isPodium) ? r : { ...r, cells: [...r.cells] });
      newRows[row].cells[col] = { course: this.editingCellData.course || '' };
      this.$emit('update:cells', newRows);
      this.closeEditor();
    },
    cancelEdit() { this.closeEditor(); },
    closeEditor() {
      this.editingCell = null;
      this.showCandidatePopup = false;
      this.candidateHighlightIndex = 0;
    },
    onEditBlur() {
      // 保护：若编辑器已关闭，直接返回
      if (!this.editingCell) return;
      this.saveEditCell();
    },
    // ---------- 候选键盘操作 ----------
    candidateHighlightNext() {
      if (this.candidateHighlightIndex < this.filteredCandidates.length - 1) {
        this.candidateHighlightIndex++;
      }
    },
    candidateHighlightPrev() {
      if (this.candidateHighlightIndex > 0) {
        this.candidateHighlightIndex--;
      }
    },
    candidateSelectHighlighted() {
      if (this.filteredCandidates.length > 0) {
        this.candidateSelect(this.filteredCandidates[this.candidateHighlightIndex]);
      } else {
        this.saveEditCell();
      }
    },
    candidateSelect(item) {
      if (item) this.editingCellData.course = this.getCandidateValue(item);
      this.saveEditCell();
    },
    getCandidateLabel(item) {
      return item[this.candidateLabelField] ?? item.姓名 ?? '';
    },
    getCandidateValue(item) {
      const field = this.candidateValueField || this.candidateLabelField;
      return item[field] ?? item.姓名 ?? '';
    },
    isEditing(rowIdx, colIdx) { return this.editingCell?.row === rowIdx && this.editingCell?.col === colIdx; },
    startEditMeta(rowIdx, field) { /* 省略，保留原逻辑 */ },
    saveEditMeta(rowIdx) { /* 省略，保留原逻辑 */ },
    // 单元格底色：走廊固定灰；若调用方在 cell 上给了 _bg（热力图等）则优先；否则按课程名配色
    getCellColor(cell) { if (cell._isAisle) return '#d1d5db'; if (cell._bg != null) return cell._bg; return COURSE_COLORS[cell.course] || '#FFFFFF'; },
    // 单元格文字色：调用方在 cell 上给了 _fg（深底白字）才覆盖，否则继承主题文字色
    getCellTextColor(cell) { return cell._fg || ''; },
  },
  watch: {
    // 行集合变化（数据初载、增删行、换行集）才开动画窗；改格子内容不会触发
    rowsKeySig() { this.openRowsAnimWindow(); this.scheduleMeasure(); },
    // 列头变化：讲台/时段/节次列的显隐会改总列数，进而改单元格宽度、可能改行高（换行）
    colHeaders() { this.scheduleMeasure(); },
  },
  mounted() {
    document.addEventListener('mouseup', this.handleGlobalMouseUp);
    // 首屏：数据区整体从左往右弹入
    this.playTableEnter();
    this.scheduleMeasure();
    // 窗口缩放会改列宽 → 可能改行高 → 重新判定是否超高（与 DynamicTable 同款监听时机）
    window.addEventListener('resize', this.onWindowResize);
  },
  // KeepAlive：从其它状态栏/页签切回来时重播数据区弹入动效
  activated() {
    if (this.firstActivate) { this.firstActivate = false; this.scheduleMeasure(); return; }
    this.playTableEnter();
    this.scheduleMeasure();
  },
  beforeUnmount() {
    document.removeEventListener('mouseup', this.handleGlobalMouseUp);
    window.removeEventListener('resize', this.onWindowResize);
    if (this._measureRaf) cancelAnimationFrame(this._measureRaf);
    if (this._measureTimer) clearTimeout(this._measureTimer);
    this.clearLongPress();
    this.removeCellGhost();
    // 拖拽中途被卸载：停掉自动滚动并清掉让位位移
    if (this._rowAutoScroll) { this._rowAutoScroll.stop(); this._rowAutoScroll = null; }
    if (this._colAutoScroll) { this._colAutoScroll.stop(); this._colAutoScroll = null; }
    this._clearRowShiftFx();
    this._clearColShiftFx();
    if (this._rowGhost) this._rowGhost.remove();
    if (this._rowSlotGhost) this._rowSlotGhost.remove();
    if (this._rowMove) window.removeEventListener('mousemove', this._rowMove);
    if (this._rowUp) window.removeEventListener('mouseup', this._rowUp);
    if (this._rowRaf) cancelAnimationFrame(this._rowRaf);
    if (this._colGhost) this._colGhost.remove();
    if (this._colSlotGhost) this._colSlotGhost.remove();
    if (this._colMove) window.removeEventListener('mousemove', this._colMove);
    if (this._colUp) window.removeEventListener('mouseup', this._colUp);
    if (this._colRaf) cancelAnimationFrame(this._colRaf);
    if (this._rowDropBox) this._rowDropBox.remove();
    if (this._colDropBox) this._colDropBox.remove();
    if (this._tableEnterCleanup) this._tableEnterCleanup();
    if (this._rowsAnimTimer) clearTimeout(this._rowsAnimTimer);
    this.cellRefs = {}; // 清除 DOM 引用，避免内存泄漏
  },
};
</script>

<style scoped>
.drag-handle { font-size: 14px; user-select: none; opacity: 0.6; }
.drag-handle:hover { opacity: 1; }
/* 列拖拽的源列（表头与数据格）：整列直接留空（visibility 保留占位宽度与列宽），
   不留下半透明副本，避免原位置看起来还有一层影子 */
.dt-col-src-hidden { visibility: hidden; }
th .drag-handle { color: color-mix(in srgb, var(--color-text-inverse, #ffffff) 70%, transparent); }
th:hover .drag-handle { color: var(--color-text-inverse, #ffffff); }
/* ---- 容器超高时的内部滚动（maxHeight 上限）----
   预留滚动条槽位：纵向滚动条随行增删出现/消失，若不预留会让整表宽度跳一下、列宽重排。 */
.scrollbar-gutter-stable { scrollbar-gutter: stable; }
/* 表头吸顶：内容超出 maxHeight 后，表头保持在容器顶部、只滚数据行。
   sticky 必须加在 th 上（加 thead 在多数浏览器不生效），与 DynamicTable 同款。
   表头自带不透明底色，滚动时遮盖下方滚上来的数据格。 */
thead th { position: sticky; top: 0; z-index: 5; }
/* 有标题行时（课表），列头行要让开标题行的高度，否则两行都吸在 top:0 会叠在一起。
   --grid-title-h 由 measureScrollState 量出实际标题行高度后写入 table 的行内样式；无标题行时为 0。 */
thead th:not(.grid-head-title) { top: var(--grid-title-h, 0px); }
/* 标题行在列头行之上（同一列重叠时标题优先） */
thead th.grid-head-title { z-index: 6; }
/* 吸顶表头补边框：border-collapse 下 sticky 单元格脱离表格的边框绘制，
   底边会随下层数据一起「穿过去」。用内阴影补一条底线，视觉与原来一致。
   玻璃/glass2/win11 主题把表格改成了 border-collapse: separate（边框本就正常），
   再补会变成双线，故排除。 */
:root:not([data-theme="glass"], [data-theme="glass2"], [data-theme="win11"]) thead th {
  box-shadow: inset 0 -1px 0 0 var(--color-border, #e5e7eb);
}
/* 行交换(FLIP)：松手后其它行平滑让位滑开，与动态表格保持一致 */
.row-flip-move { transition: transform 0.32s cubic-bezier(0.34, 1.08, 0.64, 1) !important; }
/* 内容互换型交换（网格表格的实际交换方式）的一次性过渡曲线 */
.swap-flip { transition: transform 0.32s cubic-bezier(0.34, 1.08, 0.64, 1) !important; }
.row-flip-enter-active { transition: opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.row-flip-leave-active { position: absolute; width: 100%; transition: opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.25s cubic-bezier(0.22, 1, 0.36, 1); }
.row-flip-enter-from, .row-flip-leave-to { opacity: 0; transform: translateX(-20px); }
/* 整表数据区(tbody)进入：从左往右弹入，不含表头 */
.table-enter { animation: table-slide-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes table-slide-in {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}

/* ---- 空态：直接浮在毛玻璃上（不铺白底）----
   空态块不画背景，露出外层容器 / 页面的玻璃；再由 backdrop-filter 把背后真正模糊出来。
   之前铺 var(--color-surface) 相当于在毛玻璃上又盖一层白纸，glass 主题下尤其明显。
   （.grid-view-container 在毛玻璃主题下本来就有 backdrop-filter，这里叠一层是同向加强。） */
.grid-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px 20px;
  box-sizing: border-box;
  text-align: center;
  background: transparent;
  backdrop-filter: blur(22px) saturate(1.3);
  -webkit-backdrop-filter: blur(22px) saturate(1.3);
  animation: grid-empty-in 0.3s ease both;
}
@keyframes grid-empty-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
.grid-empty-icon {
  width: 48px;
  height: 48px;
  color: var(--color-text-muted, #94a3b8);
  opacity: 0.9;
}
.grid-empty-text {
  margin: 0;
  font-size: 16px;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #94a3b8);
}
/* 判定中的静默占位：与空态同高、完全透明。
   只为了让「数据还没就绪」这段时间不画出表头，避免表头先出现再被空态替换的跳变。 */
.grid-empty-pending {
  width: 100%;
  background: transparent;
}
/* 加载失败态：复用空态的整体版式，只把图标换成告警色 ——
   版式一致，用户一眼能看出「这是同一块区域在给不同结论」，不会以为是两个模块 */
.grid-error .grid-empty-icon {
  color: var(--color-danger, #ef4444);
}
.grid-error .grid-empty-text {
  color: var(--color-text-secondary, #64748b);
}
/* 空态按钮：淡蓝底 + 深蓝字（#D9E5F8 太浅，配白字只有 1.3:1，读不出来）。
   这组色值在 DynamicTable 的 .dt-empty-btn 里有一份完全相同的副本，改颜色要两边一起改。
   现在网状表只用于「加载失败 → 重试」这一个场景（空态已移除）。 */
.grid-empty-btn {
  min-width: 108px;
  padding: 8px 20px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.4;
  color: #1e3a6b;
  background: #d9e5f8;
  border: 1px solid #c3d6f2;
  border-radius: var(--radius-control);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(30, 58, 107, 0.10);
  transition: transform 0.15s ease;
}
/* 悬停不做任何变化：这是空态的引导按钮，不是可反复试探的操作项，
   上浮 / 换色 / 加阴影反而让空态显得「活」得过分。按下时留一个轻微缩放作为手感反馈。 */
.grid-empty-btn:active {
  transform: scale(0.98);
}
.grid-empty-btn:focus-visible {
  outline: 2px solid rgba(30, 58, 107, 0.55);
  outline-offset: 2px;
}
</style>