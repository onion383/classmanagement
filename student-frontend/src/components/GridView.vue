<template>
  <div class="grid-view-container" ref="gridContainer" style="min-height: 400px; position: relative;">
    <div ref="gridTable" class="overflow-auto border rounded">
      <table class="w-full border-collapse select-none">
        <thead>
          <tr v-if="title">
            <th :colspan="totalColumns" class="bg-green-500 text-white text-center py-2 text-lg font-bold">{{ title }}</th>
          </tr>
          <tr>
            <th v-if="showPeriodColumn && !hideMetaColumns" class="bg-green-500 text-white border border-gray-300 px-2 py-1 text-center" style="width: 80px;">时段</th>
            <th v-if="!hideMetaColumns" class="bg-green-500 text-white border border-gray-300 px-2 py-1 text-center" style="width: 100px;">节次</th>
            <th v-if="!hideMetaColumns" class="bg-green-500 text-white border border-gray-300 px-2 py-1 text-center" style="width: 130px;">时间</th>
            <!-- 行号列表头（绿色） -->
            <th v-if="hideMetaColumns && showRowNumber" class="bg-green-500 text-white border border-gray-300 px-2 py-1 text-center" style="width: 70px;">行号</th>
            <th
              v-for="(col, colIdx) in colHeaders"
              :key="colIdx"
              :draggable="col !== '走廊'"
              @dragstart="col !== '走廊' && onColDragStart($event, colIdx)"
              @dragover.prevent="onColDragOver($event, colIdx)"
              @dragleave="onColDragLeave($event, colIdx)"
              @drop="onColDrop($event, colIdx)"
              @dragend="onColDragEnd"
              :class="['bg-green-500 text-white border border-gray-300 px-2 py-1 text-center', col !== '走廊' ? 'cursor-pointer' : 'cursor-default bg-gray-400', { 'opacity-30': colDragIdx === colIdx }]"
              :style="col === '走廊' ? 'width: 60px;' : ''"
            >
              <div v-if="col !== '走廊'" class="flex items-center justify-center gap-1">
                <span class="drag-handle cursor-grab text-gray-300 hover:text-white">⠿</span>
                <span>{{ col }}</span>
              </div>
              <span v-else class="text-sm text-gray-200" style="writing-mode: vertical-lr; text-orientation: upright;">走廊</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <TransitionGroup name="row-flip" tag="">
            <tr
              v-for="(row, rowIdx) in rows"
              :key="row._rowKey || rowIdx"
              :class="[{ 'opacity-30': rowDragIdx === rowIdx }, rowDropIndicatorClass(rowIdx), row._isSeparator ? 'bg-gray-200 h-8' : '', row._isPodium ? 'bg-yellow-100 h-10' : '']"
              @dragover.prevent="onRowDragOver($event, rowIdx, row)"
              @dragleave="onRowDragLeave($event, rowIdx)"
              @drop="onRowDrop($event, rowIdx, row)"
              @dragend="onRowDragEnd"
            >
              <!-- 讲台行：行号列 + 合并剩余列 -->
              <template v-if="row._isPodium">
                <!-- 如果有行号列，先渲染一个讲台标识的单元格 -->
                <td v-if="hideMetaColumns && showRowNumber" class="bg-green-500 text-white border border-gray-300 text-center text-sm font-bold py-2" style="width: 70px;">讲台</td>
                <!-- 合并除行号列以外的所有列 -->
                <td :colspan="totalColumns - (hideMetaColumns && showRowNumber ? 1 : 0)" class="text-center font-bold text-gray-800 py-3 bg-yellow-200 border-b-2 border-yellow-400 text-lg">讲  台</td>
              </template>

              <!-- 原有分隔行 -->
              <td v-else-if="row._isSeparator" :colspan="totalColumns" class="text-center font-bold text-gray-700 py-2 bg-blue-50 border-b-2 border-blue-300">{{ row.label }}</td>
              <!-- 合并行 -->
              <td v-else-if="row._mergeCells" :colspan="totalColumns" class="border border-gray-300 px-2 py-1 text-center bg-gray-100 text-sm font-semibold">{{ row.label }} {{ row.time }}</td>
              <!-- 普通行 -->
              <template v-else>
                <td v-if="showPeriodColumn && !hideMetaColumns && row._periodRowSpan > 0" :rowspan="row._periodRowSpan" class="bg-green-100 border border-gray-300 px-2 py-1 text-center font-bold align-middle" style="vertical-align: middle;">{{ row.periodLabel }}</td>
                <td v-else-if="showPeriodColumn && !hideMetaColumns" class="hidden"></td>

                <td v-if="!hideMetaColumns" class="bg-green-500 text-white border border-gray-300 px-2 py-1 text-center font-bold" style="width: 100px;">
                  <div class="flex items-center justify-center gap-1">
                    <span v-if="canDragRow(row)" class="drag-handle cursor-grab select-none text-gray-300 hover:text-white" draggable="true" @dragstart.stop="onRowDragStart($event, rowIdx)" @dragend.stop="onRowDragEnd">⠿</span>
                    <span @dblclick.stop="startEditMeta(rowIdx, 'label')">
                      <input v-if="editingMeta && editingMeta.row === rowIdx && editingMeta.field === 'label'" v-model="editingMetaValue" class="w-20 border p-0 text-sm text-black" @keyup.enter="saveEditMeta(rowIdx)" @blur="saveEditMeta(rowIdx)" @mousedown.stop />
                      <span v-else>{{ row.label }}</span>
                    </span>
                  </div>
                </td>
                <td v-if="!hideMetaColumns" class="border border-gray-300 px-2 py-1 text-center text-sm" style="width: 130px;" @dblclick.stop="startEditMeta(rowIdx, 'time')">
                  <input v-if="editingMeta && editingMeta.row === rowIdx && editingMeta.field === 'time'" v-model="editingMetaValue" class="w-28 border p-0 text-sm" @keyup.enter="saveEditMeta(rowIdx)" @blur="saveEditMeta(rowIdx)" @mousedown.stop />
                  <span v-else>{{ row.time || '' }}</span>
                </td>

                <!-- 行号列（绿色背景，与节次列一致） -->
                <td v-if="hideMetaColumns && showRowNumber" class="bg-green-500 text-white border border-gray-300 text-center text-sm font-bold py-2" style="width: 70px;">
                  <div class="flex items-center justify-center gap-1">
                    <span v-if="canDragRow(row)" class="drag-handle cursor-grab select-none text-gray-300 hover:text-white" draggable="true" @dragstart.stop="onRowDragStart($event, rowIdx)" @dragend.stop="onRowDragEnd">⠿</span>
                    <span>{{ row.label }}</span>
                  </div>
                </td>

                <!-- 数据单元格 -->
                <template v-for="(cell, colIdx) in row.cells" :key="colIdx">
                  <td v-if="cell._isAisle && cell._aisleRowSpan" :rowspan="cell._aisleRowSpan" class="border border-gray-300 bg-gray-300 text-center align-middle" style="width: 60px; vertical-align: middle; font-size: 0.875rem; line-height: 1.2;"><div style="writing-mode: vertical-lr; text-orientation: upright;">走廊</div></td>
                  <td v-else-if="cell._isAisleHidden" style="display: none;"></td>
                  <td
                    v-else
                    :ref="el => setCellRef(rowIdx, colIdx, el)"
                    :class="['border border-gray-300 px-2 py-2 text-center transition-colors relative', isDragTarget(rowIdx, colIdx) ? 'bg-blue-100 outline outline-2 outline-blue-400' : '', isCellSelected(rowIdx, colIdx) && !isEditing(rowIdx, colIdx) ? 'bg-blue-100 outline outline-2 outline-blue-400' : '', isEditing(rowIdx, colIdx) ? 'ring-2 ring-blue-500 ring-inset' : '', row._isReadonly ? '' : 'cursor-pointer']"
                    :style="{ backgroundColor: isEditing(rowIdx, colIdx) ? '' : getCellColor(cell), minHeight: '40px', height: '40px' }"
                    @mousedown="onCellMouseDown($event, rowIdx, colIdx)"
                    @mouseenter="onCellMouseEnter(rowIdx, colIdx)"
                    @dblclick="onCellDoubleClick(rowIdx, colIdx)"
                  >
                    <div v-if="isEditing(rowIdx, colIdx)" class="absolute inset-0 flex items-center justify-center">
                      <input v-model="editingCellData.course" class="w-full h-full text-center text-sm bg-transparent outline-none border-none m-0 p-0" style="box-sizing: border-box;" placeholder="输入姓名" @keydown.enter.prevent="saveEditCell" @keydown.escape.prevent="cancelEdit" @blur="onEditBlur" @input="onEditInput(rowIdx, colIdx)" @mousedown.stop />
                    </div>
                    <template v-else>{{ cell.course || '' }}</template>
                  </td>
                </template>
              </template>
            </tr>
          </TransitionGroup>
        </tbody>
      </table>
    </div>

    <!-- 外挂候选列表 -->
    <div v-if="showCandidatePopup" class="fixed z-50 bg-white border border-blue-400 shadow-lg rounded" :style="{ left: candidatePopupX + 'px', top: candidatePopupY + 'px', width: '180px', maxHeight: '200px', overflow: 'auto' }" @mousedown.stop>
      <div v-if="filteredCandidates.length > 0">
        <div v-for="(item, idx) in filteredCandidates" :key="item.id" :class="['px-3 py-2 text-sm cursor-pointer hover:bg-blue-100', { 'bg-blue-200': idx === candidateHighlightIndex }]" @mousedown.prevent="candidateSelect(item)" @mouseenter="candidateHighlightIndex = idx">{{ item.姓名 }}</div>
      </div>
      <div v-else class="px-3 py-2 text-sm text-gray-400">无匹配学生</div>
    </div>
  </div>
</template>


<script>
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
    title: { type: String, default: '' },
    hideMetaColumns: { type: Boolean, default: false },
    showRowNumber: { type: Boolean, default: false },
    enableCandidate: { type: Boolean, default: false },
    candidateItems: { type: Array, default: () => [] },
    candidateExcludeIds: { type: Array, default: () => [] },
  },
  emits: ['update:cells', 'swapRows', 'swapColumns', 'update:row-meta', 'cell-dblclick'],
  data() {
    return {
      selecting: false, selectionStart: null, selectionEnd: null, longPressTimer: null, longPressActive: false,
      dragSource: null, dragTarget: null, _cellGhost: null,
      rowDragIdx: null, rowDragOverIdx: null, _rowGhost: null,
      colDragIdx: null, colDragOverIdx: null,
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
    filteredCandidates() {
      if (!this.enableCandidate || !this.editingCell) return [];
      let list = this.candidateItems.filter(s => !this.candidateExcludeIds.includes(s.id));
      const text = this.editingCellData.course?.trim() || '';
      if (text) { const kw = text.toLowerCase(); list = list.filter(s => s.姓名.toLowerCase().includes(kw)); }
      return list;
    },
  },
  methods: {
    setCellRef(rowIdx, colIdx, el) { if (el) { if (!this.cellRefs[rowIdx]) this.cellRefs[rowIdx] = {}; this.cellRefs[rowIdx][colIdx] = el; } },
    canDragRow(row) { return !row._isSeparator && !row._mergeCells && !row._isReadonly && !row._isPodium && !this.editingCell; },
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
    getSelectedCoords() {
      if (!this.selectionStart || !this.selectionEnd) return [];
      const minR = Math.min(this.selectionStart.row, this.selectionEnd.row), maxR = Math.max(this.selectionStart.row, this.selectionEnd.row);
      const minC = Math.min(this.selectionStart.col, this.selectionEnd.col), maxC = Math.max(this.selectionStart.col, this.selectionEnd.col);
      const coords = [];
      for (let r = minR; r <= maxR; r++) { if (this.rows[r]._isSeparator || this.rows[r]._mergeCells || this.rows[r]._isPodium) continue; for (let c = minC; c <= maxC; c++) coords.push({ row: r, col: c }); }
      return coords;
    },
    isCellSelected(rowIdx, colIdx) { return this.longPressActive ? false : this.getSelectedCoords().some(c => c.row === rowIdx && c.col === colIdx); },
    isDragTarget(rowIdx, colIdx) { return this.dragTarget && this.dragTarget.row === rowIdx && this.dragTarget.col === colIdx; },
    swapCells(r1, c1, r2, c2) {
      if (r1 === r2 && c1 === c2) return;
      const newRows = this.rows.map(r => (r._isSeparator || r._mergeCells || r._isPodium) ? r : { ...r, cells: [...r.cells] });
      [newRows[r1].cells[c1], newRows[r2].cells[c2]] = [{ ...newRows[r2].cells[c2] }, { ...newRows[r1].cells[c1] }];
      this.$emit('update:cells', newRows);
    },
    onCellDoubleClick(rowIdx, colIdx) {
      const row = this.rows[rowIdx]; if (!row || row._isSeparator || row._mergeCells || row._isReadonly || row._isPodium) return;
      if (this.editingCell) requestAnimationFrame(() => this.saveEditCell());
      this.$emit('cell-dblclick', { rowIdx, colIdx, row, cell: row.cells[colIdx] });
      this.clearLongPress(); this.selectionStart = null; this.selectionEnd = null;
      this.editingCell = { row: rowIdx, col: colIdx }; this.editingCellData = { ...row.cells[colIdx] };
      this.candidateHighlightIndex = 0; this.showCandidatePopup = this.enableCandidate;
      this.$nextTick(() => {
        const cellEl = this.cellRefs[rowIdx]?.[colIdx]; if (cellEl) { const input = cellEl.querySelector('input'); if (input) input.focus(); }
        if (this.enableCandidate) this.positionPopup(rowIdx, colIdx);
      });
    },
    positionPopup(rowIdx, colIdx) { const cellEl = this.cellRefs[rowIdx]?.[colIdx]; if (cellEl) { const rect = cellEl.getBoundingClientRect(); this.candidatePopupX = rect.left; this.candidatePopupY = rect.bottom; } },
    onEditInput(rowIdx, colIdx) { this.candidateHighlightIndex = 0; if (this.showCandidatePopup) this.positionPopup(rowIdx, colIdx); },
    saveEditCell() {
      if (!this.editingCell) return;
      const { row, col } = this.editingCell;
      const newRows = this.rows.map(r => (r._isSeparator || r._mergeCells || r._isPodium) ? r : { ...r, cells: [...r.cells] });
      newRows[row].cells[col] = { course: this.editingCellData.course || '' };
      this.$emit('update:cells', newRows);
      this.closeEditor();
    },
    cancelEdit() { this.closeEditor(); },
    closeEditor() { this.editingCell = null; this.showCandidatePopup = false; this.candidateHighlightIndex = 0; },
    onEditBlur() { if (this.editingCell) this.saveEditCell(); },
    candidateSelect(item) { if (item) this.editingCellData.course = item.姓名; this.saveEditCell(); },
    isEditing(rowIdx, colIdx) { return this.editingCell?.row === rowIdx && this.editingCell?.col === colIdx; },
    startEditMeta(rowIdx, field) { if (this.rows[rowIdx]._isSeparator || this.rows[rowIdx]._mergeCells || this.rows[rowIdx]._isPodium) return; if (this.editingCell) this.saveEditCell(); this.editingMeta = { row: rowIdx, field }; this.editingMetaValue = this.rows[rowIdx][field] || ''; this.$nextTick(() => this.$el.querySelector('input')?.focus()); },
    saveEditMeta(rowIdx) {
      if (!this.editingMeta || this.editingMeta.row !== rowIdx) return;
      const newValue = this.editingMetaValue.trim();
      if (newValue !== '') {
        const updatedRows = this.rows.map(r => ({ ...r }));
        updatedRows[rowIdx] = { ...updatedRows[rowIdx], [this.editingMeta.field]: newValue };
        this.$emit('update:row-meta', { rowIdx, field: this.editingMeta.field, value: newValue, rows: updatedRows });
      }
      this.editingMeta = null; this.editingMetaValue = '';
    },
    rowDropIndicatorClass(rowIdx) {
      if (this.rowDragIdx === null || this.rowDragOverIdx === null) return '';
      if (rowIdx !== this.rowDragOverIdx) return '';
      return this.rowDragOverIdx > this.rowDragIdx ? 'border-b-2 border-blue-500' : 'border-t-2 border-blue-500';
    },
    onRowDragStart(event, rowIdx) {
      if (this.rows[rowIdx]._isSeparator || this.rows[rowIdx]._isPodium) return;
      this.rowDragIdx = rowIdx;
      event.dataTransfer.effectAllowed = 'move';
      const row = this.rows[rowIdx];
      const ghost = document.createElement('div');
      ghost.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;z-index:10000;padding:6px 14px;background:white;border:1px solid #9ca3af;border-radius:4px;color:#1f2937;font-size:14px;';
      const names = (row.cells || []).slice(0, 3).map(c => c.course || '空').join('、');
      ghost.textContent = `${row.label} (${row.time}) ${names}`;
      document.body.appendChild(ghost); event.dataTransfer.setDragImage(ghost, 0, 0); this._rowGhost = ghost;
    },
    onRowDragOver(event, rowIdx, row) { if (row._isSeparator || row._mergeCells || row._isPodium) { this.rowDragOverIdx = null; return; } this.rowDragOverIdx = rowIdx; },
    onRowDragLeave(event, rowIdx) { if (this.rowDragOverIdx === rowIdx) this.rowDragOverIdx = null; },
    onRowDrop(event, targetIdx, row) { if (this.rowDragIdx === null || this.rowDragIdx === targetIdx) { this.rowDragIdx = null; this.rowDragOverIdx = null; return; } if (row._isSeparator || row._mergeCells || row._isPodium) { this.rowDragIdx = null; this.rowDragOverIdx = null; return; } this.$emit('swapRows', this.rowDragIdx, targetIdx); this.rowDragIdx = null; this.rowDragOverIdx = null; },
    onRowDragEnd() { this.rowDragIdx = null; this.rowDragOverIdx = null; if (this._rowGhost) { document.body.removeChild(this._rowGhost); this._rowGhost = null; } },
    onColDragStart(event, colIdx) { this.colDragIdx = colIdx; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setDragImage(event.target, 0, 0); },
    onColDragOver(event, colIdx) { this.colDragOverIdx = colIdx; },
    onColDragLeave(event, colIdx) { if (this.colDragOverIdx === colIdx) this.colDragOverIdx = null; },
    onColDrop(event, targetIdx) { if (this.colDragIdx === null || this.colDragIdx === targetIdx) { this.colDragIdx = null; this.colDragOverIdx = null; return; } this.$emit('swapColumns', this.colDragIdx, targetIdx); this.colDragIdx = null; this.colDragOverIdx = null; },
    onColDragEnd() { this.colDragIdx = null; this.colDragOverIdx = null; },
    getCellColor(cell) { if (cell._isAisle) return '#d1d5db'; return COURSE_COLORS[cell.course] || '#FFFFFF'; },
  },
  mounted() { document.addEventListener('mouseup', this.handleGlobalMouseUp); },
  beforeUnmount() { document.removeEventListener('mouseup', this.handleGlobalMouseUp); this.clearLongPress(); this.removeCellGhost(); if (this._rowGhost) document.body.removeChild(this._rowGhost); },
};
</script>

<style scoped>
.drag-handle { font-size: 14px; user-select: none; opacity: 0.6; }
.drag-handle:hover { opacity: 1; }
th .drag-handle { color: rgba(255,255,255,0.7); }
th:hover .drag-handle { color: white; }
.row-flip-move { transition: transform 0.25s ease; }
.row-flip-enter-active, .row-flip-leave-active { transition: all 0.25s ease; }
.row-flip-enter-from, .row-flip-leave-to { opacity: 0; transform: translateX(-20px); }
</style>