// ===== 课程表：实行课表加载/保存、行列与单元格交互、设置 =====
// 纯代码搬运自 ScheduleView.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
import axios from 'axios'
import { recordGridCellUndo, recordGridSnapshotUndo } from '../../composables/useUndo.js'

export function useScheduleActive({ API_BASE, DEFAULT_SECTIONS }) {
  return {
    // ============= 实行课表操作 =============
    async refreshActive() {
      try {
        await this.loadActive()
        if (this._activeLoadOk) this.notifySuccess('已刷新实行课表')
      } catch (e) { /* 错误已在 loadActive 内部处理 */ }
    },
    async loadActive() {
      this._activeInFlight = (this._activeInFlight || 0) + 1;
      try {
        const res = await axios.get(`${API_BASE}/schedule`);
        const { cells, settings } = res.data;
        this.activeCells = Array.isArray(cells) ? cells : [];
        if (settings && (settings.sections || settings.periods)) {
          this.activeSettings = {
            sections: settings.sections || null,
            periods: settings.periods || [],
            days: settings.days || this.activeColHeaders
          };
          this.activeColHeaders = this.activeSettings.days;
        } else {
          this.activeSettings = {
            sections: JSON.parse(JSON.stringify(DEFAULT_SECTIONS)),
            periods: [],
            days: this.activeColHeaders
          };
          this.activeColHeaders = this.activeSettings.days;
          await this.saveActive();
        }
        this.activeCells = this.adjustCells(this.activeCells, this.activeSettings);

        // 加载学期开始日期（单独兜底：失败不影响课表本身的加载判定）
        try {
          const setRes = await axios.get(`${API_BASE}/schedule/settings`);
          this.semesterStart = setRes.data?.semester_start || '';
        } catch (e) { console.error(e); }

        this._activeLoadOk = true;
      } catch (e) {
        // 加载失败不再静默：留标记供重进页面时补拉，并给出提示
        this._activeLoadOk = false;
        this.notifyError('实行课表加载失败，请稍后重试');
        console.error(e);
      } finally {
        this._activeInFlight = (this._activeInFlight || 1) - 1;
      }
    },
    async saveActive() {
      await axios.put(`${API_BASE}/schedule`, {
        cells: this.activeCells,
        settings: this.activeSettings
      });
    },
    onActiveCellsUpdate(newRows) {
      const prev = this.activeCells.map(r => [...r]);
      const newCells = [];
      newRows.forEach(row => {
        if (row._lessonIdx !== undefined) newCells[row._lessonIdx] = row.cells;
      });
      let lessonCount = 0;
      const sections = this.activeSettings.sections;
      if (sections) {
        ['morning', 'noon', 'afternoon', 'evening', 'night'].forEach(key => {
          lessonCount += (sections[key] || []).filter(i => i.type === 'lesson').length;
        });
      }
      for (let i = 0; i < lessonCount; i++) {
        if (!newCells[i]) newCells[i] = Array(this.activeColHeaders.length).fill({ course: '' });
      }
      this.activeCells = newCells;
      this.activeCells = this.adjustCells(this.activeCells, this.activeSettings);
      this.recordCellsDiff('schedule', prev, this.activeCells);
      this.saveActive();
    },
    onActiveSwapRows(fromIdx, toIdx) {
      const rows = this.activeDisplayRows.filter(r => !r._isSeparator && !r._mergeCells);
      const fromRow = rows[fromIdx], toRow = rows[toIdx];
      if (!fromRow || !toRow || fromRow._isReadonly || toRow._isReadonly) return;
      const fromLessonIdx = fromRow._lessonIdx, toLessonIdx = toRow._lessonIdx;
      if (fromLessonIdx === undefined || toLessonIdx === undefined) return;
      const prev = JSON.parse(JSON.stringify(this.activeCells));
      // 移动语义：与拖动时的让位预览一致（取出源行插入目标位置，中间行顺移）
      const newCells = [...this.activeCells];
      const [movedRow] = newCells.splice(fromLessonIdx, 1);
      newCells.splice(toLessonIdx, 0, movedRow);
      this.activeCells = newCells;
      recordGridSnapshotUndo('课程表', 'schedule', prev, JSON.parse(JSON.stringify(newCells)), `交换行：${fromRow.label} ↔ ${toRow.label}`);
      this.saveActive();
    },
    onActiveSwapColumns(fromIdx, toIdx) {
      if (fromIdx === toIdx) return;
      const fromHeader = this.activeColHeaders[fromIdx] ?? `列${fromIdx + 1}`, toHeader = this.activeColHeaders[toIdx] ?? `列${toIdx + 1}`;
      const prev = JSON.parse(JSON.stringify(this.activeCells));
      // 移动语义：取出源列插入目标位置，中间列的数据顺移（表头固定）
      const newCells = this.activeCells.map(row => {
        const r = [...row];
        const [m] = r.splice(fromIdx, 1);
        r.splice(toIdx, 0, m);
        return r;
      });
      this.activeCells = newCells;
      recordGridSnapshotUndo('课程表', 'schedule', prev, JSON.parse(JSON.stringify(newCells)), `交换列：${fromHeader} ↔ ${toHeader}`);
      this.saveActive();
    },
    onActiveRowMeta({ rowIdx, field, value }) {
      const sections = JSON.parse(JSON.stringify(this.activeSettings.sections));
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
        this.activeSettings.sections = sections;
        this.saveActive();
      }
    },
    async saveActiveSettings(settings) {
      this.activeSettings = {
        sections: settings.sections,
        periods: settings.periods,
        days: settings.days
      };
      this.activeColHeaders = settings.days;
      this.activeSettingsVisible = false;
      this.activeCells = this.adjustCells(this.activeCells, this.activeSettings);

      // 保存学期开始日期
      await axios.put(`${API_BASE}/schedule/settings`, {
        semester_start: this.semesterStart
      });
      await this.saveActive();
    }
  }
}
