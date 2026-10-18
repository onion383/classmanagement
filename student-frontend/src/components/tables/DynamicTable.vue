<template>
  <div class="dynamic-table">
  <div
    class="table-scroll-wrapper overflow-x-auto overflow-y-auto"
    :class="{ 'is-scrollable': vScroll, 'scrollbar-gutter-stable': vScroll }"
    :style="{ height: fixedMaxHeight + 'px' }"
  >
    <table class="w-full border-separate border-spacing-0 mt-0">
      <thead>
        <tr ref="theadRow">
          <TransitionGroup :name="colAnimDone ? 'col-flip' : 'static-col'" tag="">
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

      <tbody ref="tbodyRef" :class="{ 'row-search': searchActive }">
        <!--
          行的过渡容器只在「搜索错峰动画」开启时才真正是 TransitionGroup，其余时候退化成 Fragment。

          为什么必须这样分：Vue 的 TransitionGroup 在**每次更新**里都会对 prevChildren 逐个
          getBoundingClientRect()，并在 onUpdated 里 cloneNode → appendChild → getComputedStyle
          → removeChild 去探测 move 过渡（见 @vue/runtime-dom 的 hasCSSTransform）。
          这两步都是「写 DOM 之后立刻读布局」，会强制同步样式重算 + 布局：
          对 56 行的大表格，实测单次交互因此多出 200~600ms（4 倍 CPU 降速下最慢一帧 277ms 里 205ms 是强制布局）。
          而这些开销在「勾选/排序/编辑」等日常操作里毫无收益——错峰动画本就只在搜索过滤时需要。
          退化成 Fragment 后 TransitionGroup 的 setup/hooks 完全不执行，强制布局随之消失。
        -->
        <component
          :is="rowWrapper"
          :name="rowAnimEnabled ? 'row-flip' : undefined"
          tag=""
          :data-rows="rowAnimEnabled ? 'animated' : 'plain'"
          @enter="staggerEnter"
          @after-enter="staggerAfterEnter"
          @leave="staggerLeave"
          @after-leave="staggerAfterLeave"
        >
          <tr
            v-for="(row, rowIndex) in rows"
            :key="row._rowKey"
            :data-row-id="row.id"
            @contextmenu.prevent="$emit('contextmenu', $event, row._isNew ? 'newRow' : 'row', row)"
            :class="[
              'data-drag-item',
              { 'opacity-30': dragIndex === rowIndex },
              { 'bg-surface-hover': selectedKeySet.has(row._rowKey) && !editingCell },
              { 'row-pop-in': row._isNew },
              row._isSeparator ? 'h-4 bg-border' : ''
            ]"
            class="transition-[opacity,background-color,transform] duration-200 ease-in-out"
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
                :data-col="field.name"
                class="border border-border px-2 py-1 text-center relative pl-6"
                @click="onCellClick($event, row, field)"
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
                <template v-else-if="field.name === 'position'">{{ row._isNew ? '-' : (displayIndexes ? displayIndexes[rowIndex] : row._displayIndex) }}</template>
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
                  <span v-else @dblclick="$emit('startEdit', row, field)" class="dcell block w-full min-h-[24px] leading-6 px-1 cursor-default">{{ row[field.name] || '' }}</span>
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
                  <span v-else @dblclick="$emit('startEdit', row, field)" class="dcell block w-full min-h-[24px] leading-6 px-1 cursor-default">{{ row[field.name] != null ? row[field.name] : '' }}</span>
                </template>
              </td>

              <!-- 操作列 -->
              <td v-if="!readonly" class="col-op border border-border px-1.5 py-1 text-center whitespace-nowrap">
                <template v-if="row._isNew">
                  <button @click="$emit('saveNewRow')" class="bg-info text-text-inverse border-none py-0.5 px-2 mr-1 cursor-pointer rounded">保存</button>
                  <button @click="animateCancelNewRow" class="bg-text-muted text-text-inverse border-none py-0.5 px-2 cursor-pointer rounded">取消</button>
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
                  <button @click="$emit('deleteRow', row.id)" class="bg-danger text-text-inverse border-none py-0.5 px-1.5 cursor-pointer rounded">删除</button>
                </template>
              </td>
            </template>
          </tr>
        </component>
      </tbody>
    </table>
  </div>

  <!-- 添加一行：放在滚动容器下方，始终固定可见（数据滚动时不随之滚走） -->
  <transition name="add-row-flip" :duration="addRowAnimated ? undefined : 0">
    <div
      v-if="!readonly && !hideAddRow"
      :key="'add-row-' + addRowAnimKey"
      :class="['add-row-bar bg-bg text-center py-2 mt-2 text-primary font-medium rounded-xl', hasNewRow ? 'cursor-default text-text-muted opacity-60 pointer-events-none' : 'cursor-pointer']"
      @click="$emit('addNewRowAtBottom')"
    >＋ 点击添加一行</div>
  </transition>
  </div>
</template>

<script>
import AppSelect from '../base/AppSelect.vue'
import { TransitionGroup } from 'vue'
import { applyRowShift, applyColShift, clearShift, createEdgeAutoScroll } from '../../composables/tableDragFx'

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
    dataRows: { type: String, default: '' },
  },
  emits: ['enter', 'afterEnter', 'leave', 'afterLeave'],
  render() {
    return this.$slots.default ? this.$slots.default() : null
  },
}

export default {
  name: 'DynamicTable',
  components: { AppSelect, TransitionGroup },
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
    maxHeight: { type: Number, default: 400 },             // 容器最大高度（px），内容超出即纵向滚动
    protectedColumns: { type: Array, default: () => [] },  // 受保护字段：表头名后加 *，提示不可删除
    // 与 rows 对齐的序号数组（可选）。由数据源统一派生，避免把序号写回行对象而破坏行引用复用。
    displayIndexes: { type: Array, default: null },
    searchActive: { type: Boolean, default: false }        // 搜索过滤进行中：行进入/离开时启用上下级联动画方向
  },
  emits: [
    'contextmenu', 'search', 'toggleSort', 'saveNewRow', 'cancelNewRow',
    'startEdit', 'saveCell', 'moveRow', 'deleteRow', 'addNewRowAtBottom',
    'updateNewRow', 'manageReceipt', 'swapRows', 'swapColumns', 'moveSelectedRows',
    'selectionChange',
  ],
  data() {
    return {
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
      // 列换位时用于 body 单元格 FLIP 的「换位前」位置快照（松手瞬间采集，动画后清空）
      _flipColCells: null,
      // 行换位时用于整行 FLIP 的「换位前」位置快照
      _flipRows: null,
      // 底部「添加一行」行动画开关：默认开启，首屏与取消重现都播放上浮动效
      addRowAnimated: true,
      // 底部行 key：切换状态栏重新激活时递增，强制重建以重播上浮动画
      addRowAnimKey: 0,
      // 列交换 FLIP 动画是否就绪：页面进入/数据初载时不播放，避免表头乱跳；
      // 仅当首次数据渲染稳定后才启用，此后真实拖列换位才平滑滑动
      colAnimDone: false,
      firstActivate: true,
      // 纵向滚动判定：按固定高度（fixedMaxHeight）判断，内容超高才出现纵向滚动条，
      // 而不再按行数判断——多行/换行导致的行高不同也能正确触发，表头随之吸顶。
      vScroll: false,
      // 表格最大高度：内容超过此高度即启用纵向滚动（固定高度判断），默认 400，可由父组件按内容调整
      fixedMaxHeight: this.maxHeight,
    };
  },
  computed: {
    hasNewRow() { return this.rows && this.rows.some(r => r._isNew); },
    // 行过渡容器是否启用：仅在搜索过滤时启用错峰动画（见模板里的说明）。
    // 关闭时 <component :is> 退化为 Fragment，TransitionGroup 的强制布局逻辑完全不执行。
    rowAnimEnabled() { return !!this.searchActive; },
    // 行容器组件：搜索动画开启时用 TransitionGroup，否则用 RowsFragment 做「透明包裹」，
    // 让 <tr> 始终是 <tbody> 的直接子节点。两者都必须能在实例上取到（模板表达式不会
    // 自动解析 components 选项，直接写 TransitionGroup 会得到 undefined 而整表不渲染）。
    rowWrapper() { return this.rowAnimEnabled ? TransitionGroup : RowsFragment; },
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
    'rows.length'() {
      this.$nextTick(() => {
        this.updateVScroll();
        // 仅当确实存在新增行时才聚焦其数据输入框；
        // 行数变化也可能来自搜索过滤/增删等场景，此时不得用 .focus() 抢占焦点（否则搜索输入框失焦）
        if (this.hasNewRow) this.focusNewRowInput();
      });
    },
    editingCell: {
      handler(newVal) {
        if (newVal) {
          // 进入编辑态：清除单击高亮（原先由模板条件在重渲染时移除，现改为命令式移除）
          this._clearActiveCell();
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
        // 性能探针：rows 变化是「整表重渲染」的起点（筛选/排序/增删行都会换数组引用）。
        // 从 watch 触发量到「下一帧渲染完成」，得到本次整表渲染+补丁的真实耗时，
        // 供 perf/probe.js 与 INP 交互时间窗做归因。
        this._perfMeasureRender();
        // 先构建行键集合再过滤，避免选中项多 + 行数大时的 O(n×m) 逐条 some
        const keys = new Set(newVal.map(r => r._rowKey));
        this.selectedRowKeys = this.selectedRowKeys.filter(key => keys.has(key));
        // 仅当「新增行被保存/取消」（由有 → 无）时才重算列宽并钉住；
        // 普通增删/移动行前后都没有新增行，列宽不会因新增输入而变，无需测量
        const prevHadNew = (oldVal || []).some(r => r._isNew);
        const nowHasNew = newVal.some(r => r._isNew);
        // 新增行出现（无 → 有）：在 DOM 插入新行前（watch 默认 flush:'pre'）量出并冻结旧列宽，
        // 让新增行的空输入不会撑动表头宽度，避免表头跳动。
        if (!prevHadNew && nowHasNew) {
          this._freezeHeaderWidths();
        } else if (prevHadNew && !nowHasNew && !this.editingCell) {
          // 新增行消失（保存/取消）：先保持冻结列宽不动（不立即解锁），
          // 待 280ms 后快照统一清除 min-width 并重算钉住，避免取消瞬间列宽回弹。
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
  created() {
    // 收据数量缓存：WeakMap 键为行对象，避免每次渲染逐行 JSON.parse（不参与响应式）
    this._receiptCache = new WeakMap();
  },
  mounted() {
    this.focusNewRowInput();
    this.updateVScroll();
    // 首屏：数据区整体从左往右弹入
    this.playTableEnter();
    // 整表 Enter 保存新增行：焦点不在输入框时按回车也触发保存
    document.addEventListener('keydown', this.handleGlobalEnter);
    // 列交换 FLIP 动画延迟就绪：等本页首次 table 滑入播完（350ms）、表头稳定后再启用，
    // 否则挂载时 TransitionGroup 会对静态表头播放 move，造成进入页面时表头乱跳。
    this._colAnimTimer = setTimeout(() => { this.colAnimDone = true; }, 400);
  },
  // KeepAlive：从其它状态栏/页签切换回来时重播数据区整体弹入动效
  // （取消新增行后「添加一行」重现的上浮动效由 hasNewRow 驱动，不在此处触发，
  //   否则它会和 tbody 整体滑入叠加造成闪动）
  activated() {
    if (this.firstActivate) { this.firstActivate = false; return; }
    this.playTableEnter();
    // 从其它页签切回时也会重载数据/重建表头，同样延迟启用列 FLIP，避免表头乱跳
    this.colAnimDone = false;
    if (this._colAnimTimer) clearTimeout(this._colAnimTimer);
    this._colAnimTimer = setTimeout(() => { this.colAnimDone = true; }, 400);
  },
  beforeUnmount() {
    document.removeEventListener('click', this.handleClickOutside);
    document.removeEventListener('keydown', this.handleGlobalEnter);
    // 拖拽中途被卸载：停掉自动滚动并清掉让位位移，避免残留定时器/内联样式
    if (this._rowAutoScroll) { this._rowAutoScroll.stop(); this._rowAutoScroll = null; }
    if (this._colAutoScroll) { this._colAutoScroll.stop(); this._colAutoScroll = null; }
    this._clearRowShiftFx();
    this._clearColShiftFx();
    if (this._dragGhost) this._dragGhost.remove();
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
    clearTimeout(this._snapshotTimer);
    if (this._colAnimTimer) clearTimeout(this._colAnimTimer);
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
      tbl.style.tableLayout = 'auto'; // 自动布局：列可随容器宽度收缩，内容宽时换行，不撑出横向滚动
      const widths = [...ths].map(th => th.getBoundingClientRect().width);
      [...ths].forEach((th, i) => {
        // 兜底：清除输入新行冻结可能残留的 min-width 下界，保证全屏时数据列可收缩换行、不横向溢出
        th.style.minWidth = '';
        // 操作列固定统一宽度：新增行（保存/取消）与普通行（↑↓/删除）按钮宽度不同，
        // 按实测会随行态滑动；统一固定常量保证任何行态下列宽一致、无水平位移。
        if (th.classList.contains('col-op')) {
          th.style.width = '135px';
          th.style.minWidth = '135px';
          return;
        }
        const w = widths[i];
        if (!w) return;
        // auto 布局下表头宽度只是“偏好”→ 内容充裕时按内容自适应，容器变窄时可被压缩换行
        const cur = parseFloat(th.style.width || '');
        if (Number.isFinite(cur) && Math.abs(cur - w) <= 2) return;
        th.style.width = w + 'px';
      });
    },
    // 冻结表头列宽：量出当前各列宽度并写入 width 偏好，使新增行的空输入不再撑动列宽。
    // 仅对操作列额外锁 min-width 锁定下界，保证新增前后操作列宽度一致、不左右位移；
    // 数据列不锁 min-width，容器不足时仍可收缩换行，避免全屏/小窗口横向滚动条。
    _freezeHeaderWidths() {
      const ths = this.$el?.querySelectorAll('thead th');
      if (!ths?.length) return;
      ths.forEach(th => {
        // 操作列统一固定宽度：与 snapshotWidths 保持一致，任何行态下列宽恒为 150px，
        // 避免新增行（保存/取消）与普通行（↑↓/删除）按钮宽不同导致水平位移
        if (th.classList.contains('col-op')) {
          if (th._frozenWidth == null) th._frozenWidth = th.style.width || '';
          th.style.width = '135px';
          th.style.minWidth = '135px';
          return;
        }
        const w = th.getBoundingClientRect().width;
        if (!w) return;
        if (th._frozenWidth == null) th._frozenWidth = th.style.width || '';
        th.style.width = w + 'px';
      });
    },
    // 解除冻结：恢复原有宽度、清除 min-width，由后续 snapshotWidths 重算自然列宽
    _unfreezeHeaderWidths() {
      const ths = this.$el?.querySelectorAll('thead th');
      ths?.forEach(th => {
        th.style.minWidth = '';
        if (th._frozenWidth != null) {
          th.style.width = th._frozenWidth;
          th._frozenWidth = '';
        }
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
    // 拖拽开始时一次性缓存各行与容器的几何信息，拖动过程中纯计算，避免每帧 O(n) 布局读取
    _cacheRowGeom() {
      const trs = this.$el ? this.$el.querySelectorAll('tbody tr') : [];
      const arr = [];
      for (let i = 0; i < trs.length; i++) {
        const r = trs[i].getBoundingClientRect();
        arr.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
      this._rowGeom = arr;
      this._rowGeomContainer = this.$el ? this.$el.getBoundingClientRect() : null;
    },
    // 列拖拽几何缓存：按下时一次性量出各数据列的左右边界、表头行 top、表底 bottom 与容器 rect，
    // 拖动过程中纯数值比较，避免每帧 O(n) getBoundingClientRect 触发布局（INP 优化）
    _cacheColGeom() {
      const ths = this.$el ? this.$el.querySelectorAll('thead th') : [];
      const hasOp = !!this.$el && !!this.$el.querySelector('th.col-op');
      const arr = [];
      for (let i = 1; i < ths.length; i++) {
        const colIndex = i - 1;
        if (i === ths.length - 1 && hasOp) { arr[colIndex] = null; continue; } // 跳过操作列
        const r = ths[i].getBoundingClientRect();
        arr[colIndex] = { left: r.left, right: r.right };
      }
      this._colGeom = arr;
      this._colGeomHeaderTop = ths.length ? ths[0].parentElement.getBoundingClientRect().top : null;
      const tbl = this.$el ? this.$el.querySelector('table') : null;
      this._colGeomTblBottom = tbl ? tbl.getBoundingClientRect().bottom : null;
      this._colGeomContainer = this.$el ? this.$el.getBoundingClientRect() : null;
    },
    // 复制一份跟手虚影作为「落点虚影」：更淡、无阴影、初始隐藏，
    // 位置由 update*DropBox 贴在目标格上。两个虚影同时存在：
    // 手上的跟手，落点的那份提示会落在哪。
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
      const g = (geom && this.dragOverIndex !== null) ? geom[this.dragOverIndex] : null;
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
      // 每帧都会走到这里；几何没变就别再写样式（写 width/height 会触发布局）
      const sig = `${left}|${top}|${w}|${h}`;
      if (this._rowDropSig === sig) return;
      this._rowDropSig = sig;
      // 落点虚影延迟到「确实要显示」时才克隆
      if (!this._rowSlotGhost && this._rowGhost) {
        this._rowSlotGhost = this._cloneGhostForSlot(this._rowGhost, 0.22);
      }
      const ghost = this._rowSlotGhost;
      box.style.display = 'block';
      box.style.transform = `translate(${left}px, ${top}px)`;
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      // 落点虚影：被拖行的半透明副本固定在落点上（不跟随鼠标），
      // 松手前就能看到它将落在哪一格。
      if (ghost) {
        ghost.style.display = 'block';
        ghost.style.transform = `translate(${left}px, ${top}px)`;
        ghost.style.width = w + 'px';
        ghost.style.height = h + 'px';
        ghost.style.overflow = 'hidden';
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
      const g = (geom && this.colDragOverIndex !== null) ? geom[this.colDragOverIndex] : null;
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
      // 落点虚影延迟创建
      if (!this._colSlotGhost && this._colGhost) {
        this._colSlotGhost = this._cloneGhostForSlot(this._colGhost, 0.22);
      }
      const ghost = this._colSlotGhost;
      box.style.display = 'block';
      box.style.transform = `translate(${left}px, ${top}px)`;
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      // 落点虚影：半透明列副本贴在目标格上
      if (ghost) {
        ghost.style.display = 'block';
        ghost.style.transform = `translate(${left}px, ${top}px)`;
        ghost.style.width = w + 'px';
        ghost.style.height = h + 'px';
      }
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
      wrapper.style.cssText = 'position:fixed;left:0;top:0;z-index:99998;pointer-events:none;opacity:0.85;border-radius:4px;will-change:transform;contain:layout paint;box-shadow:0 6px 18px rgba(0,0,0,0.18);';
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
      // 落点虚影在 updateRowDropBox 里延迟创建
      this._rowGrab = { grabX, grabY };
      // 跟手的虚影：自由跟随指针（不吸附、不锁位置）
      wrapper.style.transform = `translate(${event.clientX - grabX}px, ${event.clientY - grabY}px)`;
      // 落点高亮框：包住即将落位的那一行（几何信息在此一次性缓存）
      this._cacheRowGeom();
      // 让位与自动滚动的初始状态：行元素列表 + 「空槽」高度（取被拖行自身高度）
      this._rowEls = Array.from(this.$el.querySelectorAll('tbody tr'));
      const g0 = this._rowGeom ? this._rowGeom[index] : null;
      this._rowSlotH = g0 ? Math.round(g0.bottom - g0.top) : 0;
      this._rowAutoScroll = createEdgeAutoScroll(
        () => this.$el,
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
          const r = geom[i];
          if (clientY >= r.top && clientY <= r.bottom) return i;
          const d = Math.min(Math.abs(clientY - r.top), Math.abs(clientY - r.bottom));
          if (d < min) { min = d; best = i; }
        }
        return best;
      }
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
    // 应用最近一次待处理的拖拽位置（rAF 帧内执行；松手前也会强制冲刷一次，避免丢最后一帧）
    _applyRowMove() {
      if (!this._rowGhost || !this._rowPending) return;
      const ev = this._rowPending;
      // 跟手虚影自由跟随指针
      const g = this._rowGrab || { grabX: 0, grabY: 0 };
      this._rowGhost.style.transform = `translate(${ev.clientX - g.grabX}px, ${ev.clientY - g.grabY}px)`;
      const idx = this.resolveRowIndexAt(ev.clientY);
      // 只有目标行变了才重算让位与落点（每帧无条件全量遍历是拖拽卡顿的主因）
      if (idx !== this.dragOverIndex) {
        this.dragOverIndex = idx;
        this._syncRowShift();
        this.updateRowDropBox();
      }
      // 边缘自动滚动（上下左右）：滚起来后由 _onRowScrolled 同步几何缓存，保持跟手
      if (this._rowAutoScroll) this._rowAutoScroll.update(ev.clientX, ev.clientY);
    },
    // 行让位（移动语义）：按几何逐行补偿，行高不等也不会错位
    _syncRowShift() {
      applyRowShift(this._rowEls, this.dragIndex, this.dragOverIndex, this._rowGeom, this._rowSlotH);
    },
    // 清让位位移（拖拽结束/取消）：transform 与 transition 一起清掉，避免出现回弹动画
    _clearRowShiftFx() {
      const tbody = this.$refs.tbodyRef;
      if (tbody) clearShift(tbody);
      this._rowEls = null;
      this._rowSlotH = 0;
    },
    // 容器滚动后：把缓存的几何一起平移，保证命中判定与落点高亮框继续跟手
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
      // 松手位置：落位动画的起点（清 pending 之前取）
      const relRow = this._rowPending ? { x: this._rowPending.clientX, y: this._rowPending.clientY } : null;
      this._rowPending = null;
      this._rowGeom = null;
      this._rowGeomContainer = null;
      if (this._rowAutoScroll) { this._rowAutoScroll.stop(); this._rowAutoScroll = null; }
      if (this._rowGhost) { this._rowGhost.remove(); this._rowGhost = null; }
      if (this._rowSlotGhost) { this._rowSlotGhost.remove(); this._rowSlotGhost = null; }
      if (this._rowDropBox) { this._rowDropBox.remove(); this._rowDropBox = null; }
      const from = this.dragIndex;
      const to = this.dragOverIndex;
      this.dragIndex = null;
      this.dragOverIndex = null;
      if (from === null || to === null || from === to) { this._clearRowShiftFx(); return; }
      const movedRow = this.rows[from];
      // 让位交给拖动期完成；松手只做一段「从松手位置落位」的收尾动画
      this._clearRowShiftFx();
      if (this.selectedRowKeys.length > 1 && this.selectedRowKeys.includes(movedRow._rowKey)) {
        const selectedKeys = this.selectedRowKeys.filter(key => this.rows.some(r => r._rowKey === key && !r._isSeparator));
        this.$emit('moveSelectedRows', { selectedKeys, oldIndex: from, newIndex: to, isDownward: to > from });
      } else {
        this.$emit('swapRows', from, to);
      }
      if (relRow) this.$nextTick(() => this._slideInRow(to, relRow));
    },
    // 落位动画：被移动的这一行从「松手位置」滑进落点（X/Y 双向）
    _slideInRow(to, rel) {
      if (!rel) return;
      const tbody = this.$refs.tbodyRef;
      if (!tbody) return;
      const tr = tbody.querySelectorAll('tr')[to];
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
    // 采集换位前各行垂直位置（一次性读取，供换位后 FLIP 用）
    _captureRowCells() {
      const tbody = this.$refs.tbodyRef;
      if (!tbody) { this._flipRows = null; return; }
      this._flipRows = Array.from(tbody.querySelectorAll('tr[data-row-id]')).map((el) => ({
        el,
        top: el.getBoundingClientRect().top,
      }));
    },
    // 换位后播放 FLIP：移动过的行从旧位置滑到新位置；未移动的行（dy≈0）跳过
    _playRowCellFlip() {
      const list = this._flipRows;
      this._flipRows = null;
      if (!list) return;
      for (const item of list) {
        const el = item.el;
        if (!el || !el.isConnected || typeof el.animate !== 'function') continue;
        const dy = item.top - el.getBoundingClientRect().top;
        if (Math.abs(dy) < 0.5) continue;
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          { duration: 320, easing: 'cubic-bezier(0.34, 1.08, 0.64, 1)' }
        );
      }
    },

    // ==================== 手动列拖拽（不用原生 HTML5 drag，完全可控，无浏览器居中问题） ====================
    onColHandleDown(event, colIndex) {
      if (this.readonly || this.editingCell) return;
      event.preventDefault();
      this.colDragIndex = colIndex;
      this.colDragOverIndex = colIndex;
      // 拖动期间不启用表头 FLIP：落位动画统一由松手后的「滑入」负责，
      // 否则表头会再播一次交换动画（观感像弹两下）。
      this.colAnimDone = false;
      // 不再生成整列虚影：源列本身已淡化（opacity-30）+ 蓝色落点框，再加浮层会显得重复。
      this._colActive = true;
      this._colGhost = null;
      this._colGrab = null;
      // 落点高亮框：包住即将落位的那一列（几何信息在此一次性缓存）
      this._cacheColGeom();
      // 落点虚影：被拖列的半透明副本，固定贴在落点上（不跟随鼠标）
      {
        const tbl = this.$el.querySelector('table');
        const thsH = tbl ? tbl.querySelectorAll('thead th') : [];
        const thOff = this.readonly ? 0 : 1;
        const srcTh = thsH[colIndex + thOff] || null;
        if (srcTh) {
          const colWidth = srcTh.getBoundingClientRect().width;
          const cs = getComputedStyle(srcTh);
          const ghostTable = document.createElement('table');
          ghostTable.style.cssText =
            'border-collapse:collapse;table-layout:fixed;width:' + colWidth +
            'px;font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize +
            ';line-height:' + cs.lineHeight + ';color:' + cs.color + ';';
          const gThead = document.createElement('thead');
          const gThRow = document.createElement('tr');
          const gTh = srcTh.cloneNode(true);
          gTh.classList.remove('opacity-30');
          gTh.style.transition = 'none';
          gTh.style.width = colWidth + 'px';
          gTh.style.overflow = 'hidden';
          gThRow.appendChild(gTh);
          gThead.appendChild(gThRow);
          ghostTable.appendChild(gThead);
          const gTbody = document.createElement('tbody');
          if (tbl) {
            tbl.querySelectorAll('tbody tr').forEach(tr => {
              const td = tr.children[colIndex + thOff];
              if (!td) return;
              const gTr = document.createElement('tr');
              const gTd = td.cloneNode(true);
              gTd.style.transition = 'none';
              gTd.style.width = colWidth + 'px';
              gTd.style.overflow = 'hidden';
              gTr.appendChild(gTd);
              gTbody.appendChild(gTr);
            });
          }
          ghostTable.appendChild(gTbody);
          const wrap = document.createElement('div');
          wrap.style.cssText = 'position:fixed;left:0;top:0;z-index:99998;pointer-events:none;opacity:0.85;overflow:hidden;will-change:transform;contain:layout paint;box-shadow:0 6px 18px rgba(0,0,0,0.18);';
          wrap.appendChild(ghostTable);
          document.body.appendChild(wrap);
          this._colGhost = wrap;
          // 落点虚影在 updateColDropBox 里延迟创建
          // 跟手虚影：按抓取点跟随指针（自由移动，不吸附格子）
          const thRect0 = srcTh.getBoundingClientRect();
          this._colGrab = { grabX: event.clientX - thRect0.left, grabY: event.clientY - thRect0.top };
          wrap.style.transform = `translate(${event.clientX - this._colGrab.grabX}px, ${event.clientY - this._colGrab.grabY}px)`;
        }
      }
      // 让位：每列 = 表头 th + 各行该列 td（按 data-col 分组，顺序与 fields 一致）
      const ths0 = this.$el.querySelectorAll('thead th');
      const thOff = this.readonly ? 0 : 1;
      const colEls = [];
      const tbody0 = this.$refs.tbodyRef;
      if (tbody0) {
        for (const tr of tbody0.querySelectorAll('tr')) {
          const cells = tr.querySelectorAll('td[data-col]');
          for (let k = 0; k < cells.length; k++) {
            if (!colEls[k]) colEls[k] = [];
            colEls[k].push(cells[k]);
          }
        }
      }
      for (let k = 0; k < colEls.length; k++) {
        const th = ths0[k + thOff];
        if (th) colEls[k].unshift(th);
      }
      this._colEls = colEls;
      const gc0 = this._colGeom ? this._colGeom[colIndex] : null;
      this._colSlotW = gc0 ? Math.round(gc0.right - gc0.left) : 0;
      this._colAutoScroll = createEdgeAutoScroll(
        () => this.$el,
        (mx, my) => this._onColScrolled(mx, my)
      );
      this._colDropBox = this.createDropBox();
      this.updateColDropBox();

      const move = (e) => {
        if (!this._colActive) return;
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
      if (!this._colActive || !this._colPending) return;
      const ev = this._colPending;
      // 跟手虚影自由跟随指针
      const g = this._colGrab;
      if (g && this._colGhost) {
        this._colGhost.style.transform = `translate(${ev.clientX - g.grabX}px, ${ev.clientY - g.grabY}px)`;
      }
      const hov = this.resolveColIndexAt(ev.clientX);
      // 只有目标列变了才重算让位与落点
      if (hov !== null && hov !== this.colDragOverIndex) {
        this.colDragOverIndex = hov;
        this._syncColShift();
        this.updateColDropBox();
      }
      // 边缘自动滚动（上下左右）
      if (this._colAutoScroll) this._colAutoScroll.update(ev.clientX, ev.clientY);
    },
    // 列让位（移动语义）：按几何逐列补偿（列宽不等时也能精确让位）
    _syncColShift() {
      applyColShift(this._colEls, this.colDragIndex, this.colDragOverIndex, this._colGeom, this._colSlotW);
    },
    _clearColShiftFx() {
      clearShift(this.$el);
      this._colEls = null;
      this._colSlotW = 0;
    },
    // 容器滚动后同步列几何（左右按 mx、表头/表底按 my），保证命中与落点框跟手
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
        let best = null;
        let minDist = Infinity;
        for (let k = 0; k < geom.length; k++) {
          const r = geom[k];
          if (!r) continue; // 操作列不参与落点
          if (clientX >= r.left - 2 && clientX <= r.right + 2) return k; // 直接命中该列
          const center = (r.left + r.right) / 2;
          const d = Math.abs(clientX - center);
          if (d < minDist) { minDist = d; best = k; }
        }
        return best; // 落在间隙，取最近邻列
      }
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
      if (this._colRaf) { cancelAnimationFrame(this._colRaf); this._colRaf = null; }
      this._applyColMove(); // 冲刷最后一帧
      // 松手位置：落位动画的起点
      const relCol = this._colPending ? { x: this._colPending.clientX, y: this._colPending.clientY } : null;
      this._colPending = null;
      const from = this.colDragIndex;
      const to = this.colDragOverIndex;
      this._colGeom = null;
      this._colGeomContainer = null;
      this._colGrab = null;
      this._colActive = false;
      if (this._colAutoScroll) { this._colAutoScroll.stop(); this._colAutoScroll = null; }
      if (this._colDropBox) { this._colDropBox.remove(); this._colDropBox = null; }
      if (this._colGhost) { this._colGhost.remove(); this._colGhost = null; }
      if (this._colSlotGhost) { this._colSlotGhost.remove(); this._colSlotGhost = null; }
      this._clearColShiftFx();
      if (from !== null && to !== null && from !== to && to >= 0) {
        this.$emit('swapColumns', from, to);
        // colAnimDone 必须在「重排渲染之后」才恢复，否则表头会再播一遍交换动画。
        this.$nextTick(() => {
          if (relCol) this._slideInCol(to, relCol);
          this.colAnimDone = true;
        });
      } else {
        this.$nextTick(() => { this.colAnimDone = true; });
      }
      this.colDragIndex = null;
      this.colDragOverIndex = null;
    },
    // 落位动画：被移动的这一列从「松手位置」滑进落点（X/Y 双向；表头随列一起）
    _slideInCol(to, rel) {
      if (!rel) return;
      const ths = this.$el.querySelectorAll('thead th');
      const thOff = this.readonly ? 0 : 1;
      const th = ths[to + thOff];
      if (!th) return;
      const r = th.getBoundingClientRect();
      const dx = Math.round(rel.x - (r.left + r.width / 2));
      const dy = Math.round(rel.y - (r.top + r.height / 2));
      if (!dx && !dy) return;
      const els = [th];
      const tbody = this.$refs.tbodyRef;
      if (tbody) {
        for (const tr of tbody.querySelectorAll('tr')) {
          const cells = tr.querySelectorAll('td[data-col]');
          if (cells[to]) els.push(cells[to]);
        }
      }
      for (const el of els) {
        if (!el || typeof el.animate !== 'function') continue;
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 200, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
        );
      }
    },
    // 采集换位前 body 数据单元格的水平位置（一次性读取，供换位后 FLIP 用）
    _captureColCells() {
      const tbody = this.$refs.tbodyRef;
      if (!tbody) { this._flipColCells = null; return; }
      this._flipColCells = Array.from(tbody.querySelectorAll('td[data-col]')).map((el) => ({
        el,
        left: el.getBoundingClientRect().left,
      }));
    },
    // 换位后播放 FLIP：每个移动过的单元格从旧位置滑到新位置；约束失败/未移动则跳过
    _playColCellFlip() {
      const list = this._flipColCells;
      this._flipColCells = null;
      if (!list) return;
      for (const item of list) {
        const el = item.el;
        if (!el || !el.isConnected || typeof el.animate !== 'function') continue;
        const dx = item.left - el.getBoundingClientRect().left;
        if (Math.abs(dx) < 0.5) continue; // 没换位的列（含首/末未动列）不动画
        el.animate(
          [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }],
          { duration: 320, easing: 'cubic-bezier(0.34, 1.08, 0.64, 1)' }
        );
      }
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
    // 单击高亮改为命令式增删 class：避免 activeCell 成为响应式依赖触发整表重渲染
    _clearActiveCell() {
      if (this._activeTd) {
        this._activeTd.classList.remove('cell-active');
        this._activeTd = null;
      }
    },
    onCellClick(event, row, field) {
      // 忽略由拖拽手柄按下后冒出的 click（避免拖完行误触发单元格编辑/选中）
      if (this._suppressCellClick) {
        this._suppressCellClick = false;
        return;
      }
      if (this.readonly) return;
      if (this.editOnClick) {
        this._clearActiveCell();
        if (!this.isEditing(row, field.name)) {
          this.internalEditCell = { rowKey: row._rowKey, field: field.name };
          this.focusEditInput(row._rowKey, field.name);
        }
        return;
      }
      if (this.isEditing(row, field.name)) return;
      const td = event && event.currentTarget;
      if (td && td === this._activeTd) return;
      this._clearActiveCell();
      if (td) {
        td.classList.add('cell-active');
        this._activeTd = td;
      }
    },
    onCellBlur(row, field) {
      if (row._isNew) return;
      this.$emit('saveCell', row, field);
      if (this.editOnClick) { this.internalEditCell = null; this._clearActiveCell(); }
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
    getReceiptCount(row) {
      const raw = row['收据'] || '[]';
      const cached = this._receiptCache.get(row);
      if (cached && cached.raw === raw) return cached.count;
      let count = 0;
      try { count = JSON.parse(raw).length; } catch { /* 非法 JSON 视为 0 */ }
      this._receiptCache.set(row, { raw, count });
      return count;
    },
    // 搜索过滤时的上下级联动画（仅 searchActive 启用，不影响其它页/场景的普通过渡）
    // 有结果出现 → 行从上往下依次进入；没有结果 → 行从下往上依次消失
    staggerEnter(el) {
      if (!this.searchActive) return;
      el.style.transitionDelay = (Array.prototype.indexOf.call(el.parentNode.children, el) * 30) + 'ms';
    },
    staggerAfterEnter(el) { el.style.transitionDelay = ''; },
    staggerLeave(el) {
      if (!this.searchActive) return;
      const kids = el.parentNode.children;
      const idx = Array.prototype.indexOf.call(kids, el);
      el.style.transitionDelay = ((kids.length - 1 - idx) * 30) + 'ms';
    },
    staggerAfterLeave(el) { el.style.transitionDelay = ''; },
    // 性能探针：一次整表渲染的耗时（rows 变化 → 下一帧渲染完成）
    _perfMeasureRender() {
      if (typeof performance === 'undefined' || !performance.mark) return;
      try {
        performance.mark('perf:rows:start');
        requestAnimationFrame(() => {
          try {
            performance.mark('perf:rows:end');
            performance.measure('rowsRender', 'perf:rows:start', 'perf:rows:end');
          } catch (_) { /* 忽略 */ }
        });
      } catch (_) { /* 忽略 */ }
    },
    // 取消（关闭）新增行：先播放「向上加速淡出」的收起动画，动画结束后才真正移除该行，
    // 否则父组件会立即卸载该行，关闭时没有任何过渡。
    animateCancelNewRow() {
      const el = this.$el && this.$el.querySelector('tr.row-pop-in');
      if (!el) {
        this.$emit('cancelNewRow');
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.$emit('cancelNewRow');
      };
      const onEnd = (e) => {
        if (e.target !== el) return;
        el.removeEventListener('animationend', onEnd);
        finish();
      };
      el.classList.remove('row-pop-in');
      el.classList.add('row-pop-out');
      el.addEventListener('animationend', onEnd);
      // 兜底：动画事件缺失（如被禁用）时按动画时长收尾，避免行一直留着
      setTimeout(finish, 140);
    },
    focusNewRowInput() {
      this.$nextTick(() => {
        // 通过 :ref="'newRowInput'" 精确取新增行的数据输入框，不用宽泛的 querySelector，
        // 避免在搜索过滤导致行数变化时误聚焦到普通行的复选框而抢走搜索框焦点
        const inputs = this.$refs.newRowInput;
        const el = Array.isArray(inputs) ? inputs[0] : inputs;
        if (el) {
          // 容器固定高度时新增行可能在底部被遮住：滚入视口让用户立即看到新行
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          el.focus();
        }
      });
    },
    // 固定高度判断纵向滚动：测量表格完整内容高度（scrollHeight 不被容器裁剪），
    // 超过 fixedMaxHeight 即启用纵向滚动，表头随之吸顶。多行/换行行高不同也适用。
    updateVScroll() {
      if (!this.$el) return;
      const tbl = this.$el.querySelector('table');
      this.vScroll = !!tbl && tbl.scrollHeight > this.fixedMaxHeight;
    },
  },
};
</script>

<style scoped>
/* 表头吸顶：sticky 必须加在 th 上（加在 thead 上在多数浏览器不生效）。
   数据超高超限纵向滚动时，表头保持在顶部、只滚动数据行。
   表头自带不透明底色，滚动时会遮盖下方滚上来的数据。 */
thead th {
  position: sticky;
  top: 0;
  z-index: 5;
}
/* 操作列宽度：按内容自适应，保证按钮在小窗口下不被截断（之前固定 150px 过窄时按钮溢出被截掉） */
th.col-op,
td.col-op {
  width: auto;      /* 按内容自适应，紧贴操作按钮，不额外撑宽 */
  min-width: 0;
  max-width: none;
}
/* 操作列固定右侧：无条件 sticky（不管是否有横向滚动），横向滚动时操作列始终贴住容器右缘。
   表头同时吸顶+贴右成角，数据行单元格贴右。 */
th.col-op {
  position: sticky;
  top: 0;
  right: 0;
  z-index: 6;
  background-color: var(--color-primary);
}
td.col-op {
  position: sticky;
  right: 0;
  z-index: 4;
  /* 不透明底色：sticky 固定时会覆盖在横向滚动的数据之上，
     若底色透明/半透明，下方数据会透出来造成「错位」观感 */
  background-color: var(--color-surface, #ffffff);
  /* 在 px-1.5（6px）基础上整体加宽，左右各 15px */
  padding-left: 15px;
  padding-right: 15px;
}
/* 操作列固定列左侧分隔线：滚动时与其他列内容清晰分界 */
td.col-op::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-border);
}
/* 数据单元格内容：允许换行容纳长内容（全屏时不撑出横向滚动条）。
   用 overflow-wrap 拆长串，避免一脚踢出单元格宽度；单行优先，必要时换行 */
.data-drag-item td:not(.col-op) > span.dcell {
  display: block;
  width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
/* 数据列头禁止换行：新增行导致列宽变化时列头仍保持单行显示 */
th.col-header {
  white-space: nowrap;
}
/* 注意：不再对数据行使用 content-visibility —— 它会对行应用包含裁剪，导致行内
   操作列的 position:sticky 失效。为保证横向滚动时操作列固定右侧，关闭该优化。 */
.data-drag-item {
  contain-intrinsic-size: auto 32px;
}
/* 预留滚动条空间（仅开启纵向滚动时）：新增/删除行导致纵向滚动条出现/消失时，内容宽度稳定，表头不会横向偏移 */
.table-scroll-wrapper.scrollbar-gutter-stable { scrollbar-gutter: stable; }
/* 底部渐隐雾面条：可滚动（行数超过 maxRows）时淡入，随行增删非线性（过冲回弹）淡入淡出 */
/* 表格容器统一表面底色：玻璃/win11 主题下 --color-surface 为半透明，
   若不加底色，下方空数据区与有数据的操作列（同样取 surface 半透明遮罩）遮罩程度不一致，观感不和谐 */
.table-scroll-wrapper {
  position: relative;
  background-color: var(--color-surface, #ffffff);
}
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
/* 行交换(FLIP)：松手后其它行平滑让位滑开，轻微回弹即可，用 !important 覆盖行上的过渡保证生效 */
.row-flip-move { transition: transform 0.32s cubic-bezier(0.34, 1.08, 0.64, 1) !important; }
/* 列交换(FLIP)：拖列换位后其它列平滑滑开，与行交换动画一致 */
.col-flip-move { transition: transform 0.32s cubic-bezier(0.34, 1.08, 0.64, 1); }
/* 整表数据区(tbody)进入：从左往右弹入，与单行动画一致（translateX(-20px)+过冲回弹），不含表头 */
.table-enter { animation: table-slide-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes table-slide-in {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}
/* 点击「添加一行」后，新增行的弹入动画：从上方落下、过冲回弹（非线性弹入），只在新行首次挂载时播放一次 */
tr.row-pop-in { animation: row-pop-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes row-pop-in {
  from { opacity: 0; transform: translateY(-18px); }
  to { opacity: 1; transform: translateY(0); }
}
/* 取消/关闭新增行：沿进入方向对称返回——向上加速淡出（加速回退曲线），forwards 保持终态直至该行被移除 */
tr.row-pop-out { animation: row-pop-out 0.12s cubic-bezier(0.5, 0, 0.85, 0.3) forwards; }
@keyframes row-pop-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-18px); }
}
/* 新增行上浮：过冲回弹曲线（冲进来轻轻弹一下） */
.row-flip-enter-active { transition: opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
/* 取消新增行返回：先快后慢的非线性曲线 */
.row-flip-leave-active { position: absolute; width: 100%; transition: opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.25s cubic-bezier(0.22, 1, 0.36, 1); }
.row-flip-enter-from, .row-flip-leave-to { opacity: 0; transform: translateX(-20px); }
/* 搜索级联：去掉水平滑出，改用垂直位移（与「从上往下/从下往上」级联方向一致），避免与级联打架 */
.row-search .row-flip-enter-from { transform: translateY(14px); }
.row-search .row-flip-leave-to { transform: translateY(-14px); }
/* 关键：搜索离开时不要转 absolute。absolute 会让行脱离文档流、tbody 高度塌缩，滚动条内会整列内容一起消失；
   保持 static 行占据空间，动画被滚动裁剪区正确裁剪，只有可见区域的行在淡出 */
.row-search .row-flip-leave-active { position: static; }
/* 底部「点击添加一行」行上浮出现（过冲回弹） */
.add-row-flip-enter-active { transition: opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.add-row-flip-enter-from { opacity: 0; transform: translateY(16px); }
/* 消失：明显的不透明度淡出（渐变更柔和），轻微下沉 */
.add-row-flip-leave-active { transition: opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1), transform 0.18s cubic-bezier(0.22, 1, 0.36, 1); }
.add-row-flip-leave-to { opacity: 0; transform: translateY(10px); }
tr { transition: background-color 0.15s ease; }
</style>