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
      <div v-if="previewRows.length > previewLimit" class="text-text-secondary text-sm mb-2">
        表格仅显示前 {{ previewLimit }} 行（共 {{ previewRows.length }} 行）；导入会写入全部行。
      </div>
      <!-- 预览表格 -->
      <div class="flex-1 overflow-auto border border-border rounded" v-if="previewFields.length && previewRows.length">
        <DynamicTable
          :fields="previewFields"
          :rows="visibleRows"
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
        <span class="text-sm text-text-secondary">共 {{ previewRows.length }} 行{{ previewRows.length > previewLimit ? '（预览前 ' + previewLimit + ' 行）' : '' }}</span>
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

<script setup>
import DynamicTable from '../tables/DynamicTable/DynamicTable.vue';
import { parseSheet } from '../../utils/importSheet.js';
import { useSeq } from '../../composables/useSeq.js';
import '../../styles/dialog-transition.css';
import { ref, computed, watch } from 'vue';

defineOptions({ name: 'ImportExcel' });

const props = defineProps({
  visible: Boolean,
  existingFields: { type: Array, default: () => [] },
  requiredFields: { type: Array, default: () => ['收支编码'] }
});

const emit = defineEmits(['import-data', 'cancel']);

// 请求序号挂实例上：Options API 没有 setup 作用域；序号不参与渲染，不必进 data
const seq = useSeq();

// 预览最多渲染多少行（进 data 是为了模板里也能读到，用于显示截断提示）
const previewLimit = ref(3000);
const fileData = ref(null);
const fileName = ref('');
const parseError = ref('');
const filteredCount = ref(0);
const previewFields = ref([]);
const previewRows = ref([]);
const editingCell = ref(null);
const sortField = ref('');
const sortOrder = ref('asc');
const rowKeyCounter = ref(0);
const dragOver = ref(false);

const fileInput = ref(null);

// 只把前 N 行交给表格渲染：10MB 表格可能有几万行，全量铺进 DOM（即使有虚拟滚动，
// 也要为每行建 vnode / 计算列宽）会明显卡顿。**数据本身仍保留全部**，
// confirmImport 用的还是完整 previewRows —— 截断只影响预览，不影响导入内容。
const visibleRows = computed(() => {
  return previewRows.value.length > previewLimit.value
    ? previewRows.value.slice(0, previewLimit.value)
    : previewRows.value
});

function triggerFileSelect() { fileInput.value.click(); }
function onFileDrop(e) {
  dragOver.value = false;
  const file = e.dataTransfer.files[0];
  if (!file) return;
  handleFile({ target: { files: [file] } });
}
function resetFile() {
  // 取消/关闭弹窗也要让在途读取与解析失效，避免关闭后仍写入预览状态
  seq.invalidate();
  fileName.value = '';
  fileData.value = null;
  parseError.value = '';
  filteredCount.value = 0;
  previewFields.value = [];
  previewRows.value = [];
  editingCell.value = null;
  sortField.value = '';
  sortOrder.value = 'asc';
  // 清空 file input，保证同一文件可再次选择
  if (fileInput.value) fileInput.value.value = '';
}
function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  // 每次选文件都让上一轮读取/解析失效，包括随后因体积被拒绝的分支
  const my = seq.take();
  // 大小上限：超大文件会让 xlsx 解析长时间卡死甚至内存暴涨，超过 10MB 直接拒绝
  if (file.size > 10 * 1024 * 1024) {
    resetFile();
    fileName.value = file.name;
    parseError.value = '文件过大，请选择 10MB 以内的表格文件';
    return;
  }
  fileName.value = file.name;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    if (!seq.isLatest(my)) return;
    fileData.value = new Uint8Array(ev.target.result);
    // 选中文件后自动解析预览，无需再点击「解析预览」
    await parseFile();
  };
  // 读盘失败（文件被移动/权限不足/设备断开）时必须给出提示，
  // 否则界面停在「请选择一个文件进行解析」，用户以为是自己没选中文件
  reader.onerror = () => {
    if (!seq.isLatest(my)) return;
    fileData.value = null;
    parseError.value = '文件读取失败，请重新选择文件';
  };
  reader.readAsArrayBuffer(file);
}
async function parseFile() {
  if (!fileData.value) return;
  const my = seq.current();
  parseError.value = '';
  filteredCount.value = 0;
  // 大依赖 xlsx（SheetJS）延迟到真正导入文件时才加载，避免随表格页一打开就拖进几 MB 代码
  const XLSX = await import('xlsx');
  if (!seq.isLatest(my)) return;
  try {
    const workbook = XLSX.read(fileData.value, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!seq.isLatest(my)) return;
    if (!data || data.length === 0) { parseError.value = '文件无有效数据'; return; }
    // 表头识别与行映射抽到 utils/importSheet.js：
    // 表头保留原始列下标，空表头只跳过自己，不会让它右边的列整体左移（串列）
    const parsed = parseSheet(data, props.requiredFields);
    if (!seq.isLatest(my)) return;
    if (parsed.fields.length === 0) { parseError.value = '未识别到列标题'; return; }
    previewFields.value = parsed.fields.map(h => ({ name: h, type: '文字' }));
    filteredCount.value = parsed.skipped;
    // 就地在 parseSheet 新建的对象上加内部字段，不再展开拷贝：
    // 大表（几万行）展开一份等于把所有单元格字符串再引用一遍、行对象翻倍。
    parsed.rows.forEach((row, idx) => {
      row._rowKey = `import_${rowKeyCounter.value++}`;
      row._isNew = false;
      row._displayIndex = idx + 1;
    });
    previewRows.value = parsed.rows;
  } catch (e) {
    if (!seq.isLatest(my)) return;
    parseError.value = '文件解析失败：' + e.message;
  }
}
function startEditCell(row, field) { editingCell.value = { rowKey: row._rowKey, field: field.name }; }
function saveCell(row, field) { editingCell.value = null; }
// order 可显式指定方向（表头筛选面板的升序/降序按钮）；不传则沿用翻转语义
function toggleSort(fieldName, order) {
  if (order === 'asc' || order === 'desc') {
    if (sortField.value === fieldName && sortOrder.value === order) return;
    sortField.value = fieldName;
    sortOrder.value = order;
  } else if (sortField.value === fieldName) sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  else { sortField.value = fieldName; sortOrder.value = 'asc'; }
  previewRows.value.sort((a, b) => {
    let va = a[fieldName] || '', vb = b[fieldName] || '';
    if (va < vb) return sortOrder.value === 'asc' ? -1 : 1;
    if (va > vb) return sortOrder.value === 'asc' ? 1 : -1;
    return 0;
  });
}
function deletePreviewRow(rowKey) { previewRows.value = previewRows.value.filter(r => r._rowKey !== rowKey); }
function confirmImport() {
  const headers = previewFields.value.map(f => f.name);
  const rows = previewRows.value.map(row => headers.map(h => row[h] ?? ''));
  emit('import-data', { fields: headers, rows });
}
function cancel() { resetState(); emit('cancel'); }
function resetState() {
  fileData.value = null; fileName.value = '';
  parseError.value = ''; filteredCount.value = 0;
  previewFields.value = []; previewRows.value = [];
  sortField.value = '';
}

watch(() => props.visible, (val) => { if (!val) resetState(); });
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