// ===== 课程表：一般课表（模板）加载/保存、行列与单元格交互、设置、双向导入 =====
// 纯代码搬运自 ScheduleView.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
import axios from 'axios'
import { recordGridCellUndo, recordGridSnapshotUndo } from '../../composables/useUndo.js'
import { createSerialSaver } from '../../utils/serialSaver.js'

export function useScheduleMaster({ API_BASE, DEFAULT_SECTIONS }) {
  return {
    // ============= 一般课表操作 =============
    async refreshMaster() {
      try {
        await this.loadMaster()
        if (this._masterLoadOk) this.notifySuccess('已刷新课程表模板')
      } catch (e) { /* 错误已在 loadMaster 内部处理 */ }
    },
    async loadMaster() {
      this._masterInFlight = (this._masterInFlight || 0) + 1;
      try {
        const res = await axios.get(`${API_BASE}/schedule/master`);
        const { cells, settings } = res.data;
        this.masterCells = Array.isArray(cells) ? cells : [];
        if (settings && (settings.sections || settings.periods)) {
          this.masterSettings = {
            sections: settings.sections || null,
            periods: settings.periods || [],
            days: settings.days || this.masterColHeaders
          };
          this.masterColHeaders = this.masterSettings.days;
        } else {
          this.masterSettings = {
            sections: JSON.parse(JSON.stringify(DEFAULT_SECTIONS)),
            periods: [],
            days: this.masterColHeaders
          };
          this.masterColHeaders = this.masterSettings.days;
          await this.saveMaster();
        }
        this.masterCells = this.adjustCells(this.masterCells, this.masterSettings);
        this._masterLoadOk = true;
        this.masterError = false;
      } catch (e) {
        // 加载失败不再静默：留标记供重进页面时补拉，并给出提示。
        // masterError 驱动表格的「加载失败态」（告警 + 重试），与「没有数据」区分开。
        this._masterLoadOk = false;
        this.masterError = true;
        this.notifyError('一般课表加载失败，请稍后重试');
        console.error(e);
      } finally {
        this._masterInFlight = (this._masterInFlight || 1) - 1;
      }
    },
    async saveMaster() {
      // 与实行课表同一套串行保存：避免连续编辑时并发 PUT 互相覆盖；
      // 失败提示一次（成功后退回复位），不再静默丢改动。
      if (!this._masterSaver) {
        this._masterSaver = createSerialSaver(() => axios.put(`${API_BASE}/schedule/master`, {
          cells: this.masterCells,
          settings: this.masterSettings
        }))
      }
      const ok = await this._masterSaver.request()
      if (!ok) {
        if (!this._masterSaveErrorShown) {
          this._masterSaveErrorShown = true
          this.notifyError('课程表模板保存失败，改动可能未保存，请稍后重试')
          console.error('[schedule] 模板保存失败', this._masterSaver.error)
        }
      } else {
        this._masterSaveErrorShown = false
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
      const prev = this.masterCells.map(r => [...r]);
      const newCells = [];
      newRows.forEach(row => {
        if (row._lessonIdx !== undefined) newCells[row._lessonIdx] = row.cells;
      });
      let lessonCount = 0;
      const sections = this.masterSettings.sections;
      if (sections) {
        ['morning', 'noon', 'afternoon', 'evening', 'night'].forEach(key => {
          lessonCount += (sections[key] || []).filter(i => i.type === 'lesson').length;
        });
      }
      for (let i = 0; i < lessonCount; i++) {
        if (!newCells[i]) newCells[i] = Array(this.masterColHeaders.length).fill({ course: '' });
      }
      this.masterCells = newCells;
      this.masterCells = this.adjustCells(this.masterCells, this.masterSettings);
      this.recordCellsDiff('master_schedule', prev, this.masterCells);
      this.saveMaster();
    },
    onMasterSwapRows(fromIdx, toIdx) {
      const rows = this.masterDisplayRows.filter(r => !r._isSeparator && !r._mergeCells);
      const fromRow = rows[fromIdx], toRow = rows[toIdx];
      if (!fromRow || !toRow || fromRow._isReadonly || toRow._isReadonly) return;
      const fromLessonIdx = fromRow._lessonIdx, toLessonIdx = toRow._lessonIdx;
      if (fromLessonIdx === undefined || toLessonIdx === undefined) return;
      const prev = JSON.parse(JSON.stringify(this.masterCells));
      // 移动语义：同上
      const newCells = [...this.masterCells];
      const [movedRow] = newCells.splice(fromLessonIdx, 1);
      newCells.splice(toLessonIdx, 0, movedRow);
      this.masterCells = newCells;
      recordGridSnapshotUndo('课程表', 'master_schedule', prev, JSON.parse(JSON.stringify(newCells)), `交换行：${fromRow.label} ↔ ${toRow.label}`);
      this.saveMaster();
    },
    onMasterSwapColumns(fromIdx, toIdx) {
      if (fromIdx === toIdx) return;
      const fromHeader = this.masterColHeaders[fromIdx] ?? `列${fromIdx + 1}`, toHeader = this.masterColHeaders[toIdx] ?? `列${toIdx + 1}`;
      const prev = JSON.parse(JSON.stringify(this.masterCells));
      // 移动语义：同 active 表（表头固定，只移动数据列）
      const newCells = this.masterCells.map(row => {
        const r = [...row];
        const [m] = r.splice(fromIdx, 1);
        r.splice(toIdx, 0, m);
        return r;
      });
      this.masterCells = newCells;
      recordGridSnapshotUndo('课程表', 'master_schedule', prev, JSON.parse(JSON.stringify(newCells)), `交换列：${fromHeader} ↔ ${toHeader}`);
      this.saveMaster();
    },
    onMasterRowMeta({ rowIdx, field, value }) {
      const sections = JSON.parse(JSON.stringify(this.masterSettings.sections));
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
        this.masterSettings.sections = sections;
        this.saveMaster();
      }
    },
    async saveMasterSettings(settings) {
      this.masterSettings = {
        sections: settings.sections,
        periods: settings.periods,
        days: settings.days
      };
      this.masterColHeaders = settings.days;
      this.masterSettingsVisible = false;
      this.masterCells = this.adjustCells(this.masterCells, this.masterSettings);
      await this.saveMaster();
    },
    async applyMasterToActive() {
      try {
        const before = JSON.parse(JSON.stringify(this.activeCells));
        await axios.post(`${API_BASE}/schedule/apply-master`);
        this.applyMasterVisible = false;
        this.notifySuccess('已应用');
        await this.loadActive();
        recordGridSnapshotUndo('课程表', 'schedule', before, JSON.parse(JSON.stringify(this.activeCells)), '从模板导入');
      } catch (e) {
        this.notifyError('应用失败');
      }
    },
    // 反向：把实行课表整块导入到一般课表（纯前端复制，无后端接口）
    async applyActiveToMaster() {
      try {
        const before = JSON.parse(JSON.stringify(this.masterCells));
        this.masterCells = JSON.parse(JSON.stringify(this.activeCells));
        this.masterSettings = JSON.parse(JSON.stringify(this.activeSettings));
        this.masterColHeaders = [...this.activeColHeaders];
        this.applyActiveVisible = false;
        await this.saveMaster();
        recordGridSnapshotUndo('课程表', 'master_schedule', before, JSON.parse(JSON.stringify(this.masterCells)), '从实行导入');
        this.notifySuccess('已从实行课表导入');
      } catch (e) {
        this.notifyError('导入失败');
      }
    },
  }
}
