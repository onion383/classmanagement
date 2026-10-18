<template>
  <div class="grid-view-container" ref="gridContainer" :style="{ minHeight: rows.length ? 'auto' : minTableHeight + 'px', position: 'relative' }">
    <div ref="gridTable" class="overflow-auto border rounded">
      <table class="w-full border-collapse select-none">
        <thead>
          <tr v-if="title">
            <th :colspan="totalColumns" class="bg-primary text-text-inverse text-center py-2 text-lg font-bold">{{ title }}</th>
          </tr>
          <tr>
            <th v-if="showPeriodColumn && !hideMetaColumns" class="bg-primary text-text-inverse border border-border px-2 py-1 text-center" style="width: 80px;">时段</th>
            <th v-if="!hideMetaColumns" class="bg-primary text-text-inverse border border-border px-2 py-1 text-center" style="width: 100px;">节次</th>
            <th v-if="!hideMetaColumns" class="bg-primary text-text-inverse border border-border px-2 py-1 text-center" style="width: 130px;">时间</th>
            <th v-if="hideMetaColumns && showRowNumber" class="bg-primary text-text-inverse border border-border px-2 py-1 text-center" style="width: 110px;">{{ rowHeaderLabel }}</th>
            <th
              v-for="(col, colIdx) in colHeaders"
              :key="colIdx"
              :class="['bg-primary text-text-inverse border border-border px-2 py-1 text-center', col !== '走廊' ? 'cursor-pointer' : 'cursor-default bg-text-muted', { 'opacity-30': colDragIdx === colIdx }]"
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
                    :class="['border border-border px-2 py-2 text-center transition-colors relative', isDragTarget(rowIdx, colIdx) ? 'bg-info/10 outline outline-2 outline-info' : '', isCellSelected(rowIdx, colIdx) && !isEditing(rowIdx, colIdx) ? 'bg-info/10 outline outline-2 outline-info' : '', isEditing(rowIdx, colIdx) ? 'ring-2 ring-info ring-inset' : '', row._isReadonly ? '' : 'cursor-pointer', cell._bg != null ? 'cell-heat' : '', isEditing(rowIdx, colIdx) ? 'cell-editing' : '']"
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
import { applyRowShift, applyColShift, clearShift, createEdgeAutoScroll } from '../../composables/tableDragFx';

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
    rowHeaderLabel: { type: String, default: '行号' },  // 新增：行号/首列表头文案（座位用「行号」，值日用「劳动项目」）
    disableRowDrag: { type: Boolean, default: false },  // 新增：禁用行号列的整行拖拽排序（值日多行分组时关闭，避免拖单个子行）
  },
  emits: ['update:cells', 'swapRows', 'swapColumns', 'update:row-meta', 'cell-dblclick'],
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
      ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;padding:4px 10px;background:#eff6ff;color:#1e3a8a;border:1px solid #93c5fd;border-radius:4px;font-size:14px;';
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
    // ==================== 拖拽落点高亮框 ====================
    // 整层包住目标行/列的蓝色边框（不用 border 直接改单元格，避免撑动列宽/行高）
    createDropBox() {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;pointer-events:none;display:none;box-sizing:border-box;will-change:transform;border:2px solid var(--color-info, #2563eb);border-radius:4px;';
      document.body.appendChild(box);
      return box;
    },
    // rect: {left, top, right, bottom}（视口坐标）；container 内裁剪，避免滚动时溢出表格范围
    updateDropBox(box, rect, container) {
      if (!box) return;
      if (!rect) { box.style.display = 'none'; return; }
      let { left, top, right, bottom } = rect;
      if (container) {
        const c = container.getBoundingClientRect();
        left = Math.max(left, c.left);
        top = Math.max(top, c.top);
        right = Math.min(right, c.right);
        bottom = Math.min(bottom, c.bottom);
      }
      const w = right - left, h = bottom - top;
      if (w <= 0 || h <= 0) { box.style.display = 'none'; return; }
      box.style.display = 'block';
      box.style.transform = `translate(${left}px, ${top}px)`;
      box.style.width = w + 'px';
      box.style.height = h + 'px';
    },
    // 拖拽开始时一次性缓存各行与容器的几何信息，拖动过程中纯计算，避免每帧 O(n) 布局读取
    _cacheRowGeom() {
      const trs = this.$el ? this.$el.querySelectorAll('tbody tr') : [];
      const arr = [];
      for (let i = 0; i < trs.length; i++) {
        const r = trs[i].getBoundingClientRect();
        arr.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
      this._rowGeom = arr;
      const c = this.$refs.gridTable;
      this._rowGeomContainer = c ? c.getBoundingClientRect() : null;
    },
    // 列拖拽几何缓存：按下时一次性量出各数据列的左右边界、表头行 top、表底 bottom 与容器 rect，
    // 拖动过程中纯数值比较，避免每帧 O(n) getBoundingClientRect 触发布局（INP 优化）
    _cacheColGeom() {
      const ths = this.colHeaderEls();
      const off = this.colThOffset();
      const arr = [];
      for (let i = 0; i < ths.length; i++) {
        const colIdx = i - off;
        if (colIdx < 0) continue; // 元数据列（时段/节次/时间/行号）不参与落点
        const col = this.colHeaders[colIdx];
        if (col === undefined) { arr[colIdx] = null; continue; }
        const r = ths[i].getBoundingClientRect();
        // 走廊列（同桌模式下的间隔列）不是落点目标，但它的几何要参与「逐列补偿」，
        // 否则跨越走廊拖动时相邻列会让错位置。
        arr[colIdx] = { left: r.left, right: r.right, aisle: col === '走廊' };
      }
      this._colGeom = arr;
      this._colGeomHeaderTop = ths.length ? ths[0].parentElement.getBoundingClientRect().top : null;
      const tbl = this.$el ? this.$el.querySelector('table') : null;
      this._colGeomTblBottom = tbl ? tbl.getBoundingClientRect().bottom : null;
      const c = this.$refs.gridTable;
      this._colGeomContainer = c ? c.getBoundingClientRect() : null;
    },
    // 复制一份跟手虚影作为「落点虚影」：更淡、无阴影、初始隐藏，
    // 位置由 update*DropBox 贴在目标格上。两个虚影同时存在：手上跟手，落点提示位置。
    _cloneGhostForSlot(src, opacity) {
      if (!src) return null;
      const el = src.cloneNode(true);
      el.style.opacity = String(opacity);
      el.style.boxShadow = 'none';
      el.style.display = 'none';
      el.style.zIndex = '99997';
      document.body.appendChild(el);
      return el;
    },
    updateRowDropBox() {
      const box = this._rowDropBox;
      if (!box) return;
      const hide = () => {
        box.style.display = 'none';
        if (this._rowSlotGhost) this._rowSlotGhost.style.display = 'none';
        this._rowDropSig = null;
      };
      const geom = this._rowGeom;
      const g = (geom && this.rowDragOverIdx !== null) ? geom[this.rowDragOverIdx] : null;
      if (!g) { hide(); return; }
      let { left, top, right, bottom } = g;
      const c = this._rowGeomContainer;
      if (c) {
        left = Math.max(left, c.left);
        top = Math.max(top, c.top);
        right = Math.min(right, c.right);
        bottom = Math.min(bottom, c.bottom);
      }
      const w = right - left, h = bottom - top;
      if (w <= 0 || h <= 0) { hide(); return; }
      // 每帧都会走到这里；几何没变就别再写样式
      const sig = `${left}|${top}|${w}|${h}`;
      if (this._rowDropSig === sig) return;
      this._rowDropSig = sig;
      // 落点虚影延迟到「确实要显示」时才克隆（避免按下瞬间多克隆一份整表）
      if (!this._rowSlotGhost && this._rowGhost) {
        this._rowSlotGhost = this._cloneGhostForSlot(this._rowGhost, 0.22);
      }
      const ghost = this._rowSlotGhost;
      box.style.display = 'block';
      box.style.transform = `translate(${left}px, ${top}px)`;
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      // 落点虚影：被拖行的半透明副本固定在落点上（不跟随鼠标）
      if (ghost) {
        ghost.style.display = 'block';
        ghost.style.transform = `translate(${left}px, ${top}px)`;
        ghost.style.width = w + 'px';
        ghost.style.height = h + 'px';
      }
    },
    updateColDropBox() {
      const box = this._colDropBox;
      if (!box) return;
      const hide = () => {
        box.style.display = 'none';
        if (this._colSlotGhost) this._colSlotGhost.style.display = 'none';
        this._colDropSig = null;
      };
      const geom = this._colGeom;
      const g = (geom && this.colDragOverIdx !== null) ? geom[this.colDragOverIdx] : null;
      if (!g || this._colGeomHeaderTop == null) { hide(); return; }
      // 用按下时缓存的几何，拖动过程中不再读取布局
      let { left, right } = g;
      let top = this._colGeomHeaderTop;
      let bottom = this._colGeomTblBottom;
      const c = this._colGeomContainer;
      if (c) {
        left = Math.max(left, c.left);
        top = Math.max(top, c.top);
        right = Math.min(right, c.right);
        bottom = Math.min(bottom, c.bottom);
      }
      const w = right - left, h = bottom - top;
      if (w <= 0 || h <= 0) { hide(); return; }
      // 每帧都会走到这里；几何没变就别再写样式
      const sig = `${left}|${top}|${w}|${h}`;
      if (this._colDropSig === sig) return;
      this._colDropSig = sig;
      // 落点虚影延迟创建（避免按下瞬间多克隆一份）
      if (!this._colSlotGhost && this._colGhost) {
        this._colSlotGhost = this._cloneGhostForSlot(this._colGhost, 0.22);
      }
      const ghost = this._colSlotGhost;
      box.style.display = 'block';
      box.style.transform = `translate(${left}px, ${top}px)`;
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      // 落点虚影：半透明列副本贴在目标格上（表头不动，所以虚影从表头下沿开始）
      if (ghost) {
        ghost.style.display = 'block';
        ghost.style.transform = `translate(${left}px, ${top}px)`;
        ghost.style.width = w + 'px';
        ghost.style.height = h + 'px';
      }
    },
    // ==================== 交换动画（内容互换型 FLIP） ====================
    // 网格表格的交换是「同一批 DOM 节点换内容」，不是节点重排，TransitionGroup 的 move 不会触发，
    // 所以按交换前后的位置差给元素加一次性过渡，让内容看起来从原位滑到新位。
    playSwapFlip(items) {
      const list = (items || []).filter(it => it.el && it.el.isConnected);
      if (!list.length) return;
      list.forEach(({ el, dx = 0, dy = 0 }) => {
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      void this.$el.offsetWidth; // 强制重排，让起始位移先生效
      list.forEach(({ el }) => {
        el.classList.add('swap-flip');
        el.style.transition = '';
        el.style.transform = '';
        const done = (e) => {
          if (e && e.propertyName !== 'transform') return;
          el.classList.remove('swap-flip');
          el.removeEventListener('transitionend', done);
        };
        el.addEventListener('transitionend', done);
      });
    },
    rowSig(idx) {
      const r = this.rows[idx];
      if (!r) return '';
      return (r.label || '') + '#' + (r.cells || []).map(c => c.course || '').join(',');
    },
    colSig(idx) {
      return (this.rows || []).map(r => (r.cells && r.cells[idx] ? r.cells[idx].course || '' : '')).join(',');
    },
    animateRowSwap(fromIdx, toIdx) {
      const trs = this.$el ? this.$el.querySelectorAll('tbody tr') : [];
      const a = trs[fromIdx], b = trs[toIdx];
      if (!a || !b) return;
      const dy = b.getBoundingClientRect().top - a.getBoundingClientRect().top;
      if (!dy) return;
      this.playSwapFlip([{ el: a, dy }, { el: b, dy: -dy }]);
    },
    animateColSwap(fromIdx, toIdx) {
      const ths = this.colHeaderEls();
      const off = this.colThOffset();
      const thFrom = ths[off + fromIdx], thTo = ths[off + toIdx];
      if (!thFrom || !thTo) return;
      const dx = thTo.getBoundingClientRect().left - thFrom.getBoundingClientRect().left;
      if (!dx) return;
      const items = [];
      const trs = this.$el ? this.$el.querySelectorAll('tbody tr') : [];
      trs.forEach((tr, rowIdx) => {
        const refs = this.cellRefs[rowIdx];
        if (!refs) return;
        const a = refs[fromIdx], b = refs[toIdx];
        if (a && a.isConnected) items.push({ el: a, dx });
        if (b && b.isConnected) items.push({ el: b, dx: -dx });
      });
      this.playSwapFlip(items);
    },

    // ==================== 行过渡容器开关（见模板说明） ====================
    // 开窗：行集合刚发生结构性变化，短窗口内保留 Enter/Leave 动画能力
    openRowsAnimWindow() {
      // 拖拽落位：行已经让位到最终位置，这里不要再开整表 FLIP（否则观感是"弹两下"）。
      // 落位动画统一由松手后的 _playRowSlideIn 负责。
      if (this._noRowFlipOnce) {
        this._noRowFlipOnce = false;
        if (this._rowsAnimTimer) { clearTimeout(this._rowsAnimTimer); this._rowsAnimTimer = null; }
        this.rowsAnimEnabled = false;
        return;
      }
      if (this._rowsAnimTimer) clearTimeout(this._rowsAnimTimer);
      if (!this.rowsAnimEnabled) this.rowsAnimEnabled = true;
      this._rowsAnimTimer = setTimeout(this.closeRowsAnimWindow, 800);
    },
    // 关窗：回退到 Fragment（重建一次 tbody，但无动画类，观感无变化）。
    // 编辑中/拖拽中回退会重建正在输入的编辑框并丢焦点，故延后到这些操作结束。
    closeRowsAnimWindow() {
      if (this.editingCell || this.rowDragIdx != null || this.colDragIdx != null || this.longPressActive) {
        this._rowsAnimTimer = setTimeout(this.closeRowsAnimWindow, 300);
        return;
      }
      this._rowsAnimTimer = null;
      this.rowsAnimEnabled = false;
    },

    // ==================== 数据区(tbody)整体从左往右弹入（不含表头） ====================
    playTableEnter() {
      const tbody = this.$el ? this.$el.querySelector('tbody') : null;
      if (!tbody) return;
      if (this._tableEnterCleanup) this._tableEnterCleanup();
      const onEnd = (e) => { if (e && e.target !== tbody) return; this._tableEnterCleanup(); };
      this._tableEnterCleanup = () => {
        tbody.classList.remove('table-enter');
        tbody.removeEventListener('animationend', onEnd);
        this._tableEnterCleanup = null;
      };
      tbody.addEventListener('animationend', onEnd);
      void tbody.offsetWidth; // 强制重排，保证重复导航时动画能重播
      tbody.classList.add('table-enter');
    },

    // ==================== 手动拖拽：半透明整行/整列克隆虚影 ====================
    isRowDropTarget(row) {
      return !!row && !row._isSeparator && !row._mergeCells && !row._isPodium;
    },
    // 表头行里数据列之前的固定列数量（时段/节次/时间/行号）
    colThOffset() {
      if (!this.hideMetaColumns) return 2 + (this.showPeriodColumn ? 1 : 0);
      return this.showRowNumber ? 1 : 0;
    },
    colHeaderEls() { return this.$el ? this.$el.querySelectorAll('thead tr:last-child th') : []; },
    // 克隆整张表格后按矩形切片，得到与原件像素一致的半透明虚影（保留行高/边框/字体/走廊跨行）
    createSliceGhost(region, opacity, radius) {
      const table = this.$el ? this.$el.querySelector('table') : null;
      if (!table || !region.width || !region.height) return null;
      const tblRect = table.getBoundingClientRect();
      const clone = table.cloneNode(true);
      // 保留 content-visibility:auto 会让屏外行按内在尺寸折叠，导致切片错位
      clone.querySelectorAll('.content-visibility-auto').forEach(el => el.classList.remove('content-visibility-auto'));
      clone.style.width = tblRect.width + 'px';
      clone.style.position = 'absolute';
      clone.style.left = (-(region.left - tblRect.left)) + 'px';
      clone.style.top = (-(region.top - tblRect.top)) + 'px';
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;left:0;top:0;z-index:100000;pointer-events:none;overflow:hidden;will-change:transform;box-shadow:0 6px 18px rgba(0,0,0,0.18);';
      wrapper.style.opacity = opacity;
      if (radius) wrapper.style.borderRadius = radius;
      wrapper.style.width = region.width + 'px';
      wrapper.style.height = region.height + 'px';
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);
      return wrapper;
    },
    placeGhost(ghost, grab, clientX, clientY) {
      if (!ghost || !grab) return;
      ghost.style.transform = `translate(${clientX - grab.grabX}px, ${clientY - grab.grabY}px)`;
    },

    // ---------- 行拖拽 ----------
    onRowHandleDown(event, rowIdx) {
      if (this.disableRowDrag || this.editingCell) return;
      const row = this.rows[rowIdx];
      if (!row || !this.canDragRow(row)) return;
      const table = this.$el.querySelector('table');
      const tr = event.currentTarget.closest('tr');
      if (!table || !tr) return;
      event.preventDefault();
      const trRect = tr.getBoundingClientRect();
      const tblRect = table.getBoundingClientRect();
      const ghost = this.createSliceGhost(
        { left: tblRect.left, top: trRect.top, width: tblRect.width, height: trRect.height }, 0.85, '4px'
      );
      if (!ghost) return;
      this.rowDragIdx = rowIdx;
      this.rowDragOverIdx = rowIdx;
      this._rowGhost = ghost;
      // 落点虚影在 updateRowDropBox 里延迟创建
      this._rowGrab = { grabX: event.clientX - tblRect.left, grabY: event.clientY - trRect.top };
      // 跟手虚影：自由跟随指针
      this.placeGhost(ghost, this._rowGrab, event.clientX, event.clientY);
      // 落点高亮框：包住即将落位的那一行（几何信息在此一次性缓存）
      this._cacheRowGeom();
      // 让位与自动滚动的初始状态
      this._rowEls = Array.from(this.$el.querySelectorAll('tbody tr'));
      const rg0 = this._rowGeom ? this._rowGeom[rowIdx] : null;
      this._rowSlotH = rg0 ? Math.round(rg0.bottom - rg0.top) : 0;
      this._rowAutoScroll = createEdgeAutoScroll(
        () => this.$refs.gridTable,
        (mx, my) => this._onRowScrolled(mx, my)
      );
      this._rowDropBox = this.createDropBox();
      this.updateRowDropBox();

      const move = (e) => {
        if (!this._rowGhost) return;
        // rAF 对齐到帧：同一帧内多次 mousemove 只处理最后一次
        this._rowPending = e;
        if (this._rowRaf) return;
        this._rowRaf = requestAnimationFrame(() => {
          this._rowRaf = null;
          this._applyRowMove();
        });
      };
      const up = () => this.finishRowDrag();
      this._rowMove = move;
      this._rowUp = up;
      // passive：这两个监听不阻止默认行为，声明后不阻塞滚动/合成的路径
      window.addEventListener('mousemove', move, { passive: true });
      window.addEventListener('mouseup', up, { passive: true });
    },
    resolveRowIndexAt(clientY) {
      // 优先用拖拽开始时缓存的几何信息（无布局读取）
      const geom = this._rowGeom;
      if (geom && geom.length) {
        let best = null, min = Infinity;
        for (let i = 0; i < geom.length; i++) {
          if (!this.isRowDropTarget(this.rows[i])) continue;
          const r = geom[i];
          if (clientY >= r.top && clientY <= r.bottom) return i;
          const d = Math.min(Math.abs(clientY - r.top), Math.abs(clientY - r.bottom));
          if (d < min) { min = d; best = i; }
        }
        return best;
      }
      const trs = this.$el ? this.$el.querySelectorAll('tbody tr') : [];
      let best = null, min = Infinity;
      for (let i = 0; i < trs.length; i++) {
        if (!this.isRowDropTarget(this.rows[i])) continue;
        const r = trs[i].getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) return i; // 命中直接返回，避免被相邻行覆盖
        const d = Math.min(Math.abs(clientY - r.top), Math.abs(clientY - r.bottom));
        if (d < min) { min = d; best = i; }
      }
      return best;
    },
    // 应用最近一次待处理的拖拽位置（rAF 帧内执行；松手前也会强制冲刷一次，避免丢最后一帧）
    _applyRowMove() {
      if (!this._rowGhost || !this._rowPending) return;
      const ev = this._rowPending;
      // 跟手虚影自由跟随指针
      this.placeGhost(this._rowGhost, this._rowGrab, ev.clientX, ev.clientY);
      const idx = this.resolveRowIndexAt(ev.clientY);
      // 只有目标行变了才重算让位与落点（每帧无条件全量遍历是拖拽卡顿的主因）
      if (idx !== this.rowDragOverIdx) {
        this.rowDragOverIdx = idx;
        this._syncRowShift();
        this.updateRowDropBox();
      }
      // 边缘自动滚动（上下左右）：滚动后由 _onRowScrolled 同步几何缓存
      if (this._rowAutoScroll) this._rowAutoScroll.update(ev.clientX, ev.clientY);
    },
    // 行让位（移动语义）：按几何逐行补偿，行高不等（讲台/分隔/合并行）也不会错位
    _syncRowShift() {
      applyRowShift(this._rowEls, this.rowDragIdx, this.rowDragOverIdx, this._rowGeom, this._rowSlotH);
    },
    _clearRowShiftFx() {
      const tbody = this.$el ? this.$el.querySelector('tbody') : null;
      if (tbody) clearShift(tbody);
      this._rowEls = null;
      this._rowSlotH = 0;
    },
    // 容器滚动后同步行几何，保证命中判定与落点框跟手
    _onRowScrolled(mx, my) {
      const geom = this._rowGeom;
      if (geom) {
        for (const r of geom) {
          if (!r) continue;
          r.left -= mx; r.right -= mx; r.top -= my; r.bottom -= my;
        }
      }
      this.updateRowDropBox();
    },
    finishRowDrag() {
      if (this._rowMove) window.removeEventListener('mousemove', this._rowMove);
      if (this._rowUp) window.removeEventListener('mouseup', this._rowUp);
      this._rowMove = null;
      this._rowUp = null;
      if (this._rowRaf) { cancelAnimationFrame(this._rowRaf); this._rowRaf = null; }
      this._applyRowMove(); // 冲刷最后一帧
      // 松手位置：落位动画的起点
      const relRow = this._rowPending ? { x: this._rowPending.clientX, y: this._rowPending.clientY } : null;
      this._rowPending = null;
      this._rowGeom = null;
      this._rowGeomContainer = null;
      if (this._rowAutoScroll) { this._rowAutoScroll.stop(); this._rowAutoScroll = null; }
      if (this._rowGhost) { this._rowGhost.remove(); this._rowGhost = null; }
      if (this._rowSlotGhost) { this._rowSlotGhost.remove(); this._rowSlotGhost = null; }
      if (this._rowDropBox) { this._rowDropBox.remove(); this._rowDropBox = null; }
      const from = this.rowDragIdx, to = this.rowDragOverIdx;
      this.rowDragIdx = null;
      this.rowDragOverIdx = null;
      // 先清让位位移再重排：清位与重排在同一 tick，不会出现"先弹回原位"
      this._clearRowShiftFx();
      if (from === null || to === null || from === to) return;
      if (!this.isRowDropTarget(this.rows[to])) return;
      // 落位：抑制整表 FLIP（见 openRowsAnimWindow），松手只做一段从指针滑入落点的收尾
      this._noRowFlipOnce = true;
      this.$emit('swapRows', from, to);
      if (relRow) this.$nextTick(() => this._slideInRow(to, relRow));
    },
    // 松手滑入：被移动的这一行从「松手时的指针位置」滑到落点（X/Y 两个方向）
    _slideInRow(to, rel) {
      if (!rel) return;
      const trs = this.$el ? this.$el.querySelectorAll('tbody tr') : [];
      const tr = trs[to];
      if (!tr || typeof tr.animate !== 'function') return;
      const r = tr.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const dx = Math.round(rel.x - (r.left + r.width / 2));
      const dy = Math.round(rel.y - (r.top + r.height / 2));
      if (!dx && !dy) return;
      tr.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 200, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
      );
    },
    // 松手滑入：被移动的这一列（只数据格，表头不动）从指针位置滑到落点（X/Y 两个方向）
    _slideInCol(to, rel) {
      if (!rel) return;
      let base = null;
      for (let r = 0; r < this.rows.length; r++) {
        const refs = this.cellRefs[r];
        const el = refs ? refs[to] : null;
        if (el && el.isConnected) { base = el; break; }
      }
      if (!base) return;
      const br = base.getBoundingClientRect();
      const dx = Math.round(rel.x - (br.left + br.width / 2));
      const dy = Math.round(rel.y - (br.top + br.height / 2));
      if (!dx && !dy) return;
      for (let r = 0; r < this.rows.length; r++) {
        const refs = this.cellRefs[r];
        if (!refs) continue;
        const el = refs[to];
        if (!el || !el.isConnected || typeof el.animate !== 'function') continue;
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 200, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
        );
      }
    },
    // ---------- 列拖拽 ----------
    onColHandleDown(event, colIndex) {
      if (this.editingCell || this.editingMeta) return;
      if (this.colHeaders[colIndex] === '走廊') return;
      const table = this.$el.querySelector('table');
      const ths = this.colHeaderEls();
      const th = ths[this.colThOffset() + colIndex];
      if (!table || !th) return;
      event.preventDefault();
      const thRect = th.getBoundingClientRect();
      const rowRect = th.parentElement.getBoundingClientRect();
      const tblRect = table.getBoundingClientRect();
      // 虚影只取「数据区」，不含表头：本类表格拖动列时只移动数据，表头必须固定不动。
      // 数据区高度过小（空表）时退回整列区域，保证拖拽仍能发起。
      const dataTop = rowRect.bottom;
      const dataH = Math.max(0, tblRect.bottom - dataTop);
      const useDataOnly = dataH > 4;
      const ghostTop = useDataOnly ? dataTop : rowRect.top;
      const ghost = this.createSliceGhost(
        { left: thRect.left, top: ghostTop, width: thRect.width, height: Math.max(0, tblRect.bottom - ghostTop) }, 0.85
      );
      if (!ghost) return;
      this.colDragIdx = colIndex;
      this.colDragOverIdx = colIndex;
      this._colGhost = ghost;
      // 落点虚影在 updateColDropBox 里延迟创建
      this._colGrab = { grabX: event.clientX - thRect.left, grabY: event.clientY - ghostTop };
      // 跟手虚影：自由跟随指针
      this.placeGhost(ghost, this._colGrab, event.clientX, event.clientY);
      // 落点高亮框：包住即将落位的那一列（几何信息在此一次性缓存）
      this._cacheColGeom();
      // 让位：从 cellRefs 收集每列的数据单元格（只平移 td，表头 th 保持固定）
      const colEls = [];
      for (let r = 0; r < this.rows.length; r++) {
        const refs = this.cellRefs[r];
        if (!refs) continue;
        for (const key of Object.keys(refs)) {
          const k = Number(key);
          if (!Number.isInteger(k) || k < 0) continue;
          if (!colEls[k]) colEls[k] = [];
          if (refs[key]) colEls[k].push(refs[key]);
        }
      }
      // 走廊列是固定的分隔列，永远不参与让位（既不移动也不作为落点）
      this._colEls = colEls;
      const cg0 = this._colGeom ? this._colGeom[colIndex] : null;
      this._colSlotW = cg0 ? Math.round(cg0.right - cg0.left) : 0;
      this._colAutoScroll = createEdgeAutoScroll(
        () => this.$refs.gridTable,
        (mx, my) => this._onColScrolled(mx, my)
      );
      this._colDropBox = this.createDropBox();
      this.updateColDropBox();

      const move = (e) => {
        if (!this._colGhost) return;
        // rAF 对齐到帧：同一帧内多次 mousemove 只处理最后一次
        this._colPending = e;
        if (this._colRaf) return;
        this._colRaf = requestAnimationFrame(() => {
          this._colRaf = null;
          this._applyColMove();
        });
      };
      const up = () => this.finishColDrag();
      this._colMove = move;
      this._colUp = up;
      // passive：这两个监听不阻止默认行为，声明后不阻塞滚动/合成的路径
      window.addEventListener('mousemove', move, { passive: true });
      window.addEventListener('mouseup', up, { passive: true });
    },
    // 应用最近一次待处理的列拖拽位置（rAF 帧内执行；松手前也会强制冲刷一次）
    _applyColMove() {
      if (!this._colGhost || !this._colPending) return;
      const ev = this._colPending;
      // 跟手虚影自由跟随指针
      this.placeGhost(this._colGhost, this._colGrab, ev.clientX, ev.clientY);
      const hov = this.resolveColIndexAt(ev.clientX);
      // 目标列变了才重算让位与落点（每帧无条件全量遍历是拖拽卡顿的主因）
      if (hov !== this.colDragOverIdx) {
        this.colDragOverIdx = hov;
        this._syncColShift();
        this.updateColDropBox();
      }
      // 边缘自动滚动（上下左右）
      if (this._colAutoScroll) this._colAutoScroll.update(ev.clientX, ev.clientY);
    },
    // 列让位（移动语义）：只平移「数据单元格」，表头保持不动（座位/课表/值日表头固定）。
    // 位移按几何逐列补偿：同桌列 + 走廊列导致列宽不等，统一宽度会让中间列错位。
    _syncColShift() {
      applyColShift(this._colEls, this.colDragIdx, this.colDragOverIdx, this._colGeom, this._colSlotW);
    },
    _clearColShiftFx() {
      clearShift(this.$el);
      this._colEls = null;
      this._colSlotW = 0;
    },
    // 容器滚动后同步列几何（左右按 mx、表头/表底按 my）
    _onColScrolled(mx, my) {
      const geom = this._colGeom;
      if (geom) {
        for (const r of geom) {
          if (!r) continue;
          r.left -= mx; r.right -= mx;
        }
      }
      if (this._colGeomHeaderTop != null) this._colGeomHeaderTop -= my;
      if (this._colGeomTblBottom != null) this._colGeomTblBottom -= my;
      this.updateColDropBox();
    },
    resolveColIndexAt(clientX) {
      // 优先用拖拽开始时缓存的几何信息（无布局读取）
      const geom = this._colGeom;
      if (geom && geom.length) {
        let best = null, min = Infinity;
        for (let k = 0; k < geom.length; k++) {
          const r = geom[k];
          if (!r || r.aisle) continue; // 走廊列/空列不是落点目标（但几何仍参与让位补偿）
          if (clientX >= r.left && clientX <= r.right) return k; // 命中直接返回，避免被相邻列覆盖
          const d = Math.abs(clientX - (r.left + r.right) / 2);
          if (d < min) { min = d; best = k; }
        }
        return best;
      }
      const ths = this.colHeaderEls();
      const off = this.colThOffset();
      let best = null, min = Infinity;
      for (let i = 0; i < ths.length; i++) {
        const colIdx = i - off;
        const col = this.colHeaders[colIdx];
        if (colIdx < 0 || col === undefined || col === '走廊') continue;
        const r = ths[i].getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right) return colIdx; // 命中直接返回，避免被相邻列覆盖
        const d = Math.abs(clientX - (r.left + r.right) / 2);
        if (d < min) { min = d; best = colIdx; }
      }
      return best;
    },
    finishColDrag() {
      if (this._colMove) window.removeEventListener('mousemove', this._colMove);
      if (this._colUp) window.removeEventListener('mouseup', this._colUp);
      this._colMove = null;
      this._colUp = null;
      if (this._colRaf) { cancelAnimationFrame(this._colRaf); this._colRaf = null; }
      this._applyColMove(); // 冲刷最后一帧
      // 松手位置：列滑入动画的起点
      const relCol = this._colPending ? { x: this._colPending.clientX, y: this._colPending.clientY } : null;
      this._colPending = null;
      const from = this.colDragIdx, to = this.colDragOverIdx;
      this._colGeom = null;
      this._colGeomContainer = null;
      this._colGrab = null;
      if (this._colAutoScroll) { this._colAutoScroll.stop(); this._colAutoScroll = null; }
      if (this._colGhost) { this._colGhost.remove(); this._colGhost = null; }
      if (this._colSlotGhost) { this._colSlotGhost.remove(); this._colSlotGhost = null; }
      if (this._colDropBox) { this._colDropBox.remove(); this._colDropBox = null; }
      this.colDragIdx = null;
      this.colDragOverIdx = null;
      // 先清让位位移再重排（清位与重排同一 tick，不会先弹回原位）
      this._clearColShiftFx();
      if (from === null || to === null || from === to) return;
      // 落位：只给这一列的数据格播「从松手位置滑入」（表头不动）
      this.$emit('swapColumns', from, to);
      if (relCol) this.$nextTick(() => this._slideInCol(to, relCol));
    },
    // 单元格底色：走廊固定灰；若调用方在 cell 上给了 _bg（热力图等）则优先；否则按课程名配色
    getCellColor(cell) { if (cell._isAisle) return '#d1d5db'; if (cell._bg != null) return cell._bg; return COURSE_COLORS[cell.course] || '#FFFFFF'; },
    // 单元格文字色：调用方在 cell 上给了 _fg（深底白字）才覆盖，否则继承主题文字色
    getCellTextColor(cell) { return cell._fg || ''; },
  },
  watch: {
    // 行集合变化（数据初载、增删行、换行集）才开动画窗；改格子内容不会触发
    rowsKeySig() { this.openRowsAnimWindow(); },
  },
  mounted() {
    document.addEventListener('mouseup', this.handleGlobalMouseUp);
    // 首屏：数据区整体从左往右弹入
    this.playTableEnter();
  },
  // KeepAlive：从其它状态栏/页签切回来时重播数据区弹入动效
  activated() {
    if (this.firstActivate) { this.firstActivate = false; return; }
    this.playTableEnter();
  },
  beforeUnmount() {
    document.removeEventListener('mouseup', this.handleGlobalMouseUp);
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
th .drag-handle { color: color-mix(in srgb, var(--color-text-inverse, #ffffff) 70%, transparent); }
th:hover .drag-handle { color: var(--color-text-inverse, #ffffff); }
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
</style>