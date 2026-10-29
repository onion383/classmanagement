<template>
  <div class="dynamic-table" ref="rootEl">
  <div
    ref="scrollWrapper"
    class="table-scroll-wrapper overflow-x-auto overflow-y-auto"
    :class="{ 'is-scrollable': vScroll, 'dt-scroll-empty': emptyVisible || emptyPending }"
    :style="fitContent ? { maxHeight: fixedMaxHeight + 'px' } : { height: fixedMaxHeight + 'px' }"
    @scroll.passive="onBodyScroll"
  >
    <!-- 空态：整块替换整张表 —— **表头也不渲染**。
         表头留着会暗示「下面应该有行」，而空表时下方只是一片空白，反而更难看；
         整块换成一张毛玻璃的「还没有数据 + 添加」面板，才是一个完整的空页。
         去掉 <table> 是安全的：所有依赖表格 DOM 的方法都先判空
         （_doSnapshotWidths 有 !tbl 早退、updateVScroll 用 !!tbl、列宽/行拖拽只由表头/行触发）。
         高度取 100%：外层 .table-scroll-wrapper 本就是固定高度（非 fitContent 时 height=maxHeight），
         空态块铺满它才不会只顶一半、下面留一片白。 -->
    <!-- 加载失败：和「没有数据」必须分开。两者都表现为表里空空，
         但用户该做的事完全不同 —— 没数据要去添加，加载失败只要重试。 -->
    <div v-if="loadError" class="dt-empty dt-error">
      <svg class="dt-empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M24 8 4 42h40L24 8Z" stroke-linejoin="round" opacity="0.75" />
        <path d="M24 20v10" stroke-linecap="round" />
        <circle cx="24" cy="36" r="1.6" fill="currentColor" stroke="none" />
      </svg>
      <p class="dt-empty-text">{{ errorText }}</p>
      <button type="button" class="dt-empty-btn" @click="$emit('retry')">重试</button>
    </div>

    <div v-else-if="emptyVisible" class="dt-empty">
      <!-- 搜索无结果：图标换成放大镜（区别于「真的没数据」的表格图标） -->
      <svg v-if="searchNoResult" class="dt-empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <circle cx="21" cy="21" r="12" opacity="0.75" />
        <path d="M30 30l10 10" stroke-linecap="round" opacity="0.85" />
      </svg>
      <svg v-else class="dt-empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="7" y="11" width="34" height="26" rx="4" stroke-dasharray="4 4" opacity="0.55" />
        <path d="M16 20h16M16 26h11" stroke-linecap="round" opacity="0.85" />
      </svg>
      <p class="dt-empty-text">{{ searchNoResult ? emptySearchMessage : emptyMessage }}</p>
      <!-- 搜索无结果：只给「清除搜索」。「点击添加」在这里是误导 ——
           数据其实都在，只是没匹配上关键字，让人去添加新记录只会越搞越乱。
           空态按钮与 hideAddRow 解耦：hideAddRow 只表示「不要内联新增行」，
           页面仍可借这个按钮打开自己的新增弹窗（如加分管理）；不需要的页面传 emptyActionText=""。 -->
      <button
        v-if="searchNoResult"
        type="button"
        class="dt-empty-btn"
        @click="$emit('clearSearch')"
      >清除搜索</button>
      <button
        v-else-if="emptyActionText && !readonly"
        type="button"
        class="dt-empty-btn"
        @click="onAddRowBarClick"
      >{{ emptyActionText }}</button>
    </div>

    <!-- 判定中：同高静默占位，**不渲染表头**。
         放在空态和表格之间，长度恒定（外层容器本来就是固定高度），所以从占位 → 空态
         或占位 → 表格都不会有高度跳动。 -->
    <div v-else-if="emptyPending" class="dt-empty-pending" aria-hidden="true"></div>

    <table v-else class="w-full border-separate border-spacing-0 mt-0">
      <thead>
        <tr ref="theadRow">
          <TransitionGroup :name="colAnimDone ? 'col-flip' : 'static-col'" tag="">
          <!-- 全选复选框（可通过 hideSelectAll 隐藏，但列始终存在；noSelect 可整列隐藏） -->
          <th
            v-if="!readonly && !noSelect"
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
              { 'dt-col-src-hidden': colDragIndex === colIndex }
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
                {{ field.label || (field.name === 'id' ? 'ID' : field.name) }}<span v-if="isProtectedField(field)" class="text-warning ml-0.5" title="核心字段，禁止删除">*</span>
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

          <!-- 操作列（固定）：只读表可通过 actionsHeader + #row-actions 插槽自定义操作内容 -->
          <th
            v-if="!readonly || actionsHeader"
            key="col-op"
            class="bg-primary text-text-inverse border border-border px-2 py-1 text-center col-op"
          >
            {{ actionsHeader || '操作' }}
          </th>
          </TransitionGroup>
        </tr>
      </thead>

      <tbody ref="tbodyRef" :class="{ 'row-search': searchActive || filterAnimating }">
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
          :name="rowAnimEnabled && !rowsAnimSilent ? 'row-flip' : undefined"
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
            <td v-if="row._isSeparator" :colspan="tableColSpan"></td>

            <!-- 普通行 -->
            <template v-else>
              <!-- 复选框 -->
              <td v-if="!readonly && !noSelect" class="border border-border px-1 text-center align-middle w-8" @click.stop>
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
                :class="{ 'dt-col-src-hidden': colDragIndex === fieldIndex }"
                @click="onCellClick($event, row, field)"
              >
                <!-- 拖拽手柄（按住拖行）。上下移按钮去掉后，**行排序只剩这一个入口**，
                     所以 hideMoveButtons 的语义变成了「禁用本表的行排序」——
                     请假记录按时间排、不允许手动调序，那张表就把它设成 true。
                     别把它和 hideEditButton 混用：前者关排序，后者关「修改」按钮。 -->
                <span
                  v-if="fieldIndex === 0 && !hideMoveButtons && !readonly"
                  class="absolute left-1 top-1/2 -translate-y-1/2 drag-handle cursor-grab select-none text-text-muted hover:text-text-secondary"
                  title="按住拖动行"
                  @mousedown.prevent="onRowHandleDown($event, rowIndex)"
                  @contextmenu.stop.prevent
                >⠿</span>

                <slot :name="field.slot || ('cell-' + field.name)" :row="row" :field="field" :value="row[field.name]" :index="rowIndex" :editing="isEditing(row, field.name)">
                <template v-if="field.name === 'id'">{{ row._isNew ? '自动' : row.id }}</template>
                <template v-else-if="field.name === 'position'"><span class="dt-index-fix">{{ row._isNew ? '-' : positionOf(rowIndex) }}</span></template>
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
                    :ref="(el) => setCellInputRef(row, field, el)"
                  />
                  <span v-else @dblclick="$emit('startEdit', row, field)" class="dcell block w-full min-h-[24px] leading-6 px-1 cursor-default">{{ row[field.name] != null ? row[field.name] : '' }}</span>
                </template>
                </slot>
              </td>

              <!-- 操作列 -->
              <td v-if="!readonly || actionsHeader" class="col-op border border-border px-1.5 py-1 text-center whitespace-nowrap">
                <!-- 额外操作按钮：插在默认操作按钮（新增行保存/取消、↑↓/删除）之前 -->
                <slot name="row-actions-extra" :row="row" :index="rowIndex"></slot>
                <slot name="row-actions" :row="row" :index="rowIndex">
                <template v-if="row._isNew">
                  <button @click="$emit('saveNewRow')" class="bg-info text-text-inverse border-none py-0.5 px-2 mr-1 cursor-pointer rounded">保存</button>
                  <button @click="requestCancelNewRow" class="bg-text-muted text-text-inverse border-none py-0.5 px-2 cursor-pointer rounded">取消</button>
                </template>
                <template v-else>
                  <!-- 修改：取代原来的上移/下移，抛出 editRow 由各页面打开自己的「添加/编辑」弹窗
                       （弹窗和新增共用一套，只是预填 + 走 PUT）。组件本身不碰编辑逻辑 ——
                       各页表单字段差异太大，只有页面自己知道该弹什么。
                       没接 @edit-row 的表请传 hideEditButton，否则是个点了没反应的按钮。
                       排序能力没有丢：靠行首的 ⠿ 拖拽（.drag-handle），比一步步点箭头更适合长表。 -->
                  <button
                    v-if="!hideEditButton"
                    @click="$emit('editRow', row)"
                    class="bg-info text-text-inverse border-none py-0.5 px-2 mr-1 cursor-pointer rounded"
                    title="修改本行"
                  >修改</button>
                  <!-- 删除按钮始终保留 -->
                  <button @click="$emit('deleteRow', row.id)" class="bg-danger text-text-inverse border-none py-0.5 px-1.5 cursor-pointer rounded">删除</button>
                </template>
                </slot>
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

  <!-- 添加一行：放在滚动容器下方，始终固定可见（数据滚动时不随之滚走）
       存在新增行时按钮切换为「取消添加一行」，点击可放弃本次新增
       空态时隐藏：空态块里已经有一个同样的添加入口，两个并排出现会重复 -->
  <transition name="add-row-flip" :duration="addRowAnimated ? undefined : 0">
    <div
      v-if="!readonly && !hideAddRow && !emptyVisible && !emptyPending"
      :key="'add-row-' + addRowAnimKey"
      :class="['add-row-bar bg-bg text-center py-2 mt-2 font-medium rounded-xl cursor-pointer', hasNewRow ? 'text-text-secondary' : 'text-primary']"
      @click="onAddRowBarClick"
    >{{ hasNewRow ? '取消添加一行' : '＋ 点击添加一行' }}</div>
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

  <!-- 放弃新增行确认：新增行已填写数据时，取消新增前先确认 -->
  <ConfirmDialog
    :visible="discardConfirmVisible"
    title="放弃新增行"
    message="新增行已填写数据，放弃后不会保存，确定要放弃吗？"
    type="confirm"
    :show-cancel="true"
    @confirm="confirmDiscardNewRow"
    @cancel="discardConfirmVisible = false"
  />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onActivated, onBeforeUnmount, nextTick, defineAsyncComponent, TransitionGroup, toRef } from 'vue'
import AppSelect from '../../base/AppSelect.vue'
import ConfirmDialog from '../../base/ConfirmDialog.vue'
import { Search, Filter } from '@lucide/vue'
import { useDynamicTableDrag } from './DynamicTable.drag.js'
import { vPreload } from '../../../utils/dialogPrefetch.js'
import { zhCollator } from '../../../utils/collator.js'

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

defineOptions({ name: 'DynamicTable' })

const props = defineProps({
    fields: { type: Array, required: true },
    rows: { type: Array, required: true },
    newRow: { type: Object, default: null },
    sortField: { type: String, default: '' },
    sortOrder: { type: String, default: 'asc' },
    editingCell: { type: Object, default: null },
    maxRows: { type: Number, default: 10 },
    hideSelectAll: { type: Boolean, default: false },
    // 禁用本表的行排序：上下移按钮已移除，现在只作用于行首 ⠿ 拖拽手柄
    // （请假记录按时间排、不允许手动调序，那张表传 true）
    hideMoveButtons: { type: Boolean, default: false },
    // 隐藏操作列里的「修改」按钮。给「自己已经提供了编辑入口」的表用：
    // 成绩管理在 #row-actions-extra 里自带「编辑」按钮，不改会并排出现两个做同一件事的按钮。
    hideEditButton: { type: Boolean, default: false },
    // 操作列固定宽度（px）：默认 105 容纳「修改 + 删除」；使用 row-actions-extra 增加按钮时可调大
    opColumnWidth: { type: Number, default: 105 },
    hideAddRow: { type: Boolean, default: false },        // 新增：隐藏底部「点击添加一行」
    noRowDrag: { type: Boolean, default: false },         // 新增：禁用整行拖拽（避免与双击内联编辑冲突）
    editOnClick: { type: Boolean, default: false },       // 新增：单击单元格直接进入编辑（配合失焦保存）
    readonly: { type: Boolean, default: false },          // 新增：纯只读展示（历史快照等）
    // 只读表的自定义操作列：传入表头文字即显示该列，内容由 #row-actions 插槽提供
    actionsHeader: { type: String, default: '' },
    emptyText: { type: String, default: '' },              // 完整的空表提示文案（老接口；传了 emptyLabel 时以 emptyLabel 拼句为准）
    // ---- 空态（毛玻璃提示块 + 新增入口）----
    // 只填名词（「班费」「学生」「请假记录」…），文案由组件拼成「还没有 XX 数据」，
    // 与 GridView 的空态措辞保持一致；都不传则退回 `emptyText`，再退回「还没有数据」。
    emptyLabel: { type: String, default: '' },
    // 空态按钮文案。传空字符串即不渲染按钮；只读表 / 禁用「添加一行」的表也会自动不显示
    // （那种表点了也加不了行，留着是个死按钮）。
    emptyActionText: { type: String, default: '点击添加' },
    // 数据是否已就绪。false 时不渲染空态 —— 异步加载期间 rows 也是空数组，
    // 不区分的话会在数据回来前先闪一下「还没有数据」。
    emptyReady: { type: Boolean, default: true },
    // 加载失败：显示告警图标 + 重试，而不是让用户对着一张空表猜是不是数据丢了
    loadError: { type: Boolean, default: false },
    errorText: { type: String, default: '表格加载失败' },
    // 高度随内容自适应（maxHeight 变成上限而不是固定高度），适合小数据量只读表
    fitContent: { type: Boolean, default: false },
    // 隐藏整列勾选框（保留行操作，不需要批量选择时使用）
    noSelect: { type: Boolean, default: false },
    maxHeight: { type: Number, default: 400 },             // 容器最大高度（px），内容超出即纵向滚动
    protectedColumns: { type: Array, default: () => [] },  // 受保护字段：表头名后加 *，提示不可删除
    // 与 rows 对齐的序号数组（可选）。由数据源统一派生，避免把序号写回行对象而破坏行引用复用。
    displayIndexes: { type: Array, default: null },
    searchActive: { type: Boolean, default: false },       // 搜索过滤进行中：行进入/离开时启用上下级联动画方向
    // 关键字搜索把数据筛光了（由父组件判定）：表格自己分不清「本来就没数据」和
    // 「有数据但没匹配上关键字」——这两者要给用户不同的提示和不同的按钮。
    // 为 true 时空态换成「暂无 XX 的搜索结果」+「清除搜索」。
    searchNoResult: { type: Boolean, default: false },
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
})
const emit = defineEmits([

    'contextmenu', 'search', 'toggleSort', 'saveNewRow', 'cancelNewRow',
    'startEdit', 'saveCell', 'moveRow', 'deleteRow', 'addNewRowAtBottom',
    'updateNewRow', 'manageReceipt', 'swapRows', 'swapColumns', 'moveSelectedRows',
    'selectionChange',
    // 操作列「修改」：带上整行，页面据此打开自己的编辑弹窗（各页表单字段不同，只有页面知道该弹什么）
    'editRow',
    // 加载失败态里的「重试」
    'retry',
    // 搜索无结果态里的「清除搜索」
    'clearSearch',
])

// 模板 ref（静态名自动绑定）；动态 :ref（editInput-* / newRowInput）由函数 ref 收集进 cellInputRefs
const rootEl = ref(null)
const scrollWrapper = ref(null)
const tbodyRef = ref(null)
const theadRow = ref(null)

// 动态 :ref 的登记表：key 形如 editInput-<rowKey>-<field> / newRowInput。
// 用函数 ref 收集而不是实例 $refs —— Vapor 模式没有 $refs，函数 ref 在两种模式下通用。
const cellInputRefs = new Map()
function setCellInputRef(row, field, el) {
  const key = row._isNew ? 'newRowInput' : `editInput-${row._rowKey}-${field.name}`
  if (el) cellInputRefs.set(key, el)
  else cellInputRefs.delete(key)
}
function getCellInput(key) {
  return cellInputRefs.get(key) || null
}

// ===== 状态 =====
const internalEditCell = ref(null)
const selectedRowKeys = ref([])
      // 空态是否真正显示。不跟着 showEmptyBase 立刻变：条件成立后先挂 260ms，
      // 数据在这期间到达就一次都不显示 —— 否则每次进页面都会先闪一下「还没有数据」。
const emptyVisible = ref(false)
const _emptyTimer = ref(null)
const dragIndex = ref(null)
const dragOverIndex = ref(null)
const colDragIndex = ref(null)
const colDragOverIndex = ref(null)
const _dragGhost = ref(null)
const _colDragGhost = ref(null)
const _rowDropBox = ref(null)
const _colDropBox = ref(null)
      // 列换位时用于 body 单元格 FLIP 的「换位前」位置快照（松手瞬间采集，动画后清空）
const _flipColCells = ref(null)
      // 行换位时用于整行 FLIP 的「换位前」位置快照
const _flipRows = ref(null)
      // 底部「添加一行」行动画开关：默认开启，首屏与取消重现都播放上浮动效
const addRowAnimated = ref(true)
      // 底部行 key：切换状态栏重新激活时递增，强制重建以重播上浮动画
const addRowAnimKey = ref(0)
      // 放弃新增行确认弹窗：仅当新增行已填写数据时弹出
const discardConfirmVisible = ref(false)
      // 列交换 FLIP 动画是否就绪：页面进入/数据初载时不播放，避免表头乱跳；
      // 仅当首次数据渲染稳定后才启用，此后真实拖列换位才平滑滑动
const colAnimDone = ref(false)
const firstActivate = ref(true)
      // 纵向滚动判定：按固定高度（fixedMaxHeight）判断，内容超高才出现纵向滚动条，
      // 而不再按行数判断——多行/换行导致的行高不同也能正确触发，表头随之吸顶。
const vScroll = ref(false)
      // 行增删后的短动画窗：只有它开着，行容器才切成 TransitionGroup ——
      // 被删掉的那行才播离场、恢复的那行才播入场。平时保持 Fragment（见 beginRowsAnimWindow）。
const rowsAnimWindow = ref(false)
      // 窗口刚打开的那一帧静默：容器从 Fragment 换成 TransitionGroup 时现存行都算新节点，
      // 不禁掉入场动画会整表弹一遍
const rowsAnimSilent = ref(false)
const _rowsAnimTimer = ref(null)
      // 表格最大高度：内容超过此高度即启用纵向滚动（固定高度判断），默认 400，可由父组件按内容调整
const fixedMaxHeight = ref(props.maxHeight)
      // 列筛选状态：{ 列名: Set(允许出现的值) }。值为空表示该列未筛选（不参与过滤）
const columnFilters = ref({})
      // 当前打开筛选面板的列名（'' = 未打开）
const filterField = ref('')
      // 筛选面板打开期间才开启行错峰动画（面板关闭后延时关闭，见 rowAnimEnabled）
const filterAnimating = ref(false)
      // 面板里的值列表：由 buildFilterOptions 在打开/勾选时算出，缓存避免每次渲染重算
const filterOptions = ref([])
      // 面板定位锚点（表头上的那个放大镜/漏斗按钮）
const filterAnchorEl = ref(null)
      // ===== 行虚拟滚动 =====
      // 当前渲染窗口 [virtualStart, virtualEnd)（下标针对 bodyRows）
const virtualStart = ref(0)
const virtualEnd = ref(0)
      // 滞后开关的当前状态（由 syncVirtualActive 维护）：≥virtualFrom 置真、≤virtualOffBelow 置假、
      // 中间区间维持现状。不能用纯 computed——「维持现状」需要记住上一次的状态。
const virtualActive = ref(false)
      // 拖行期间锁死窗口：行在拖动中途被卸载会直接打乱几何缓存与落点判定
const virtualFrozen = ref(false)
      // 实测行高缓存：{ rowKey → 高度 }。未测到的行用 estRowH 估算
const rowHeights = ref(new Map())
const estRowH = ref(33)

// ===== computed =====

const hasNewRow = computed(() => { return ctx.rows.value && ctx.rows.value.some(r => r._isNew); })
    // 新增行是否已填写数据（用于取消新增前确认，id/position 属自动列不计入）
const newRowHasData = computed(() => {
      const nr = ctx.newRow.value || (ctx.rows.value || []).find(r => r._isNew);
      if (!nr) return false;
      return (ctx.fields.value || []).some(f => {
        if (f.name === 'id' || f.name === 'position') return false;
        const v = nr[f.name];
        return v != null && String(v).trim() !== '';
      });
    })
    // 是否有任何列处于筛选状态
const columnFilterActive = computed(() => { return Object.keys(ctx.columnFilters.value).length > 0; })
    // 实际渲染的行：columns 筛选后的结果。未筛选时直接返回原数组引用（零开销、不破坏行对象复用）
const bodyRows = computed(() => {
      if (!ctx.columnFilterActive.value) return ctx.rows.value;
      const active = Object.keys(ctx.columnFilters.value);
      return ctx.rows.value.filter(r => {
        // 正在录入的新行不参与筛选，否则一勾筛选它就凭空消失
        if (r._isNew) return true;
        // 分隔带在筛选态下没有意义（它不代表任何数据）
        if (r._isSeparator) return false;
        return active.every(f => ctx.matchColumnFilter(r, f));
      });
    })
    // 渲染下标 → rows 原始下标 的映射（仅供拖拽/序号回查用）。
    // 未筛选时为 null，调用方按恒等处理，避免多算一份数组。
const srcIndexList = computed(() => {
      if (!ctx.columnFilterActive.value) return null;
      const pos = new Map();
      ctx.rows.value.forEach((r, i) => pos.set(r, i));
      return ctx.bodyRows.value.map(r => (pos.has(r) ? pos.get(r) : -1));
    })
    // 筛选后一行都不剩：提示用。
    // 搜索无结果时不算「筛选没结果」——父组件的关键字搜索已经把行筛空了，
    // 这时该给的是「暂无 XX 的搜索结果 + 清除搜索」，不是「没有符合筛选条件的数据」。
const filterNoResult = computed(() => { return ctx.columnFilterActive.value && ctx.bodyRows.value.length === 0 && !ctx.searchNoResult.value; })
    // ===== 空态 =====
const emptyMessage = computed(() => {
      if (ctx.emptyLabel.value) return `还没有${ctx.emptyLabel.value}数据`;
      return ctx.emptyText.value || '还没有数据';
    })
    // 搜索无结果的文案：和「还没有 XX 数据」区分开。
    // 「还没有数据」暗示要去添加，「暂无搜索结果」暗示数据在、只是没匹配上 ——
    // 用户该做的动作完全不同（清除搜索 vs 添加记录）。
const emptySearchMessage = computed(() => {
      return ctx.emptyLabel.value ? `暂无${ctx.emptyLabel.value}的搜索结果` : '暂无搜索结果';
    })
    // 三个条件：数据已就绪、一行都没有、且不是「筛选把数据筛空了」
    // （筛选无结果有单独的提示行，不能说成「还没有数据」）。
const showEmptyBase = computed(() => {
      return ctx.emptyReady.value && ctx.bodyRows.value.length === 0 && !ctx.filterNoResult.value;
    })
    // 「判定中」：空态条件已经成立，但还没到延迟上屏的时间。
    // 这期间**既不算表格也不算空态**，模板里只放一块同高的静默占位、不渲染表头 ——
    // 否则首帧会先画出表头，260ms 后确认没数据、表头又被空态换掉，闪一下。
    // 数据若在这 260ms 内到达，showEmptyBase 立刻变 false，表格（表头）随即出现，不会被拖慢。
const emptyPending = computed(() => {
      return ctx.showEmptyBase.value && !ctx.emptyVisible.value;
    })
    // 空态的种类：'' = 不显示空态；'data' = 真的没数据；'search' = 搜索没匹配上。
    // 分开是因为两者的文案、按钮、用户的下一步动作都不同。
const emptyKind = computed(() => {
      if (!ctx.showEmptyBase.value) return '';
      return ctx.searchNoResult.value ? 'search' : 'data';
    })
    // ===== 行虚拟滚动 =====
    // 是否启用窗口化渲染：走滞后开关 virtualActive（见 syncVirtualActive），小表格保持整表 DOM。
    // virtualFrom <= 0 时整体关闭（走整表 DOM），与旧行为一致。
const virtualOn = computed(() => { return ctx.virtualFrom.value > 0 && ctx.virtualActive.value; })
    // 真正的渲染列表：窗口化时是 bodyRows 的一段切片，否则就是 bodyRows 本身（零拷贝）
const renderRows = computed(() => {
      if (!ctx.virtualOn.value) return ctx.bodyRows.value;
      return ctx.bodyRows.value.slice(ctx.virtualStart.value, ctx.virtualEnd.value);
    })
    // 渲染下标 → bodyRows 下标的偏移量。
    // 模板里的 rowIndex 是「渲染顺序」，窗口化时必须加回窗口起点才能对回真实数据。
const winOffset = computed(() => { return ctx.virtualOn.value ? ctx.virtualStart.value : 0; })
    // 行高前缀和：pre[i] = 前 i 行的累计高度。实测过的行用真实高度，其余用均值估算。
    // 只依赖 rowHeights / estRowH / bodyRows，滚动时不会重算（窗口定位走二分查找）。
const rowPrefix = computed(() => {
      const rows = ctx.bodyRows.value;
      const n = rows.length;
      const pre = new Array(n + 1);
      pre[0] = 0;
      const est = ctx.estRowH.value;
      for (let i = 0; i < n; i++) {
        const h = ctx.rowHeights.value.get(rows[i]._rowKey);
        pre[i + 1] = pre[i] + (h != null ? h : est);
      }
      return pre;
    })
    // 上垫片高度 = 窗口之前所有行的高度和；下垫片 = 窗口之后的高度和。
    // 两段垫片保证 <table> 的总高度与真实全量渲染一致，滚动条长度不会随窗口变化而跳动。
    // 行数骤减时窗口下标可能暂时越界（浏览器还没把 scrollTop 夹回范围内），这里统一夹住。
const padTop = computed(() => {
      if (!ctx.virtualOn.value) return 0;
      const pre = ctx.rowPrefix.value;
      return pre[Math.min(Math.max(0, ctx.virtualStart.value), pre.length - 1)];
    })
const padBottom = computed(() => {
      if (!ctx.virtualOn.value) return 0;
      const pre = ctx.rowPrefix.value;
      const end = Math.min(Math.max(0, ctx.virtualEnd.value), pre.length - 1);
      return Math.max(0, pre[pre.length - 1] - pre[end]);
    })
    // 垫片行 / 空状态行的跨列数
const tableColSpan = computed(() => {
      if (ctx.readonly.value) return ctx.fields.value.length + (ctx.actionsHeader.value ? 1 : 0);
      return ctx.fields.value.length + (ctx.noSelect.value ? 1 : 2);
    })
    // 面板里的排序高亮态：只有当前列就是排序列时才显示升/降序选中
const filterSortOrder = computed(() => {
      return ctx.filterField.value && ctx.sortField.value === ctx.filterField.value ? ctx.sortOrder.value : '';
    })
    // 行过渡容器是否启用：仅在搜索过滤/筛选面板打开期间启用错峰动画（见模板里的说明）。
    // 为什么不用「有筛选就开」：TransitionGroup 每次更新都要强制读写布局，而在有筛选的情况下
    // 用户还会继续双击编辑单元格，那时动画毫无收益。故只在「筛选面板打开」这个窗口内开启，
    // 面板关掉 600ms 后自动退化回 Fragment，日常编辑依旧零额外开销。
    // 虚拟滚动下直接关掉：滚动本身就在不停换行，播进出动画只会变成整屏闪。
    // 注意判据是「窗口真的截断了行」而不是「virtualOn」——行全都在窗口里时虚拟滚动等同没开，
    // 这时动画照旧（否则把阈值调小做验证时，小表格的筛选动画会被无辜关掉）。
    // rowsAnimWindow：行增删（删除 / 撤销恢复 / 保存新行）后的短窗口，见 openRowsAnimWindow。
const rowAnimEnabled = computed(() => {
      const truncating = ctx.virtualOn.value && (ctx.virtualEnd.value - ctx.virtualStart.value) < ctx.bodyRows.value.length;
      return !truncating && (!!ctx.searchActive.value || ctx.filterAnimating.value || ctx.rowsAnimWindow.value);
    })
    // 行容器组件：错峰动画窗口内（搜索中 / 筛选面板打开）用 TransitionGroup，否则用 RowsFragment 做「透明包裹」，
    // 让 <tr> 始终是 <tbody> 的直接子节点。两者都必须能在实例上取到（模板表达式不会
    // 自动解析 components 选项，直接写 TransitionGroup 会得到 undefined 而整表不渲染）。
const rowWrapper = computed(() => { return ctx.rowAnimEnabled.value ? TransitionGroup : RowsFragment; })
    // 选中行键集合：O(n) 建一次，模板内 O(1) 查用，避免整张表 O(n²) 的 includes 查找
const selectedKeySet = computed(() => { return new Set(ctx.selectedRowKeys.value); })
const isAllSelected = computed(() => {
      const normalRows = (ctx.bodyRows.value || []).filter(r => !r._isSeparator);
      return normalRows.length > 0 && normalRows.every(r => ctx.selectedKeySet.value.has(r._rowKey));
    })
const isIndeterminate = computed(() => {
      const normalRows = (ctx.bodyRows.value || []).filter(r => !r._isSeparator);
      // 只统计「当前可见行」里被选中的数量：筛选态下被隐藏的选中行不应该让全选框保持半选
      const s = normalRows.filter(r => ctx.selectedKeySet.value.has(r._rowKey)).length;
      return s > 0 && s < normalRows.length;
    })

// ===== ctx 袋：拖拽模块与本组件方法经它互调 =====
const ctx = {
  // 模板 ref（拖拽模块经 ctx.rootEl.value 取组件根节点；动态输入框 ref 由函数 ref 收集进 cellInputRefs）
  rootEl, scrollWrapper, tbodyRef, theadRow,
  // props（toRef，供模块经 ctx.x.value 读）
  fields: toRef(props, "fields"),
  rows: toRef(props, "rows"),
  newRow: toRef(props, "newRow"),
  sortField: toRef(props, "sortField"),
  sortOrder: toRef(props, "sortOrder"),
  editingCell: toRef(props, "editingCell"),
  maxRows: toRef(props, "maxRows"),
  hideSelectAll: toRef(props, "hideSelectAll"),
  hideMoveButtons: toRef(props, "hideMoveButtons"),
  hideEditButton: toRef(props, "hideEditButton"),
  opColumnWidth: toRef(props, "opColumnWidth"),
  hideAddRow: toRef(props, "hideAddRow"),
  noRowDrag: toRef(props, "noRowDrag"),
  editOnClick: toRef(props, "editOnClick"),
  readonly: toRef(props, "readonly"),
  actionsHeader: toRef(props, "actionsHeader"),
  emptyText: toRef(props, "emptyText"),
  emptyLabel: toRef(props, "emptyLabel"),
  emptyActionText: toRef(props, "emptyActionText"),
  emptyReady: toRef(props, "emptyReady"),
  loadError: toRef(props, "loadError"),
  errorText: toRef(props, "errorText"),
  fitContent: toRef(props, "fitContent"),
  noSelect: toRef(props, "noSelect"),
  maxHeight: toRef(props, "maxHeight"),
  protectedColumns: toRef(props, "protectedColumns"),
  displayIndexes: toRef(props, "displayIndexes"),
  searchActive: toRef(props, "searchActive"),
  searchNoResult: toRef(props, "searchNoResult"),
  virtualFrom: toRef(props, "virtualFrom"),
  virtualOffBelow: toRef(props, "virtualOffBelow"),
  virtualOverscan: toRef(props, "virtualOverscan"),
  // 状态 / computed ref
  internalEditCell,
  selectedRowKeys,
  emptyVisible,
  dragIndex,
  dragOverIndex,
  colDragIndex,
  colDragOverIndex,
  addRowAnimated,
  addRowAnimKey,
  discardConfirmVisible,
  colAnimDone,
  firstActivate,
  vScroll,
  rowsAnimWindow,
  rowsAnimSilent,
  fixedMaxHeight,
  columnFilters,
  filterField,
  filterAnimating,
  filterOptions,
  filterAnchorEl,
  virtualStart,
  virtualEnd,
  virtualActive,
  virtualFrozen,
  rowHeights,
  estRowH,
  hasNewRow,
  newRowHasData,
  columnFilterActive,
  bodyRows,
  srcIndexList,
  filterNoResult,
  emptyMessage,
  emptySearchMessage,
  showEmptyBase,
  emptyPending,
  emptyKind,
  virtualOn,
  renderRows,
  winOffset,
  rowPrefix,
  padTop,
  padBottom,
  tableColSpan,
  filterSortOrder,
  rowAnimEnabled,
  rowWrapper,
  selectedKeySet,
  isAllSelected,
  isIndeterminate,
  // 事件
  emit,
}

// 拖拽模块（行/列拖拽、落点高亮框与交换 FLIP 动画）与组件自身方法统一挂上 ctx
Object.assign(ctx, useDynamicTableDrag(ctx), { isProtectedField, syncVirtualActive, onBodyScroll, recalcWindow, lowerBound, commitEditIfLeaving, measureRows, initVirtual, preloadFilterPanel, isColumnFiltered, filterButtonTitle, openFilter, closeFilter, onFilterToggle, onFilterSort, clearColumnFilter, buildFilterOptions, matchColumnFilter, cellFilterValue, compareFilterValue, srcIndex, rowAt, positionOf, onFilterDocClick, handleFilterKeydown, onFilterScroll, playTableEnter, snapshotWidths, _doSnapshotWidths, _freezeHeaderWidths, _unfreezeHeaderWidths, cellSelectOptions, isEditing, focusEditInput, _clearActiveCell, onCellClick, onCellBlur, onCellEnter, handleGlobalEnter, handleClickOutside, emitSaveAndClear, isRowSelected, toggleRowSelect, toggleAllSelect, clearSelection, getReceiptCount, staggerEnter, staggerAfterEnter, staggerLeave, staggerAfterLeave, _perfMeasureRender, onAddRowBarClick, requestCancelNewRow, confirmDiscardNewRow, animateCancelNewRow, focusNewRowInput, _focusNewRowEl, updateVScroll, beginRowsAnimWindow })

// ===== 模板顶层绑定：拖拽模块提供、模板用到的方法 =====
const { onRowHandleDown, onColHandleDown } = ctx

// ===== 方法 =====
    // 判断字段是否受保护（受保护字段在表头显示 * 提示）
function isProtectedField(field) { return ctx.protectedColumns.value.includes(field.name); }

    // ==================== 行虚拟滚动 ====================
    // 滞后开关（防抖）：行数 ≥ virtualFrom 才开虚拟，≤ virtualOffBelow 才退回整表，
    // 两者之间维持现状——否则行数在阈值附近增删（加一行/删一行/筛一下）会整表 ↔ 窗口来回切，
    // 每次切换都要重建 DOM。每次切模式的代价远大于中间区间多算几行，故用双阈值锁住。
function syncVirtualActive() {
      if (ctx.virtualFrom.value <= 0) { ctx.virtualActive.value = false; return; }
      const n = ctx.bodyRows.value.length;
      const onAt = ctx.virtualFrom.value;
      // offAt 至少比 onAt 小 1，防调用方把两个阈值配成同一个数（否则恰好等于阈值时抖动）
      const offAt = Math.min(ctx.virtualOffBelow.value, onAt - 1);
      if (n >= onAt) ctx.virtualActive.value = true;
      else if (n <= offAt) ctx.virtualActive.value = false;
      // 中间区间：维持现状
    }
    // 滚动：同步重算窗口，只有窗口真的变了才触发渲染。
    // 不走 rAF：rAF 会晚一帧出新行，快速滑动/甩动时那一帧就露出垫片空白、下一帧「突然出字」；
    // 同步算完 + Vue 微任务补丁在同一帧内绘制，滚动全程不露白。
    // recalcWindow 只是二分查找 + 写两个响应式值（O(log n)），放进滚动事件里开销可忽略。
    // 视口高由 initVirtual / ResizeObserver 维护，不在滚动事件里读 clientHeight（避免触发布局）。
function onBodyScroll(e) {
      if (!e.target) return;
      ctx._scrollTop = e.target.scrollTop;
      if (!ctx.virtualOn.value) return;
      ctx.recalcWindow();
    }
    // 按当前滚动位置算渲染窗口；窗口没变就什么都不做（滚动过程中的绝大部分帧走这条路）
function recalcWindow() {
      const n = ctx.bodyRows.value.length;
      if (!ctx.virtualOn.value) {
        if (ctx.virtualStart.value !== 0 || ctx.virtualEnd.value !== n) { ctx.virtualStart.value = 0; ctx.virtualEnd.value = n; }
        return;
      }
      // 拖行期间窗口锁死：行在拖动中途被卸载会打乱 _rowGeom / _rowEls 的下标对应
      if (ctx.virtualFrozen.value) return;
      const pre = ctx.rowPrefix.value;
      const top = ctx._scrollTop;
      const bottom = top + (ctx._viewportH || ctx.fixedMaxHeight.value);
      // 二分：第一个累计高度 > top 的行下标，即当前可视窗口的起点
      let s = ctx.lowerBound(pre, top) - 1;
      let e = ctx.lowerBound(pre, bottom);
      // 缓冲行数动态取大：固定 8 行在高视口/矮行高下不够（400px ÷ 33px ≈ 12 行可视，缓冲不足一屏），
      // 至少留「两整屏」的缓冲——窗口切换更稀、甩动/触控板惯性滚动的跳跃也落在已渲染范围内。
      // DOM 量仍远小于整表（400px 视口 → 约 60 行 vs 全量 2500 行）。
      const overscan = Math.max(ctx.virtualOverscan.value, Math.ceil((ctx._viewportH || ctx.fixedMaxHeight.value) / (ctx.estRowH.value || 33)) * 2);
      s = Math.max(0, s - overscan);
      e = Math.min(n, e + overscan);
      if (e < s) e = s;
      if (s === ctx.virtualStart.value && e === ctx.virtualEnd.value) return;
      // 编辑中的单元格所在行即将被卸载：输入框消失不会触发 blur，得先落盘再换窗口
      ctx.commitEditIfLeaving(s, e);
      ctx.virtualStart.value = s;
      ctx.virtualEnd.value = e;
      nextTick(() => ctx.measureRows());
    }
    // 返回第一个 arr[i] > value 的下标（arr 单调不减）
function lowerBound(arr, value) {
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= value) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
    // 窗口切换会把「正在编辑的行」卸载掉：先按失焦语义提交，避免改了的值丢失
function commitEditIfLeaving(start, end) {
      const key = ctx.editingCell.value ? ctx.editingCell.value.rowKey
        : (ctx.internalEditCell.value ? ctx.internalEditCell.value.rowKey : null);
      if (!key) return;
      const idx = ctx.bodyRows.value.findIndex(r => r._rowKey === key);
      if (idx >= start && idx < end) return;
      if (ctx.editingCell.value) ctx.emitSaveAndClear();
      if (ctx.internalEditCell.value) { ctx.internalEditCell.value = null; ctx._clearActiveCell(); }
    }
    // 量一次当前渲染行的真实高度，更新缓存；行高变了还要补偿滚动位置避免跳一下。
    // 估算行高只在「第一次量到行」时锁定一次：若让它跟着每次测量漂移，
    // 垫片上方的未测行总高度会跟着变，滚动位置就会莫名其妙地跳。
function measureRows() {
      if (!ctx.virtualOn.value) return;
      const tbody = ctx.tbodyRef.value;
      const list = ctx.renderRows.value;
      if (!tbody || !list.length) return;
      const trs = tbody.querySelectorAll('tr.data-drag-item');
      // 数量对不上说明有行正在离场动画里，这一帧跳过，下一帧再量
      if (trs.length !== list.length) return;
      // 先记下当前 padTop（改缓存之前读），测量后用它算位移补偿
      const winStart = ctx.virtualStart.value;
      const before = ctx.rowPrefix.value[winStart];
      let sum = 0, cnt = 0, changed = false;
      for (let i = 0; i < trs.length; i++) {
        const h = Math.round(trs[i].getBoundingClientRect().height);
        if (h <= 0) continue;
        sum += h; cnt++;
        if (ctx.rowHeights.value.get(list[i]._rowKey) !== h) {
          ctx.rowHeights.value.set(list[i]._rowKey, h);
          changed = true;
        }
      }
      if (cnt && !ctx._estLocked) {
        ctx.estRowH.value = Math.round(sum / cnt);
        ctx._estLocked = true;
      }
      if (!changed) return;
      // 上面的行变高/变矮会让可视内容整体位移，用 padTop 的差值把滚动位置补回去
      nextTick(() => {
        if (ctx.virtualFrozen.value) return;
        // 测量期间窗口已被重算（滚动/换窗口）：此时 rowPrefix[virtualStart] 变的是窗口起点而不是行高，
        // 再补偿就会把 scrollTop 二次顶飞（曾表现为首屏直接滚到表格末尾）
        if (ctx.virtualStart.value !== winStart) return;
        const after = ctx.rowPrefix.value[winStart];
        const delta = after - before;
        const wrap = ctx.scrollWrapper.value;
        if (!delta || !wrap) return;
        wrap.scrollTop += delta;
        ctx._scrollTop = wrap.scrollTop;
      });
    }
    // 初始化：先按容器固定高度估一次窗口（首帧就不能把全部行画出来），再把滚动/尺寸接上
function initVirtual() {
      const wrap = ctx.scrollWrapper.value;
      if (!wrap) return;
      ctx._viewportH = wrap.clientHeight || ctx.fixedMaxHeight.value;
      ctx._scrollTop = wrap.scrollTop;
      ctx.recalcWindow();
      nextTick(() => ctx.measureRows());
      if (typeof ResizeObserver !== 'undefined' && !ctx._ro) {
        ctx._ro = new ResizeObserver(() => {
          ctx._viewportH = wrap.clientHeight;
          ctx.recalcWindow();
          nextTick(() => ctx.measureRows());
        });
        ctx._ro.observe(wrap);
      }
    }

    // ==================== 列筛选（表头放大镜/漏斗） ====================
    // 供 v-preload 使用：把懒加载 loader 包成实例方法，模板里才能引用到
function preloadFilterPanel() { return loadColumnFilter(); }
function isColumnFiltered(name) { return !!ctx.columnFilters.value[name]; }
function filterButtonTitle(name) {
      return ctx.isColumnFiltered(name) ? `${name}：已筛选（点击修改）` : `${name}：筛选 / 排序`;
    }
function openFilter(field, event) {
      if (event) event.stopPropagation();
      // 再点一次同一个按钮 = 收起
      if (ctx.filterField.value === field.name) { ctx.closeFilter(); return; }
      ctx.filterAnchorEl.value = (event && event.currentTarget) || null;
      ctx.filterOptions.value = ctx.buildFilterOptions(field.name);
      ctx.filterField.value = field.name;
      // 面板开着的这段时间就是「会有行进出」的窗口：提前打开错峰动画，
      // 这样第一次勾选也和后续勾选一样有进出动画（而不是切换容器导致的整表重挂载）
      clearTimeout(ctx._filterAnimTimer);
      ctx.filterAnimating.value = true;
    }
function closeFilter() {
      if (!ctx.filterField.value) return;
      ctx.filterField.value = '';
      // 留一段尾巴让最后一次收起的行动画播完，再退化回 Fragment 省掉强制布局
      clearTimeout(ctx._filterAnimTimer);
      ctx._filterAnimTimer = setTimeout(() => { ctx.filterAnimating.value = false; }, 600);
    }
    // 勾选/取消某个值：以「全部值」为起点取反，再把结果存回筛选状态
function onFilterToggle(value) {
      const field = ctx.filterField.value;
      if (!field) return;
      const current = ctx.columnFilters.value[field];
      const sel = current ? new Set(current) : new Set(ctx.filterOptions.value.map(o => o.value));
      if (sel.has(value)) sel.delete(value);
      else sel.add(value);
      // 全部勾上 == 没筛选：直接清掉该列状态，图标回到放大镜
      if (ctx.filterOptions.value.length && sel.size === ctx.filterOptions.value.length) delete ctx.columnFilters.value[field];
      else ctx.columnFilters.value[field] = sel;
      // 计数只受「其它列」影响，本列勾选不变，故这里重算只为刷新勾选态
      ctx.filterOptions.value = ctx.buildFilterOptions(field);
    }
    // 排序：把「升/降序」的明确意图交给父组件（父组件的 toggleSort 支持第二参数）
function onFilterSort(order) {
      if (!ctx.filterField.value) return;
      emit('toggleSort', ctx.filterField.value, order);
    }
function clearColumnFilter() {
      const field = ctx.filterField.value;
      if (!field) return;
      delete ctx.columnFilters.value[field];
      ctx.filterOptions.value = ctx.buildFilterOptions(field);
    }
    // 面板里的值列表：只统计「通过其它列筛选」的行，实现后筛选的列跟着前面的条件收窄
function buildFilterOptions(field) {
      const others = Object.keys(ctx.columnFilters.value).filter(f => f !== field);
      const counts = new Map();
      for (const r of ctx.rows.value || []) {
        if (r._isSeparator || r._isNew) continue;
        if (!others.every(f => ctx.matchColumnFilter(r, f))) continue;
        const v = ctx.cellFilterValue(r, field);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      const sel = ctx.columnFilters.value[field];
      return [...counts.entries()]
        .map(([value, count]) => ({ value, count, selected: !sel || sel.has(value) }))
        .sort((a, b) => ctx.compareFilterValue(a.value, b.value));
    }
function matchColumnFilter(row, field) {
      const sel = ctx.columnFilters.value[field];
      if (!sel) return true;
      return sel.has(ctx.cellFilterValue(row, field));
    }
    // 单元格值统一成字符串比较：null / undefined 视为空白（空串）
function cellFilterValue(row, field) {
      const v = row ? row[field] : undefined;
      return v == null ? '' : String(v);
    }
function compareFilterValue(a, b) {
      if (a === b) return 0;
      if (a === '') return 1;      // 空白永远排最后
      if (b === '') return -1;
      const na = Number(a), nb = Number(b);
      const aNum = a.trim() !== '' && !Number.isNaN(na);
      const bNum = b.trim() !== '' && !Number.isNaN(nb);
      if (aNum && bNum) return na - nb;
      if (aNum !== bNum) return aNum ? -1 : 1;   // 数字排在文字前
      return zhCollator.compare(a, b);
    }
    // 渲染下标 → rows 原始下标（未筛选且未窗口化时恒等）
function srcIndex(i) {
      // 先加回窗口偏移：模板里的下标是「渲染顺序」，而 bodyRows 是完整列表
      const j = i + ctx.winOffset.value;
      const list = ctx.srcIndexList.value;
      if (!list) return j;
      const v = list[j];
      return v == null || v < 0 ? j : v;
    }
    // 按渲染下标取到真实行对象（拖拽内部按渲染顺序处理，回查行数据时必须走这里）
function rowAt(i) { return ctx.rows.value[ctx.srcIndex(i)]; }
    // 序号列：筛选后仍显示该行在全表中的原始序号
function positionOf(rowIndex) {
      const src = ctx.srcIndex(rowIndex);
      if (ctx.displayIndexes.value) return ctx.displayIndexes.value[src];
      const row = ctx.rows.value[src];
      return row ? row._displayIndex : '';
    }
    // 点面板外部收起
function onFilterDocClick(e) {
      if (!ctx.filterField.value) return;
      const t = e.target;
      if (t && t.closest && (t.closest('.dtf-panel') || t.closest('.dt-filter-btn'))) return;
      ctx.closeFilter();
    }
function handleFilterKeydown(e) {
      if (e.key === 'Escape' && ctx.filterField.value) ctx.closeFilter();
    }
    // 表格/页面滚动后锚点位置已失效：收起面板（面板内部列表滚动不算）
function onFilterScroll(e) {
      if (!ctx.filterField.value) return;
      const t = e.target;
      if (t && t.nodeType === 1 && t.closest && t.closest('.dtf-panel')) return;
      ctx.closeFilter();
    }
    // 数据区(tbody)整体从左往右弹入：不动 DOM 结构、不加 key，
    // 通过临时加一次性 keyframe 类播放动画（与课程表单行 row-flip 方向一致）。
    // 动画结束后移除类，保证下次导航能重新触发。
function playTableEnter() {
      const tbody = ctx.tbodyRef.value;
      if (!tbody) return;
      // 清理上次监听
      if (ctx._tableEnterCleanup) ctx._tableEnterCleanup();
      const onEnd = (e) => { if (e && e.target !== tbody) return; ctx._tableEnterCleanup(); };
      ctx._tableEnterCleanup = () => {
        const t = tbody;
        if (!t) return;
        t.classList.remove('table-enter');
        t.removeEventListener('animationend', onEnd);
        ctx._tableEnterCleanup = null;
      };
      tbody.addEventListener('animationend', onEnd);
      // 强制重排后再加类，保证重复导航时动画能重播
      void tbody.offsetWidth;
      tbody.classList.add('table-enter');
    }
    // 按当前「内容」量出自然自适应列宽，并立刻切到 fixed 布局钉住，
    // 这样新增行里空 input 不会撑宽窄列，动画前后列宽都稳定
function snapshotWidths() {
      if (!ctx.rootEl.value) return;
      // 等首帧绘制完成后再测量/钉住列宽，避免首次进入页面时列宽跳变产生的 layout shift
      if (ctx._snapshotRaf) cancelAnimationFrame(ctx._snapshotRaf);
      ctx._snapshotRaf = requestAnimationFrame(() => ctx._doSnapshotWidths());
    }
function _doSnapshotWidths() {
      ctx._snapshotRaf = null;
      const tbl = ctx.rootEl.value.querySelector('table');
      const ths = ctx.rootEl.value.querySelectorAll('thead th');
      if (!tbl || !ths.length) return;
      tbl.style.tableLayout = 'auto'; // 自动布局：列可随容器宽度收缩，内容宽时换行，不撑出横向滚动
      const widths = [...ths].map(th => th.getBoundingClientRect().width);
      [...ths].forEach((th, i) => {
        // 兜底：清除输入新行冻结可能残留的 min-width 下界，保证全屏时数据列可收缩换行、不横向溢出
        th.style.minWidth = '';
        // 操作列固定统一宽度：新增行（保存/取消）与普通行（↑↓/删除）按钮宽度不同，
        // 按实测会随行态滑动；统一固定常量保证任何行态下列宽一致、无水平位移。
        if (th.classList.contains('col-op')) {
          th.style.width = ctx.opColumnWidth.value + 'px';
          th.style.minWidth = ctx.opColumnWidth.value + 'px';
          return;
        }
        const w = widths[i];
        if (!w) return;
        // auto 布局下表头宽度只是“偏好”→ 内容充裕时按内容自适应，容器变窄时可被压缩换行
        const cur = parseFloat(th.style.width || '');
        if (Number.isFinite(cur) && Math.abs(cur - w) <= 2) return;
        th.style.width = w + 'px';
      });
    }
    // 冻结表头列宽：量出当前各列宽度并写入 width 偏好，使新增行的空输入不再撑动列宽。
    // 仅对操作列额外锁 min-width 锁定下界，保证新增前后操作列宽度一致、不左右位移；
    // 数据列不锁 min-width，容器不足时仍可收缩换行，避免全屏/小窗口横向滚动条。
function _freezeHeaderWidths() {
      const ths = ctx.rootEl.value?.querySelectorAll('thead th');
      if (!ths?.length) return;
      ths.forEach(th => {
        // 操作列统一固定宽度：与 snapshotWidths 保持一致，任何行态下列宽恒为 150px，
        // 避免新增行（保存/取消）与普通行（↑↓/删除）按钮宽不同导致水平位移
        if (th.classList.contains('col-op')) {
          if (th._frozenWidth == null) th._frozenWidth = th.style.width || '';
          th.style.width = ctx.opColumnWidth.value + 'px';
          th.style.minWidth = ctx.opColumnWidth.value + 'px';
          return;
        }
        const w = th.getBoundingClientRect().width;
        if (!w) return;
        if (th._frozenWidth == null) th._frozenWidth = th.style.width || '';
        th.style.width = w + 'px';
      });
    }
    // 解除冻结：恢复原有宽度、清除 min-width，由后续 snapshotWidths 重算自然列宽
function _unfreezeHeaderWidths() {
      const ths = ctx.rootEl.value?.querySelectorAll('thead th');
      ths?.forEach(th => {
        th.style.minWidth = '';
        if (th._frozenWidth != null) {
          th.style.width = th._frozenWidth;
          th._frozenWidth = '';
        }
      });
    }
function cellSelectOptions(field) {
      // 保留原来「空选项」的清除语义：把空串作为首项
      return ['', ...(field.options || [])]
    }

function isEditing(row, fieldName) {
      if (ctx.editOnClick.value) {
        return ctx.internalEditCell.value !== null && ctx.internalEditCell.value.rowKey === row._rowKey && ctx.internalEditCell.value.field === fieldName;
      }
      return ctx.editingCell.value?.rowKey === row._rowKey && ctx.editingCell.value?.field === fieldName;
    }
function focusEditInput(rowKey, fieldName) {
      nextTick(() => {
        const el = getCellInput('editInput-' + rowKey + '-' + fieldName);
        if (el) el.focus();
      });
    }
    // 单击高亮改为命令式增删 class：避免 activeCell 成为响应式依赖触发整表重渲染
function _clearActiveCell() {
      if (ctx._activeTd) {
        ctx._activeTd.classList.remove('cell-active');
        ctx._activeTd = null;
      }
    }
function onCellClick(event, row, field) {
      // 忽略由拖拽手柄按下后冒出的 click（避免拖完行误触发单元格编辑/选中）
      if (ctx._suppressCellClick) {
        ctx._suppressCellClick = false;
        return;
      }
      if (ctx.readonly.value) return;
      if (ctx.editOnClick.value) {
        ctx._clearActiveCell();
        if (!ctx.isEditing(row, field.name)) {
          ctx.internalEditCell.value = { rowKey: row._rowKey, field: field.name };
          ctx.focusEditInput(row._rowKey, field.name);
        }
        return;
      }
      if (ctx.isEditing(row, field.name)) return;
      const td = event && event.currentTarget;
      if (td && td === ctx._activeTd) return;
      ctx._clearActiveCell();
      if (td) {
        td.classList.add('cell-active');
        ctx._activeTd = td;
      }
    }
function onCellBlur(row, field) {
      if (row._isNew) return;
      emit('saveCell', row, field);
      if (ctx.editOnClick.value) { ctx.internalEditCell.value = null; ctx._clearActiveCell(); }
    }
function onCellEnter(row, field) {
      if (row._isNew) { emit('saveNewRow'); return; }
      emit('saveCell', row, field);
      if (ctx.editOnClick.value) ctx.internalEditCell.value = null;
    }
    // 整表 Enter 保存新增行：焦点不在输入框/文本域/下拉等可输入控件时，Enter 即触发保存
function handleGlobalEnter(e) {
      if (e.key !== 'Enter' || e.isComposing) return
      if (!ctx.hasNewRow.value) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      // 焦点在「取消」按钮上时按回车应取消而非保存
      if (t && t.tagName === 'BUTTON' && /取消/.test(t.textContent || '')) return
      emit('saveNewRow')
    }
function handleClickOutside(event) {
      if (!ctx.editingCell.value) return;
      if (!ctx.rootEl.value.contains(event.target)) { ctx.emitSaveAndClear(); return; }
      const editingInput = ctx.rootEl.value.querySelector('input:focus, select:focus');
      if (!editingInput || !editingInput.contains(event.target)) ctx.emitSaveAndClear();
    }
function emitSaveAndClear() {
      if (!ctx.editingCell.value) return;
      const row = ctx.rows.value.find(r => r._rowKey === ctx.editingCell.value.rowKey);
      const field = ctx.fields.value.find(f => f.name === ctx.editingCell.value.field);
      if (row && field) emit('saveCell', row, field);
    }
function isRowSelected(rowKey) { return ctx.selectedKeySet.value.has(rowKey); }
function toggleRowSelect(rowKey) {
      if (ctx.readonly.value) return;
      ctx.selectedRowKeys.value = ctx.selectedKeySet.value.has(rowKey)
        ? ctx.selectedRowKeys.value.filter(k => k !== rowKey)
        : [...ctx.selectedRowKeys.value, rowKey];
    }
function toggleAllSelect() {
      if (ctx.readonly.value) return;
      // 全选只作用于「当前可见行」：筛选态下不应把被过滤掉的行也勾上
      const normalRows = (ctx.bodyRows.value || []).filter(r => !r._isSeparator && !r._isNew);
      ctx.selectedRowKeys.value = ctx.isAllSelected.value ? [] : normalRows.map(r => r._rowKey);
    }
function clearSelection() { ctx.selectedRowKeys.value = []; }
function getReceiptCount(row) {
      const raw = row['收据'] || '[]';
      const cached = ctx._receiptCache.get(row);
      if (cached && cached.raw === raw) return cached.count;
      let count = 0;
      try { count = JSON.parse(raw).length; } catch { /* 非法 JSON 视为 0 */ }
      ctx._receiptCache.set(row, { raw, count });
      return count;
    }
    // 搜索过滤/列筛选时的上下级联动画（仅 rowAnimEnabled 启用，不影响其它页/场景的普通过渡）
    // 有结果出现 → 行从上往下依次进入；没有结果 → 行从下往上依次消失
function staggerEnter(el) {
      if (!ctx.rowAnimEnabled.value) return;
      el.style.transitionDelay = (Array.prototype.indexOf.call(el.parentNode.children, el) * 30) + 'ms';
    }
function staggerAfterEnter(el) { el.style.transitionDelay = ''; }
function staggerLeave(el) {
      if (!ctx.rowAnimEnabled.value) return;
      const kids = el.parentNode.children;
      const idx = Array.prototype.indexOf.call(kids, el);
      el.style.transitionDelay = ((kids.length - 1 - idx) * 30) + 'ms';
    }
function staggerAfterLeave(el) { el.style.transitionDelay = ''; }
    // 性能探针：一次整表渲染的耗时（rows 变化 → 下一帧渲染完成）
function _perfMeasureRender() {
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
    }
    // 底部「添加一行 / 取消添加一行」按钮
function onAddRowBarClick() {
      if (!ctx.hasNewRow.value) {
        emit('addNewRowAtBottom');
        return;
      }
      ctx.requestCancelNewRow();
    }
    // 取消新增行：已填写数据时先确认放弃，未填数据直接收起
function requestCancelNewRow() {
      if (ctx.newRowHasData.value) {
        ctx.discardConfirmVisible.value = true;
        return;
      }
      ctx.animateCancelNewRow();
    }
function confirmDiscardNewRow() {
      ctx.discardConfirmVisible.value = false;
      ctx.animateCancelNewRow();
    }
    // 取消（关闭）新增行：先播放「向上加速淡出」的收起动画，动画结束后才真正移除该行，
    // 否则父组件会立即卸载该行，关闭时没有任何过渡。
function animateCancelNewRow() {
      const el = ctx.rootEl.value && ctx.rootEl.value.querySelector('tr.row-pop-in');
      if (!el) {
        emit('cancelNewRow');
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (ctx._cancelRowTimer) { clearTimeout(ctx._cancelRowTimer); ctx._cancelRowTimer = null; }
        emit('cancelNewRow');
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
      ctx._cancelRowTimer = setTimeout(finish, 140);
    }
function focusNewRowInput() {
      // 没有新增行就不做任何事：下面的「滚到底部」兜底是给新增行准备的，
      // 若在挂载时无条件走到那里，整张表会在首帧被直接滚到末页（表头/首行看起来「没固定」）
      if (!ctx.hasNewRow.value) return;
      nextTick(() => {
        if (ctx._focusNewRowEl()) return;
        // 虚拟滚动下新增行可能落在窗口之外（根本没被渲染）：先把容器滚到底，重算窗口后再聚焦
        if (!ctx.virtualOn.value) return;
        const wrap = ctx.scrollWrapper.value;
        if (!wrap) return;
        wrap.scrollTop = wrap.scrollHeight;
        ctx._scrollTop = wrap.scrollTop;
        ctx.recalcWindow();
        nextTick(() => { ctx._focusNewRowEl(); });
      });
    }
    // 通过 :ref="'newRowInput'" 精确取新增行的数据输入框，不用宽泛的 querySelector，
    // 避免在搜索过滤导致行数变化时误聚焦到普通行的复选框而抢走搜索框焦点
function _focusNewRowEl() {
      const el = getCellInput('newRowInput');
      if (!el) return false;
      // 容器固定高度时新增行可能在底部被遮住：滚入视口让用户立即看到新行
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      el.focus();
      return true;
    }
    // 固定高度判断纵向滚动：测量表格完整内容高度（scrollHeight 不被容器裁剪），
    // 超过 fixedMaxHeight 即启用纵向滚动，表头随之吸顶。多行/换行行高不同也适用。
function updateVScroll() {
      if (!ctx.rootEl.value) return;
      const tbl = ctx.rootEl.value.querySelector('table');
      ctx.vScroll.value = !!tbl && tbl.scrollHeight > ctx.fixedMaxHeight.value;
    }
    // 行数要变化了（删掉一行 / 撤销恢复一行）——由父组件在**动手之前**调用。
    // 为什么必须提前：行容器平时是 Fragment（性能考虑，见 rowAnimEnabled），
    // 只有已经在 TransitionGroup 里的行，被移出时才会播离场动画。
    // 如果等 rows 更新完再切换容器，那时旧行已经没了、新容器也从未渲染过它，
    // 离场动画就永远不会播；反而所有现存行会被当成新节点整表重播一遍入场。
    // 所以顺序是：先切容器（首帧静默，见 rowsAnimSilent）→ 再改数据 → 只有真正增删的那一行有动画。
function beginRowsAnimWindow() {
      if (ctx._rowsAnimTimer) clearTimeout(ctx._rowsAnimTimer);
      // 首帧静默：容器刚换成 TransitionGroup 时，现存行都会被视为新节点，
      // 不禁掉入场就会整表一起弹一遍。静默只覆盖这一次 patch，下一帧就恢复正常。
      ctx.rowsAnimSilent.value = true;
      ctx.rowsAnimWindow.value = true;
      nextTick(() => { ctx.rowsAnimSilent.value = false; });
      // 450ms ≈ 离场 0.3s / 入场 0.3s，再留一点余量；窗口一过退回 Fragment。
      ctx._rowsAnimTimer = setTimeout(() => {
        ctx._rowsAnimTimer = null;
        ctx.rowsAnimWindow.value = false;
      }, 450);
    }
// 空态延迟上屏（见 data 里 emptyVisible 的说明）：条件成立不是立刻显示，
// 取消时立刻收回，不给「闪一下又消失」留窗口。
// 搜索无结果（emptyKind === 'search'）例外：那是用户主动输入关键字后的确定结论，
// 立刻给反馈才对；再等 260ms 会让人觉得「按了没反应」。
watch(emptyKind, (v) => {
  if (ctx._emptyTimer) { clearTimeout(ctx._emptyTimer); ctx._emptyTimer = null; }
  if (!v) { emptyVisible.value = false; return; }
  if (v === 'search') { emptyVisible.value = true; return; }
  ctx._emptyTimer = setTimeout(() => { ctx._emptyTimer = null; emptyVisible.value = true; }, 260);
}, { immediate: true })
watch(hasNewRow, (val) => {
  // 取消新增行 → 底部添加行重现，仅此后播放上浮动画
  if (!val) addRowAnimated.value = true;
})
watch(() => ctx.rows.value.length, () => {
  // 就地增删（数组引用没变）也会走到这里：滞后开关要跟进行数，否则跨阈值不切换
  syncVirtualActive();
  nextTick(() => {
    updateVScroll();
    // 仅当确实存在新增行时才聚焦其数据输入框；
    // 行数变化也可能来自搜索过滤/增删等场景，此时不得用 .focus() 抢占焦点（否则搜索输入框失焦）
    if (hasNewRow.value) focusNewRowInput();
  });
})
// 列筛选只改变渲染行，不改变 rows 长度，这里单独跟进底部渐隐条/纵向滚动的判定
watch(() => bodyRows.value.length, () => {
  nextTick(() => updateVScroll());
})
// 行集合（增删/筛选/排序）变化：总高度变了，窗口要重算，行高也要重测。
// 重算必须同步跑（不能塞进 $nextTick）：数据到位后的首帧就要用正确的窗口渲染，
// 否则会先按旧窗口 [0,0) 出一帧空表、下一帧才补行——这就是虚拟滚动的「加载延迟」观感。
// 量高要读 DOM，只能等渲染后（$nextTick）。
watch(bodyRows, () => {
  syncVirtualActive();
  recalcWindow();
  nextTick(() => {
    measureRows();
    // 数据整体替换（如刷新）后按当前容器宽度重钉列宽：
    // 纵向滚动条状态可能在这一帧才稳定，旧列宽会让表格短暂溢出、横向滚动条闪一下
    snapshotWidths();
  });
})
// 阈值/行数跨过开关点时，窗口模式会切换（整表 ↔ 窗口化），重新算一次并重新量高。
// 同理同步重算，避免切换模式的首帧按旧窗口渲染。
watch(virtualOn, () => {
  recalcWindow();
  nextTick(() => measureRows());
})
watch(() => ctx.editingCell.value, (newVal) => {
  if (newVal) {
    // 进入编辑态：清除单击高亮（原先由模板条件在重渲染时移除，现改为命令式移除）
    _clearActiveCell();
    nextTick(() => {
      const key = 'editInput-' + newVal.rowKey + '-' + newVal.field;
      const el = getCellInput(key);
      if (el) el.focus();
    });
    document.addEventListener('click', handleClickOutside);
  } else {
    document.removeEventListener('click', handleClickOutside);
  }
}, { immediate: true })
watch(() => ctx.rows.value, (newVal, oldVal) => {
  // 性能探针：rows 变化是「整表重渲染」的起点（筛选/排序/增删行都会换数组引用）。
  // 从 watch 触发量到「下一帧渲染完成」，得到本次整表渲染+补丁的真实耗时，
  // 供 perf/probe.js 与 INP 交互时间窗做归因。
  _perfMeasureRender();
  // 先构建行键集合再过滤，避免选中项多 + 行数大时的 O(n×m) 逐条 some
  const keys = new Set(newVal.map(r => r._rowKey));
  selectedRowKeys.value = selectedRowKeys.value.filter(key => keys.has(key));
  // 仅当「新增行被保存/取消」（由有 → 无）时才重算列宽并钉住；
  // 普通增删/移动行前后都没有新增行，列宽不会因新增输入而变，无需测量
  const prevHadNew = (oldVal || []).some(r => r._isNew);
  const nowHasNew = newVal.some(r => r._isNew);
  // 新增行出现（无 → 有）：在 DOM 插入新行前（watch 默认 flush:'pre'）量出并冻结旧列宽，
  // 让新增行的空输入不会撑动表头宽度，避免表头跳动。
  if (!prevHadNew && nowHasNew) {
    _freezeHeaderWidths();
  } else if (prevHadNew && !nowHasNew && !ctx.editingCell.value) {
    // 新增行消失（保存/取消）：先保持冻结列宽不动（不立即解锁），
    // 待 280ms 后快照统一清除 min-width 并重算钉住，避免取消瞬间列宽回弹。
    nextTick(() => {
      clearTimeout(ctx._snapshotTimer);
      ctx._snapshotTimer = setTimeout(() => snapshotWidths(), 280);
    });
  }
}, { immediate: true })
watch(() => ctx.fields.value, (newFields) => {
  // 列被删/改名后，残留的筛选状态会让整表永久空表 → 只保留仍然存在的列
  const names = new Set((newFields || []).map(f => f.name));
  Object.keys(columnFilters.value).forEach(n => {
    if (!names.has(n)) delete columnFilters.value[n];
  });
  if (filterField.value && !names.has(filterField.value)) closeFilter();
  // 增删/改名/移动列后重算列宽
  nextTick(() => snapshotWidths());
}, { immediate: true })
watch(selectedRowKeys, () => {
  emit('selectionChange', {
    count: selectedRowKeys.value.length,
    keys: [...selectedRowKeys.value]
  });
}, { immediate: true })

// created 等价：非响应式运行时状态 + 首帧之前先估一次虚拟窗口
// 收据数量缓存：WeakMap 键为行对象，避免每次渲染逐行 JSON.parse（不参与响应式）
ctx._receiptCache = new WeakMap();
// 虚拟滚动用的滚动位置/视口高度/ResizeObserver：纯运行时值，不进响应式
ctx._scrollTop = 0;
ctx._viewportH = 0;
ctx._ro = null;
// 估算行高是否已锁定（只取第一次实测均值，之后不再漂移，见 measureRows）
ctx._estLocked = false;
// 首帧之前就先按容器固定高度估一次窗口——否则第一帧会把全部行都画出来，
// 正好抵消掉虚拟滚动想省的那次整表渲染（挂载后再收缩窗口已经晚了）。
ctx._viewportH = fixedMaxHeight.value;
syncVirtualActive();
recalcWindow();

onMounted(() => {
  focusNewRowInput();
  updateVScroll();
  initVirtual();
  // 首屏：数据区整体从左往右弹入
  playTableEnter();
  // 整表 Enter 保存新增行：焦点不在输入框时按回车也触发保存
  document.addEventListener('keydown', handleGlobalEnter);
  // 筛选面板：点面板外部 / 按 Esc / 容器滚动时收起
  document.addEventListener('click', onFilterDocClick);
  document.addEventListener('keydown', handleFilterKeydown);
  window.addEventListener('scroll', onFilterScroll, true);
  // 列交换 FLIP 动画延迟就绪：等本页首次 table 滑入播完（350ms）、表头稳定后再启用，
  // 否则挂载时 TransitionGroup 会对静态表头播放 move，造成进入页面时表头乱跳。
  ctx._colAnimTimer = setTimeout(() => { colAnimDone.value = true; }, 400);
})
// KeepAlive：从其它状态栏/页签切换回来时重播数据区整体弹入动效
// （取消新增行后「添加一行」重现的上浮动效由 hasNewRow 驱动，不在此处触发，
//   否则它会和 tbody 整体滑入叠加造成闪动）
onActivated(() => {
  if (firstActivate.value) { firstActivate.value = false; return; }
  playTableEnter();
  // 从其它页签切回时也会重载数据/重建表头，同样延迟启用列 FLIP，避免表头乱跳
  colAnimDone.value = false;
  if (ctx._colAnimTimer) clearTimeout(ctx._colAnimTimer);
  ctx._colAnimTimer = setTimeout(() => { colAnimDone.value = true; }, 400);
  // 缓存的 DOM 尺寸可能已随页签切换变化，重新量一次窗口
  nextTick(() => { initVirtual(); });
})
onBeforeUnmount(() => {
  if (ctx._ro) { ctx._ro.disconnect(); ctx._ro = null; }
  // 空态延迟定时器：卸载后还在跑会往已销毁的实例上写状态
  if (ctx._emptyTimer) { clearTimeout(ctx._emptyTimer); ctx._emptyTimer = null; }
  // 行动画窗定时器同理
  if (ctx._rowsAnimTimer) { clearTimeout(ctx._rowsAnimTimer); ctx._rowsAnimTimer = null; }
  // 取消新增行的 140ms 兜底定时器：卸载后触发会往已销毁的实例上 emit
  if (ctx._cancelRowTimer) { clearTimeout(ctx._cancelRowTimer); ctx._cancelRowTimer = null; }
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleGlobalEnter);
  document.removeEventListener('click', onFilterDocClick);
  document.removeEventListener('keydown', handleFilterKeydown);
  window.removeEventListener('scroll', onFilterScroll, true);
  // 拖拽中途被卸载：停掉自动滚动并清掉让位位移，避免残留定时器/内联样式
  if (ctx._rowAutoScroll) { ctx._rowAutoScroll.stop(); ctx._rowAutoScroll = null; }
  if (ctx._colAutoScroll) { ctx._colAutoScroll.stop(); ctx._colAutoScroll = null; }
  ctx._clearRowShiftFx();
  ctx._clearColShiftFx();
  if (ctx._dragGhost) ctx._dragGhost.remove();
  if (ctx._rowGhost) ctx._rowGhost.remove();
  if (ctx._rowSlotGhost) ctx._rowSlotGhost.remove();
  if (ctx._rowMove) window.removeEventListener('mousemove', ctx._rowMove);
  if (ctx._rowUp) window.removeEventListener('mouseup', ctx._rowUp);
  if (ctx._rowRaf) cancelAnimationFrame(ctx._rowRaf);
  if (ctx._colGhost) ctx._colGhost.remove();
  if (ctx._colSlotGhost) ctx._colSlotGhost.remove();
  if (ctx._colMove) window.removeEventListener('mousemove', ctx._colMove);
  if (ctx._colUp) window.removeEventListener('mouseup', ctx._colUp);
  if (ctx._colRaf) cancelAnimationFrame(ctx._colRaf);
  if (ctx._rowDropBox) ctx._rowDropBox.remove();
  if (ctx._colDropBox) ctx._colDropBox.remove();
  clearTimeout(ctx._snapshotTimer);
  clearTimeout(ctx._filterAnimTimer);
  if (ctx._colAnimTimer) clearTimeout(ctx._colAnimTimer);
  if (ctx._snapshotRaf) cancelAnimationFrame(ctx._snapshotRaf);
  if (ctx._tableEnterCleanup) ctx._tableEnterCleanup();
})

// 对外暴露：父组件删行/恢复时触发行出入动画；导出截图/行定位取根节点 DOM。
// 用 getter 暴露 rootEl —— exposed 对象不带 proxyRefs，直接暴露 ref 父侧拿到的是 Ref 而非元素。
defineExpose({
  beginRowsAnimWindow,
  get rootEl() { return rootEl.value },
})

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
  border-radius: var(--radius-xs);
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
/* 判定中的静默占位：与空态同高、完全透明。
   唯一目的就是「还不知道有没有数据的这 260ms 里别画表头」，
   避免表头先出现、确认没数据后又被空态替换的那种闪跳。 */
.dt-empty-pending {
  width: 100%;
  height: 100%;
  min-height: 240px;
  background: transparent;
}
.dt-filter-empty td {
  padding: 18px 8px;
  border: 1px solid var(--color-border, #e5e7eb);
  text-align: center;
  color: var(--color-text-muted, #9ca3af);
  font-size: 13px;
}
/* ===== 空态：直接浮在外层毛玻璃上 =====
   空态块自己**不画背景、也不再叠 backdrop-filter**：外层卡片已经是毛玻璃，
   这里再加一层模糊等于在玻璃上又盖一层遮罩，观感会变浊。
   height:100% 是因为外层滚动容器已经是固定高度；min-height 只兜 fitContent 的场景。 */
.dt-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  height: 100%;
  min-height: 240px;
  padding: 24px 20px;
  box-sizing: border-box;
  text-align: center;
  background: transparent;
  animation: dt-empty-in 0.3s ease both;
}
/* 空表时容器不再铺 surface 白底：表格的底色只在「有表格」时才有意义，
   空态要的是让页面的光斑透上来。
   同时撤掉 scrollbar-gutter: stable —— 那条是为「有数据时滚动条忽隐忽现导致列宽抖动」
   而恒定预留的，空表根本没有可滚内容，留着就是右侧一条莫名其妙的空白竖带
   （用户截图里看到的就是它）。overflow 一起关掉：空态块高度就是容器高度，不需要滚动。 */
.table-scroll-wrapper.dt-scroll-empty {
  background-color: transparent;
  scrollbar-gutter: auto;
  overflow: hidden;
}
@keyframes dt-empty-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
.dt-empty-icon {
  width: 48px;
  height: 48px;
  color: var(--color-text-muted, #94a3b8);
  opacity: 0.9;
}
.dt-empty-text {
  margin: 0;
  font-size: 16px;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #94a3b8);
}
/* 加载失败态：复用空态的版式，只换图标颜色和文字深浅 ——
   让用户一眼看出「还是这块区域，只是结论不同」 */
.dt-error .dt-empty-icon { color: var(--color-danger, #ef4444); }
.dt-error .dt-empty-text { color: var(--color-text-secondary, #64748b); }
/* 空态按钮：淡蓝底 + 深蓝字（#D9E5F8 太浅，配白字只有 1.3:1，读不出来）。
   这组色值在 GridView 的 .grid-empty-btn 里有一份完全相同的副本，改颜色要两边一起改。 */
.dt-empty-btn {
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
.dt-empty-btn:active {
  transform: scale(0.98);
}
.dt-empty-btn:focus-visible {
  outline: 2px solid rgba(30, 58, 107, 0.55);
  outline-offset: 2px;
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
/* 底部渐隐雾面条：可滚动（行数超过 maxRows）时淡入，随行增删非线性（过冲回弹）淡入淡出 */
/* 表格容器统一表面底色：玻璃/win11 主题下 --color-surface 为半透明，
   若不加底色，下方空数据区与有数据的操作列（同样取 surface 半透明遮罩）遮罩程度不一致，观感不和谐 */
.table-scroll-wrapper {
  position: relative;
  background-color: var(--color-surface, #ffffff);
  /* 这里**不再**恒定写 scrollbar-gutter: stable。
     那个写法的本意是「数据刷新时滚动条瞬时出现/消失 → 内容宽度变化 → 已钉住的列宽短暂溢出 →
     横向滚动条闪一下」，但它把代价转嫁给了所有行数不多的表：只要滚动条不会出现，
     预留的槽位就是右边一条永远填不满的空带（只有一条数据的表也带着）。
     现在改成按需：只在 is-scrollable（内容真的超出 fixedMaxHeight）时才预留 —— 见下一条。 */
}
/* 内容真的超高时才预留槽位：此时纵向滚动条会长期存在，预留能避免上述列宽抖动；
   不超高时完全不占位，右侧不会再有一条空带。 */
.table-scroll-wrapper.is-scrollable {
  scrollbar-gutter: stable;
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
/* 序号列内容：必须是非行内元素才能做 transform —— 行让位时它反向位移，
   留在原来的格子上，避免拖动中序号看起来整体错一行 */
.dt-index-fix { display: inline-block; }
/* 列拖拽的源列：整列直接留空（visibility 保留占位宽度），
   不留下半透明副本，避免原位置看起来还有一层影子 */
.dt-col-src-hidden { visibility: hidden; }
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
/* 整表数据区(tbody)首次进入：从左往右弹入，不含表头。
   注意这里保持横向：单行增删（.row-flip-*）已改成纵向浮入/下沉，两者刻意不同 ——
   整表是「一次性出现」，横向扫入更能表达「整块内容就位」；单行是「一行进出」，纵向更自然。 */
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
/* 默认场景（删掉一行 / 撤销恢复一行 / 新增行保存）：
   直接复用底部「＋ 点击添加一行 / 取消添加一行」那组曲线 ——
   进场从下方 16px 弹性浮上来，离场向下 10px 淡出。表格行和那条添加栏用同一套动作语言，
   删除和恢复不再是「瞬间消失/瞬间出现」。
   搜索/筛选场景由下面的 .row-search 覆盖成垂直级联方向，互不干扰。 */
.row-flip-enter-active { transition: opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.row-flip-leave-active { position: absolute; width: 100%; transition: opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1), transform 0.18s cubic-bezier(0.22, 1, 0.36, 1); }
.row-flip-enter-from { opacity: 0; transform: translateY(16px); }
.row-flip-leave-to { opacity: 0; transform: translateY(10px); }
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