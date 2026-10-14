<template>
  <!-- 导出表格组件 -->
  <Teleport to="body">
  <Transition name="dialog">
  <div v-if="effectiveVisible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]">
    <div class="bg-surface p-5 rounded-lg min-w-[400px] max-w-xl shadow-card border border-border dialog-card">
      <h3 class="text-lg font-bold mb-3">导出选项</h3>

      <div class="mb-4">
        <p class="font-semibold mb-2">{{ isGroupMode ? '选择导出的小组：' : '选择要导出的列：' }}</p>
        <!-- 普通模式：选列 -->
        <div v-if="!isGroupMode" class="flex flex-wrap gap-2">
          <label v-for="field in fields" :key="field.name" class="flex items-center gap-1 text-sm">
            <input type="checkbox" :value="field.name" v-model="selectedColumns" />
            {{ field.name }}
          </label>
        </div>
        <!-- 分组模式：选小组 -->
        <div v-else class="flex flex-wrap gap-2">
          <label v-for="(g, i) in groupSource.groups" :key="i" class="flex items-center gap-1 text-sm">
            <input type="checkbox" :value="i" v-model="selectedGroups" />
            {{ g.name }} ({{ g.members.length }})
          </label>
        </div>
        <p v-if="!isGroupMode && selectedColumns.length === 0" class="text-danger text-sm mt-1">请至少选择一列</p>
        <p v-else-if="isGroupMode && selectedGroups.length === 0" class="text-danger text-sm mt-1">请至少选择一个小组</p>
      </div>

      <div class="mb-4" v-if="!isGroupMode">
        <p class="font-semibold mb-2">导出行：</p>
        <label class="flex items-center gap-2 mb-1">
          <input type="radio" value="all" v-model="rowMode" /> 全部行
        </label>
        <label class="flex items-center gap-2 mb-1">
          <input type="radio" value="selected" v-model="rowMode" :disabled="selectedCount === 0" /> 仅选中行 ({{ selectedCount }})
        </label>
      </div>

      <div class="mb-4">
        <p class="font-semibold mb-2">导出格式：</p>
        <AppSelect v-model="exportFormat" class="w-full" :options="[{value:'html',label:'HTML 表格 (.html)'},{value:'xlsx',label:'Excel (.xlsx) - 带边框'},{value:'csv',label:'CSV (.csv) - 无样式'},{value:'md',label:'Markdown 文档 (.md)'},{value:'txt',label:'纯文本 (.txt)'},{value:'json',label:'JSON 数据 (.json)'},{value:'image',label:'图片 (.png)'},{value:'pdf',label:'PDF (.pdf)'}]" />
      </div>

      <div class="mb-4">
        <label class="font-semibold block mb-1">文件名</label>
        <input v-model="filename" class="filename-input border border-border bg-surface text-text p-2 w-full !rounded-[12px]" />
      </div>

      <div class="text-right">
        <button @click="cancel" class="bg-surface-hover text-text border border-border px-4 py-1.5 rounded-lg mr-2 cursor-pointer">取消</button>
        <button @click="doExport" class="bg-info text-text-inverse border-none px-4 py-1.5 rounded-lg cursor-pointer" :disabled="selectedColumns.length === 0">导出</button>
      </div>
    </div>
  </div>
  </Transition>
  </Teleport>
</template>

<script>
import AppSelect from '../base/AppSelect.vue'
import { useNotification } from '../../composables/useNotification';
import '../../styles/dialog-transition.css'

const SECTION_NAMES = { morning: '上午', noon: '中午', afternoon: '下午', evening: '傍晚', night: '晚上' };

const FORMAT_LABELS = {
  csv: '表格 (.csv)',
  html: 'HTML 表格 (.html)',
  xlsx: 'Excel 表格 (.xlsx)',
  md: 'Markdown 文档 (.md)',
  txt: '纯文本 (.txt)',
  json: 'JSON 数据 (.json)',
  image: 'PNG 图片 (.png)',
  pdf: 'PDF 文档 (.pdf)'
};

export default {
  name: 'ExportExcel',
  components: { AppSelect },
  props: {
    rows: { type: Array, required: true },
    fields: { type: Array, required: true },
    selectedRowKeys: { type: Array, default: () => [] },
    defaultFilename: { type: String, default: '导出数据' },
    tableElement: { type: Object, default: null },
    // 分组导出模式：传入后弹窗改为「选择导出的小组」，数据从该对象取
    groupSource: { type: Object, default: null },
    // 受控模式：传入后显示由外部 isVisible 决定（配合 v-if 可实现懒加载）；不传则用 open() 自管理，向后兼容
    isVisible: { type: Boolean, default: undefined }
  },
  emits: ['export-start', 'export-finish', 'export-error', 'update:isVisible'],
  setup() {
    const { success, error, info } = useNotification()
    return { notifySuccess: success, notifyError: error, notifyInfo: info }
  },
  data() {
    return {
      visible: false,
      selectedColumns: [],
      selectedGroups: [],
      rowMode: 'all',
      exportFormat: 'html',
      filename: ''
    };
  },
  computed: {
    selectedCount() { return this.selectedRowKeys.length; },
    isGroupMode() { return !!(this.groupSource && Array.isArray(this.groupSource.groups) && this.groupSource.groups.length); },
    isControlled() { return this.isVisible !== undefined; },
    effectiveVisible() { return this.isControlled ? this.isVisible : this.visible; }
  },
  watch: {
    // immediate：挂载时（含 v-if 懒加载后首次可见）即初始化默认全选，
    // 否则首次打开弹窗时 selectedColumns 为空，需开关一次才补全
    effectiveVisible: {
      immediate: true,
      handler(val) {
        if (val) {
          this.selectedColumns = this.fields.map(f => f.name);
          this.selectedGroups = this.groupSource ? this.groupSource.groups.map((_, i) => i) : [];
          this.rowMode = 'all';
          this.exportFormat = 'html';
          this.filename = this.defaultFilename;
        }
      }
    }
  },
  methods: {
    open() {
      if (this.isControlled) this.$emit('update:isVisible', true);
      else this.visible = true;
      this.$emit('export-start');
    },
    close() {
      if (this.isControlled) this.$emit('update:isVisible', false);
      else this.visible = false;
    },
    cancel() { this.close(); },
    async doExport() {
      // ---------- 分组导出模式 ----------
      if (this.isGroupMode) {
        if (this.selectedGroups.length === 0) { this.notifyInfo('请至少选择一个小组'); return; }
        const dateStr = new Date().toISOString().slice(0, 10);
        const finalFilename = `${this.filename}_${dateStr}`;
        try {
          let saved = true;
          switch (this.exportFormat) {
            case 'csv': saved = await this.exportGroupCSV(this.selectedGroups, finalFilename); break;
            case 'html': saved = await this.exportGroupHTML(this.selectedGroups, finalFilename); break;
            case 'md': saved = await this.exportGroupMD(this.selectedGroups, finalFilename); break;
            case 'txt': saved = await this.exportGroupTXT(this.selectedGroups, finalFilename); break;
            case 'json': saved = await this.exportGroupJSON(this.selectedGroups, finalFilename); break;
            case 'image': saved = await this.exportGroupImage(this.selectedGroups, finalFilename); break;
            case 'pdf': saved = await this.exportGroupPDF(this.selectedGroups, finalFilename); break;
            case 'xlsx': saved = await this.exportGroupXLSX(this.selectedGroups, finalFilename); break;
            default: saved = await this.exportGroupHTML(this.selectedGroups, finalFilename);
          }
          if (saved) {
            this.notifySuccess(`已成功导出 ${FORMAT_LABELS[this.exportFormat] || '文件'}`)
            this.$emit('export-finish');
          }
        } catch (err) {
          console.error('导出失败:', err);
          this.notifyError('导出失败，请重试')
          this.$emit('export-error', err);
        }
        this.close();
        return;
      }

      // ---------- 普通表格导出 ----------
      if (this.selectedColumns.length === 0) return;
      let exportRows = [...this.rows];
      if (this.rowMode === 'selected') {
        exportRows = exportRows.filter(r => this.selectedRowKeys.includes(r.id) || this.selectedRowKeys.includes(r._rowKey));
      }
      if (!exportRows.length) { this.notifyInfo('没有数据可以导出'); this.close(); return; }

      const selectedFields = this.fields.filter(f => this.selectedColumns.includes(f.name));
      const dateStr = new Date().toISOString().slice(0, 10);
      const finalFilename = `${this.filename}_${dateStr}`;

      try {
        let saved = true
        switch (this.exportFormat) {
          case 'csv': saved = await this.exportCSV(exportRows, selectedFields, finalFilename); break;
          case 'html': saved = await this.exportHTMLTable(exportRows, selectedFields, finalFilename); break;
          case 'xlsx': saved = await this.exportXLSX(exportRows, selectedFields, finalFilename); break;
          case 'md': saved = await this.exportMD(exportRows, selectedFields, finalFilename); break;
          case 'txt': saved = await this.exportTXT(exportRows, selectedFields, finalFilename); break;
          case 'json': saved = await this.exportJSON(exportRows, selectedFields, finalFilename); break;
          case 'image': saved = await this.exportImage(exportRows, selectedFields, finalFilename); break;
          case 'pdf': saved = await this.exportPDF(exportRows, selectedFields, finalFilename); break;
          default: saved = await this.exportHTMLTable(exportRows, selectedFields, finalFilename);
        }
        if (saved) {
          const label = FORMAT_LABELS[this.exportFormat] || '文件'
          this.notifySuccess(`已成功导出 ${label}`)
          this.$emit('export-finish');
        }
      } catch (err) {
        console.error('导出失败:', err);
        this.notifyError('导出失败，请重试')
        this.$emit('export-error', err);
      }
      this.close();
    },

    // 保存文件：Electron 下弹系统保存对话框，用户确认后才写入；浏览器则直接下载
    async saveFileWithDialog(defaultName, blob) {
      if (window.electron && typeof window.electron.invoke === 'function') {
        const arrayBuffer = await blob.arrayBuffer()
        const result = await window.electron.invoke('save-file', {
          defaultName,
          data: arrayBuffer
        })
        if (result && !result.canceled && result.filePath) {
          // 导出成功后用系统默认应用打开文件
          window.electron.invoke('open-file', { filePath: result.filePath }).catch(() => {})
        }
        return !!result && !result.canceled
      }
      // 浏览器环境：直接触发下载
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = defaultName
      a.click()
      URL.revokeObjectURL(url)
      return true
    },

    getSectionName(key) {
      return SECTION_NAMES[key] || '';
    },

    isScheduleData(rows) {
      if (!rows || rows.length === 0) return false;
      return rows.some(r => r.type === 'lesson' || r.type === 'globalRest' || r.type === 'innerRest');
    },

    getCellValue(row, headerName, headers) {
      if (headerName === '时段') return this.getSectionName(row.section);
      if (headerName === '节次') return row.label || '';
      if (headerName === '时间') return row.time || '';
      if (row[headerName] !== undefined) return row[headerName];
      const idx = headers.indexOf(headerName) - 3;
      if (idx >= 0 && row.cells && row.cells[idx]) return row.cells[idx].course || '';
      return '';
    },

    // 判断是否为讲台行，并且有行号列
    isPodiumRowWithRowNum(row, headers) {
      return row._isPodium && headers.length > 1 && headers[0] === '行号';
    },

    // 检查某列是否为行号列（表头为“行号”）
    isRowNumColumn(headerName) {
      return headerName === '行号';
    },

    // 检查某列是否为走廊列（表头为“走廊”）
    isAisleColumn(headerName) {
      return headerName === '走廊';
    },

    // ==================== 分组导出（groupSource 模式） ====================
    // 按小组下标取小组对象
    groupObjects(idxList) {
      return idxList.map(i => this.groupSource.groups[i]);
    },
    // 拉平为二维表（用于 CSV / HTML / XLSX 标题行）
    groupFlatRows(idxList) {
      const leaderTitle = this.groupSource.leaderTitle || '组长';
      const rows = [['小组', '成员', '备注', '职务']];
      this.groupObjects(idxList).forEach(g => {
        let first = true;
        for (const m of g.members || []) {
          rows.push([first ? g.name : '', m.member_name || '', m.remark || '', first ? leaderTitle : '']);
          first = false;
        }
      });
      return rows;
    },
    // 生成带标题、可截图/打印的分组 HTML 表格串
    groupTableHTML(idxList, filename) {
      const rows = this.groupFlatRows(idxList);
      const head = rows[0];
      const body = rows.slice(1);
      let html = `<div style="text-align:center; font-size:20px; font-weight:bold; margin-bottom:12px;">${this.escapeHtml(filename)}</div>`;
      html += '<table style="border-collapse:collapse; margin:0 auto;">';
      html += `<thead><tr style="background-color:#4CAF50; color:white;">${head.map(h => `<th style="border:1px solid #ccc; padding:6px 12px;">${h}</th>`).join('')}</tr></thead><tbody>`;
      for (const r of body) {
        const cells = r.map((c, i) => {
          let style = 'border:1px solid #ccc; padding:6px 12px; text-align:center;';
          if (r[0] && i === 0) style += ' font-weight:bold; background-color:#BDD7EE;';
          else if (r[3]) style += ' font-weight:bold;';
          return `<td style="${style}">${String(c ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
        });
        html += `<tr>${cells.join('')}</tr>`;
      }
      html += '</tbody></table>';
      return html;
    },
    async exportGroupCSV(idxList, filename) {
      const rows = this.groupFlatRows(idxList);
      const esc = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      return await this.saveFileWithDialog(`${filename}.csv`, blob);
    },
    async exportGroupHTML(idxList, filename) {
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${this.escapeHtml(filename)}</title></head><body>${this.groupTableHTML(idxList, filename)}</body></html>`;
      const blob = new Blob([html], { type: 'text/html' });
      return await this.saveFileWithDialog(`${filename}.html`, blob);
    },
    async exportGroupMD(idxList, filename) {
      const rows = this.groupFlatRows(idxList);
      const md = this.buildMarkdown(rows[0], rows.slice(1), filename);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
      return await this.saveFileWithDialog(`${filename}.md`, blob);
    },
    async exportGroupTXT(idxList, filename) {
      const rows = this.groupFlatRows(idxList);
      const txt = this.buildTxt(rows[0], rows.slice(1));
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' });
      return await this.saveFileWithDialog(`${filename}.txt`, blob);
    },
    async exportGroupJSON(idxList, filename) {
      const rows = this.groupFlatRows(idxList);
      const json = this.buildJson(rows[0], rows.slice(1));
      const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
      return await this.saveFileWithDialog(`${filename}.json`, blob);
    },
    async exportGroupImage(idxList, filename) {
      const { default: html2canvas } = await import('html2canvas');
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = this.groupTableHTML(idxList, filename);
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      document.body.appendChild(tempDiv);
      try {
        const canvas = await html2canvas(tempDiv, { scale: 2 });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return false;
        return await this.saveFileWithDialog(`${filename}.png`, blob);
      } finally { document.body.removeChild(tempDiv); }
    },
    async exportGroupPDF(idxList, filename) {
      const { default: html2canvas } = await import('html2canvas');
      const { default: jsPDF } = await import('jspdf');
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = this.groupTableHTML(idxList, filename);
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      document.body.appendChild(tempDiv);
      try {
        const canvas = await html2canvas(tempDiv, { scale: 2 });
        const img = canvas.toDataURL('image/png');
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const ratio = canvas.width / canvas.height;
        let w = pageW - 20;
        let h = w / ratio;
        if (h > pageH - 20) { h = pageH - 20; w = h * ratio; }
        doc.addImage(img, 'PNG', (pageW - w) / 2, (pageH - h) / 2, w, h);
        doc.save(`${filename}.pdf`);
        return true;
      } finally { document.body.removeChild(tempDiv); }
    },
    async exportGroupXLSX(idxList, filename) {
      const { default: ExcelJS } = await import('exceljs');
      const gs = this.groupSource;
      const leaderTitle = gs.leaderTitle || '组长';
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('分组表');
      const headers = [leaderTitle, '成员', '备注'];
      // 标题行
      const titleRow = sheet.addRow([filename]);
      sheet.mergeCells(1, 1, 1, headers.length);
      titleRow.eachCell(c => {
        c.font = { bold: true, size: 14 };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
        c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
      titleRow.height = 24;
      let r = 2;
      this.groupObjects(idxList).forEach(g => {
        // 组名行（合并全列）
        sheet.addRow([]);
        sheet.mergeCells(r, 1, r, headers.length);
        const nc = sheet.getCell(r, 1);
        nc.value = g.name;
        nc.font = { bold: true };
        nc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
        nc.alignment = { horizontal: 'left', vertical: 'middle' };
        for (let col = 1; col <= headers.length; col++) sheet.getCell(r, col).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        sheet.getRow(r).height = 20;
        r++;
        // 表头行
        const headRow = sheet.addRow(headers);
        headRow.eachCell(c => {
          c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
          c.alignment = { horizontal: 'center' };
          c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
        r++;
        // 组长行 + 成员行
        (g.members || []).forEach((m, mi) => {
          const row = sheet.addRow([mi === 0 ? leaderTitle : '', m.member_name || '', m.remark || '']);
          row.eachCell(c => {
            c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
          });
          if (mi === 0) sheet.getCell(r, 1).font = { bold: true };
          r++;
        });
        r++; // 空行分隔
      });
      for (let i = 1; i <= headers.length; i++) sheet.getColumn(i).width = 20;
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      return await this.saveFileWithDialog(`${filename}.xlsx`, blob);
    },

    // ==================== XLSX ====================
    async exportXLSX(rows, fields, filename) {
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sheet1');
      const headers = fields.map(f => f.name);
      const isSchedule = this.isScheduleData(rows);
      const periodCol = headers.indexOf('时段') + 1;

      // 标题行
      const titleRow = sheet.addRow([filename]);
      sheet.mergeCells(1, 1, 1, headers.length);
      titleRow.height = 24;
      titleRow.eachCell(cell => {
        cell.font = { bold: true, size: 14, color: { argb: 'FF000000' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      // 表头行
      const headerRow = sheet.addRow(headers);
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
        cell.alignment = { horizontal: 'center' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      let currentRow = headerRow.number + 1;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // ---------- 讲台行处理 ----------
        if (row._isPodium) {
          const isRowNumTable = this.isPodiumRowWithRowNum(row, headers);
          const rowData = new Array(headers.length).fill('');
          if (isRowNumTable) {
            rowData[0] = '讲台';
          } else {
            rowData[0] = '讲  台';
          }
          const podiumRow = sheet.addRow(rowData);
          podiumRow.height = 20;

          if (isRowNumTable && headers.length > 1) {
            // 第一列（行号）：绿色背景白色文字
            const numCell = sheet.getCell(currentRow, 1);
            numCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            numCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
            numCell.alignment = { horizontal: 'center', vertical: 'middle' };
            numCell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            // 合并其余列
            sheet.mergeCells(currentRow, 2, currentRow, headers.length);
            const mergedCell = sheet.getCell(currentRow, 2);
            mergedCell.value = '讲  台';
            mergedCell.font = { bold: true, color: { argb: 'FF000000' } };
            mergedCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
            mergedCell.alignment = { horizontal: 'center', vertical: 'middle' };
            for (let col = 2; col <= headers.length; col++) {
              const cell = sheet.getCell(currentRow, col);
              cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            }
          } else {
            // 整行合并
            sheet.mergeCells(currentRow, 1, currentRow, headers.length);
            const cell = sheet.getCell(currentRow, 1);
            cell.value = '讲  台';
            cell.font = { bold: true, color: { argb: 'FF000000' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            podiumRow.eachCell(c => {
              c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            });
          }
          currentRow++;
          continue;
        }

        if (row.type === 'globalRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          const data = new Array(headers.length).fill('');
          const mergeRow = sheet.addRow(data);
          mergeRow.height = 20;
          sheet.mergeCells(currentRow, 1, currentRow, headers.length);
          const cell = mergeRow.getCell(1);
          cell.value = displayText;
          mergeRow.eachCell(cell => {
            cell.font = { bold: true, color: { argb: 'FF000000' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          });
          currentRow++;
        } else if (row.type === 'innerRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          const data = new Array(headers.length).fill('');
          const mergeRow = sheet.addRow(data);
          mergeRow.height = 20;
          if (periodCol > 1) {
            const startCol = periodCol + 1;
            sheet.mergeCells(currentRow, startCol, currentRow, headers.length);
            const cell = sheet.getCell(currentRow, startCol);
            cell.value = displayText;
          } else {
            sheet.mergeCells(currentRow, 1, currentRow, headers.length);
            const cell = mergeRow.getCell(1);
            cell.value = displayText;
          }
          mergeRow.eachCell((cell, colNumber) => {
            if (periodCol > 1 && colNumber === periodCol) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
              cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
              return;
            }
            cell.font = { bold: true, color: { argb: 'FF000000' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          });
          currentRow++;
        } else {
          // 普通行或座位行
          const rowData = headers.map((h, colIdx) => {
            const val = row[h] !== undefined ? row[h] : '';
            return val;
          });
          const dataRow = sheet.addRow(rowData);
          dataRow.eachCell((cell, colNumber) => {
            const headerName = headers[colNumber - 1];
            // 设置边框和对齐
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            // 行号列样式
            if (this.isRowNumColumn(headerName)) {
              cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
            } else if (this.isAisleColumn(headerName)) {
              cell.font = { color: { argb: 'FF000000' } };
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }; // 灰色
            } else {
              // 普通单元格保持默认白色背景
              cell.font = { color: { argb: 'FF000000' } };
            }
          });

          // 课程表时段列竖向合并（如果是课程表数据）
          if (isSchedule && periodCol > 1 && row._rowSpan > 1 && row._isFirstInBlock) {
            sheet.mergeCells(currentRow, periodCol, currentRow + row._rowSpan - 1, periodCol);
            for (let j = 1; j < row._rowSpan; j++) {
              sheet.getCell(currentRow + j, periodCol).border = {
                top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
              };
            }
          }
          currentRow++;
        }
      }

      // 列宽
      for (let i = 1; i <= headers.length; i++) {
        let maxLen = headers[i - 1].length;
        rows.forEach(row => {
          if (row._isPodium) return;
          if (row.type !== 'globalRest' && row.type !== 'innerRest') {
            const val = row[headers[i - 1]] || '';
            let charLen = 0;
            for (const ch of String(val)) charLen += /[\u4e00-\u9fa5]/.test(ch) ? 2.2 : 1;
            if (charLen > maxLen) maxLen = charLen;
          }
        });
        sheet.getColumn(i).width = Math.max(12, Math.min(maxLen + 6, 50));
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      return await this.saveFileWithDialog(`${filename}.xlsx`, blob);
    },

    // ==================== HTML ====================
    async exportHTMLTable(rows, fields, filename) {
      const headers = fields.map(f => f.name);
      const isSchedule = this.isScheduleData(rows);
      const periodColIdx = headers.indexOf('时段');

      let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${this.escapeHtml(filename)}</title></head><body>
        <h2 style="text-align:center;">${this.escapeHtml(filename)}</h2>
        <table border="2" style="border-collapse:collapse; border-color:black;">
          <thead><tr>${headers.map(h => `<th>${this.escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>`;

      for (const row of rows) {
        // ---------- 讲台行 ----------
        if (row._isPodium) {
          const isRowNumTable = this.isPodiumRowWithRowNum(row, headers);
          html += '<tr>';
          if (isRowNumTable) {
            html += '<td style="text-align:center; font-weight:bold; background-color:#4CAF50; color:white;">讲台</td>';
            if (headers.length > 1) {
              html += `<td colspan="${headers.length - 1}" style="text-align:center; font-weight:bold; background-color:#FFF9C4;">讲  台</td>`;
            }
          } else {
            html += `<td colspan="${headers.length}" style="text-align:center; font-weight:bold; background-color:#FFF9C4;">讲  台</td>`;
          }
          html += '</tr>';
          continue;
        }

        if (row.type === 'globalRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          html += `<tr><td colspan="${headers.length}" style="text-align:center; font-weight:bold; background-color:#D9D9D9;">${this.escapeHtml(displayText)}</td></tr>`;
        } else if (row.type === 'innerRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          html += '<tr>';
          if (periodColIdx >= 0) {
            const remainingCols = headers.length - periodColIdx - 1;
            html += `<td colspan="${remainingCols}" style="text-align:center; font-weight:bold; background-color:#D9D9D9;">${this.escapeHtml(displayText)}</td>`;
          } else {
            html += `<td colspan="${headers.length}" style="text-align:center; font-weight:bold; background-color:#D9D9D9;">${this.escapeHtml(displayText)}</td>`;
          }
          html += '</tr>';
        } else {
          html += '<tr>';
          for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            const cellVal = row[h] !== undefined ? row[h] : '';
            let style = '';
            if (h === '行号') {
              style = 'text-align:center; font-weight:bold; background-color:#4CAF50; color:white;';
            } else if (h === '走廊') {
              style = 'text-align:center; background-color:#D9D9D9;';
            } else {
              style = 'text-align:center;';
            }
            html += `<td style="${style}">${this.escapeHtml(cellVal)}</td>`;
          }
          html += '</tr>';
        }
      }

      html += '</tbody></table></body></html>';
      const blob = new Blob([html], { type: 'text/html' });
      return await this.saveFileWithDialog(`${filename}.html`, blob);
    },

    // ==================== CSV ====================
    async exportCSV(rows, fields, filename) {
      const headers = fields.map(f => f.name);
      let csv = '\uFEFF' + headers.join(',') + '\n';
      rows.forEach(row => {
        if (row._isPodium) {
          const isRowNumTable = this.isPodiumRowWithRowNum(row, headers);
          if (isRowNumTable) {
            csv += '讲台,讲  台,'.repeat(headers.length - 1).slice(0, -1) + '\n';
          } else {
            csv += '讲台,'.repeat(headers.length).slice(0, -1) + '\n';
          }
          return;
        }
        if (row.type === 'globalRest' || row.type === 'innerRest') return;
        const line = headers.map(h => {
          const v = row[h] !== undefined ? row[h] : '';
          const str = v == null ? '' : String(v);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(',');
        csv += line + '\n';
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      return await this.saveFileWithDialog(`${filename}.csv`, blob);
    },

    // ==================== Markdown ====================
    // 单元格转义：管道符会破坏表格结构，反斜杠先转义，换行转为 <br>
    mdEscape(v) {
      const s = v == null ? '' : String(v);
      return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    },
    buildMarkdown(headers, bodyRows, filename) {
      const rowLine = cells => `| ${cells.map(c => this.mdEscape(c)).join(' | ')} |`;
      const lines = [
        `# ${this.mdEscape(filename)}`,
        '',
        rowLine(headers),
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...bodyRows.map(rowLine)
      ];
      return lines.join('\n') + '\n';
    },
    // 将 rows+fields 规整为 { headers, bodyRows }（bodyRows 为「数组的数组」），供 md/txt/json 复用
    buildTableArrays(rows, fields) {
      const headers = fields.map(f => f.name);
      const isSchedule = this.isScheduleData(rows);
      const bodyRows = [];
      for (const row of rows) {
        // ---------- 讲台行 ----------
        if (row._isPodium) {
          const isRowNumTable = this.isPodiumRowWithRowNum(row, headers);
          const arr = new Array(headers.length).fill('');
          if (isRowNumTable && headers.length > 1) {
            arr[0] = '讲台';
            arr[1] = '讲  台';
          } else {
            arr[0] = '讲  台';
          }
          bodyRows.push(arr);
          continue;
        }
        // ---------- 全局 / 内部休息行 ----------
        if (row.type === 'globalRest' || row.type === 'innerRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          const arr = new Array(headers.length).fill('');
          arr[0] = displayText;
          bodyRows.push(arr);
          continue;
        }
        // ---------- 普通行 ----------
        const arr = headers.map(h => {
          if (isSchedule && h === '时段') {
            if (row._rowSpan > 1 && row._isFirstInBlock) return SECTION_NAMES[row.section] || '';
            if (row._rowSpan === 0) return '';
          }
          return row[h] !== undefined ? row[h] : '';
        });
        bodyRows.push(arr);
      }
      return { headers, bodyRows };
    },
    async exportMD(rows, fields, filename) {
      const { headers, bodyRows } = this.buildTableArrays(rows, fields);
      const md = this.buildMarkdown(headers, bodyRows, filename);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
      return await this.saveFileWithDialog(`${filename}.md`, blob);
    },

    // ==================== 纯文本 (TXT) ====================
    // Tab 分隔，去掉单元格内的 Tab/换行以免破坏列对齐
    buildTxt(headers, bodyRows) {
      const line = cells => cells.map(c => String(c == null ? '' : c).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t');
      return [line(headers), ...bodyRows.map(line)].join('\r\n') + '\r\n';
    },
    async exportTXT(rows, fields, filename) {
      const { headers, bodyRows } = this.buildTableArrays(rows, fields);
      const txt = this.buildTxt(headers, bodyRows);
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' });
      return await this.saveFileWithDialog(`${filename}.txt`, blob);
    },

    // ==================== JSON ====================
    // 以表头为键的对象数组，便于程序化处理/再导入
    buildJson(headers, bodyRows) {
      const data = bodyRows.map(arr => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = arr[i] === undefined || arr[i] === null ? '' : arr[i]; });
        return obj;
      });
      return JSON.stringify(data, null, 2) + '\n';
    },
    async exportJSON(rows, fields, filename) {
      const { headers, bodyRows } = this.buildTableArrays(rows, fields);
      const json = this.buildJson(headers, bodyRows);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
      return await this.saveFileWithDialog(`${filename}.json`, blob);
    },

    // ==================== 图片 ====================
    async exportImage(rows, fields, filename) {
      const { default: html2canvas } = await import('html2canvas');
      const el = this.tableElement instanceof Element ? this.tableElement : null;
      if (el && el.offsetParent !== null) {
        try {
          const canvas = await html2canvas(el, { scale: 2 });
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (blob) return await this.saveFileWithDialog(`${filename}.png`, blob);
        } catch (e) {}
      }

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = this.buildHTMLString(rows, fields, filename);
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      document.body.appendChild(tempDiv);
      const canvas = await html2canvas(tempDiv, { scale: 2 });
      document.body.removeChild(tempDiv);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      return await this.saveFileWithDialog(`${filename}.png`, blob);
    },

    escapeHtml(str) {
      const s = str == null ? '' : String(str);
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    },

    buildHTMLString(rows, fields, filename) {
      const headers = fields.map(f => f.name);
      const isSchedule = this.isScheduleData(rows);
      const periodColIdx = headers.indexOf('时段');

      let html = `<div style="text-align:center; font-size:20px; font-weight:bold; margin-bottom:12px;">${this.escapeHtml(filename)}</div>
        <table style="border-collapse:collapse; margin:0 auto;">
          <thead><tr style="background-color:#4CAF50; color:white;">
            ${headers.map(h => `<th style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle;">${this.escapeHtml(h)}</th>`).join('')}
          </tr></thead><tbody>`;

      for (const row of rows) {
        // ---------- 讲台行 ----------
        if (row._isPodium) {
          const isRowNumTable = this.isPodiumRowWithRowNum(row, headers);
          html += '<tr>';
          if (isRowNumTable) {
            html += '<td style="border:1px solid #ccc; padding:6px 12px; text-align:center; font-weight:bold; background-color:#4CAF50; color:white;">讲台</td>';
            if (headers.length > 1) {
              html += `<td colspan="${headers.length - 1}" style="border:1px solid #ccc; padding:6px 12px; text-align:center; font-weight:bold; background-color:#FFF9C4;">讲  台</td>`;
            }
          } else {
            html += `<td colspan="${headers.length}" style="border:1px solid #ccc; padding:6px 12px; text-align:center; font-weight:bold; background-color:#FFF9C4;">讲  台</td>`;
          }
          html += '</tr>';
          continue;
        }

        if (row.type === 'globalRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          html += `<tr><td colspan="${headers.length}" style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle; font-weight:bold; background-color:#D9D9D9;">${this.escapeHtml(displayText)}</td></tr>`;
        } else if (row.type === 'innerRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          html += '<tr>';
          if (periodColIdx >= 0) {
            const remainingCols = headers.length - periodColIdx - 1;
            html += `<td colspan="${remainingCols}" style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle; font-weight:bold; background-color:#D9D9D9;">${this.escapeHtml(displayText)}</td>`;
          } else {
            html += `<td colspan="${headers.length}" style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle; font-weight:bold; background-color:#D9D9D9;">${this.escapeHtml(displayText)}</td>`;
          }
          html += '</tr>';
        } else {
          html += '<tr>';
          for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            const cellVal = row[h] !== undefined ? row[h] : '';
            let style = 'border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle;';
            if (h === '行号') {
              style += ' background-color:#4CAF50; color:white; font-weight:bold;';
            } else if (h === '走廊') {
              style += ' background-color:#D9D9D9;';
            }
            html += `<td style="${style}">${this.escapeHtml(cellVal)}</td>`;
          }
          html += '</tr>';
        }
      }

      html += '</tbody></table>';
      return html;
    },

    // ==================== PDF ====================
    async exportPDF(rows, fields, filename) {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      let fontLoaded = false;
      try {
        // 字体以 gzip 形式随包分发（原始 12.75MB → 8MB），运行时解压得到完整未子集化的 TTF。
        // 关键坑：服务器是否已自动解压并不一致——
        //   · 打包版 app:// 协议原样返回 gzip 字节，需自行解压；
        //   · Vite dev 会把 .gz 当预压缩资源，带 Content-Encoding: gzip，浏览器已透明解压（拿到的是原始 TTF）。
        // 因此不能无条件 pipeThrough(DecompressionStream)，必须先按 gzip 魔数 1F 8B 判断，两种情形都能用。
        // （另：Chromium 的 DecompressionStream 只支持 gzip/deflate，不支持 'zstd'，别改回 zstd，否则字体加载失败、中文退化乱码。）
        const response = await fetch('/NotoSansSC-6.ttf.gz');
        if (!response.ok) throw new Error('字体文件加载失败');
        let bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
          bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        }
        const fontBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(new Blob([bytes]));
        });
        doc.addFileToVFS('NotoSansSC.ttf', fontBase64);
        doc.addFont('NotoSansSC.ttf', 'NotoSansSC', 'normal');
        doc.addFont('NotoSansSC.ttf', 'NotoSansSC', 'bold');
        fontLoaded = true;
      } catch (e) {
        console.warn('中文字体加载失败:', e);
      }

      const pdfFont = fontLoaded ? 'NotoSansSC' : 'helvetica';
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(16);
      doc.setFont(pdfFont, 'normal');
      doc.text(filename, pageWidth / 2, 15, { align: 'center' });

      const headers = fields.map(f => f.name);
      const isSchedule = this.isScheduleData(rows);
      const periodColIdx = headers.indexOf('时段');

      const body = [];
      for (const row of rows) {
        // ---------- 讲台行 ----------
        if (row._isPodium) {
          const isRowNumTable = this.isPodiumRowWithRowNum(row, headers);
          const arr = new Array(headers.length).fill('');
          if (isRowNumTable) {
            arr[0] = '讲台';
            arr._rowNumStyle = true;
            if (headers.length > 1) arr[1] = '讲  台';
            arr._merge = true;
            arr._mergeType = 'podium';
            arr._startIdx = 1;
          } else {
            arr[0] = '讲  台';
            arr._merge = true;
            arr._mergeType = 'podium';
            arr._startIdx = 0;
          }
          body.push(arr);
          continue;
        }

        if (row.type === 'globalRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          const arr = new Array(headers.length).fill('');
          arr[0] = displayText;
          arr._merge = true;
          arr._mergeType = 'global';
          body.push(arr);
        } else if (row.type === 'innerRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          const arr = new Array(headers.length).fill('');
          if (periodColIdx >= 0) {
            const startIdx = periodColIdx + 1;
            arr[startIdx] = displayText;
            arr._merge = true;
            arr._mergeType = 'inner';
            arr._startIdx = startIdx;
          } else {
            arr[0] = displayText;
            arr._merge = true;
            arr._mergeType = 'global';
          }
          body.push(arr);
        } else {
          const arr = headers.map(h => {
            if (isSchedule && h === '时段') {
              if (row._rowSpan > 1 && row._isFirstInBlock) {
                return SECTION_NAMES[row.section] || '';
              } else if (row._rowSpan === 0) {
                return '';
              }
            }
            return row[h] !== undefined ? row[h] : '';
          });
          arr._rowNumStyle = true; // 用于标记行号列样式
          arr._schedule = isSchedule; // 课程表标记
          body.push(arr);
        }
      }

      autoTable(doc, {
        startY: 25,
        head: [headers],
        body: body,
        theme: 'plain',
        styles: {
          font: pdfFont,
          fontStyle: 'normal',
          fontSize: 8,
          cellPadding: 1,
          halign: 'center',
          lineColor: [0, 0, 0],
          lineWidth: 0.1
        },
        headStyles: {
          font: pdfFont,
          fontStyle: 'normal',
          fillColor: [76, 175, 80],
          textColor: 255,
          halign: 'center',
          lineWidth: 0.1
        },
        didParseCell: function (data) {
          const rowArr = data.row.raw;
          if (!rowArr) return;

          data.cell.styles.font = pdfFont;
          data.cell.styles.halign = 'center';
          data.cell.styles.valign = 'middle';

          // 讲台行
          if (rowArr._mergeType === 'podium') {
            if (rowArr._rowNumStyle && data.column.index === 0) {
              data.cell.styles.fillColor = [76, 175, 80];
              data.cell.styles.textColor = 255;
              data.cell.styles.fontStyle = 'bold';
              return;
            }
            data.cell.styles.fillColor = [255, 249, 196];
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = [0, 0, 0];
            if (rowArr._startIdx === 0) {
              if (data.column.index === 0) {
                data.cell.colSpan = headers.length;
              } else {
                data.cell.text = [''];
              }
            } else {
              if (data.column.index === rowArr._startIdx) {
                data.cell.colSpan = headers.length - rowArr._startIdx;
              } else if (data.column.index > rowArr._startIdx) {
                data.cell.text = [''];
              }
            }
            return;
          }

          // 全局/内部休息行
          if (rowArr._merge) {
            data.cell.styles.fillColor = [217, 217, 217];
            data.cell.styles.fontStyle = 'bold';
            if (rowArr._mergeType === 'global') {
              if (data.column.index === 0) {
                data.cell.colSpan = headers.length;
              } else {
                data.cell.text = [''];
              }
            } else if (rowArr._mergeType === 'inner') {
              if (data.column.index === rowArr._startIdx) {
                data.cell.colSpan = headers.length - rowArr._startIdx;
              } else if (data.column.index > rowArr._startIdx) {
                data.cell.text = [''];
              }
            }
            return;
          }

          // 普通行：根据列头设置样式
          const headerName = headers[data.column.index];
          if (headerName === '行号') {
            data.cell.styles.fillColor = [76, 175, 80];
            data.cell.styles.textColor = 255;
            data.cell.styles.fontStyle = 'bold';
          } else if (headerName === '走廊') {
            data.cell.styles.fillColor = [217, 217, 217];
          } else {
            data.cell.styles.textColor = [0, 0, 0];
          }

          // 课程表时段列竖向合并
          if (rowArr._schedule && periodColIdx >= 0 && data.column.index === periodColIdx) {
            if (rowArr._rowSpan > 1 && rowArr._isFirstInBlock) {
              data.cell.rowSpan = rowArr._rowSpan;
              data.cell.styles.fillColor = [232, 245, 233];
              data.cell.styles.fontStyle = 'bold';
            } else if (rowArr._rowSpan === 0) {
              data.cell.text = [''];
              data.cell.styles.fillColor = [232, 245, 233];
            }
          }
        }
      });

      const blob = doc.output('blob');
      return await this.saveFileWithDialog(`${filename}.pdf`, blob);
    }
  }
};
</script>

<style scoped>
/* 文件名输入框：聚焦时显示与登录框一致的蓝色边缘，白色高亮带过渡 */
.filename-input {
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.filename-input:focus {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.28) !important;
  outline: none;
  background-color: rgba(255, 255, 255, 0.98) !important;
}
</style>