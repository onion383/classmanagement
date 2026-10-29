// ===== 课程表：一般课表（模板）加载/保存、行列与单元格交互、设置、双向导入 =====
// 纯代码搬运自 ScheduleView.vue 的 methods，未改写逻辑；经 ctx 闭包调用（script setup）。
import axios from 'axios'
import { recordGridCellUndo, recordGridSnapshotUndo } from '../../composables/useUndo.js'
import { createSerialSaver } from '../../utils/serialSaver.js'

export function useScheduleMaster(ctx, { API_BASE, DEFAULT_SECTIONS }) {
  return {
    // ============= 一般课表操作 =============
    async refreshMaster() {
      try {
        await ctx.loadMaster()
        if (ctx._masterLoadOk.value) ctx.notifySuccess('已刷新课程表模板')
      } catch (e) { /* 错误已在 loadMaster 内部处理 */ }
    },
    async loadMaster() {
      ctx._masterInFlight = (ctx._masterInFlight || 0) + 1;
      try {
        const res = await axios.get(`${API_BASE}/schedule/master`);
        const { cells, settings } = res.data;
        ctx.masterCells.value = Array.isArray(cells) ? cells : [];
        if (settings && (settings.sections || settings.periods)) {
          ctx.masterSettings.value = {
            sections: settings.sections || null,
            periods: settings.periods || [],
            days: settings.days || ctx.masterColHeaders.value
          };
          ctx.masterColHeaders.value = ctx.masterSettings.value.days;
        } else {
          ctx.masterSettings.value = {
            sections: JSON.parse(JSON.stringify(DEFAULT_SECTIONS)),
            periods: [],
            days: ctx.masterColHeaders.value
          };
          ctx.masterColHeaders.value = ctx.masterSettings.value.days;
          // 口径同 loadActive：失败要说出来，否则每次进页面都像首跑
          if (!await ctx.saveMaster()) {
            ctx.notifyError('默认课表设置保存失败，本次修改可能无法保留');
          }
        }
        ctx.masterCells.value = ctx.adjustCells(ctx.masterCells.value, ctx.masterSettings.value);
        ctx._masterLoadOk.value = true;
        ctx.masterError.value = false;
      } catch (e) {
        // 加载失败不再静默：留标记供重进页面时补拉，并给出提示。
        // masterError 驱动表格的「加载失败态」（告警 + 重试），与「没有数据」区分开。
        ctx._masterLoadOk.value = false;
        ctx.masterError.value = true;
        ctx.notifyError('一般课表加载失败，请稍后重试');
        console.error(e);
      } finally {
        ctx._masterInFlight = (ctx._masterInFlight || 1) - 1;
      }
    },
    async saveMaster() {
      // 与实行课表同一套串行保存：避免连续编辑时并发 PUT 互相覆盖；
      // 失败提示一次（成功后退回复位），不再静默丢改动。
      if (!ctx._masterSaver) {
        ctx._masterSaver = createSerialSaver(() => axios.put(`${API_BASE}/schedule/master`, {
          cells: ctx.masterCells.value,
          settings: ctx.masterSettings.value
        }))
      }
      const ok = await ctx._masterSaver.request()
      if (!ok) {
        if (!ctx._masterSaveErrorShown) {
          ctx._masterSaveErrorShown = true
          ctx.notifyError('课程表模板保存失败，改动可能未保存，请稍后重试')
          console.error('[schedule] 模板保存失败', ctx._masterSaver.error)
        }
      } else {
        ctx._masterSaveErrorShown = false
      }
      return ok
    },
    // 对比前后网格，逐格写入撤销记录（课表存 {course} 对象，只需比对 course 文本）
    recordCellsDiff(table, prev, next) {
      const maxR = Math.max(prev.length, next.length)
      for (let r = 0; r < maxR; r++) {
        const pr = prev[r] || [], nr = next[r] || []
        const maxC = Math.max(pr.length, nr.length)
        for (let c = 0; c < maxC; c++) {
          const a = pr[c], b = nr[c]
          const av = a && a.course !== undefined ? a.course : a
          const bv = b && b.course !== undefined ? b.course : b
          if (String(av ?? '') !== String(bv ?? '')) {
            recordGridCellUndo('课程表', table, r, c, a ?? null, b ?? null)
          }
        }
      }
    },
    onMasterCellsUpdate(newRows) {
      const prev = ctx.masterCells.value.map(r => [...r]);
      const newCells = [];
      newRows.forEach(row => {
        if (row._lessonIdx !== undefined) newCells[row._lessonIdx] = row.cells;
      });
      let lessonCount = 0;
      const sections = ctx.masterSettings.value.sections;
      if (sections) {
        ['morning', 'noon', 'afternoon', 'evening', 'night'].forEach(key => {
          lessonCount += (sections[key] || []).filter(i => i.type === 'lesson').length;
        });
      }
      for (let i = 0; i < lessonCount; i++) {
        if (!newCells[i]) newCells[i] = Array(ctx.masterColHeaders.value.length).fill({ course: '' });
      }
      ctx.masterCells.value = newCells;
      ctx.masterCells.value = ctx.adjustCells(ctx.masterCells.value, ctx.masterSettings.value);
      ctx.recordCellsDiff('master_schedule', prev, ctx.masterCells.value);
      ctx.saveMaster();
    },
    async onMasterSwapRows(fromIdx, toIdx) {
      const rows = ctx.masterDisplayRows.filter(r => !r._isSeparator && !r._mergeCells);
      const fromRow = rows[fromIdx], toRow = rows[toIdx];
      if (!fromRow || !toRow || fromRow._isReadonly || toRow._isReadonly) return;
      const fromLessonIdx = fromRow._lessonIdx, toLessonIdx = toRow._lessonIdx;
      if (fromLessonIdx === undefined || toLessonIdx === undefined) return;
      const prev = JSON.parse(JSON.stringify(ctx.masterCells.value));
      // 移动语义：同上
      const newCells = [...ctx.masterCells.value];
      const [movedRow] = newCells.splice(fromLessonIdx, 1);
      newCells.splice(toLessonIdx, 0, movedRow);
      ctx.masterCells.value = newCells;
      // 先存后登记（口径同实行课表）：失败时不登记撤销，并把界面还原成交换前
      const ok = await ctx.saveMaster();
      if (!ok) {
        if (ctx.masterCells.value === newCells) ctx.masterCells.value = prev;
        return;
      }
      recordGridSnapshotUndo('课程表', 'master_schedule', prev, JSON.parse(JSON.stringify(newCells)), `交换行：${fromRow.label} ↔ ${toRow.label}`);
    },
    async onMasterSwapColumns(fromIdx, toIdx) {
      if (fromIdx === toIdx) return;
      const fromHeader = ctx.masterColHeaders.value[fromIdx] ?? `列${fromIdx + 1}`, toHeader = ctx.masterColHeaders.value[toIdx] ?? `列${toIdx + 1}`;
      const prev = JSON.parse(JSON.stringify(ctx.masterCells.value));
      // 移动语义：同 active 表（表头固定，只移动数据列）
      const newCells = ctx.masterCells.value.map(row => {
        const r = [...row];
        const [m] = r.splice(fromIdx, 1);
        r.splice(toIdx, 0, m);
        return r;
      });
      ctx.masterCells.value = newCells;
      // 口径同交换行
      const ok = await ctx.saveMaster();
      if (!ok) {
        if (ctx.masterCells.value === newCells) ctx.masterCells.value = prev;
        return;
      }
      recordGridSnapshotUndo('课程表', 'master_schedule', prev, JSON.parse(JSON.stringify(newCells)), `交换列：${fromHeader} ↔ ${toHeader}`);
    },
    onMasterRowMeta({ rowIdx, field, value }) {
      const sections = JSON.parse(JSON.stringify(ctx.masterSettings.value.sections));
      const flat = [];
      ['morning', 'noon', 'afternoon', 'evening', 'night'].forEach(key => {
        (sections[key] || []).forEach(item => flat.push({ section: key, item }));
      });
      if (rowIdx < flat.length) {
        const target = flat[rowIdx].item;
        if (field === 'label') target.name = value;
        else if (field === 'time') {
          const parts = value.split('-');
          if (parts.length === 2) {
            target.start = parts[0].trim();
            target.end = parts[1].trim();
          }
        }
        ctx.masterSettings.value.sections = sections;
        ctx.saveMaster();
      }
    },
    async saveMasterSettings(settings) {
      ctx.masterSettings.value = {
        sections: settings.sections,
        periods: settings.periods,
        days: settings.days
      };
      ctx.masterColHeaders.value = settings.days;
      ctx.masterSettingsVisible.value = false;
      ctx.masterCells.value = ctx.adjustCells(ctx.masterCells.value, ctx.masterSettings.value);
      await ctx.saveMaster();
    },
    async applyMasterToActive() {
      try {
        const before = JSON.parse(JSON.stringify(ctx.activeCells.value));
        await axios.post(`${API_BASE}/schedule/apply-master`);
        ctx.applyMasterVisible.value = false;
        ctx.notifySuccess('已应用');
        await ctx.loadActive();
        recordGridSnapshotUndo('课程表', 'schedule', before, JSON.parse(JSON.stringify(ctx.activeCells.value)), '从模板导入');
      } catch (e) {
        ctx.notifyError('应用失败');
      }
    },
    // 反向：把实行课表整块导入到一般课表（纯前端复制，无后端接口）
    async applyActiveToMaster() {
      try {
        const before = JSON.parse(JSON.stringify(ctx.masterCells.value));
        ctx.masterCells.value = JSON.parse(JSON.stringify(ctx.activeCells.value));
        ctx.masterSettings.value = JSON.parse(JSON.stringify(ctx.activeSettings.value));
        ctx.masterColHeaders.value = [...ctx.activeColHeaders.value];
        ctx.applyActiveVisible.value = false;
        // saveMaster 返回 ok 且内部已提示失败：这里不能忽略结果，
        // 否则会同时出现「模板保存失败」和「已从实行课表导入」两条矛盾提示，
        // 还会登记一条根本没生效的撤销。
        const ok = await ctx.saveMaster();
        if (!ok) return;
        recordGridSnapshotUndo('课程表', 'master_schedule', before, JSON.parse(JSON.stringify(ctx.masterCells.value)), '从实行导入');
        ctx.notifySuccess('已从实行课表导入');
      } catch (e) {
        ctx.notifyError('导入失败');
      }
    },
  }
}
