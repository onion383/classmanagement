// =========================================================================
// DynamicTable.drag.js —— DynamicTable 的行/列拖拽、落点高亮框与交换 FLIP 动画
//
// 逐字搬运自 DynamicTable.vue 的 methods，未改写任何逻辑与注释；
// 方法体经 ctx 闭包调用（script setup）。
// =========================================================================

import { applyRowShift, applyColShift, clearShift, createEdgeAutoScroll } from '../../../composables/tableDragFx';
import { nextTick } from 'vue'

// 表头/行内「数据列」的起始下标：有勾选框列时是 1，no-select 时勾选框整列不渲染，必须从 0 开始。
// 若一律按 1 算，no-select 的表（今日到班两张表）列拖拽的落点框与虚影会整体错开一列。
const thOffsetOf = (vm) => (!vm.readonly && !vm.noSelect ? 1 : 0);

// ctx 契约：状态/computed/props ref 用 .value 访问，组件根节点取 ctx.rootEl.value（模板 ref），
// _ 开头临时字段（拖拽几何/ghost/RAF 句柄）为 ctx 普通字段，跨模块方法经 ctx 运行时解析。
export function useDynamicTableDrag(ctx) {
  return {

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
      // 只取真实数据行：虚拟滚动的上下垫片行不参与几何计算，否则下标会整体错位
      const trs = ctx.rootEl.value ? ctx.rootEl.value.querySelectorAll('tbody tr.data-drag-item') : [];
      const arr = [];
      for (let i = 0; i < trs.length; i++) {
        const r = trs[i].getBoundingClientRect();
        arr.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
      ctx._rowGeom = arr;
      ctx._rowGeomContainer = ctx.rootEl.value ? ctx.rootEl.value.getBoundingClientRect() : null;
    },
    // 列拖拽几何缓存：按下时一次性量出各数据列的左右边界、表头行 top、表底 bottom 与容器 rect，
    // 拖动过程中纯数值比较，避免每帧 O(n) getBoundingClientRect 触发布局（INP 优化）
    _cacheColGeom() {
      const ths = ctx.rootEl.value ? ctx.rootEl.value.querySelectorAll('thead th') : [];
      const hasOp = !!ctx.rootEl.value && !!ctx.rootEl.value.querySelector('th.col-op');
      const off = thOffsetOf(this);
      const arr = [];
      for (let i = off; i < ths.length; i++) {
        const colIndex = i - off;
        if (i === ths.length - 1 && hasOp) { arr[colIndex] = null; continue; } // 跳过操作列
        const r = ths[i].getBoundingClientRect();
        arr[colIndex] = { left: r.left, right: r.right };
      }
      ctx._colGeom = arr;
      ctx._colGeomHeaderTop = ths.length ? ths[0].parentElement.getBoundingClientRect().top : null;
      const tbl = ctx.rootEl.value ? ctx.rootEl.value.querySelector('table') : null;
      ctx._colGeomTblBottom = tbl ? tbl.getBoundingClientRect().bottom : null;
      ctx._colGeomContainer = ctx.rootEl.value ? ctx.rootEl.value.getBoundingClientRect() : null;
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
      const box = ctx._rowDropBox;
      if (!box) return;
      const hide = () => {
        box.style.display = 'none';
        if (ctx._rowSlotGhost) ctx._rowSlotGhost.style.display = 'none';
        ctx._rowDropSig = null;
      };
      const geom = ctx._rowGeom;
      const g = (geom && ctx.dragOverIndex.value !== null) ? geom[ctx.dragOverIndex.value] : null;
      if (!g) { hide(); return; }
      let { left, top, right, bottom } = g;
      const c = ctx._rowGeomContainer;
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
      if (ctx._rowDropSig === sig) return;
      ctx._rowDropSig = sig;
      // 落点虚影延迟到「确实要显示」时才克隆
      if (!ctx._rowSlotGhost && ctx._rowGhost) {
        ctx._rowSlotGhost = ctx._cloneGhostForSlot(ctx._rowGhost, 0.22);
      }
      const ghost = ctx._rowSlotGhost;
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
      const box = ctx._colDropBox;
      if (!box) return;
      const hide = () => {
        box.style.display = 'none';
        if (ctx._colSlotGhost) ctx._colSlotGhost.style.display = 'none';
        ctx._colDropSig = null;
      };
      const geom = ctx._colGeom;
      const g = (geom && ctx.colDragOverIndex.value !== null) ? geom[ctx.colDragOverIndex.value] : null;
      if (!g || ctx._colGeomHeaderTop == null) { hide(); return; }
      // 还停在源列上（尚未发生让位）时不显示落点框与落点虚影：
      // 否则源列被隐藏后，原位置反而会留下一层「影子」，正是要避免的观感。
      // 蓝框与影子只在拖到别的列、真正腾出空位后才出现。
      if (ctx.colDragIndex.value !== null && ctx.colDragOverIndex.value === ctx.colDragIndex.value) { hide(); return; }
      // 用按下时缓存的几何，拖动过程中不再读取布局。
      // 空位大小要按「让位后真正空出来的宽度」算，不能直接套目标列的原宽度：
      //  · 向右拖：from..to 的列整体左移到前一列的左边界，空位贴在目标列原区域右端，
      //    宽度 = 目标列前一列的宽度（列宽不等时，它与目标列宽度并不相同）。
      //  · 向左拖：to..from-1 的列整体右移到后一列的左边界，空位就是目标列原区域。
      // 列宽相等时，两者都与「目标列原矩形」完全一致，表现不变。
      const from = ctx.colDragIndex.value;
      const to = ctx.colDragOverIndex.value;
      let left, right;
      if (from !== null && to > from) {
        const prev = geom[to - 1];
        const slotW = prev ? prev.right - prev.left : g.right - g.left;
        left = g.right - slotW;
        right = g.right;
      } else {
        left = g.left;
        right = g.right;
      }
      let top = ctx._colGeomHeaderTop;
      let bottom = ctx._colGeomTblBottom;
      const c = ctx._colGeomContainer;
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
      if (ctx._colDropSig === sig) return;
      ctx._colDropSig = sig;
      // 落点虚影延迟创建
      if (!ctx._colSlotGhost && ctx._colGhost) {
        ctx._colSlotGhost = ctx._cloneGhostForSlot(ctx._colGhost, 0.22);
      }
      const ghost = ctx._colSlotGhost;
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
      if (ctx.noRowDrag.value || ctx.readonly.value) return;
      // index 是「渲染顺序」下标（列筛选后与 rows 下标不一致），回查行对象须走 rowAt
      const row = ctx.rowAt(index);
      if (!row || row._isNew || row._isSeparator) return;
      if (ctx.selectedRowKeys.value.length > 1 && !ctx.selectedKeySet.value.has(row._rowKey)) return;
      const trEl = (event.currentTarget instanceof Element && event.currentTarget.closest('tr')) || null;
      event.preventDefault();
      // 拖行期间锁死虚拟滚动窗口：行在拖动中途被换掉会让 _rowGeom/_rowEls 的下标全部错位
      ctx.virtualFrozen.value = true;
      ctx.dragIndex.value = index;
      ctx.dragOverIndex.value = index;
      ctx._suppressCellClick = true; // 压制从手柄冒出的 click
      // 自绘 fixed 虚影（不用原生拖拽图，避免被浏览器居中/卡住）
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;left:0;top:0;z-index:99998;pointer-events:none;opacity:0.85;border-radius:4px;will-change:transform;contain:layout paint;box-shadow:0 6px 18px rgba(0,0,0,0.18);';
      let grabX = 16, grabY = 12;
      if (ctx.selectedRowKeys.value.length > 1) {
        // 多选：整批胶囊
        const selectedRows = ctx.rows.value.filter(r => ctx.selectedRowKeys.value.includes(r._rowKey) && !r._isNew && !r._isSeparator);
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
      ctx._rowGhost = wrapper;
      // 落点虚影在 updateRowDropBox 里延迟创建
      ctx._rowGrab = { grabX, grabY };
      // 跟手的虚影：自由跟随指针（不吸附、不锁位置）
      wrapper.style.transform = `translate(${event.clientX - grabX}px, ${event.clientY - grabY}px)`;
      // 落点高亮框：包住即将落位的那一行（几何信息在此一次性缓存）
      ctx._cacheRowGeom();
      // 让位与自动滚动的初始状态：行元素列表 + 「空槽」高度（取被拖行自身高度）
      // 与 _cacheRowGeom 同一口径：垫片行不算行元素
      ctx._rowEls = Array.from(ctx.rootEl.value.querySelectorAll('tbody tr.data-drag-item'));
      const g0 = ctx._rowGeom ? ctx._rowGeom[index] : null;
      ctx._rowSlotH = g0 ? Math.round(g0.bottom - g0.top) : 0;
      // 虚拟滚动：拖行期间窗口锁死（见 DynamicTable.recalcWindow），滚出去只会看到垫片空白，
      // 故这一轮不启用边缘自动滚动——拖放范围就是当前可见窗口。
      ctx._rowAutoScroll = ctx.virtualOn.value ? null : createEdgeAutoScroll(
        () => ctx.rootEl.value,
        (mx, my) => ctx._onRowScrolled(mx, my)
      );
      ctx._rowDropBox = ctx.createDropBox();
      ctx.updateRowDropBox();

      const move = (e) => {
        if (!ctx._rowGhost) return;
        // rAF 对齐到帧：同一帧内多次 mousemove 只处理最后一次
        ctx._rowPending = e;
        if (ctx._rowRaf) return;
        ctx._rowRaf = requestAnimationFrame(() => {
          ctx._rowRaf = null;
          ctx._applyRowMove();
        });
      };
      const up = () => ctx.finishRowDrag();
      ctx._rowMove = move;
      ctx._rowUp = up;
      // passive：这两个监听不阻止默认行为，声明后不阻塞滚动/合成的路径
      window.addEventListener('mousemove', move, { passive: true });
      window.addEventListener('mouseup', up, { passive: true });
    },
    resolveRowIndexAt(clientY) {
      // 优先用拖拽开始时缓存的几何信息（无布局读取）
      const geom = ctx._rowGeom;
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
      const trs = ctx.rootEl.value ? ctx.rootEl.value.querySelectorAll('tbody tr.data-drag-item') : [];
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
      if (!ctx._rowGhost || !ctx._rowPending) return;
      const ev = ctx._rowPending;
      // 跟手虚影自由跟随指针
      const g = ctx._rowGrab || { grabX: 0, grabY: 0 };
      ctx._rowGhost.style.transform = `translate(${ev.clientX - g.grabX}px, ${ev.clientY - g.grabY}px)`;
      const idx = ctx.resolveRowIndexAt(ev.clientY);
      // 只有目标行变了才重算让位与落点（每帧无条件全量遍历是拖拽卡顿的主因）
      if (idx !== ctx.dragOverIndex.value) {
        ctx.dragOverIndex.value = idx;
        ctx._syncRowShift();
        ctx.updateRowDropBox();
      }
      // 边缘自动滚动（上下左右）：滚起来后由 _onRowScrolled 同步几何缓存，保持跟手
      if (ctx._rowAutoScroll) ctx._rowAutoScroll.update(ev.clientX, ev.clientY);
    },
    // 行让位（移动语义）：按几何逐行补偿，行高不等也不会错位
    // 序号列（#）内容反向位移：序号留在原来的格子里，只有行内容在滑动，
    // 否则让位时序号跟着行走，看上去像整体错了一行。
    _syncRowShift() {
      applyRowShift(
        ctx._rowEls, ctx.dragIndex.value, ctx.dragOverIndex.value, ctx._rowGeom, ctx._rowSlotH,
        (el) => el.querySelector('td[data-col="position"] > span.dt-index-fix')
      );
    },
    // 清让位位移（拖拽结束/取消）：transform 与 transition 一起清掉，避免出现回弹动画
    _clearRowShiftFx() {
      const tbody = ctx.tbodyRef.value;
      if (tbody) clearShift(tbody);
      ctx._rowEls = null;
      ctx._rowSlotH = 0;
    },
    // 容器滚动后：把缓存的几何一起平移，保证命中判定与落点高亮框继续跟手
    _onRowScrolled(mx, my) {
      const geom = ctx._rowGeom;
      if (geom) {
        for (const r of geom) {
          if (!r) continue;
          r.left -= mx; r.right -= mx; r.top -= my; r.bottom -= my;
        }
      }
      ctx.updateRowDropBox();
    },
    finishRowDrag() {
      // 解冻虚拟滚动窗口：松手后按当前滚动位置重新算可见窗口（拖行期间它是锁死的）
      if (ctx.virtualFrozen.value) {
        ctx.virtualFrozen.value = false;
        nextTick(() => ctx.recalcWindow());
      }
      if (ctx._rowMove) window.removeEventListener('mousemove', ctx._rowMove);
      if (ctx._rowUp) window.removeEventListener('mouseup', ctx._rowUp);
      ctx._rowMove = null;
      ctx._rowUp = null;
      if (ctx._rowRaf) { cancelAnimationFrame(ctx._rowRaf); ctx._rowRaf = null; }
      ctx._applyRowMove(); // 冲刷最后一帧
      // 松手位置：落位动画的起点（清 pending 之前取）
      const relRow = ctx._rowPending ? { x: ctx._rowPending.clientX, y: ctx._rowPending.clientY } : null;
      ctx._rowPending = null;
      ctx._rowGeom = null;
      ctx._rowGeomContainer = null;
      if (ctx._rowAutoScroll) { ctx._rowAutoScroll.stop(); ctx._rowAutoScroll = null; }
      if (ctx._rowGhost) { ctx._rowGhost.remove(); ctx._rowGhost = null; }
      if (ctx._rowSlotGhost) { ctx._rowSlotGhost.remove(); ctx._rowSlotGhost = null; }
      if (ctx._rowDropBox) { ctx._rowDropBox.remove(); ctx._rowDropBox = null; }
      const from = ctx.dragIndex.value;
      const to = ctx.dragOverIndex.value;
      ctx.dragIndex.value = null;
      ctx.dragOverIndex.value = null;
      if (from === null || to === null || from === to) { ctx._clearRowShiftFx(); return; }
      const movedRow = ctx.rowAt(from);
      if (!movedRow) { ctx._clearRowShiftFx(); return; }
      // 让位交给拖动期完成；松手只做一段「从松手位置落位」的收尾动画
      ctx._clearRowShiftFx();
      // 对外抛的是 rows 原始下标（列筛选下 from/to 是渲染顺序，须换算），
      // 否则父组件会挪错行；落位动画仍用渲染下标 to（DOM 顺序）
      const srcFrom = ctx.srcIndex(from);
      const srcTo = ctx.srcIndex(to);
      if (ctx.selectedRowKeys.value.length > 1 && ctx.selectedRowKeys.value.includes(movedRow._rowKey)) {
        const selectedKeys = ctx.selectedRowKeys.value.filter(key => ctx.rows.value.some(r => r._rowKey === key && !r._isSeparator));
        ctx.emit('moveSelectedRows', { selectedKeys, oldIndex: srcFrom, newIndex: srcTo, isDownward: srcTo > srcFrom });
      } else {
        ctx.emit('swapRows', srcFrom, srcTo);
      }
      if (relRow) nextTick(() => ctx._slideInRow(to, relRow));
    },
    // 落位动画：被移动的这一行从「松手位置」滑进落点（X/Y 双向）
    _slideInRow(to, rel) {
      if (!rel) return;
      const tbody = ctx.tbodyRef.value;
      if (!tbody) return;
      // 只取真实数据行：虚拟滚动的垫片行会占掉下标位置
      const tr = tbody.querySelectorAll('tr.data-drag-item')[to];
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
      const tbody = ctx.tbodyRef.value;
      if (!tbody) { ctx._flipRows = null; return; }
      ctx._flipRows = Array.from(tbody.querySelectorAll('tr[data-row-id]')).map((el) => ({
        el,
        top: el.getBoundingClientRect().top,
      }));
    },
    // 换位后播放 FLIP：移动过的行从旧位置滑到新位置；未移动的行（dy≈0）跳过
    _playRowCellFlip() {
      const list = ctx._flipRows;
      ctx._flipRows = null;
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
      if (ctx.readonly.value || ctx.editingCell.value) return;
      event.preventDefault();
      ctx.colDragIndex.value = colIndex;
      ctx.colDragOverIndex.value = colIndex;
      // 拖动期间不启用表头 FLIP：落位动画统一由松手后的「滑入」负责，
      // 否则表头会再播一次交换动画（观感像弹两下）。
      ctx.colAnimDone.value = false;
      // 不再生成整列虚影：源列本身已淡化（opacity-30）+ 蓝色落点框，再加浮层会显得重复。
      ctx._colActive = true;
      ctx._colGhost = null;
      ctx._colGrab = null;
      // 落点高亮框：包住即将落位的那一列（几何信息在此一次性缓存）
      ctx._cacheColGeom();
      // 落点虚影：被拖列的半透明副本，固定贴在落点上（不跟随鼠标）
      {
        const tbl = ctx.rootEl.value.querySelector('table');
        const thsH = tbl ? tbl.querySelectorAll('thead th') : [];
        const thOff = thOffsetOf(this);
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
          gTh.classList.remove('opacity-30', 'dt-col-src-hidden');
          gTh.style.transition = 'none';
          gTh.style.width = colWidth + 'px';
          gTh.style.overflow = 'hidden';
          gThRow.appendChild(gTh);
          gThead.appendChild(gThRow);
          ghostTable.appendChild(gThead);
          const gTbody = document.createElement('tbody');
          if (tbl) {
            // 只克隆滚动容器可视范围内的行：视口外的行本来就会被裁掉，
            // 克隆它们只会多出节点与样式/布局计算（虚拟滚动的窗口还带两屏 overscan）。
            const wrapRect = ctx.scrollWrapper.value ? ctx.scrollWrapper.value.getBoundingClientRect() : null;
            const bandTop = wrapRect ? wrapRect.top : -Infinity;
            const bandBottom = wrapRect ? wrapRect.bottom : Infinity;
            const headerBottom = srcTh.parentElement.getBoundingClientRect().bottom;
            let firstTop = null;
            tbl.querySelectorAll('tbody tr').forEach(tr => {
              const td = tr.children[colIndex + thOff];
              if (!td) return;
              const r = tr.getBoundingClientRect();
              if (r.bottom <= bandTop || r.top >= bandBottom) return;
              if (firstTop == null) firstTop = r.top;
              const gTr = document.createElement('tr');
              gTr.style.height = r.height + 'px';
              const gTd = td.cloneNode(true);
              gTd.style.transition = 'none';
              gTd.style.width = colWidth + 'px';
              gTd.style.overflow = 'hidden';
              gTr.appendChild(gTd);
              gTbody.appendChild(gTr);
            });
            // 视口上方被裁掉的行用一条等高占位行补齐，保证留下的行与原件位置一致
            const spacer = firstTop != null ? firstTop - headerBottom : 0;
            if (spacer > 0.5) {
              const spTr = document.createElement('tr');
              const spTd = document.createElement('td');
              spTd.style.height = spacer + 'px';
              spTr.appendChild(spTd);
              gTbody.insertBefore(spTr, gTbody.firstChild);
            }
          }
          ghostTable.appendChild(gTbody);
          const wrap = document.createElement('div');
          wrap.style.cssText = 'position:fixed;left:0;top:0;z-index:99998;pointer-events:none;opacity:0.85;overflow:hidden;will-change:transform;contain:layout paint;box-shadow:0 6px 18px rgba(0,0,0,0.18);';
          wrap.appendChild(ghostTable);
          document.body.appendChild(wrap);
          ctx._colGhost = wrap;
          // 落点虚影在 updateColDropBox 里延迟创建
          // 跟手虚影：按抓取点跟随指针（自由移动，不吸附格子）
          const thRect0 = srcTh.getBoundingClientRect();
          ctx._colGrab = { grabX: event.clientX - thRect0.left, grabY: event.clientY - thRect0.top };
          wrap.style.transform = `translate(${event.clientX - ctx._colGrab.grabX}px, ${event.clientY - ctx._colGrab.grabY}px)`;
        }
      }
      // 让位：每列 = 表头 th + 各行该列 td（按 data-col 分组，顺序与 fields 一致）
      const ths0 = ctx.rootEl.value.querySelectorAll('thead th');
      const thOff = thOffsetOf(this);
      const colEls = [];
      const tbody0 = ctx.tbodyRef.value;
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
      ctx._colEls = colEls;
      const gc0 = ctx._colGeom ? ctx._colGeom[colIndex] : null;
      ctx._colSlotW = gc0 ? Math.round(gc0.right - gc0.left) : 0;
      ctx._colAutoScroll = createEdgeAutoScroll(
        () => ctx.rootEl.value,
        (mx, my) => ctx._onColScrolled(mx, my)
      );
      ctx._colDropBox = ctx.createDropBox();
      ctx.updateColDropBox();

      const move = (e) => {
        if (!ctx._colActive) return;
        // rAF 对齐到帧：同一帧内多次 mousemove 只处理最后一次
        ctx._colPending = e;
        if (ctx._colRaf) return;
        ctx._colRaf = requestAnimationFrame(() => {
          ctx._colRaf = null;
          ctx._applyColMove();
        });
      };
      const up = () => ctx.finishColDrag();
      ctx._colMove = move;
      ctx._colUp = up;
      // passive：这两个监听不阻止默认行为，声明后不阻塞滚动/合成的路径
      window.addEventListener('mousemove', move, { passive: true });
      window.addEventListener('mouseup', up, { passive: true });
    },
    // 应用最近一次待处理的列拖拽位置（rAF 帧内执行；松手前也会强制冲刷一次）
    _applyColMove() {
      if (!ctx._colActive || !ctx._colPending) return;
      const ev = ctx._colPending;
      // 跟手虚影自由跟随指针
      const g = ctx._colGrab;
      if (g && ctx._colGhost) {
        ctx._colGhost.style.transform = `translate(${ev.clientX - g.grabX}px, ${ev.clientY - g.grabY}px)`;
      }
      const hov = ctx.resolveColIndexAt(ev.clientX);
      // 只有目标列变了才重算让位与落点
      if (hov !== null && hov !== ctx.colDragOverIndex.value) {
        ctx.colDragOverIndex.value = hov;
        ctx._syncColShift();
        ctx.updateColDropBox();
      }
      // 边缘自动滚动（上下左右）
      if (ctx._colAutoScroll) ctx._colAutoScroll.update(ev.clientX, ev.clientY);
    },
    // 列让位（移动语义）：按几何逐列补偿（列宽不等时也能精确让位）
    _syncColShift() {
      applyColShift(ctx._colEls, ctx.colDragIndex.value, ctx.colDragOverIndex.value, ctx._colGeom, ctx._colSlotW);
    },
    _clearColShiftFx() {
      clearShift(ctx.rootEl.value);
      ctx._colEls = null;
      ctx._colSlotW = 0;
    },
    // 容器滚动后同步列几何（左右按 mx、表头/表底按 my），保证命中与落点框跟手
    _onColScrolled(mx, my) {
      const geom = ctx._colGeom;
      if (geom) {
        for (const r of geom) {
          if (!r) continue;
          r.left -= mx; r.right -= mx;
        }
      }
      if (ctx._colGeomHeaderTop != null) ctx._colGeomHeaderTop -= my;
      if (ctx._colGeomTblBottom != null) ctx._colGeomTblBottom -= my;
      ctx.updateColDropBox();
    },
    resolveColIndexAt(clientX) {
      // 优先用拖拽开始时缓存的几何信息（无布局读取）
      const geom = ctx._colGeom;
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
      const ths = ctx.rootEl.value ? ctx.rootEl.value.querySelectorAll('thead th') : [];
      const hasOp = !!ctx.rootEl.value && !!ctx.rootEl.value.querySelector('th.col-op');
      let best = null;
      let minDist = Infinity;
      const off = thOffsetOf(this);
      for (let i = off; i < ths.length; i++) {
        if (i === ths.length - 1 && hasOp) continue; // 跳过操作列
        const r = ths[i].getBoundingClientRect();
        if (clientX >= r.left - 2 && clientX <= r.right + 2) return i - off; // 直接命中该列
        const center = (r.left + r.right) / 2;
        const d = Math.abs(clientX - center);
        if (d < minDist) { minDist = d; best = i - off; }
      }
      return best; // 落在间隙，取最近邻列
    },
    finishColDrag() {
      if (ctx._colMove) window.removeEventListener('mousemove', ctx._colMove);
      if (ctx._colUp) window.removeEventListener('mouseup', ctx._colUp);
      ctx._colMove = null;
      ctx._colUp = null;
      if (ctx._colRaf) { cancelAnimationFrame(ctx._colRaf); ctx._colRaf = null; }
      ctx._applyColMove(); // 冲刷最后一帧
      // 松手位置：落位动画的起点
      const relCol = ctx._colPending ? { x: ctx._colPending.clientX, y: ctx._colPending.clientY } : null;
      ctx._colPending = null;
      const from = ctx.colDragIndex.value;
      const to = ctx.colDragOverIndex.value;
      ctx._colGeom = null;
      ctx._colGeomContainer = null;
      ctx._colGrab = null;
      ctx._colActive = false;
      if (ctx._colAutoScroll) { ctx._colAutoScroll.stop(); ctx._colAutoScroll = null; }
      if (ctx._colDropBox) { ctx._colDropBox.remove(); ctx._colDropBox = null; }
      if (ctx._colGhost) { ctx._colGhost.remove(); ctx._colGhost = null; }
      if (ctx._colSlotGhost) { ctx._colSlotGhost.remove(); ctx._colSlotGhost = null; }
      ctx._clearColShiftFx();
      if (from !== null && to !== null && from !== to && to >= 0) {
        ctx.emit('swapColumns', from, to);
        // colAnimDone 必须在「重排渲染之后」才恢复，否则表头会再播一遍交换动画。
        nextTick(() => {
          if (relCol) ctx._slideInCol(to, relCol);
          ctx.colAnimDone.value = true;
        });
      } else {
        nextTick(() => { ctx.colAnimDone.value = true; });
      }
      ctx.colDragIndex.value = null;
      ctx.colDragOverIndex.value = null;
    },
    // 落位动画：被移动的这一列从「松手位置」滑进落点（X/Y 双向；表头随列一起）
    _slideInCol(to, rel) {
      if (!rel) return;
      const ths = ctx.rootEl.value.querySelectorAll('thead th');
      const thOff = thOffsetOf(this);
      const th = ths[to + thOff];
      if (!th) return;
      const r = th.getBoundingClientRect();
      const dx = Math.round(rel.x - (r.left + r.width / 2));
      const dy = Math.round(rel.y - (r.top + r.height / 2));
      if (!dx && !dy) return;
      const els = [th];
      const tbody = ctx.tbodyRef.value;
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
      const tbody = ctx.tbodyRef.value;
      if (!tbody) { ctx._flipColCells = null; return; }
      ctx._flipColCells = Array.from(tbody.querySelectorAll('td[data-col]')).map((el) => ({
        el,
        left: el.getBoundingClientRect().left,
      }));
    },
    // 换位后播放 FLIP：每个移动过的单元格从旧位置滑到新位置；约束失败/未移动则跳过
    _playColCellFlip() {
      const list = ctx._flipColCells;
      ctx._flipColCells = null;
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
  };
}
