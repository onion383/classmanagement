<template>
  <!-- Teleport 到 body：避免固定定位遮罩被 main 橡皮筋滚动的 transform 约束，保证全屏覆盖侧边栏 -->
  <Teleport to="body">
  <Transition name="dialog">
    <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]">
      <div class="bg-surface p-5 rounded-lg w-[900px] max-h-[85vh] flex flex-col shadow-card dialog-card">
      <h3 class="text-lg font-bold mb-3">从文件导入数据</h3>
      <!-- 文件选择：点击或拖入均可，选中后显示文件名 + 关闭按钮 -->
      <div class="mb-4">
        <div
          v-if="!fileName"
          @click="triggerFileSelect"
          @dragover.prevent
          @dragenter.prevent="dragOver = true"
          @dragleave.prevent="dragOver = false"
          @drop.prevent="onFileDrop"
          class="dropzone flex items-center justify-center gap-2 h-20 cursor-pointer select-none border-2 border-dashed rounded-xl text-inverse"
          :class=" dragOver ? 'dropzone-active' : ''"
        >
          <span class="text-sm">点击选择文件，或将文件拖到此处</span>
        </div>
        <div
          v-else
          class="dropzone flex items-center justify-between px-4 h-12 rounded-xl border"
        >
          <span class="text-sm text-text-secondary truncate flex-1 mr-2">{{ fileName }}</span>
          <button @click="resetFile" class="text-text-muted hover:text-danger cursor-pointer select-none" title="移除文件">✕</button>
        </div>
        <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" class="hidden" @change="handleFile" />
      </div>
      <div v-if="parseError" class="text-danger text-sm mb-2">{{ parseError }}</div>
      <div v-if="filteredCount > 0" class="text-text-secondary text-sm mb-2">由于缺少受保护字段，已过滤 {{ filteredCount }} 条数据。</div>
      <!-- 预览表格 -->
      <div class="flex-1 overflow-auto border border-border rounded" v-if="previewFields.length && previewRows.length">
        <DynamicTable
          :fields="previewFields"
          :rows="previewRows"
          emptyActionText=""
          hideEditButton
          :editingCell="editingCell"
          @startEdit="startEditCell"
          @saveCell="saveCell"
          @deleteRow="deletePreviewRow"
          @toggleSort="toggleSort"
          :sortField="sortField"
          :sortOrder="sortOrder"
        />
      </div>
      <div v-else class="text-center py-6 text-text-secondary">请选择一个文件进行解析</div>
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
  </Transition>
  </Teleport>
</template>

<script>
import DynamicTable from '../tables/DynamicTable/DynamicTable.vue';
import { parseSheet } from '../../utils/importSheet.js';
import '../../styles/dialog-transition.css';

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
      rowKeyCounter: 0,
      dragOver: false
    };
  },
  methods: {
    triggerFileSelect() { this.$refs.fileInput.click(); },
    onFileDrop(e) {
      this.dragOver = false;
      const file = e.dataTransfer.files[0];
      if (!file) return;
      this.handleFile({ target: { files: [file] } });
    },
    resetFile() {
      this.fileName = '';
      this.fileData = null;
      this.parseError = '';
      this.filteredCount = 0;
      this.previewFields = [];
      this.previewRows = [];
      this.editingCell = null;
      this.sortField = '';
      this.sortOrder = 'asc';
      // 清空 file input，保证同一文件可再次选择
      if (this.$refs.fileInput) this.$refs.fileInput.value = '';
    },
    handleFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      // 大小上限：超大文件会让 xlsx 解析长时间卡死甚至内存暴涨，超过 10MB 直接拒绝
      if (file.size > 10 * 1024 * 1024) {
        this.resetFile();
        this.fileName = file.name;
        this.parseError = '文件过大，请选择 10MB 以内的表格文件';
        return;
      }
      this.fileName = file.name;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        this.fileData = new Uint8Array(ev.target.result);
        // 选中文件后自动解析预览，无需再点击「解析预览」
        await this.parseFile();
      };
      // 读盘失败（文件被移动/权限不足/设备断开）时必须给出提示，
      // 否则界面停在「请选择一个文件进行解析」，用户以为是自己没选中文件
      reader.onerror = () => {
        this.fileData = null;
        this.parseError = '文件读取失败，请重新选择文件';
      };
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
        // 表头识别与行映射抽到 utils/importSheet.js：
        // 表头保留原始列下标，空表头只跳过自己，不会让它右边的列整体左移（串列）
        const parsed = parseSheet(data, this.requiredFields);
        if (parsed.fields.length === 0) { this.parseError = '未识别到列标题'; return; }
        this.previewFields = parsed.fields.map(h => ({ name: h, type: '文字' }));
        this.filteredCount = parsed.skipped;
        this.previewRows = parsed.rows.map((row, idx) => ({
          ...row,
          _rowKey: `import_${this.rowKeyCounter++}`,
          _isNew: false,
          _displayIndex: idx + 1
        }));
      } catch (e) { this.parseError = '文件解析失败：' + e.message; }
    },
    startEditCell(row, field) { this.editingCell = { rowKey: row._rowKey, field: field.name }; },
    saveCell(row, field) { this.editingCell = null; },
    // order 可显式指定方向（表头筛选面板的升序/降序按钮）；不传则沿用翻转语义
    toggleSort(fieldName, order) {
      if (order === 'asc' || order === 'desc') {
        if (this.sortField === fieldName && this.sortOrder === order) return;
        this.sortField = fieldName;
        this.sortOrder = order;
      } else if (this.sortField === fieldName) this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
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

<style>
  /* 文件拖放区：点击/拖入均可，毛玻璃边框 */
  .dropzone {
    background-color: rgba(255, 255, 255, 0.65);
    border-color: rgba(0, 0, 0, 0.12);
    transition: border-color 0.15s, background-color 0.15s;
  }
  .dropzone:hover {
    border-color: rgba(59, 130, 246, 0.6);
  }
  .dropzone-active {
    background-color: rgba(59, 130, 246, 0.12);
    border-color: rgba(59, 130, 246, 0.7);
  }
</style>