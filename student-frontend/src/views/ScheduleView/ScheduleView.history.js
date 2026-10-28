// ===== 课程表：历史快照（周列表、快照加载、保存本周、删除本周、周切换） =====
// 纯代码搬运自 ScheduleView.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
import axios from 'axios'
import { localDateStr } from '../../utils/dateTime.js'

export function useScheduleHistory(API_BASE) {
  return {
    // 获取所有快照周列表
    async fetchHistoryWeeks() {
      try {
        const res = await axios.get(`${API_BASE}/schedule/history`);
        this.historyWeeks = res.data || [];

        // 如果已有选中的周，检查是否仍在列表中
        if (this.historyCurrentWeek) {
          const stillExists = this.historyWeeks.some(w => w.week_start === this.historyCurrentWeek);
          if (!stillExists) this.historyCurrentWeek = '';
        }

        // 如果没有选中，自动选第一周
        if (!this.historyCurrentWeek && this.historyWeeks.length > 0) {
          this.historyCurrentWeek = this.historyWeeks[0].week_start;
        }

        // 如果有选中的周，加载其快照
        if (this.historyCurrentWeek) {
          await this.loadHistorySnapshot();
        }
      } catch (e) {
        console.error('获取历史周列表失败', e);
      }
    },

    // 加载当前周的课表快照
    async loadHistorySnapshot() {
      if (!this.historyCurrentWeek) return;
      this.historyLoading = true;
      try {
        const res = await axios.get(`${API_BASE}/schedule/history/${this.historyCurrentWeek}`);
        this.historySnapshot = res.data;
        if (this.historySnapshot) {
          this.historyCells = Array.isArray(this.historySnapshot.cells) ? this.historySnapshot.cells : [];
          const settings = this.historySnapshot.settings || {};
          this.historySettings = {
            sections: settings.sections || null,
            periods: settings.periods || [],
            days: settings.days || ['周一','周二','周三','周四','周五']
          };
          this.historyColHeaders = this.historySettings.days;
        } else {
          this.historyCells = [];
          this.historySettings = { sections: null, periods: [], days: ['周一','周二','周三','周四','周五'] };
          this.historyColHeaders = ['周一','周二','周三','周四','周五'];
        }
      } catch (e) { console.error(e); }
      finally { this.historyLoading = false; }
    },

    // 获取本周一的日期
    getMonday(date) {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(d.setDate(diff));
    },

    // 保存当前实行课表为本周快照
    async captureHistorySnapshot() {
      try {
        const activeRes = await axios.get(`${API_BASE}/schedule`);
        const { cells, settings } = activeRes.data;
        // 必须取本地日期：getMonday 返回的是本地时间，若再 toISOString 转 UTC，
        // 东八区周一 00:00–08:00 之间会算成周日，快照存到错误的一周
        const weekStart = localDateStr(this.getMonday(new Date()));
        await axios.post(`${API_BASE}/schedule/snapshot`, {
          week_start: weekStart,
          cells,
          settings
        });
        this.notifySuccess('本周快照已保存');
        await this.fetchHistoryWeeks();
      } catch (e) { this.notifyError('保存失败'); console.error(e); }
    },
    requestDeleteHistorySnapshot() {
      if (!this.canDeleteHistorySnapshot) return;
      this.deleteSnapshotVisible = true;
    },
    onSwitchWeek(dir) {
      this.slideDir = dir;
    },
    async confirmDeleteHistorySnapshot() {
      this.deleteSnapshotVisible = false;
      const week = this.historyCurrentWeek;
      if (!week) return;
      try {
        await axios.delete(`${API_BASE}/schedule/history/${week}`);
        this.notifySuccess('该周快照已删除');
        if (this.historyCurrentWeek === week) this.historySnapshot = null;
        await this.fetchHistoryWeeks();
      } catch (e) { this.notifyError('删除失败'); console.error(e); }
    },
  }
}
