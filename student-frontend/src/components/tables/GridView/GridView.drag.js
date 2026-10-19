// =========================================================================
// GridView.drag.js —— GridView 的行/列拖拽、落点高亮框与虚影（方法模块）
//
// 逐字搬运自 GridView.vue 的 methods，未改写任何逻辑与注释；
// 方法体内部仍使用 this，主组件以 methods: { ...useGridViewDrag() } 展开注册。
// =========================================================================

import { applyRowShift, applyColShift, clearShift, createEdgeAutoScroll } from '../../../composables/tableDragFx';

export function useGridViewDrag() {
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
  };
}
