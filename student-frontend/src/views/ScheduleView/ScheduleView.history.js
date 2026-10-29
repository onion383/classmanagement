// ===== 课程表：历史快照（周列表、快照加载、保存本周、删除本周、周切换） =====
// 纯代码搬运自 ScheduleView.vue 的 methods，未改写逻辑；经 ctx 闭包调用（script setup）。
import axios from 'axios'
import { localDateStr } from '../../utils/dateTime.js'

export function useScheduleHistory(ctx, API_BASE) {
  return {
    // 获取所有快照周列表
    async fetchHistoryWeeks() {
      try {
        const res = await axios.get(`${API_BASE}/schedule/history`);
        ctx.historyWeeks.value = res.data || [];

        // 如果已有选中的周，检查是否仍在列表中
        if (ctx.historyCurrentWeek.value) {
          const stillExists = ctx.historyWeeks.value.some(w => w.week_start === ctx.historyCurrentWeek.value);
          if (!stillExists) ctx.historyCurrentWeek.value = '';
        }

        // 如果没有选中，自动选第一周
        if (!ctx.historyCurrentWeek.value && ctx.historyWeeks.value.length > 0) {
          ctx.historyCurrentWeek.value = ctx.historyWeeks.value[0].week_start;
        }

        // 如果有选中的周，加载其快照
        if (ctx.historyCurrentWeek.value) {
          await ctx.loadHistorySnapshot();
        }
      } catch (e) {
        console.error('获取历史周列表失败', e);
      }
    },

    // 加载当前周的课表快照
    async loadHistorySnapshot() {
      if (!ctx.historyCurrentWeek.value) return;
      ctx.historyLoading.value = true;
      try {
        const res = await axios.get(`${API_BASE}/schedule/history/${ctx.historyCurrentWeek.value}`);
        ctx.historySnapshot.value = res.data;
        if (ctx.historySnapshot.value) {
          ctx.historyCells.value = Array.isArray(ctx.historySnapshot.value.cells) ? ctx.historySnapshot.value.cells : [];
          const settings = ctx.historySnapshot.value.settings || {};
          ctx.historySettings.value = {
            sections: settings.sections || null,
            periods: settings.periods || [],
            days: settings.days || ['周一','周二','周三','周四','周五']
          };
          ctx.historyColHeaders.value = ctx.historySettings.value.days;
        } else {
          ctx.historyCells.value = [];
          ctx.historySettings.value = { sections: null, periods: [], days: ['周一','周二','周三','周四','周五'] };
          ctx.historyColHeaders.value = ['周一','周二','周三','周四','周五'];
        }
      } catch (e) { console.error(e); }
      finally { ctx.historyLoading.value = false; }
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
        const weekStart = localDateStr(ctx.getMonday(new Date()));
        await axios.post(`${API_BASE}/schedule/snapshot`, {
          week_start: weekStart,
          cells,
          settings
        });
        ctx.notifySuccess('本周快照已保存');
        await ctx.fetchHistoryWeeks();
      } catch (e) { ctx.notifyError('保存失败'); console.error(e); }
    },
    requestDeleteHistorySnapshot() {
      if (!ctx.canDeleteHistorySnapshot) return;
      ctx.deleteSnapshotVisible.value = true;
    },
    onSwitchWeek(dir) {
      ctx.slideDir.value = dir;
    },
    async confirmDeleteHistorySnapshot() {
      ctx.deleteSnapshotVisible.value = false;
      const week = ctx.historyCurrentWeek.value;
      if (!week) return;
      try {
        await axios.delete(`${API_BASE}/schedule/history/${week}`);
        ctx.notifySuccess('该周快照已删除');
        if (ctx.historyCurrentWeek.value === week) ctx.historySnapshot.value = null;
        await ctx.fetchHistoryWeeks();
      } catch (e) { ctx.notifyError('删除失败'); console.error(e); }
    },
  }
}
