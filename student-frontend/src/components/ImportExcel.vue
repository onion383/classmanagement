<template>
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]">
    <div class="bg-surface p-5 rounded-lg w-[900px] max-h-[85vh] flex flex-col shadow-card">
      <h3 class="text-lg font-bold mb-3">从文件导入数据</h3>
      <!-- 文件选择 -->
      <div class="mb-4 flex items-center gap-3">
        <input type="file" accept=".xlsx,.xls,.csv" @change="handleFile" ref="fileInput" class="text-sm" />
        <span v-if="fileName" class="text-sm text-text-secondary">{{ fileName }}</span>
        <button @click="parseFile" :disabled="!fileData" class="bg-info text-text-inverse px-3 py-1 rounded text-sm">解析预览</button>
      </div>
      <div v-if="parseError" class="text-danger text-sm mb-2">{{ parseError }}</div>
      <div v-if="filteredCount > 0" class="text-warning text-sm mb-2">由于缺少受保护字段，已过滤 {{ filteredCount }} 条数据。</div>
      <!-- 预览表格 -->
      <div class="flex-1 overflow-auto border border-border rounded" v-if="previewFields.length && previewRows.length">
        <DynamicTable
          :fields="previewFields"
          :rows="previewRows"
          :editingCell="editingCell"
          @startEdit="startEditCell"
          @saveCell="saveCell"
          @deleteRow="deletePreviewRow"
          @toggleSort="toggleSort"
          :sortField="sortField"
          :sortOrder="sortOrder"
        />
      </div>
      <div v-else class="text-center py-6 text-text-muted">请选择一个文件并点击“解析预览”</div>
      <!-- 底部按钮 -->
      <div class="flex justify-between items-center mt-4">
        <span class="text-sm text-text-secondary">共 {{ previewRows.length }} 行</span>
        <div class="flex gap-2">
          <button @click="cancel" class="bg-surface-hover px-4 py-1.5 rounded text-text">取消</button>
          <button @click="confirmImport" :disabled="previewRows.length === 0" class="bg-primary text-text-inverse px-4 py-1.5 rounded">导入并合并保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import DynamicTable from './DynamicTable.vue';

export default {
  name: 'ImportExcel',
  components: { DynamicTable },
  props: {
    visible: Boolean,
    existingFields: { type: Array, default: () => [] },
    requiredFields: { type: Array, default: () => ['收支编码'] }
  },
  emits: ['import-data', 'cancel'],
  data() {
    return {
      fileData: null,
      fileName: '',
      parseError: '',
      filteredCount: 0,
      previewFields: [],
      previewRows: [],
      editingCell: null,
      sortField: '',
      sortOrder: 'asc',
      rowKeyCounter: 0
    };
  },
  methods: {
    handleFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      this.fileName = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => { this.fileData = new Uint8Array(ev.target.result); };
      reader.readAsArrayBuffer(file);
    },
    async parseFile() {
      if (!this.fileData) return;
      this.parseError = '';
      this.filteredCount = 0;
      // 大依赖 xlsx（SheetJS）延迟到真正导入文件时才加载，避免随表格页一打开就拖进几 MB 代码
      const XLSX = await import('xlsx');
      try {
        const workbook = XLSX.read(this.fileData, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
        if (!data || data.length === 0) { this.parseError = '文件无有效数据'; return; }
        // 智能提取表头
        let headerRowIndex = -1;
        let headerRow = [];
        for (let i = 0; i < Math.min(data.length, 10); i++) {
          const row = data[i];
          if (row.some(cell => cell !== '' && cell !== null)) {
            if (i + 1 < data.length && data[i + 1].some(c => c !== '')) {
              headerRowIndex = i;
              headerRow = row.map(c => String(c).trim()).filter(h => h.length > 0);
              break;
            }
          }
        }
        if (headerRowIndex === -1) {
          headerRow = data[0].map(c => String(c).trim());
          headerRowIndex = 0;
        }
        const validHeaders = headerRow.filter(h => h !== '');
        if (validHeaders.length === 0) { this.parseError = '未识别到列标题'; return; }
        this.previewFields = validHeaders.map(h => ({ name: h, type: '文字' }));
        const rawRows = data.slice(headerRowIndex + 1).filter(row => row.some(cell => cell !== '' && cell !== null));
        const cleanedRows = [];
        let skipped = 0;
        for (const row of rawRows) {
          const obj = {};
          let missing = false;
          validHeaders.forEach((header, idx) => {
            const val = row[idx] !== undefined ? String(row[idx]).trim() : '';
            obj[header] = val;
          });
          for (const required of this.requiredFields) {
            if (!obj[required] || obj[required].trim() === '') { missing = true; break; }
          }
          if (missing) skipped++;
          else cleanedRows.push(obj);
        }
        this.filteredCount = skipped;
        this.previewRows = cleanedRows.map((row, idx) => ({
          ...row,
          _rowKey: `import_${this.rowKeyCounter++}`,
          _isNew: false,
          _displayIndex: idx + 1
        }));
      } catch (e) { this.parseError = '文件解析失败：' + e.message; }
    },
    startEditCell(row, field) { this.editingCell = { rowKey: row._rowKey, field: field.name }; },
    saveCell(row, field) { this.editingCell = null; },
    toggleSort(fieldName) {
      if (this.sortField === fieldName) this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
      else { this.sortField = fieldName; this.sortOrder = 'asc'; }
      this.previewRows.sort((a, b) => {
        let va = a[fieldName] || '', vb = b[fieldName] || '';
        if (va < vb) return this.sortOrder === 'asc' ? -1 : 1;
        if (va > vb) return this.sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    },
    deletePreviewRow(rowKey) { this.previewRows = this.previewRows.filter(r => r._rowKey !== rowKey); },
    confirmImport() {
      const headers = this.previewFields.map(f => f.name);
      const rows = this.previewRows.map(row => headers.map(h => row[h] ?? ''));
      this.$emit('import-data', { fields: headers, rows });
    },
    cancel() { this.resetState(); this.$emit('cancel'); },
    resetState() {
      this.fileData = null; this.fileName = '';
      this.parseError = ''; this.filteredCount = 0;
      this.previewFields = []; this.previewRows = [];
      this.sortField = '';
    }
  },
  watch: { visible(val) { if (!val) this.resetState(); } }
};
</script>