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
import AppSelect from '../../base/AppSelect.vue'
import { useNotification } from '../../../composables/useNotification';
import { useExportFormats } from './ExportExcel.exporters.js';
import '../../../styles/dialog-transition.css'


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
    ...useExportFormats(),
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