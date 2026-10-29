// ===== 课程表：公共构建（显示行/导出行/行列调整、导出入口、跨页定位） =====
// 纯代码搬运自 ScheduleView.vue 的 methods，未改写逻辑；经 ctx 闭包调用（script setup）。
import { useNotification } from '../../composables/useNotification.js'
import { applyRouteRowFocus } from '../../composables/useRowFocus.js'

// ctx 契约：状态 ref（.value 访问）、临时字段、notify* 函数、host（applyRouteRowFocus 的宿主 { route, router }）与跨模块方法。
export function useScheduleCommon(ctx, { SECTION_NAMES }) {
  return {
    // ============= 公共：构建显示行 =============
    buildDisplayRows(cells, settings) {
      const sections = settings.sections;
      if (!sections) return [];
      let lessonIdx = 0;
      const rows = [];
      const order = ['morning', 'noon', 'afternoon', 'evening', 'night'];
      const days = settings.days || ctx.masterColHeaders.value;

      order.forEach(secKey => {
        const items = sections[secKey] || [];
        const sectionName = SECTION_NAMES[secKey] || secKey;
        const sectionRowCount = items.length;

        items.forEach((item, idx) => {
          const row = {
            _rowKey: `${secKey}_${idx}`,
            label: item.name,
            time: `${item.start}-${item.end}`,
            _isSeparator: false,
            cells: [],
            _isReadonly: item.type !== 'lesson',
            _mergeCells: item.type !== 'lesson',
            periodLabel: idx === 0 ? sectionName : '',
            _periodRowSpan: idx === 0 ? sectionRowCount : 0,
          };

          if (item.type === 'lesson') {
            const lessonCells = cells[lessonIdx] || Array(days.length).fill({ course: '' });
            while (lessonCells.length < days.length) lessonCells.push({ course: '' });
            row.cells = lessonCells.slice(0, days.length);
            row._lessonIdx = lessonIdx;
            lessonIdx++;
          } else {
            row.cells = Array(days.length).fill({ course: '' });
          }
          rows.push(row);
        });
      });
      return rows;
    },

    // ============= 公共：构建导出行 =============
    buildExportRows(cells, settings) {
      const sections = settings.sections;
      if (!sections) return [];
      const order = ['morning', 'noon', 'afternoon', 'evening', 'night'];
      let lessonIdx = 0;
      const output = [];
      const days = settings.days || ctx.masterColHeaders.value;

      order.forEach(secKey => {
        const items = sections[secKey] || [];
        if (items.length === 0) return;

        const hasLesson = items.some(it => it.type === 'lesson');
        if (!hasLesson) {
          items.forEach(item => {
            output.push({
              type: 'globalRest',
              label: item.name,
              time: `${item.start}-${item.end}`,
              section: secKey
            });
          });
          return;
        }

        const lessonRows = [];
        items.forEach(item => {
          if (item.type === 'lesson') {
            const lessonCells = cells[lessonIdx] || Array(days.length).fill({ course: '' });
            lessonIdx++;
            lessonRows.push({
              type: 'lesson',
              label: item.name,
              time: `${item.start}-${item.end}`,
              section: secKey,
              cells: lessonCells,
              _rowSpan: 0
            });
          }
        });

        let lessonCursor = 0;
        items.forEach(item => {
          if (item.type === 'lesson') {
            output.push(lessonRows[lessonCursor]);
            lessonCursor++;
          } else {
            output.push({
              type: 'innerRest',
              label: item.name,
              time: `${item.start}-${item.end}`,
              section: secKey
            });
          }
        });
      });

      // 重新计算时段列竖向合并跨度
      let currentSection = null;
      let firstLessonIdx = -1;
      for (let i = 0; i < output.length; i++) {
        const row = output[i];
        if (row.section !== currentSection) {
          if (currentSection !== null && firstLessonIdx >= 0) {
            const span = i - firstLessonIdx;
            output[firstLessonIdx]._rowSpan = span;
            output[firstLessonIdx]._isFirstInBlock = true;
            for (let j = firstLessonIdx + 1; j < i; j++) {
              if (output[j].type === 'lesson') {
                output[j]._rowSpan = 0;
                output[j]._isFirstInBlock = false;
              }
            }
          }
          currentSection = row.section;
          firstLessonIdx = row.type === 'lesson' ? i : -1;
        } else if (firstLessonIdx === -1 && row.type === 'lesson') {
          firstLessonIdx = i;
        }
      }
      if (currentSection !== null && firstLessonIdx >= 0) {
        const span = output.length - firstLessonIdx;
        output[firstLessonIdx]._rowSpan = span;
        output[firstLessonIdx]._isFirstInBlock = true;
        for (let j = firstLessonIdx + 1; j < output.length; j++) {
          if (output[j].type === 'lesson') {
            output[j]._rowSpan = 0;
            output[j]._isFirstInBlock = false;
          }
        }
      }

      return output;
    },

    // 辅助：按设置调整 cells 行列数
    adjustCells(cells, settings) {
      const sections = settings.sections;
      if (!sections) return cells;
      let lessonCount = 0;
      ['morning', 'noon', 'afternoon', 'evening', 'night'].forEach(key => {
        lessonCount += (sections[key] || []).filter(i => i.type === 'lesson').length;
      });
      const dayCount = (settings.days || ['周一', '周二', '周三', '周四', '周五']).length;
      while (cells.length < lessonCount) cells.push(Array(dayCount).fill({ course: '' }));
      cells = cells.slice(0, lessonCount).map(row => {
        while (row.length < dayCount) row.push({ course: '' });
        return row;
      });
      return cells;
    },

    // 重进页面（KeepAlive activated）时只补拉「上次失败」的表；
    // 已加载成功的表不再重复请求，保持原有行为，避免多余往返
    retryFailedLoads() {
      if (!ctx._activeLoadOk.value && !ctx._activeInFlight) ctx.loadActive();
      if (!ctx._masterLoadOk.value && !ctx._masterInFlight) ctx.loadMaster();
    },

    // 课表单元格里是否有实际课程内容（行结构始终存在，不能用行数判空）
    _applyRowFocus() {
      applyRouteRowFocus(ctx.host, {
        parse: (key) => {
          if (!/^[sm]:\d+:\d+$/.test(key)) return null
          if (ctx.activeTab.value !== 'schedule') ctx.activeTab.value = 'schedule'
          return key
        },
      })
    },
    hasScheduleData(cells) {
      return (cells || []).some(row => Array.isArray(row) && row.some(c => {
        const v = typeof c === 'string' ? c : (c && c.course)
        return String(v || '').trim() !== ''
      }))
    },
    // 导出课表：无数据时直接提示，不弹导出选项弹窗
    openActiveExport() {
      if (!ctx.hasScheduleData(ctx.activeCells.value)) return useNotification().info('暂无课表数据可导出')
      ctx.activeExportVisible.value = true
    },
    openMasterExport() {
      if (!ctx.hasScheduleData(ctx.masterCells.value)) return useNotification().info('课表模板为空，无法导出')
      ctx.masterExportVisible.value = true
    },
  }
}
