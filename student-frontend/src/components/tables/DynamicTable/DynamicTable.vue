<template>
  <div class="dynamic-table">
  <div
    ref="scrollWrapper"
    class="table-scroll-wrapper overflow-x-auto overflow-y-auto"
    :class="{ 'is-scrollable': vScroll, 'scrollbar-gutter-stable': vScroll }"
    :style="{ height: fixedMaxHeight + 'px' }"
    @scroll.passive="onBodyScroll"
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
              <!-- 筛选入口：未筛选=放大镜，已筛选=漏斗；排序/值筛选都在面板里。
                   面板是懒加载 chunk，悬停按钮即预取，点开无需等待。 -->
              <button
                type="button"
                class="dt-filter-btn"
                v-preload="preloadFilterPanel"
                :class="{ 'is-on': isColumnFiltered(field.name) || sortField === field.name }"
                :title="filterButtonTitle(field.name)"
                @click.stop="openFilter(field, $event)"
              >
                <Filter v-if="isColumnFiltered(field.name)" :size="13" stroke-width="2.2" />
                <Search v-else :size="13" stroke-width="2.2" />
              </button>
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

      <tbody ref="tbodyRef" :class="{ 'row-search': rowAnimEnabled }">
        <!--
          行的过渡容器只在「搜索/筛选错峰动画」开启时才真正是 TransitionGroup，其余时候退化成 Fragment。

          为什么必须这样分：Vue 的 TransitionGroup 在**每次更新**里都会对 prevChildren 逐个
          getBoundingClientRect()，并在 onUpdated 里 cloneNode → appendChild → getComputedStyle
          → removeChild 去探测 move 过渡（见 @vue/runtime-dom 的 hasCSSTransform）。
          这两步都是「写 DOM 之后立刻读布局」，会强制同步样式重算 + 布局：
          对 56 行的大表格，实测单次交互因此多出 200~600ms（4 倍 CPU 降速下最慢一帧 277ms 里 205ms 是强制布局）。
          而这些开销在「勾选/排序/编辑」等日常操作里毫无收益——错峰动画本就只在搜索过滤/列筛选时需要。
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
          <!-- 虚拟滚动上垫片：只撑高度、不参与交互（不渲染真实行，滚动条长度仍与总高度一致） -->
          <tr v-if="padTop" key="__vpad_top" class="dt-vpad" aria-hidden="true">
            <td :colspan="tableColSpan" :style="{ height: padTop + 'px' }"></td>
          </tr>
          <tr
            v-for="(row, rowIndex) in renderRows"
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
                <template v-else-if="field.name === 'position'">{{ row._isNew ? '-' : positionOf(rowIndex) }}</template>
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
          <!-- 筛选后无结果：给一行提示，避免整表空白让人以为数据丢了 -->
          <tr v-if="filterNoResult" key="__dt-filter-empty" class="dt-filter-empty">
            <td :colspan="tableColSpan">没有符合筛选条件的数据</td>
          </tr>
          <!-- 虚拟滚动下垫片 -->
          <tr v-if="padBottom" key="__vpad_bottom" class="dt-vpad" aria-hidden="true">
            <td :colspan="tableColSpan" :style="{ height: padBottom + 'px' }"></td>
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

  <!-- 表头筛选面板：Teleport 到 body，避免被表格滚动容器的 overflow 裁掉 -->
  <Teleport to="body">
    <Transition name="dtf">
      <ColumnFilter
        v-if="filterField"
        :key="filterField"
        :field="filterField"
        :options="filterOptions"
        :sort-order="filterSortOrder"
        :readonly="readonly"
        :anchor-el="filterAnchorEl"
        @sort="onFilterSort"
        @toggle="onFilterToggle"
        @clear="clearColumnFilter"
        @close="closeFilter"
      />
    </Transition>
  </Teleport>
  </div>
</template>

<script>
import AppSelect from '../../base/AppSelect.vue'
import { TransitionGroup, defineAsyncComponent } from 'vue'
import { Search, Filter } from '@lucide/vue'
import { useDynamicTableDrag } from './DynamicTable.drag.js'
import { vPreload } from '../../../utils/dialogPrefetch.js'

// 表头筛选面板：独立组件 + 懒加载。
// 用 defineAsyncComponent 把面板拆成单独 chunk，只有第一次点开表头放大镜/漏斗时才下载；
// 按钮上再挂 v-preload，鼠标悬停就提前预取，点开时基本感觉不到加载。
const loadColumnFilter = () => import('./DynamicTable.filter.vue')
const ColumnFilter = defineAsyncComponent(loadColumnFilter)

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
  components: { AppSelect, TransitionGroup, Search, Filter, ColumnFilter },
  // v-preload 在主窗口是全局指令；这里本地再注册一次，保证本组件在任意窗口/单测里都能解析
  directives: { preload: vPreload },
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
    searchActive: { type: Boolean, default: false },       // 搜索过滤进行中：行进入/离开时启用上下级联动画方向
    // 行虚拟滚动阈值（滞后双阈值）：行数 ≥ virtualFrom 开启「只渲染可视窗口」，传 0 可整体关闭（走整表 DOM）；
    // 行数 ≤ virtualOffBelow 退回整表，两者之间维持当前状态，防止行数在阈值附近增删时整表 ↔ 窗口来回切换。
    // 【定稿】default = 1（全面虚拟）：实测（testjs/virtual-bench，2026-10-20）挂载 30 行起即快于整表，
    // 80~150 行全表重渲染仅慢 2~4ms（不可感知），2500 行滚动卡顿帧 0 vs 19。
    // 阈值机制保留：个别场景想回整表渲染时传 0（或调大阈值）即可，代码路径不动。
    // 小表下行为差异仅两处：搜索/筛选错峰动画在窗口截断时自动关闭（反馈更快）；
    // 拖行期间窗口冻结、不可拖出可视区（小表窗口本就包住全部行，不受影响）。
    // 【2026-10-20 晚】曾因体感「加载延迟」改成 160/140 滞后阈值；随后定位真根因是窗口重算晚一帧
    // （bodyRows watch 里 recalcWindow 在 $nextTick，数据到位后首帧按旧窗口出空表），已改同步重算。
    // 修复后实测全部虚拟明显更快，故 default 保持 1（全面虚拟）；160/140 机制保留，想回阈值策略改 default 即可。
    virtualFrom: { type: Number, default: 1 },
    // 退回整表的行数阈值（≤ 该值关虚拟）。必须 < virtualFrom（syncVirtualActive 内夹紧）
    virtualOffBelow: { type: Number, default: 140 },
    virtualOverscan: { type: Number, default: 8 }          // 缓冲行数下限；实际按视口高度动态放大到两整屏（见 recalcWindow）
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
      // 列筛选状态：{ 列名: Set(允许出现的值) }。值为空表示该列未筛选（不参与过滤）
      columnFilters: {},
      // 当前打开筛选面板的列名（'' = 未打开）
      filterField: '',
      // 筛选面板打开期间才开启行错峰动画（面板关闭后延时关闭，见 rowAnimEnabled）
      filterAnimating: false,
      // 面板里的值列表：由 buildFilterOptions 在打开/勾选时算出，缓存避免每次渲染重算
      filterOptions: [],
      // 面板定位锚点（表头上的那个放大镜/漏斗按钮）
      filterAnchorEl: null,
      // ===== 行虚拟滚动 =====
      // 当前渲染窗口 [virtualStart, virtualEnd)（下标针对 bodyRows）
      virtualStart: 0,
      virtualEnd: 0,
      // 滞后开关的当前状态（由 syncVirtualActive 维护）：≥virtualFrom 置真、≤virtualOffBelow 置假、
      // 中间区间维持现状。不能用纯 computed——「维持现状」需要记住上一次的状态。
      virtualActive: false,
      // 拖行期间锁死窗口：行在拖动中途被卸载会直接打乱几何缓存与落点判定
      virtualFrozen: false,
      // 实测行高缓存：{ rowKey → 高度 }。未测到的行用 estRowH 估算
      rowHeights: new Map(),
      estRowH: 33,
    };
  },
  computed: {
    hasNewRow() { return this.rows && this.rows.some(r => r._isNew); },
    // 是否有任何列处于筛选状态
    columnFilterActive() { return Object.keys(this.columnFilters).length > 0; },
    // 实际渲染的行：columns 筛选后的结果。未筛选时直接返回原数组引用（零开销、不破坏行对象复用）
    bodyRows() {
      if (!this.columnFilterActive) return this.rows;
      const active = Object.keys(this.columnFilters);
      return this.rows.filter(r => {
        // 正在录入的新行不参与筛选，否则一勾筛选它就凭空消失
        if (r._isNew) return true;
        // 分隔带在筛选态下没有意义（它不代表任何数据）
        if (r._isSeparator) return false;
        return active.every(f => this.matchColumnFilter(r, f));
      });
    },
    // 渲染下标 → rows 原始下标 的映射（仅供拖拽/序号回查用）。
    // 未筛选时为 null，调用方按恒等处理，避免多算一份数组。
    srcIndexList() {
      if (!this.columnFilterActive) return null;
      const pos = new Map();
      this.rows.forEach((r, i) => pos.set(r, i));
      return this.bodyRows.map(r => (pos.has(r) ? pos.get(r) : -1));
    },
    // 筛选后一行都不剩：提示用
    filterNoResult() { return this.columnFilterActive && this.bodyRows.length === 0; },
    // ===== 行虚拟滚动 =====
    // 是否启用窗口化渲染：走滞后开关 virtualActive（见 syncVirtualActive），小表格保持整表 DOM。
    // virtualFrom <= 0 时整体关闭（走整表 DOM），与旧行为一致。
    virtualOn() { return this.virtualFrom > 0 && this.virtualActive; },
    // 真正的渲染列表：窗口化时是 bodyRows 的一段切片，否则就是 bodyRows 本身（零拷贝）
    renderRows() {
      if (!this.virtualOn) return this.bodyRows;
      return this.bodyRows.slice(this.virtualStart, this.virtualEnd);
    },
    // 渲染下标 → bodyRows 下标的偏移量。
    // 模板里的 rowIndex 是「渲染顺序」，窗口化时必须加回窗口起点才能对回真实数据。
    winOffset() { return this.virtualOn ? this.virtualStart : 0; },
    // 行高前缀和：pre[i] = 前 i 行的累计高度。实测过的行用真实高度，其余用均值估算。
    // 只依赖 rowHeights / estRowH / bodyRows，滚动时不会重算（窗口定位走二分查找）。
    rowPrefix() {
      const rows = this.bodyRows;
      const n = rows.length;
      const pre = new Array(n + 1);
      pre[0] = 0;
      const est = this.estRowH;
      for (let i = 0; i < n; i++) {
        const h = this.rowHeights.get(rows[i]._rowKey);
        pre[i + 1] = pre[i] + (h != null ? h : est);
      }
      return pre;
    },
    // 上垫片高度 = 窗口之前所有行的高度和；下垫片 = 窗口之后的高度和。
    // 两段垫片保证 <table> 的总高度与真实全量渲染一致，滚动条长度不会随窗口变化而跳动。
    // 行数骤减时窗口下标可能暂时越界（浏览器还没把 scrollTop 夹回范围内），这里统一夹住。
    padTop() {
      if (!this.virtualOn) return 0;
      const pre = this.rowPrefix;
      return pre[Math.min(Math.max(0, this.virtualStart), pre.length - 1)];
    },
    padBottom() {
      if (!this.virtualOn) return 0;
      const pre = this.rowPrefix;
      const end = Math.min(Math.max(0, this.virtualEnd), pre.length - 1);
      return Math.max(0, pre[pre.length - 1] - pre[end]);
    },
    // 垫片行 / 空状态行的跨列数
    tableColSpan() { return this.fields.length + (this.readonly ? 0 : 2); },
    // 面板里的排序高亮态：只有当前列就是排序列时才显示升/降序选中
    filterSortOrder() {
      return this.filterField && this.sortField === this.filterField ? this.sortOrder : '';
    },
    // 行过渡容器是否启用：仅在搜索过滤/筛选面板打开期间启用错峰动画（见模板里的说明）。
    // 为什么不用「有筛选就开」：TransitionGroup 每次更新都要强制读写布局，而在有筛选的情况下
    // 用户还会继续双击编辑单元格，那时动画毫无收益。故只在「筛选面板打开」这个窗口内开启，
    // 面板关掉 600ms 后自动退化回 Fragment，日常编辑依旧零额外开销。
    // 虚拟滚动下直接关掉：滚动本身就在不停换行，播进出动画只会变成整屏闪。
    // 注意判据是「窗口真的截断了行」而不是「virtualOn」——行全都在窗口里时虚拟滚动等同没开，
    // 这时动画照旧（否则把阈值调小做验证时，小表格的筛选动画会被无辜关掉）。
    rowAnimEnabled() {
      const truncating = this.virtualOn && (this.virtualEnd - this.virtualStart) < this.bodyRows.length;
      return !truncating && (!!this.searchActive || this.filterAnimating);
    },
    // 行容器组件：错峰动画窗口内（搜索中 / 筛选面板打开）用 TransitionGroup，否则用 RowsFragment 做「透明包裹」，
    // 让 <tr> 始终是 <tbody> 的直接子节点。两者都必须能在实例上取到（模板表达式不会
    // 自动解析 components 选项，直接写 TransitionGroup 会得到 undefined 而整表不渲染）。
    rowWrapper() { return this.rowAnimEnabled ? TransitionGroup : RowsFragment; },
    // 选中行键集合：O(n) 建一次，模板内 O(1) 查用，避免整张表 O(n²) 的 includes 查找
    selectedKeySet() { return new Set(this.selectedRowKeys); },
    isAllSelected() {
      const normalRows = (this.bodyRows || []).filter(r => !r._isSeparator);
      return normalRows.length > 0 && normalRows.every(r => this.selectedKeySet.has(r._rowKey));
    },
    isIndeterminate() {
      const normalRows = (this.bodyRows || []).filter(r => !r._isSeparator);
      // 只统计「当前可见行」里被选中的数量：筛选态下被隐藏的选中行不应该让全选框保持半选
      const s = normalRows.filter(r => this.selectedKeySet.has(r._rowKey)).length;
      return s > 0 && s < normalRows.length;
    },
  },
  watch: {
    hasNewRow(val) {
      // 取消新增行 → 底部添加行重现，仅此后播放上浮动画
      if (!val) this.addRowAnimated = true;
    },
    'rows.length'() {
      // 就地增删（数组引用没变）也会走到这里：滞后开关要跟进行数，否则跨阈值不切换
      this.syncVirtualActive();
      this.$nextTick(() => {
        this.updateVScroll();
        // 仅当确实存在新增行时才聚焦其数据输入框；
        // 行数变化也可能来自搜索过滤/增删等场景，此时不得用 .focus() 抢占焦点（否则搜索输入框失焦）
        if (this.hasNewRow) this.focusNewRowInput();
      });
    },
    // 列筛选只改变渲染行，不改变 rows 长度，这里单独跟进底部渐隐条/纵向滚动的判定
    'bodyRows.length'() {
      this.$nextTick(() => this.updateVScroll());
    },
    // 行集合（增删/筛选/排序）变化：总高度变了，窗口要重算，行高也要重测。
    // 重算必须同步跑（不能塞进 $nextTick）：数据到位后的首帧就要用正确的窗口渲染，
    // 否则会先按旧窗口 [0,0) 出一帧空表、下一帧才补行——这就是虚拟滚动的「加载延迟」观感。
    // 量高要读 DOM，只能等渲染后（$nextTick）。
    bodyRows() {
      this.syncVirtualActive();
      this.recalcWindow();
      this.$nextTick(() => this.measureRows());
    },
    // 阈值/行数跨过开关点时，窗口模式会切换（整表 ↔ 窗口化），重新算一次并重新量高。
    // 同理同步重算，避免切换模式的首帧按旧窗口渲染。
    virtualOn() {
      this.recalcWindow();
      this.$nextTick(() => this.measureRows());
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
      handler(newFields) {
        // 列被删/改名后，残留的筛选状态会让整表永久空表 → 只保留仍然存在的列
        const names = new Set((newFields || []).map(f => f.name));
        Object.keys(this.columnFilters).forEach(n => {
          if (!names.has(n)) delete this.columnFilters[n];
        });
        if (this.filterField && !names.has(this.filterField)) this.closeFilter();
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
    // 虚拟滚动用的滚动位置/视口高度/ResizeObserver：纯运行时值，不进响应式
    this._scrollTop = 0;
    this._viewportH = 0;
    this._ro = null;
    // 估算行高是否已锁定（只取第一次实测均值，之后不再漂移，见 measureRows）
    this._estLocked = false;
    // 首帧之前就先按容器固定高度估一次窗口——否则第一帧会把全部行都画出来，
    // 正好抵消掉虚拟滚动想省的那次整表渲染（挂载后再收缩窗口已经晚了）。
    this._viewportH = this.fixedMaxHeight;
    this.syncVirtualActive();
    this.recalcWindow();
  },
  mounted() {
    this.focusNewRowInput();
    this.updateVScroll();
    this.initVirtual();
    // 首屏：数据区整体从左往右弹入
    this.playTableEnter();
    // 整表 Enter 保存新增行：焦点不在输入框时按回车也触发保存
    document.addEventListener('keydown', this.handleGlobalEnter);
    // 筛选面板：点面板外部 / 按 Esc / 容器滚动时收起
    document.addEventListener('click', this.onFilterDocClick);
    document.addEventListener('keydown', this.handleFilterKeydown);
    window.addEventListener('scroll', this.onFilterScroll, true);
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
    // 缓存的 DOM 尺寸可能已随页签切换变化，重新量一次窗口
    this.$nextTick(() => { this.initVirtual(); });
  },
  beforeUnmount() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    document.removeEventListener('click', this.handleClickOutside);
    document.removeEventListener('keydown', this.handleGlobalEnter);
    document.removeEventListener('click', this.onFilterDocClick);
    document.removeEventListener('keydown', this.handleFilterKeydown);
    window.removeEventListener('scroll', this.onFilterScroll, true);
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
    clearTimeout(this._filterAnimTimer);
    if (this._colAnimTimer) clearTimeout(this._colAnimTimer);
    if (this._snapshotRaf) cancelAnimationFrame(this._snapshotRaf);
    if (this._tableEnterCleanup) this._tableEnterCleanup();
  },
  methods: {
    ...useDynamicTableDrag(),
    // 判断字段是否受保护（受保护字段在表头显示 * 提示）
    isProtectedField(field) { return this.protectedColumns.includes(field.name); },

    // ==================== 行虚拟滚动 ====================
    // 滞后开关（防抖）：行数 ≥ virtualFrom 才开虚拟，≤ virtualOffBelow 才退回整表，
    // 两者之间维持现状——否则行数在阈值附近增删（加一行/删一行/筛一下）会整表 ↔ 窗口来回切，
    // 每次切换都要重建 DOM。每次切模式的代价远大于中间区间多算几行，故用双阈值锁住。
    syncVirtualActive() {
      if (this.virtualFrom <= 0) { this.virtualActive = false; return; }
      const n = this.bodyRows.length;
      const onAt = this.virtualFrom;
      // offAt 至少比 onAt 小 1，防调用方把两个阈值配成同一个数（否则恰好等于阈值时抖动）
      const offAt = Math.min(this.virtualOffBelow, onAt - 1);
      if (n >= onAt) this.virtualActive = true;
      else if (n <= offAt) this.virtualActive = false;
      // 中间区间：维持现状
    },
    // 滚动：同步重算窗口，只有窗口真的变了才触发渲染。
    // 不走 rAF：rAF 会晚一帧出新行，快速滑动/甩动时那一帧就露出垫片空白、下一帧「突然出字」；
    // 同步算完 + Vue 微任务补丁在同一帧内绘制，滚动全程不露白。
    // recalcWindow 只是二分查找 + 写两个响应式值（O(log n)），放进滚动事件里开销可忽略。
    // 视口高由 initVirtual / ResizeObserver 维护，不在滚动事件里读 clientHeight（避免触发布局）。
    onBodyScroll(e) {
      if (!e.target) return;
      this._scrollTop = e.target.scrollTop;
      if (!this.virtualOn) return;
      this.recalcWindow();
    },
    // 按当前滚动位置算渲染窗口；窗口没变就什么都不做（滚动过程中的绝大部分帧走这条路）
    recalcWindow() {
      const n = this.bodyRows.length;
      if (!this.virtualOn) {
        if (this.virtualStart !== 0 || this.virtualEnd !== n) { this.virtualStart = 0; this.virtualEnd = n; }
        return;
      }
      // 拖行期间窗口锁死：行在拖动中途被卸载会打乱 _rowGeom / _rowEls 的下标对应
      if (this.virtualFrozen) return;
      const pre = this.rowPrefix;
      const top = this._scrollTop;
      const bottom = top + (this._viewportH || this.fixedMaxHeight);
      // 二分：第一个累计高度 > top 的行下标，即当前可视窗口的起点
      let s = this.lowerBound(pre, top) - 1;
      let e = this.lowerBound(pre, bottom);
      // 缓冲行数动态取大：固定 8 行在高视口/矮行高下不够（400px ÷ 33px ≈ 12 行可视，缓冲不足一屏），
      // 至少留「两整屏」的缓冲——窗口切换更稀、甩动/触控板惯性滚动的跳跃也落在已渲染范围内。
      // DOM 量仍远小于整表（400px 视口 → 约 60 行 vs 全量 2500 行）。
      const overscan = Math.max(this.virtualOverscan, Math.ceil((this._viewportH || this.fixedMaxHeight) / (this.estRowH || 33)) * 2);
      s = Math.max(0, s - overscan);
      e = Math.min(n, e + overscan);
      if (e < s) e = s;
      if (s === this.virtualStart && e === this.virtualEnd) return;
      // 编辑中的单元格所在行即将被卸载：输入框消失不会触发 blur，得先落盘再换窗口
      this.commitEditIfLeaving(s, e);
      this.virtualStart = s;
      this.virtualEnd = e;
      this.$nextTick(() => this.measureRows());
    },
    // 返回第一个 arr[i] > value 的下标（arr 单调不减）
    lowerBound(arr, value) {
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= value) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    // 窗口切换会把「正在编辑的行」卸载掉：先按失焦语义提交，避免改了的值丢失
    commitEditIfLeaving(start, end) {
      const key = this.editingCell ? this.editingCell.rowKey
        : (this.internalEditCell ? this.internalEditCell.rowKey : null);
      if (!key) return;
      const idx = this.bodyRows.findIndex(r => r._rowKey === key);
      if (idx >= start && idx < end) return;
      if (this.editingCell) this.emitSaveAndClear();
      if (this.internalEditCell) { this.internalEditCell = null; this._clearActiveCell(); }
    },
    // 量一次当前渲染行的真实高度，更新缓存；行高变了还要补偿滚动位置避免跳一下。
    // 估算行高只在「第一次量到行」时锁定一次：若让它跟着每次测量漂移，
    // 垫片上方的未测行总高度会跟着变，滚动位置就会莫名其妙地跳。
    measureRows() {
      if (!this.virtualOn) return;
      const tbody = this.$refs.tbodyRef;
      const list = this.renderRows;
      if (!tbody || !list.length) return;
      const trs = tbody.querySelectorAll('tr.data-drag-item');
      // 数量对不上说明有行正在离场动画里，这一帧跳过，下一帧再量
      if (trs.length !== list.length) return;
      // 先记下当前 padTop（改缓存之前读），测量后用它算位移补偿
      const winStart = this.virtualStart;
      const before = this.rowPrefix[winStart];
      let sum = 0, cnt = 0, changed = false;
      for (let i = 0; i < trs.length; i++) {
        const h = Math.round(trs[i].getBoundingClientRect().height);
        if (h <= 0) continue;
        sum += h; cnt++;
        if (this.rowHeights.get(list[i]._rowKey) !== h) {
          this.rowHeights.set(list[i]._rowKey, h);
          changed = true;
        }
      }
      if (cnt && !this._estLocked) {
        this.estRowH = Math.round(sum / cnt);
        this._estLocked = true;
      }
      if (!changed) return;
      // 上面的行变高/变矮会让可视内容整体位移，用 padTop 的差值把滚动位置补回去
      this.$nextTick(() => {
        if (this.virtualFrozen) return;
        // 测量期间窗口已被重算（滚动/换窗口）：此时 rowPrefix[virtualStart] 变的是窗口起点而不是行高，
        // 再补偿就会把 scrollTop 二次顶飞（曾表现为首屏直接滚到表格末尾）
        if (this.virtualStart !== winStart) return;
        const after = this.rowPrefix[winStart];
        const delta = after - before;
        const wrap = this.$refs.scrollWrapper;
        if (!delta || !wrap) return;
        wrap.scrollTop += delta;
        this._scrollTop = wrap.scrollTop;
      });
    },
    // 初始化：先按容器固定高度估一次窗口（首帧就不能把全部行画出来），再把滚动/尺寸接上
    initVirtual() {
      const wrap = this.$refs.scrollWrapper;
      if (!wrap) return;
      this._viewportH = wrap.clientHeight || this.fixedMaxHeight;
      this._scrollTop = wrap.scrollTop;
      this.recalcWindow();
      this.$nextTick(() => this.measureRows());
      if (typeof ResizeObserver !== 'undefined' && !this._ro) {
        this._ro = new ResizeObserver(() => {
          this._viewportH = wrap.clientHeight;
          this.recalcWindow();
          this.$nextTick(() => this.measureRows());
        });
        this._ro.observe(wrap);
      }
    },

    // ==================== 列筛选（表头放大镜/漏斗） ====================
    // 供 v-preload 使用：把懒加载 loader 包成实例方法，模板里才能引用到
    preloadFilterPanel() { return loadColumnFilter(); },
    isColumnFiltered(name) { return !!this.columnFilters[name]; },
    filterButtonTitle(name) {
      return this.isColumnFiltered(name) ? `${name}：已筛选（点击修改）` : `${name}：筛选 / 排序`;
    },
    openFilter(field, event) {
      if (event) event.stopPropagation();
      // 再点一次同一个按钮 = 收起
      if (this.filterField === field.name) { this.closeFilter(); return; }
      this.filterAnchorEl = (event && event.currentTarget) || null;
      this.filterOptions = this.buildFilterOptions(field.name);
      this.filterField = field.name;
      // 面板开着的这段时间就是「会有行进出」的窗口：提前打开错峰动画，
      // 这样第一次勾选也和后续勾选一样有进出动画（而不是切换容器导致的整表重挂载）
      clearTimeout(this._filterAnimTimer);
      this.filterAnimating = true;
    },
    closeFilter() {
      if (!this.filterField) return;
      this.filterField = '';
      // 留一段尾巴让最后一次收起的行动画播完，再退化回 Fragment 省掉强制布局
      clearTimeout(this._filterAnimTimer);
      this._filterAnimTimer = setTimeout(() => { this.filterAnimating = false; }, 600);
    },
    // 勾选/取消某个值：以「全部值」为起点取反，再把结果存回筛选状态
    onFilterToggle(value) {
      const field = this.filterField;
      if (!field) return;
      const current = this.columnFilters[field];
      const sel = current ? new Set(current) : new Set(this.filterOptions.map(o => o.value));
      if (sel.has(value)) sel.delete(value);
      else sel.add(value);
      // 全部勾上 == 没筛选：直接清掉该列状态，图标回到放大镜
      if (this.filterOptions.length && sel.size === this.filterOptions.length) delete this.columnFilters[field];
      else this.columnFilters[field] = sel;
      // 计数只受「其它列」影响，本列勾选不变，故这里重算只为刷新勾选态
      this.filterOptions = this.buildFilterOptions(field);
    },
    // 排序：把「升/降序」的明确意图交给父组件（父组件的 toggleSort 支持第二参数）
    onFilterSort(order) {
      if (!this.filterField) return;
      this.$emit('toggleSort', this.filterField, order);
    },
    clearColumnFilter() {
      const field = this.filterField;
      if (!field) return;
      delete this.columnFilters[field];
      this.filterOptions = this.buildFilterOptions(field);
    },
    // 面板里的值列表：只统计「通过其它列筛选」的行，实现后筛选的列跟着前面的条件收窄
    buildFilterOptions(field) {
      const others = Object.keys(this.columnFilters).filter(f => f !== field);
      const counts = new Map();
      for (const r of this.rows || []) {
        if (r._isSeparator || r._isNew) continue;
        if (!others.every(f => this.matchColumnFilter(r, f))) continue;
        const v = this.cellFilterValue(r, field);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      const sel = this.columnFilters[field];
      return [...counts.entries()]
        .map(([value, count]) => ({ value, count, selected: !sel || sel.has(value) }))
        .sort((a, b) => this.compareFilterValue(a.value, b.value));
    },
    matchColumnFilter(row, field) {
      const sel = this.columnFilters[field];
      if (!sel) return true;
      return sel.has(this.cellFilterValue(row, field));
    },
    // 单元格值统一成字符串比较：null / undefined 视为空白（空串）
    cellFilterValue(row, field) {
      const v = row ? row[field] : undefined;
      return v == null ? '' : String(v);
    },
    compareFilterValue(a, b) {
      if (a === b) return 0;
      if (a === '') return 1;      // 空白永远排最后
      if (b === '') return -1;
      const na = Number(a), nb = Number(b);
      const aNum = a.trim() !== '' && !Number.isNaN(na);
      const bNum = b.trim() !== '' && !Number.isNaN(nb);
      if (aNum && bNum) return na - nb;
      if (aNum !== bNum) return aNum ? -1 : 1;   // 数字排在文字前
      return a.localeCompare(b, 'zh');
    },
    // 渲染下标 → rows 原始下标（未筛选且未窗口化时恒等）
    srcIndex(i) {
      // 先加回窗口偏移：模板里的下标是「渲染顺序」，而 bodyRows 是完整列表
      const j = i + this.winOffset;
      const list = this.srcIndexList;
      if (!list) return j;
      const v = list[j];
      return v == null || v < 0 ? j : v;
    },
    // 按渲染下标取到真实行对象（拖拽内部按渲染顺序处理，回查行数据时必须走这里）
    rowAt(i) { return this.rows[this.srcIndex(i)]; },
    // 序号列：筛选后仍显示该行在全表中的原始序号
    positionOf(rowIndex) {
      const src = this.srcIndex(rowIndex);
      if (this.displayIndexes) return this.displayIndexes[src];
      const row = this.rows[src];
      return row ? row._displayIndex : '';
    },
    // 点面板外部收起
    onFilterDocClick(e) {
      if (!this.filterField) return;
      const t = e.target;
      if (t && t.closest && (t.closest('.dtf-panel') || t.closest('.dt-filter-btn'))) return;
      this.closeFilter();
    },
    handleFilterKeydown(e) {
      if (e.key === 'Escape' && this.filterField) this.closeFilter();
    },
    // 表格/页面滚动后锚点位置已失效：收起面板（面板内部列表滚动不算）
    onFilterScroll(e) {
      if (!this.filterField) return;
      const t = e.target;
      if (t && t.nodeType === 1 && t.closest && t.closest('.dtf-panel')) return;
      this.closeFilter();
    },
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
      // 全选只作用于「当前可见行」：筛选态下不应把被过滤掉的行也勾上
      const normalRows = (this.bodyRows || []).filter(r => !r._isSeparator && !r._isNew);
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
    // 搜索过滤/列筛选时的上下级联动画（仅 rowAnimEnabled 启用，不影响其它页/场景的普通过渡）
    // 有结果出现 → 行从上往下依次进入；没有结果 → 行从下往上依次消失
    staggerEnter(el) {
      if (!this.rowAnimEnabled) return;
      el.style.transitionDelay = (Array.prototype.indexOf.call(el.parentNode.children, el) * 30) + 'ms';
    },
    staggerAfterEnter(el) { el.style.transitionDelay = ''; },
    staggerLeave(el) {
      if (!this.rowAnimEnabled) return;
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
      // 没有新增行就不做任何事：下面的「滚到底部」兜底是给新增行准备的，
      // 若在挂载时无条件走到那里，整张表会在首帧被直接滚到末页（表头/首行看起来「没固定」）
      if (!this.hasNewRow) return;
      this.$nextTick(() => {
        if (this._focusNewRowEl()) return;
        // 虚拟滚动下新增行可能落在窗口之外（根本没被渲染）：先把容器滚到底，重算窗口后再聚焦
        if (!this.virtualOn) return;
        const wrap = this.$refs.scrollWrapper;
        if (!wrap) return;
        wrap.scrollTop = wrap.scrollHeight;
        this._scrollTop = wrap.scrollTop;
        this.recalcWindow();
        this.$nextTick(() => { this._focusNewRowEl(); });
      });
    },
    // 通过 :ref="'newRowInput'" 精确取新增行的数据输入框，不用宽泛的 querySelector，
    // 避免在搜索过滤导致行数变化时误聚焦到普通行的复选框而抢走搜索框焦点
    _focusNewRowEl() {
      const inputs = this.$refs.newRowInput;
      const el = Array.isArray(inputs) ? inputs[0] : inputs;
      if (!el) return false;
      // 容器固定高度时新增行可能在底部被遮住：滚入视口让用户立即看到新行
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      el.focus();
      return true;
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
/* 表头筛选按钮（放大镜 / 漏斗）：20×20 圆角方块，配色随表头文字（白系）。
   必须清掉毛玻璃/Win11 主题的按钮皮肤（边框、阴影、荧光描边 ::before）。 */
.dt-filter-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none !important;
  border-radius: 5px;
  background: transparent;
  box-shadow: none !important;
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease, transform 0.14s ease;
}
.dt-filter-btn::before { display: none !important; }
.dt-filter-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
}
.dt-filter-btn:active { transform: scale(0.9); }
/* 已筛选 / 本列即当前排序列：与旧版排序箭头同样的琥珀色提示 */
.dt-filter-btn.is-on { color: var(--color-warning, #f59e0b); }
.dt-filter-btn.is-on:hover {
  color: var(--color-warning, #f59e0b);
  background: rgba(255, 255, 255, 0.2);
}
/* 筛选后零结果的提示行 */
.dt-filter-empty td {
  padding: 18px 8px;
  border: 1px solid var(--color-border, #e5e7eb);
  text-align: center;
  color: var(--color-text-muted, #9ca3af);
  font-size: 13px;
}
/* 虚拟滚动垫片行：只负责把总高度撑出来，不能有边框/内边距/背景，否则会多出横线 */
.dt-vpad { pointer-events: none; }
.dt-vpad td {
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  line-height: 0;
  font-size: 0;
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