<template>
  <div
    class="table-scroll-wrapper"
    :class="{ 'overflow-y-auto': enableVerticalScroll, 'is-scrollable': enableVerticalScroll }"
    :style="enableVerticalScroll ? { maxHeight: '400px' } : {}"
  >
    <table class="w-full border-collapse mt-0">
      <thead class="sticky top-0 z-10">
        <tr ref="theadRow">
          <TransitionGroup name="col-flip" tag="">
          <!-- 全选复选框（可通过 hideSelectAll 隐藏，但列始终存在） -->
          <th
            v-if="!readonly"
            key="col-checkbox"
            class="bg-primary text-text-inverse border border-border px-1 py-1 text-center w-8 col-static"
          >
            <input
              v-if="!hideSelectAll"
              type="checkbox"
              :checked="isAllSelected"
              :indeterminate.prop="isIndeterminate"
              @change="toggleAllSelect"
              :disabled="!!editingCell"
              class="cursor-pointer"
            />
          </th>

          <!-- 数据列（可拖拽，手动指针拖拽以避开浏览器原生拖拽图居中问题） -->
          <th
            v-for="(field, colIndex) in fields"
            :key="field.name"
            @contextmenu.prevent="$emit('contextmenu', $event, 'header', field)"
            :class="[
              'bg-primary text-text-inverse border border-border px-2 py-1 text-center cursor-context-menu select-none',
              { 'opacity-30': colDragIndex === colIndex }
            ]"
            class="col-header"
          >
            <div class="flex items-center justify-center gap-1">
              <span
                v-if="!readonly"
                class="drag-handle cursor-grab text-text-inverse/70 hover:text-text-inverse select-none"
                title="按住拖动列"
                @mousedown.prevent="onColHandleDown($event, colIndex)"
                @contextmenu.stop.prevent
              >⠿</span>
              <span @click.stop="$emit('search', field.name)" class="cursor-pointer">
                {{ field.name === 'id' ? 'ID' : field.name }}<span v-if="isProtectedField(field)" class="text-warning ml-0.5" title="核心字段，禁止删除">*</span>
              </span>
              <span class="flex flex-col text-xs cursor-pointer" @click.stop="$emit('toggleSort', field.name)">
                <span :class="sortField === field.name && sortOrder === 'asc' ? 'text-warning' : 'text-text-inverse/70'">▲</span>
                <span :class="sortField === field.name && sortOrder === 'desc' ? 'text-warning' : 'text-text-inverse/70'">▼</span>
              </span>
            </div>
          </th>

          <!-- 操作列（固定） -->
          <th
            v-if="!readonly"
            key="col-op"
            class="bg-primary text-text-inverse border border-border px-2 py-1 text-center col-op"
          >
            操作
          </th>
          </TransitionGroup>
        </tr>
      </thead>

      <tbody ref="tbodyRef">
        <TransitionGroup
          name="row-flip"
          tag=""
        >
          <tr
            v-for="(row, rowIndex) in rows"
            :key="row._rowKey"
            @contextmenu.prevent="$emit('contextmenu', $event, row._isNew ? 'newRow' : 'row', row)"
            :class="[
              'data-drag-item content-visibility-auto',
              { 'opacity-30': dragIndex === rowIndex },
              { 'bg-surface-hover': selectedKeySet.has(row._rowKey) && !editingCell },
              row._isSeparator ? 'h-4 bg-border' : ''
            ]"
            class="transition-all duration-200 ease-in-out"
          >
            <!-- 分隔行：只显示一个跨列的空单元格 -->
            <td v-if="row._isSeparator" :colspan="(fields ? fields.length : 0) + 2"></td>

            <!-- 普通行 -->
            <template v-else>
              <!-- 复选框 -->
              <td v-if="!readonly" class="border border-border px-1 text-center align-middle w-8" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedKeySet.has(row._rowKey)"
                  @change="toggleRowSelect(row._rowKey)"
                  :disabled="!!editingCell"
                  class="cursor-pointer"
                />
              </td>

              <!-- 数据列 -->
              <td
                v-for="(field, fieldIndex) in fields"
                :key="field.name"
                class="border border-border px-2 py-1 text-center relative pl-6"
                :class="{
                  'cell-active':
                    !isEditing(row, field.name) &&
                    activeCell &&
                    activeCell.rowKey === row._rowKey &&
                    activeCell.field === field.name
                }"
                @click="onCellClick(row, field)"
              >
                <!-- 拖拽手柄（仅在非去重模式或允许移动时显示，按住拖行） -->
                <span
                  v-if="fieldIndex === 0 && !hideMoveButtons && !readonly"
                  class="absolute left-1 top-1/2 -translate-y-1/2 drag-handle cursor-grab select-none text-text-muted hover:text-text-secondary"
                  title="按住拖动行"
                  @mousedown.prevent="onRowHandleDown($event, rowIndex)"
                  @contextmenu.stop.prevent
                >⠿</span>

                <template v-if="field.name === 'id'">{{ row._isNew ? '自动' : row.id }}</template>
                <template v-else-if="field.name === 'position'">{{ row._isNew ? '-' : row._displayIndex }}</template>
                <template v-else-if="field.name === '收据'">
                  <button @click="$emit('manageReceipt', { row, isNew: row._isNew })" class="bg-primary text-text-inverse border-none py-1 px-2 rounded text-xs cursor-pointer">管理收据{{ row._isNew ? '' : ' (' + getReceiptCount(row) + ')' }}</button>
                </template>
                <template v-else-if="field.control === 'select'">
                  <AppSelect
                    v-if="row._isNew || isEditing(row, field.name)"
                    v-model="row[field.name]"
                    :options="cellSelectOptions(field)"
                    @change="row._isNew ? $emit('updateNewRow', field.name, $event) : $emit('saveCell', row, field)"
                    class="w-full"
                  />
                  <span v-else @dblclick="$emit('startEdit', row, field)" class="block w-full min-h-[24px] leading-6 px-1 cursor-default">{{ row[field.name] || '' }}</span>
                </template>
                <template v-else-if="field.type === '日期' || field.control === 'datepicker'">
                  <input type="date" v-if="row._isNew || isEditing(row, field.name)" v-model="row[field.name]" @blur="row._isNew ? null : $emit('saveCell', row, field)" class="w-full h-6 leading-6 px-1 py-0 border border-transparent bg-warning/10 focus:outline-none focus:border-primary box-border" />
                  <span v-else @dblclick="$emit('startEdit', row, field)" class="block w-full min-h-[24px] leading-6 px-1 cursor-default">{{ row[field.name] || '' }}</span>
                </template>
                <template v-else>
                  <input
                    v-if="row._isNew || isEditing(row, field.name)"
                    v-model="row[field.name]"
                    @blur="onCellBlur(row, field)"
                    @keyup.enter="onCellEnter(row, field)"
                    class="w-full h-6 leading-6 px-1 py-0 border border-transparent bg-warning/10 focus:outline-none focus:border-primary box-border"
                    :placeholder="field.name"
                    :ref="row._isNew ? 'newRowInput' : 'editInput-' + row._rowKey + '-' + field.name"
                  />
                  <span v-else @dblclick="$emit('startEdit', row, field)" class="block w-full min-h-[24px] leading-6 px-1 cursor-default">{{ row[field.name] != null ? row[field.name] : '' }}</span>
                </template>
              </td>

              <!-- 操作列 -->
              <td v-if="!readonly" class="col-op border border-border px-2 py-1 text-center whitespace-nowrap">
                <template v-if="row._isNew">
                  <button @click="$emit('saveNewRow')" class="bg-info text-text-inverse border-none py-0.5 px-2 mr-1 cursor-pointer rounded">保存</button>
                  <button @click="$emit('cancelNewRow')" class="bg-text-muted text-text-inverse border-none py-0.5 px-2 cursor-pointer rounded">取消</button>
                </template>
                <template v-else>
                  <!-- 上移 / 下移（仅在非去重模式显示） -->
                  <button
                    v-if="!hideMoveButtons"
                    @click="$emit('moveRow', row, 'up')"
                    class="move-arrow-btn bg-text-muted text-text-inverse border border-border/40 py-0.5 px-1.5 mr-0.5 cursor-pointer rounded"
                    title="上移"
                  >↑</button>
                  <button
                    v-if="!hideMoveButtons"
                    @click="$emit('moveRow', row, 'down')"
                    class="move-arrow-btn bg-text-muted text-text-inverse border border-border/40 py-0.5 px-1.5 mr-0.5 cursor-pointer rounded"
                    title="下移"
                  >↓</button>
                  <!-- 删除按钮始终保留 -->
                  <button @click="$emit('deleteRow', row.id)" class="bg-danger text-text-inverse border-none py-0.5 px-2 cursor-pointer rounded">删除</button>
                </template>
              </td>
            </template>
          </tr>
        </TransitionGroup>

        <transition name="add-row-flip" :duration="addRowAnimated ? undefined : 0">
          <tr v-if="!hasNewRow && !readonly && !hideAddRow" :key="'add-row-' + addRowAnimKey" class="bg-bg cursor-pointer" @click="$emit('addNewRowAtBottom')">
            <td :colspan="(fields ? fields.length : 0) + 2" class="text-center py-2 text-primary font-medium">
              ＋ 点击添加一行
            </td>
          </tr>
        </transition>
      </tbody>
    </table>
  </div>
</template>

<script>
import AppSelect from '../base/AppSelect.vue'
export default {
  name: 'DynamicTable',
  components: { AppSelect },
  props: {
    fields: { type: Array, required: true },
    rows: { type: Array, required: true },
    newRow: { type: Object, default: null },
    sortField: { type: String, default: '' },
    sortOrder: { type: String, default: 'asc' },
    editingCell: { type: Object, default: null },
    maxRows: { type: Number, default: 10 },
    hideSelectAll: { type: Boolean, default: false },
    hideMoveButtons: { type: Boolean, default: false },   // 新增：控制移动按钮和拖拽手柄的显示
    hideAddRow: { type: Boolean, default: false },        // 新增：隐藏底部「点击添加一行」
    noRowDrag: { type: Boolean, default: false },         // 新增：禁用整行拖拽（避免与双击内联编辑冲突）
    editOnClick: { type: Boolean, default: false },       // 新增：单击单元格直接进入编辑（配合失焦保存）
    readonly: { type: Boolean, default: false },          // 新增：纯只读展示（历史快照等）
    protectedColumns: { type: Array, default: () => [] }  // 受保护字段：表头名后加 *，提示不可删除
  },
  emits: [
    'contextmenu', 'search', 'toggleSort', 'saveNewRow', 'cancelNewRow',
    'startEdit', 'saveCell', 'moveRow', 'deleteRow', 'addNewRowAtBottom',
    'updateNewRow', 'manageReceipt', 'swapRows', 'swapColumns', 'moveSelectedRows',
    'selectionChange',
  ],
  data() {
    return {
      activeCell: null,
      internalEditCell: null,
      selectedRowKeys: [],
      dragIndex: null,
      dragOverIndex: null,
      colDragIndex: null,
      colDragOverIndex: null,
      _dragGhost: null,
      _colDragGhost: null,
      _rowDropBox: null,
      _colDropBox: null,
      // 底部「添加一行」行动画开关：默认开启，首屏与取消重现都播放上浮动效
      addRowAnimated: true,
      // 底部行 key：切换状态栏重新激活时递增，强制重建以重播上浮动画
      addRowAnimKey: 0,
      firstActivate: true,
    };
  },
  computed: {
    hasNewRow() { return this.rows && this.rows.some(r => r._isNew); },
    enableVerticalScroll() { return (this.rows || []).length > this.maxRows; },
    // 选中行键集合：O(n) 建一次，模板内 O(1) 查用，避免整张表 O(n²) 的 includes 查找
    selectedKeySet() { return new Set(this.selectedRowKeys); },
    isAllSelected() {
      const normalRows = (this.rows || []).filter(r => !r._isSeparator);
      return normalRows.length > 0 && normalRows.every(r => this.selectedKeySet.has(r._rowKey));
    },
    isIndeterminate() {
      const normalRows = (this.rows || []).filter(r => !r._isSeparator);
      const s = this.selectedKeySet.size;
      return s > 0 && s < normalRows.length;
    },
  },
  watch: {
    hasNewRow(val) {
      // 取消新增行 → 底部添加行重现，仅此后播放上浮动画
      if (!val) this.addRowAnimated = true;
    },
    'rows.length'() { this.$nextTick(() => this.focusOnNewRow()); },
    editingCell: {
      handler(newVal) {
        if (newVal) {
          this.$nextTick(() => {
            const key = 'editInput-' + newVal.rowKey + '-' + newVal.field;
            const inputs = this.$refs[key];
            if (inputs && inputs[0]) inputs[0].focus();
          });
          document.addEventListener('click', this.handleClickOutside);
        } else {
          document.removeEventListener('click', this.handleClickOutside);
        }
      },
      immediate: true,
    },
    rows: {
      handler(newVal, oldVal) {
        // 先构建行键集合再过滤，避免选中项多 + 行数大时的 O(n×m) 逐条 some
        const keys = new Set(newVal.map(r => r._rowKey));
        this.selectedRowKeys = this.selectedRowKeys.filter(key => keys.has(key));
        // 仅当「新增行被保存/取消」（由有 → 无）时才重算列宽并钉住；
        // 普通增删/移动行前后都没有新增行，列宽不会因新增输入而变，无需测量
        const prevHadNew = (oldVal || []).some(r => r._isNew);
        const nowHasNew = newVal.some(r => r._isNew);
        if (prevHadNew && !nowHasNew && !this.editingCell) {
          this.$nextTick(() => {
            clearTimeout(this._snapshotTimer);
            this._snapshotTimer = setTimeout(() => this.snapshotWidths(), 280);
          });
        }
      },
      immediate: true,
    },
    fields: {
      handler() {
        // 增删/改名/移动列后重算列宽
        this.$nextTick(() => this.snapshotWidths());
      },
      immediate: true,
    },
    selectedRowKeys: {
      handler() {
        this.$emit('selectionChange', {
          count: this.selectedRowKeys.length,
          keys: [...this.selectedRowKeys]
        });
      },
      immediate: true,
    },
  },
  mounted() {
    this.focusOnNewRow();
    // 首屏：数据区整体从左往右弹入
    this.playTableEnter();
    // 整表 Enter 保存新增行：焦点不在输入框时按回车也触发保存
    document.addEventListener('keydown', this.handleGlobalEnter);
  },
  // KeepAlive：从其它状态栏/页签切换回来时重播数据区整体弹入动效
  // （取消新增行后「添加一行」重现的上浮动效由 hasNewRow 驱动，不在此处触发，
  //   否则它会和 tbody 整体滑入叠加造成闪动）
  activated() {
    if (this.firstActivate) { this.firstActivate = false; return; }
    this.playTableEnter();
  },
  beforeUnmount() {
    document.removeEventListener('click', this.handleClickOutside);
    document.removeEventListener('keydown', this.handleGlobalEnter);
    if (this._dragGhost) this._dragGhost.remove();
    if (this._rowGhost) this._rowGhost.remove();
    if (this._rowMove) window.removeEventListener('mousemove', this._rowMove);
    if (this._rowUp) window.removeEventListener('mouseup', this._rowUp);
    if (this._colGhost) this._colGhost.remove();
    if (this._colMove) window.removeEventListener('mousemove', this._colMove);
    if (this._colUp) window.removeEventListener('mouseup', this._colUp);
    if (this._rowDropBox) this._rowDropBox.remove();
    if (this._colDropBox) this._colDropBox.remove();
    clearTimeout(this._snapshotTimer);
    if (this._snapshotRaf) cancelAnimationFrame(this._snapshotRaf);
    if (this._tableEnterCleanup) this._tableEnterCleanup();
  },
  methods: {
    // 判断字段是否受保护（受保护字段在表头显示 * 提示）
    isProtectedField(field) { return this.protectedColumns.includes(field.name); },
    // 数据区(tbody)整体从左往右弹入：不动 DOM 结构、不加 key，
    // 通过临时加一次性 keyframe 类播放动画（与课程表单行 row-flip 方向一致）。
    // 动画结束后移除类，保证下次导航能重新触发。
    playTableEnter() {
      const tbody = this.$refs.tbodyRef;
      if (!tbody) return;
      // 清理上次监听
      if (this._tableEnterCleanup) this._tableEnterCleanup();
      const onEnd = (e) => { if (e && e.target !== tbody) return; this._tableEnterCleanup(); };
      this._tableEnterCleanup = () => {
        const t = tbody;
        if (!t) return;
        t.classList.remove('table-enter');
        t.removeEventListener('animationend', onEnd);
        this._tableEnterCleanup = null;
      };
      tbody.addEventListener('animationend', onEnd);
      // 强制重排后再加类，保证重复导航时动画能重播
      void tbody.offsetWidth;
      tbody.classList.add('table-enter');
    },
    // 按当前「内容」量出自然自适应列宽，并立刻切到 fixed 布局钉住，
    // 这样新增行里空 input 不会撑宽窄列，动画前后列宽都稳定
    snapshotWidths() {
      if (!this.$el) return;
      // 等首帧绘制完成后再测量/钉住列宽，避免首次进入页面时列宽跳变产生的 layout shift
      if (this._snapshotRaf) cancelAnimationFrame(this._snapshotRaf);
      this._snapshotRaf = requestAnimationFrame(() => this._doSnapshotWidths());
    },
    _doSnapshotWidths() {
      this._snapshotRaf = null;
      const tbl = this.$el.querySelector('table');
      const ths = this.$el.querySelectorAll('thead th');
      if (!tbl || !ths.length) return;
      tbl.style.tableLayout = ''; // 临时 auto，让浏览器按真实内容算出自然宽
      const widths = [...ths].map(th => th.getBoundingClientRect().width);
      tbl.style.tableLayout = 'fixed'; // 回固定布局，钉住列宽
      [...ths].forEach((th, i) => {
        const w = widths[i];
        if (!w) return;
        // 已有固定宽度；仅当新宽度与当前相差 >2px 才更新，抑制内容微变导致的表头 1~2px 抖动
        const cur = parseFloat(th.style.width || '');
        if (Number.isFinite(cur) && Math.abs(cur - w) <= 2) return;
        th.style.width = w + 'px';
      });
    },
    cellSelectOptions(field) {
      // 保留原来「空选项」的清除语义：把空串作为首项
      return ['', ...(field.options || [])]
    },
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
    updateRowDropBox() {
      const box = this._rowDropBox;
      if (!box) return;
      const trs = this.$el ? this.$el.querySelectorAll('tbody tr') : [];
      const tr = this.dragOverIndex === null ? null : trs[this.dragOverIndex];
      if (!tr) { box.style.display = 'none'; return; }
      const r = tr.getBoundingClientRect();
      this.updateDropBox(box, { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, this.$el);
    },
    updateColDropBox() {
      const box = this._colDropBox;
      if (!box) return;
      const tbl = this.$el ? this.$el.querySelector('table') : null;
      const th = this.colDragOverIndex === null ? null : this.$el.querySelectorAll('thead th')[this.colDragOverIndex + 1];
      if (!tbl || !th) { box.style.display = 'none'; return; }
      const r = th.getBoundingClientRect();
      const headerRow = th.parentElement.getBoundingClientRect();
      const tblRect = tbl.getBoundingClientRect();
      this.updateDropBox(box, { left: r.left, top: headerRow.top, right: r.right, bottom: tblRect.bottom }, this.$el);
    },

    onRowHandleDown(event, index) {
      if (this.noRowDrag || this.readonly) return;
      const row = this.rows[index];
      if (!row || row._isNew || row._isSeparator) return;
      if (this.selectedRowKeys.length > 1 && !this.selectedKeySet.has(row._rowKey)) return;
      const trEl = (event.currentTarget instanceof Element && event.currentTarget.closest('tr')) || null;
      event.preventDefault();
      this.dragIndex = index;
      this.dragOverIndex = index;
      this._suppressCellClick = true; // 压制从手柄冒出的 click
      // 自绘 fixed 虚影（不用原生拖拽图，避免被浏览器居中/卡住）
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;left:0;top:0;z-index:100000;pointer-events:none;opacity:0.85;will-change:transform;box-shadow:0 6px 18px rgba(0,0,0,0.18);border-radius:4px;';
      let grabX = 16, grabY = 12;
      if (this.selectedRowKeys.length > 1) {
        // 多选：整批胶囊
        const selectedRows = this.rows.filter(r => this.selectedRowKeys.includes(r._rowKey) && !r._isNew && !r._isSeparator);
        const names = selectedRows.slice(0, 2).map(r => r['姓名'] || r['收支编码'] || '项目');
        let text = '🚚 ' + names.join('、');
        if (selectedRows.length > 2) text += ` 等${selectedRows.length}项`;
        const pill = document.createElement('div');
        pill.textContent = text;
        pill.style.cssText = 'padding:6px 10px;background:rgba(219,234,254,0.95);border:2px solid #3b82f6;border-radius:6px;color:#1e3a8a;font-weight:bold;font-size:13px;white-space:nowrap;';
        wrapper.appendChild(pill);
        grabX = -14; grabY = -8; // 胶囊出现在指针右下角
      } else if (trEl) {
        // 单选：忠实克隆整行（样式/颜色/字号与表格一致），装进单行 table 以保留单元格布局
        const r = trEl.getBoundingClientRect();
        const clone = trEl.cloneNode(true);
        clone.classList.remove('content-visibility-auto', 'opacity-30');
        clone.style.transition = 'none';
        const srcTds = trEl.querySelectorAll('td,th');
        // 逐列记录原件真实宽度，克隆后按固定表格布局还原，避免列被挤压变形
        const colWidths = Array.from(srcTds).map(td => td.getBoundingClientRect().width);
        clone.querySelectorAll('td,th').forEach((td, i) => {
          td.style.transition = 'none';
          if (colWidths[i] > 0) td.style.width = colWidths[i] + 'px';
          td.style.overflow = 'hidden';
        });
        const tbl = document.createElement('table');
        tbl.style.cssText = 'border-collapse:collapse;table-layout:fixed;width:' + r.width + 'px;';
        // 继承原行字体，保证字号/字族/颜色与表格一致
        const cs = getComputedStyle(srcTds[0] || trEl);
        tbl.style.fontFamily = cs.fontFamily;
        tbl.style.fontSize = cs.fontSize;
        tbl.style.lineHeight = cs.lineHeight;
        tbl.style.color = cs.color;
        tbl.style.background = getComputedStyle(srcTds[0]).backgroundColor;
        const tbody = document.createElement('tbody');
        tbody.appendChild(clone);
        tbl.appendChild(tbody);
        wrapper.appendChild(tbl);
        grabX = Math.min(30, event.clientX - r.left);
        grabY = event.clientY - r.top;
      }
      document.body.appendChild(wrapper);
      this._rowGhost = wrapper;
      this._rowGrab = { grabX, grabY };
      wrapper.style.transform = `translate(${event.clientX - grabX}px, ${event.clientY - grabY}px)`;
      // 落点高亮框：包住即将落位的那一行
      this._rowDropBox = this.createDropBox();
      this.updateRowDropBox();

      const move = (e) => {
        if (!this._rowGhost) return;
        const g = this._rowGrab || { grabX: 0, grabY: 0 };
        this._rowGhost.style.transform = `translate(${e.clientX - g.grabX}px, ${e.clientY - g.grabY}px)`;
        this.dragOverIndex = this.resolveRowIndexAt(e.clientY);
        this.updateRowDropBox();
      };
      const up = () => this.finishRowDrag();
      this._rowMove = move;
      this._rowUp = up;
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    resolveRowIndexAt(clientY) {
      const trs = this.$el ? this.$el.querySelectorAll('tbody tr') : [];
      let best = null, min = Infinity;
      trs.forEach((tr, i) => {
        const r = tr.getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) { best = i; return; }
        const d = Math.min(Math.abs(clientY - r.top), Math.abs(clientY - r.bottom));
        if (d < min) { min = d; best = i; }
      });
      return best;
    },
    finishRowDrag() {
      if (this._rowMove) window.removeEventListener('mousemove', this._rowMove);
      if (this._rowUp) window.removeEventListener('mouseup', this._rowUp);
      this._rowMove = null;
      this._rowUp = null;
      if (this._rowGhost) { this._rowGhost.remove(); this._rowGhost = null; }
      if (this._rowDropBox) { this._rowDropBox.remove(); this._rowDropBox = null; }
      const from = this.dragIndex;
      const to = this.dragOverIndex;
      this.dragIndex = null;
      this.dragOverIndex = null;
      if (from === null || to === null || from === to) return;
      const movedRow = this.rows[from];
      if (this.selectedRowKeys.length > 1 && this.selectedRowKeys.includes(movedRow._rowKey)) {
        const selectedKeys = this.selectedRowKeys.filter(key => this.rows.some(r => r._rowKey === key && !r._isSeparator));
        this.$emit('moveSelectedRows', { selectedKeys, oldIndex: from, newIndex: to, isDownward: to > from });
      } else {
        this.$emit('swapRows', from, to);
      }
    },

    // ==================== 手动列拖拽（不用原生 HTML5 drag，完全可控，无浏览器居中问题） ====================
    onColHandleDown(event, colIndex) {
      if (this.readonly || this.editingCell) return;
      event.preventDefault();
      this.colDragIndex = colIndex;
      this.colDragOverIndex = colIndex;

      // 构建“整列”虚影：克隆表头 + 该列所有数据单元格，装进真正的 <table>（保留边框/行高/字体/宽度，视觉与原件一致）
      const tbl = this.$el.querySelector('table');
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;left:0;top:0;z-index:100000;pointer-events:none;opacity:0.7;will-change:transform;box-shadow:0 6px 18px rgba(0,0,0,0.18);';
      const ths = tbl ? tbl.querySelectorAll('thead th') : [];
      const src = ths[colIndex + 1] || event.currentTarget;
      const colWidth = src.getBoundingClientRect().width;
      // 继承原列字体，保证字号/字族/颜色一致
      const cs = getComputedStyle(src);
      const ghostTable = document.createElement('table');
      ghostTable.style.cssText =
        'border-collapse:collapse;table-layout:fixed;width:' + colWidth +
        'px;font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize +
        ';line-height:' + cs.lineHeight + ';color:' + cs.color + ';';

      const thead = document.createElement('thead');
      const thRow = document.createElement('tr');
      const th = src.cloneNode(true);
      th.classList.remove('opacity-30');
      th.style.transition = 'none';
      th.style.width = colWidth + 'px';
      th.style.overflow = 'hidden';
      thRow.appendChild(th);
      thead.appendChild(thRow);
      ghostTable.appendChild(thead);

      const tbody = document.createElement('tbody');
      if (tbl) tbl.querySelectorAll('tbody tr').forEach(tr => {
        const td = tr.children[colIndex + 1];
        if (td) {
          const tdRow = document.createElement('tr');
          const tdClone = td.cloneNode(true);
          tdClone.style.transition = 'none';
          tdClone.style.width = colWidth + 'px';
          tdClone.style.overflow = 'hidden';
          tdRow.appendChild(tdClone);
          tbody.appendChild(tdRow);
        }
      });
      ghostTable.appendChild(tbody);
      wrapper.appendChild(ghostTable);
      document.body.appendChild(wrapper);

      // 抓取偏移：按下点在源表头内相对位置 → 全程保证“指针正对抓取点”
      const rect = src.getBoundingClientRect();
      const grabX = event.clientX - rect.left;
      const grabY = event.clientY - rect.top;
      this._colGhost = wrapper;
      wrapper.style.transform = `translate(${event.clientX - grabX}px, ${event.clientY - grabY}px)`;
      // 落点高亮框：包住即将落位的那一列
      this._colDropBox = this.createDropBox();
      this.updateColDropBox();

      const move = (e) => {
        if (!this._colGhost) return;
        this._colGhost.style.transform = `translate(${e.clientX - grabX}px, ${e.clientY - grabY}px)`;
        const hov = this.resolveColIndexAt(e.clientX);
        if (hov !== null) this.colDragOverIndex = hov;
        this.updateColDropBox();
      };
      const up = () => this.finishColDrag();
      this._colMove = move;
      this._colUp = up;
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    resolveColIndexAt(clientX) {
      const ths = this.$el ? this.$el.querySelectorAll('thead th') : [];
      const hasOp = !!this.$el && !!this.$el.querySelector('th.col-op');
      let best = null;
      let minDist = Infinity;
      for (let i = 1; i < ths.length; i++) {
        if (i === ths.length - 1 && hasOp) continue; // 跳过操作列
        const r = ths[i].getBoundingClientRect();
        if (clientX >= r.left - 2 && clientX <= r.right + 2) return i - 1; // 直接命中该列
        const center = (r.left + r.right) / 2;
        const d = Math.abs(clientX - center);
        if (d < minDist) { minDist = d; best = i - 1; }
      }
      return best; // 落在间隙，取最近邻列
    },
    finishColDrag() {
      if (this._colMove) window.removeEventListener('mousemove', this._colMove);
      if (this._colUp) window.removeEventListener('mouseup', this._colUp);
      this._colMove = null;
      this._colUp = null;
      const from = this.colDragIndex;
      const to = this.colDragOverIndex;
      if (this._colGhost) { this._colGhost.remove(); this._colGhost = null; }
      if (this._colDropBox) { this._colDropBox.remove(); this._colDropBox = null; }
      if (from !== null && to !== null && from !== to && to >= 0) {
        this.$emit('swapColumns', from, to);
      }
      this.colDragIndex = null;
      this.colDragOverIndex = null;
    },

    isEditing(row, fieldName) {
      if (this.editOnClick) {
        return this.internalEditCell !== null && this.internalEditCell.rowKey === row._rowKey && this.internalEditCell.field === fieldName;
      }
      return this.editingCell?.rowKey === row._rowKey && this.editingCell?.field === fieldName;
    },
    focusEditInput(rowKey, fieldName) {
      this.$nextTick(() => {
        const inputs = this.$refs['editInput-' + rowKey + '-' + fieldName];
        if (inputs && inputs[0]) inputs[0].focus();
      });
    },
    onCellClick(row, field) {
      // 忽略由拖拽手柄按下后冒出的 click（避免拖完行误触发单元格编辑/选中）
      if (this._suppressCellClick) {
        this._suppressCellClick = false;
        return;
      }
      if (this.readonly) return;
      if (this.editOnClick) {
        this.activeCell = null;
        if (!this.isEditing(row, field.name)) {
          this.internalEditCell = { rowKey: row._rowKey, field: field.name };
          this.focusEditInput(row._rowKey, field.name);
        }
        return;
      }
      if (!this.isEditing(row, field.name)) this.activeCell = { rowKey: row._rowKey, field: field.name };
    },
    onCellBlur(row, field) {
      if (row._isNew) return;
      this.$emit('saveCell', row, field);
      if (this.editOnClick) { this.internalEditCell = null; this.activeCell = null; }
    },
    onCellEnter(row, field) {
      if (row._isNew) { this.$emit('saveNewRow'); return; }
      this.$emit('saveCell', row, field);
      if (this.editOnClick) this.internalEditCell = null;
    },
    // 整表 Enter 保存新增行：焦点不在输入框/文本域/下拉等可输入控件时，Enter 即触发保存
    handleGlobalEnter(e) {
      if (e.key !== 'Enter' || e.isComposing) return
      if (!this.hasNewRow) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      // 焦点在「取消」按钮上时按回车应取消而非保存
      if (t && t.tagName === 'BUTTON' && /取消/.test(t.textContent || '')) return
      this.$emit('saveNewRow')
    },
    handleClickOutside(event) {
      if (!this.editingCell) return;
      if (!this.$el.contains(event.target)) { this.emitSaveAndClear(); return; }
      const editingInput = this.$el.querySelector('input:focus, select:focus');
      if (!editingInput || !editingInput.contains(event.target)) this.emitSaveAndClear();
    },
    emitSaveAndClear() {
      if (!this.editingCell) return;
      const row = this.rows.find(r => r._rowKey === this.editingCell.rowKey);
      const field = this.fields.find(f => f.name === this.editingCell.field);
      if (row && field) this.$emit('saveCell', row, field);
    },
    isRowSelected(rowKey) { return this.selectedKeySet.has(rowKey); },
    toggleRowSelect(rowKey) {
      if (this.readonly) return;
      this.selectedRowKeys = this.selectedKeySet.has(rowKey)
        ? this.selectedRowKeys.filter(k => k !== rowKey)
        : [...this.selectedRowKeys, rowKey];
    },
    toggleAllSelect() {
      if (this.readonly) return;
      const normalRows = (this.rows || []).filter(r => !r._isSeparator && !r._isNew);
      this.selectedRowKeys = this.isAllSelected ? [] : normalRows.map(r => r._rowKey);
    },
    clearSelection() { this.selectedRowKeys = []; },
    getReceiptCount(row) { try { return JSON.parse(row['收据'] || '[]').length; } catch { return 0; } },
    focusOnNewRow() {
      this.$nextTick(() => {
        const input = this.$el.querySelector('.data-drag-item input:not([type="date"]):not([type="file"])');
        if (input) input.focus();
      });
    },
  },
};
</script>

<style scoped>
/* 操作列定宽：保证「正常行(↑↓删除)」与「新增行(保存/取消)」切换时列宽不变，避免布局跳动 */
th.col-op,
td.col-op {
  width: 150px;
  min-width: 150px;
  max-width: 150px;
}
/* 数据列头禁止换行：新增行导致列宽变化时列头仍保持单行显示 */
th.col-header {
  white-space: nowrap;
}
/* 屏外行跳过渲染：配合 content-visibility 预留行高，避免滚动时高度/滚动条跳动 */
.data-drag-item {
  content-visibility: auto;
  contain-intrinsic-size: auto 32px;
}
/* 预留滚动条空间：新增/删除行导致滚动条出现/消失时，内容宽度稳定，表头不会横向偏移 */
.table-scroll-wrapper { scrollbar-gutter: stable; }
/* 底部渐隐雾面条：可滚动（行数超过 maxRows）时淡入，随行增删非线性（过冲回弹）淡入淡出 */
.table-scroll-wrapper { position: relative; }
.table-scroll-wrapper.is-scrollable::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 32px;
  pointer-events: none;
  background: linear-gradient(to top, rgba(255,255,255,0.35), rgba(255,255,255,0));
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.table-scroll-wrapper.is-scrollable::after {
  opacity: 1;
  transform: translateY(0);
}
.drag-handle { font-size: 14px; line-height: 1; user-select: none; opacity: 0.6; }
.drag-handle:hover { opacity: 1; }
th .drag-handle { color: rgba(255,255,255,0.7); }
th:hover .drag-handle { color: white; }
.cell-input { padding: 2px 4px; line-height: 1.5; min-height: 24px; box-sizing: border-box; border: 1px solid transparent; background-color: var(--color-warning-light, #fffde7); outline: none; transition: border-color 0.1s; }
.cell-input:focus { border-color: var(--color-primary, #4CAF50); }
.cell-text { padding: 2px 4px; line-height: 1.5; min-height: 24px; box-sizing: border-box; }
.cell-active { outline: 2px solid var(--color-info, #2563eb); outline-offset: -2px; background-color: color-mix(in srgb, var(--color-info, #2563eb) 5%, transparent); }
/* 行交换(FLIP)：松手后其它行平滑让位滑开，轻微回弹即可，用 !important 覆盖行上 transition-all 保证生效 */
.row-flip-move { transition: transform 0.32s cubic-bezier(0.34, 1.08, 0.64, 1) !important; }
/* 列交换(FLIP)：拖列换位后其它列平滑滑开，与行交换动画一致 */
.col-flip-move { transition: transform 0.32s cubic-bezier(0.34, 1.08, 0.64, 1); }
/* 整表数据区(tbody)进入：从左往右弹入，与单行动画一致（translateX(-20px)+过冲回弹），不含表头 */
.table-enter { animation: table-slide-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes table-slide-in {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}
/* 新增行上浮：过冲回弹曲线（冲进来轻轻弹一下） */
.row-flip-enter-active { transition: opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
/* 取消新增行返回：先快后慢的非线性曲线 */
.row-flip-leave-active { position: absolute; width: 100%; transition: opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.25s cubic-bezier(0.22, 1, 0.36, 1); }
.row-flip-enter-from, .row-flip-leave-to { opacity: 0; transform: translateX(-20px); }
/* 底部「点击添加一行」行上浮出现（过冲回弹） */
.add-row-flip-enter-active { transition: opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.add-row-flip-enter-from { opacity: 0; transform: translateY(16px); }
/* 消失：明显的不透明度淡出（渐变更柔和），轻微下沉 */
.add-row-flip-leave-active { transition: opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1), transform 0.18s cubic-bezier(0.22, 1, 0.36, 1); }
.add-row-flip-leave-to { opacity: 0; transform: translateY(10px); }
tr { transition: background-color 0.15s ease; }
</style>