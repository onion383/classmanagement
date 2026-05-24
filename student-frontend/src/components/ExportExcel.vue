<template>
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]">
    <div class="bg-white p-5 rounded-lg min-w-[400px] max-w-xl">
      <h3 class="text-lg font-bold mb-3">导出选项</h3>

      <div class="mb-4">
        <p class="font-semibold mb-2">选择要导出的列：</p>
        <div class="flex flex-wrap gap-2">
          <label v-for="field in fields" :key="field.name" class="flex items-center gap-1 text-sm">
            <input type="checkbox" :value="field.name" v-model="selectedColumns" />
            {{ field.name }}
          </label>
        </div>
        <p v-if="selectedColumns.length === 0" class="text-red-500 text-sm mt-1">请至少选择一列</p>
      </div>

      <div class="mb-4">
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
        <select v-model="exportFormat" class="border p-2 rounded w-full">
          <option value="html">HTML 表格 (.html)</option>
          <option value="xlsx">Excel (.xlsx) - 带边框</option>
          <option value="csv">CSV (.csv) - 无样式</option>
          <option value="image">图片 (.png)</option>
          <option value="pdf">PDF (.pdf)</option>
        </select>
      </div>

      <div class="mb-4">
        <label class="font-semibold block mb-1">文件名</label>
        <input v-model="filename" class="border p-2 w-full rounded" />
      </div>

      <div class="text-right">
        <button @click="cancel" class="bg-gray-300 border-none px-4 py-1.5 rounded mr-2 cursor-pointer">取消</button>
        <button @click="doExport" class="bg-blue-500 text-white border-none px-4 py-1.5 rounded cursor-pointer" :disabled="selectedColumns.length === 0">导出</button>
      </div>
    </div>
  </div>
</template>

<script>
import ExcelJS from 'exceljs';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import fontUrl from '../assets/fonts/NotoSansSC-6.ttf';

const SECTION_NAMES = { morning: '上午', noon: '中午', afternoon: '下午', evening: '傍晚', night: '晚上' };

export default {
  name: 'ExportExcel',
  props: {
    rows: { type: Array, required: true },
    fields: { type: Array, required: true },
    selectedRowKeys: { type: Array, default: () => [] },
    defaultFilename: { type: String, default: '导出数据' },
    tableElement: { type: Object, default: null }
  },
  emits: ['export-start', 'export-finish', 'export-error'],
  data() {
    return {
      visible: false,
      selectedColumns: [],
      rowMode: 'all',
      exportFormat: 'html',
      filename: ''
    };
  },
  computed: {
    selectedCount() { return this.selectedRowKeys.length; }
  },
  watch: {
    visible(val) {
      if (val) {
        this.selectedColumns = this.fields.map(f => f.name);
        this.rowMode = 'all';
        this.exportFormat = 'html';
        this.filename = this.defaultFilename;
      }
    }
  },
  methods: {
    open() { this.visible = true; this.$emit('export-start'); },
    cancel() { this.visible = false; },
    async doExport() {
      if (this.selectedColumns.length === 0) return;
      let exportRows = [...this.rows];
      if (this.rowMode === 'selected') {
        exportRows = exportRows.filter(r => this.selectedRowKeys.includes(r.id) || this.selectedRowKeys.includes(r._rowKey));
      }
      if (!exportRows.length) { alert('没有数据可以导出'); this.visible = false; return; }

      const selectedFields = this.fields.filter(f => this.selectedColumns.includes(f.name));
      const dateStr = new Date().toISOString().slice(0, 10);
      const finalFilename = `${this.filename}_${dateStr}`;

      try {
        switch (this.exportFormat) {
          case 'csv': this.exportCSV(exportRows, selectedFields, finalFilename); break;
          case 'html': this.exportHTMLTable(exportRows, selectedFields, finalFilename); break;
          case 'xlsx': await this.exportXLSX(exportRows, selectedFields, finalFilename); break;
          case 'image': await this.exportImage(exportRows, selectedFields, finalFilename); break;
          case 'pdf': await this.exportPDF(exportRows, selectedFields, finalFilename); break;
          default: this.exportHTMLTable(exportRows, selectedFields, finalFilename);
        }
        this.$emit('export-finish');
      } catch (err) {
        console.error('导出失败:', err);
        this.$emit('export-error', err);
      }
      this.visible = false;
    },

    getSectionName(key) {
      return SECTION_NAMES[key] || '';
    },

    // 判断数据是否为课程表类型
    isScheduleData(rows) {
      if (!rows || rows.length === 0) return false;
      return rows.some(r => r.type === 'lesson' || r.type === 'globalRest' || r.type === 'innerRest');
    },

    // 获取单元格值（支持普通表格和课程表）
    getCellValue(row, headerName, headers) {
      if (headerName === '时段') return this.getSectionName(row.section);
      if (headerName === '节次') return row.label || '';
      if (headerName === '时间') return row.time || '';
      // 普通表格：直接读取属性
      if (row[headerName] !== undefined) return row[headerName];
      // 课程表：从 cells 数组读取
      const idx = headers.indexOf(headerName) - 3;
      if (idx >= 0 && row.cells && row.cells[idx]) return row.cells[idx].course || '';
      return '';
    },

    // ==================== XLSX ====================
    async exportXLSX(rows, fields, filename) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sheet1');
      const headers = fields.map(f => f.name);
      const isSchedule = this.isScheduleData(rows);
      const periodCol = headers.indexOf('时段') + 1; // 1-based, 0 if not found

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

        if (row.type === 'globalRest') {
          // 全局休息：整行合并
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
          // 内部休息：时段列保持被合并状态（不写入值），右侧合并显示休息文字
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          const data = new Array(headers.length).fill('');
          const mergeRow = sheet.addRow(data);
          mergeRow.height = 20;

          if (periodCol > 1) {
            // 时段列存在：时段列留空（保持竖向合并），从节次列开始合并到末尾
            const startCol = periodCol + 1; // 节次列
            sheet.mergeCells(currentRow, startCol, currentRow, headers.length);
            const cell = sheet.getCell(currentRow, startCol);
            cell.value = displayText;
          } else {
            // 无时段列：整行合并
            sheet.mergeCells(currentRow, 1, currentRow, headers.length);
            const cell = mergeRow.getCell(1);
            cell.value = displayText;
          }

          mergeRow.eachCell((cell, colNumber) => {
            if (periodCol > 1 && colNumber === periodCol) {
              // 时段列：加边框和浅绿色背景，与被合并的时段列保持一致
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
          // 普通行或正课行
          const rowData = headers.map(h => this.getCellValue(row, h, headers));
          const dataRow = sheet.addRow(rowData);
          dataRow.eachCell(cell => {
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            cell.alignment = { horizontal: 'center' };
          });

          // 竖向合并时段列（只合并连续正课行）
          if (isSchedule && periodCol > 1 && row._rowSpan > 1 && row._isFirstInBlock) {
            sheet.mergeCells(currentRow, periodCol, currentRow + row._rowSpan - 1, periodCol);
            // 为被合并的单元格加边框（后续行）
            for (let j = 1; j < row._rowSpan; j++) {
              sheet.getCell(currentRow + j, periodCol).border = {
                top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
              };
            }
          }
          currentRow++;
        }
      }

      // 自动调整列宽
      for (let i = 1; i <= headers.length; i++) {
        let maxLen = headers[i - 1].length;
        rows.forEach(row => {
          if (row.type !== 'globalRest' && row.type !== 'innerRest') {
            const val = this.getCellValue(row, headers[i - 1], headers) || '';
            let charLen = 0;
            for (const ch of String(val)) charLen += /[\u4e00-\u9fa5]/.test(ch) ? 2.2 : 1;
            if (charLen > maxLen) maxLen = charLen;
          }
        });
        sheet.getColumn(i).width = Math.max(12, Math.min(maxLen + 6, 50));
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    },

    // ==================== HTML ====================
    exportHTMLTable(rows, fields, filename) {
      const headers = fields.map(f => f.name);
      const isSchedule = this.isScheduleData(rows);
      const periodColIdx = headers.indexOf('时段'); // 0-based, -1 if not found

      let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${filename}</title></head><body>
        <h2 style="text-align:center;">${filename}</h2>
        <table border="2" style="border-collapse:collapse; border-color:black;">
          <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`;

      for (const row of rows) {
        if (row.type === 'globalRest') {
          // 全局休息：整行合并
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          html += `<tr><td colspan="${headers.length}" style="text-align:center; font-weight:bold; background-color:#D9D9D9;">${displayText}</td></tr>`;
        } else if (row.type === 'innerRest') {
          // 内部休息：时段列被正课行的rowspan占用，不输出时段列td，从节次列开始合并
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          html += '<tr>';
          if (periodColIdx >= 0) {
            // 时段列被rowspan占用，跳过；从节次列开始合并到末尾
            const remainingCols = headers.length - periodColIdx - 1;
            html += `<td colspan="${remainingCols}" style="text-align:center; font-weight:bold; background-color:#D9D9D9;">${displayText}</td>`;
          } else {
            html += `<td colspan="${headers.length}" style="text-align:center; font-weight:bold; background-color:#D9D9D9;">${displayText}</td>`;
          }
          html += '</tr>';
        } else {
          // 普通行或正课行
          html += '<tr>';
          for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            if (isSchedule && h === '时段') {
              if (row._rowSpan > 1 && row._isFirstInBlock) {
                html += `<td rowspan="${row._rowSpan}" style="text-align:center; vertical-align:middle; font-weight:bold; background-color:#E8F5E9;">${SECTION_NAMES[row.section] || ''}</td>`;
              } else if (row._rowSpan === 0) {
                // 被合并的单元格：跳过不输出（rowspan由第一行处理）
              } else {
                html += `<td style="text-align:center;">${this.getCellValue(row, h, headers) || ''}</td>`;
              }
            } else {
              html += `<td style="text-align:center;">${this.getCellValue(row, h, headers) || ''}</td>`;
            }
          }
          html += '</tr>';
        }
      }

      html += '</tbody></table></body></html>';
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.html`;
      a.click();
      URL.revokeObjectURL(url);
    },

    // ==================== CSV ====================
    exportCSV(rows, fields, filename) {
      const headers = fields.map(f => f.name);
      let csv = '\uFEFF' + headers.join(',') + '\n'; // BOM for Excel UTF-8
      rows.forEach(row => {
        if (row.type === 'globalRest' || row.type === 'innerRest') return;
        const line = headers.map(h => {
          const v = this.getCellValue(row, h, headers);
          const str = v == null ? '' : String(v);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(',');
        csv += line + '\n';
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },

    // ==================== 图片 ====================
    async exportImage(rows, fields, filename) {
      const el = this.tableElement instanceof Element ? this.tableElement : null;
      if (el && el.offsetParent !== null) {
        try {
          const canvas = await html2canvas(el, { scale: 2 });
          const link = document.createElement('a');
          link.download = `${filename}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
          return;
        } catch (e) {}
      }

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = this.buildHTMLString(rows, fields, filename);
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      document.body.appendChild(tempDiv);
      const canvas = await html2canvas(tempDiv, { scale: 2 });
      document.body.removeChild(tempDiv);
      const link = document.createElement('a');
      link.download = `${filename}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    },

    buildHTMLString(rows, fields, filename) {
      const headers = fields.map(f => f.name);
      const isSchedule = this.isScheduleData(rows);
      const periodColIdx = headers.indexOf('时段');

      let html = `<div style="text-align:center; font-size:20px; font-weight:bold; margin-bottom:10px;">${filename}</div>
        <table style="border-collapse:collapse; margin:0 auto;">
          <thead><tr style="background-color:#4CAF50; color:white;">
            ${headers.map(h => `<th style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle;">${h}</th>`).join('')}
          </tr></thead><tbody>`;

      for (const row of rows) {
        if (row.type === 'globalRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          html += `<tr><td colspan="${headers.length}" style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle; font-weight:bold; background-color:#D9D9D9;">${displayText}</td></tr>`;
        } else if (row.type === 'innerRest') {
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          html += '<tr>';
          if (periodColIdx >= 0) {
            // 时段列被rowspan占用，跳过；从节次列开始合并到末尾
            const remainingCols = headers.length - periodColIdx - 1;
            html += `<td colspan="${remainingCols}" style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle; font-weight:bold; background-color:#D9D9D9;">${displayText}</td>`;
          } else {
            html += `<td colspan="${headers.length}" style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle; font-weight:bold; background-color:#D9D9D9;">${displayText}</td>`;
          }
          html += '</tr>';
        } else {
          html += '<tr>';
          for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            if (isSchedule && h === '时段') {
              if (row._rowSpan > 1 && row._isFirstInBlock) {
                html += `<td rowspan="${row._rowSpan}" style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle; font-weight:bold; background-color:#E8F5E9;">${SECTION_NAMES[row.section] || ''}</td>`;
              } else if (row._rowSpan === 0) {
                // skip
              } else {
                html += `<td style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle;">${this.getCellValue(row, h, headers) || ''}</td>`;
              }
            } else {
              html += `<td style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle;">${this.getCellValue(row, h, headers) || ''}</td>`;
            }
          }
          html += '</tr>';
        }
      }

      html += '</tbody></table>';
      return html;
    },

    // ==================== PDF ====================
    async exportPDF(rows, fields, filename) {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      let fontLoaded = false;
      try {
        const response = await fetch(fontUrl);
        if (!response.ok) throw new Error('字体文件加载失败');
        const blob = await response.blob();
        const fontBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
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

      // 构建 body：每行是一个数组，与 headers 一一对应
      const body = [];
      for (const row of rows) {
        if (row.type === 'globalRest') {
          // 全局休息：第一列显示文字，其余为空，通过 didParseCell 合并
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          const arr = new Array(headers.length).fill('');
          arr[0] = displayText;
          arr._merge = true;
          arr._mergeType = 'global';
          body.push(arr);
        } else if (row.type === 'innerRest') {
          // 内部休息
          const displayText = row.label ? `${row.label} ${row.time}` : '';
          const arr = new Array(headers.length).fill('');
          if (periodColIdx >= 0) {
            // 时段列留空（保持合并），从节次列开始显示
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
          // 普通行或正课行
          const arr = headers.map(h => {
            if (isSchedule && h === '时段') {
              if (row._rowSpan > 1 && row._isFirstInBlock) {
                return SECTION_NAMES[row.section] || '';
              } else if (row._rowSpan === 0) {
                return ''; // 被合并的单元格
              }
            }
            return this.getCellValue(row, h, headers) || '';
          });
          arr._rowSpan = row._rowSpan;
          arr._isFirstInBlock = row._isFirstInBlock;
          arr._section = row.section;
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

          // 确保所有单元格使用正确的中文字体，并强制水平和垂直居中
          data.cell.styles.font = pdfFont;
          data.cell.styles.halign = 'center';
          data.cell.styles.valign = 'middle';

          // 处理合并行（globalRest / innerRest）
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
              // periodColIdx 的单元格保持原样（空）
            }
            return;
          }

          // 处理时段列的竖向合并
          if (isSchedule && periodColIdx >= 0 && data.column.index === periodColIdx) {
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

      doc.save(`${filename}.pdf`);
    }
  }
};
</script>
