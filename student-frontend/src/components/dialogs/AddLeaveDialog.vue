<template>
  <DialogShell :visible="visible" :z-index="10001" @overlay="$emit('cancel')">
    <div class="bg-surface p-5 rounded-xl w-[520px] max-w-full shadow-lg dialog-card">
      <h3 class="text-lg font-bold mb-4 text-text">{{ isEdit ? '编辑请假记录' : '请假登记' }}</h3>

      <!-- 编辑模式：只读学生姓名 -->
      <div v-if="isEdit" class="mb-3">
        <label class="block text-sm text-text-secondary mb-1">请假学生</label>
        <input readonly :value="editingRecord.姓名" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border text-text-muted" />
      </div>

      <!-- 学生选择（带候选列表 + 自动带出联系方式） -- 仅新增模式 -->
      <div v-else class="mb-3">
        <label class="block text-sm text-text-secondary mb-1">选择学生 <span class="text-danger">*</span></label>
        <div class="relative">
          <input
            v-model="keyword"
            type="text"
            placeholder="输入姓名搜索"
            class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary"
            @focus="listVisible = true"
            @blur="delayHide"
          />
          <div
            v-if="listVisible"
            class="absolute left-0 right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto z-10"
          >
            <div
              v-for="s in filteredStudents"
              :key="s.id"
              class="px-3 py-2 text-sm cursor-pointer hover:bg-primary/10 transition-theme"
              @mousedown.prevent="selectStudent(s)"
            >
              <span class="text-text">{{ s.姓名 }}</span>
              <span v-if="s.学号" class="ml-2 text-xs text-text-muted">{{ s.学号 }}</span>
            </div>
            <div v-if="!filteredStudents.length" class="px-3 py-2 text-sm text-text-muted">无匹配学生</div>
          </div>
        </div>
      </div>

      <!-- 带出的联系方式（可编辑） -->
      <div v-if="selected || isEdit" class="grid grid-cols-2 gap-3 mb-3 text-sm">
        <div>
          <label class="block text-text-secondary mb-1">家长联系电话 <span class="text-text-muted text-xs">(可双击编辑)</span></label>
          <input v-model="form.parentPhone" type="text" class="w-full px-3 py-2 rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
        </div>
        <div>
          <label class="block text-text-secondary mb-1">学生联系电话 <span class="text-text-muted text-xs">(可双击编辑)</span></label>
          <input v-model="form.studentPhone" type="text" class="w-full px-3 py-2 rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
        </div>
      </div>

      <!-- 请假类型 -->
      <div class="mb-3">
        <label class="block text-sm text-text-secondary mb-1">请假类型 <span class="text-danger">*</span></label>
        <div class="flex gap-2">
          <button
            v-for="t in typeOptions"
            :key="t"
            type="button"
            @click="form.type = t"
            :class="[
              'px-4 py-1.5 rounded-lg text-sm transition-colors',
              form.type === t
                ? 'bg-primary text-text-inverse'
                : 'bg-surface-hover text-text-secondary hover:bg-border'
            ]"
          >{{ t }}</button>
        </div>
      </div>

      <!-- 请假时段：快捷按钮 + 开始/结束时间 -->
      <div class="mb-3">
        <label class="block text-sm text-text-secondary mb-1">请假时段 <span class="text-danger">*</span></label>
        <div class="flex flex-wrap gap-2 mb-2">
          <button
            v-for="q in quickButtons"
            :key="q"
            type="button"
            @click="applyQuick(q)"
            class="px-3 py-1.5 text-xs rounded-lg bg-surface-hover text-text-secondary hover:bg-border border border-border transition-theme"
          >{{ q }}</button>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs text-text-muted mb-1">开始时间</label>
            <input v-model="form.startLocal" type="datetime-local" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">结束时间</label>
            <input v-model="form.endLocal" type="datetime-local" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
          </div>
        </div>
      </div>

      <!-- 备注 -->
      <div class="mb-4">
        <label class="block text-sm text-text-secondary mb-1">备注</label>
        <textarea v-model="form.remark" rows="2" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary"></textarea>
      </div>

      <div class="flex justify-end gap-2">
        <button v-if="isEdit" type="button" @click="$emit('delete', editingRecord)" class="mr-auto px-4 py-2 rounded-lg bg-danger text-text-inverse hover:bg-danger-hover transition-theme">删除</button>
        <button type="button" @click="$emit('cancel')" class="px-4 py-2 rounded-lg bg-text-muted text-text-inverse hover:bg-text-secondary transition-theme">取消</button>
        <button type="button" @click="submit" class="px-4 py-2 rounded-lg bg-primary text-text-inverse hover:bg-primary-hover transition-theme">确认请假</button>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'
import { useNotification } from '../../composables/useNotification.js'
import { formatDateTimeLocal, formatDateTime } from '../../utils/dateTime.js'

defineOptions({ name: 'AddLeaveDialog' })

const props = defineProps({
  visible: { type: Boolean, default: false },
  students: { type: Array, default: () => [] },
  typeOptions: { type: Array, default: () => ['病假', '事假', '其他'] },
  // 非空时进入编辑模式（传入一条请假记录）
  editingRecord: { type: Object, default: null }
})
const emit = defineEmits(['cancel', 'delete', 'update', 'ask-save-phones', 'confirm'])

const keyword = ref('');
const listVisible = ref(false);
const selected = ref(null);
const hideTimer = ref(null);
const quickButtons = ref(['今日全天', '今日上午', '今日下午', '今日晚修', '今日不过夜', '明天全天', '连续两天', '连续三天']);
const form = ref({
  type: props.typeOptions[0] || '病假',
  startLocal: '',
  endLocal: '',
  parentPhone: '',
  studentPhone: '',
  remark: ''
});

const filteredStudents = computed(() => {
  const kw = keyword.value.toLowerCase();
  const list = props.students.filter(s => !kw || String(s.姓名 || '').toLowerCase().includes(kw));
  return list;
})
const isEdit = computed(() => {
  return !!(props.editingRecord && props.editingRecord.id != null)
})

watch(() => props.visible, (v) => {
  if (v) {
    if (isEdit.value) presetFromRecord(props.editingRecord)
    else reset()
  }
})

// 下拉延迟收起定时器：弹窗关掉（组件卸载）后仍在跑就会往已销毁的实例上写状态
onBeforeUnmount(() => clearTimeout(hideTimer.value))

// datetime-local 输入值格式
function toInput(d) {
  return formatDateTimeLocal(d);
}
// 存储展示格式：YYYY-MM-DD HH:mm
function toFmt(d) {
  return formatDateTime(d);
}
function reset() {
  keyword.value = '';
  selected.value = null;
  listVisible.value = false;
  form.value = {
    type: props.typeOptions[0] || '病假',
    startLocal: '',
    endLocal: '',
    parentPhone: '',
    studentPhone: '',
    remark: ''
  };
  // 默认填充今日全天，方便直接提交
  applyQuick('今日全天');
}
// 编辑模式：用原记录预填
function presetFromRecord(r) {
  form.value = {
    type: r.类型 || props.typeOptions[0],
    startLocal: r.开始时间 ? toInput(new Date(r.开始时间.replace(' ', 'T'))) : '',
    endLocal: r.结束时间 ? toInput(new Date(r.结束时间.replace(' ', 'T'))) : '',
    parentPhone: r.家长联系电话 || '',
    studentPhone: r.学生联系电话 || '',
    remark: r.备注 || ''
  };
}
function applyQuick(name) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const at = (dd, hh, mm) => new Date(y, m, d + dd, hh, mm, 0, 0);
  let start, end;
  if (name === '今日全天') {
    start = at(0, 0, 0); end = at(1, 0, 0);
  } else if (name === '今日上午') {
    start = at(0, 7, 0); end = at(0, 13, 0);
  } else if (name === '今日下午') {
    start = at(0, 13, 0); end = at(0, 18, 0);
  } else if (name === '今日晚修') {
    start = at(0, 18, 0); end = at(0, 22, 0);
  } else if (name === '今日不过夜') {
    start = at(0, 18, 0); end = at(1, 7, 0);
  } else if (name === '明天全天') {
    start = now; end = at(2, 7, 0); // 当前时刻 → 第三天(后天)早上7点
  } else if (name === '连续两天') {
    start = now; end = new Date(now.getTime() + 48 * 3600 * 1000);
  } else if (name === '连续三天') {
    start = now; end = new Date(now.getTime() + 72 * 3600 * 1000);
  }
  if (start && end) {
    form.value.startLocal = toInput(start);
    form.value.endLocal = toInput(end);
  }
}
function selectStudent(s) {
  selected.value = s;
  keyword.value = s.姓名 || '';
  listVisible.value = false;
  form.value.parentPhone = s.家长联系电话 || '';
  form.value.studentPhone = s.学生联系电话 || '';
}
function delayHide() {
  clearTimeout(hideTimer.value);
  hideTimer.value = setTimeout(() => {
    listVisible.value = false;
  }, 150);
}
function submit() {
  if (!form.value.type) {
    useNotification().warning('请选择请假类型');
    return;
  }
  if (!form.value.startLocal || !form.value.endLocal) {
    useNotification().warning('请选择请假时段（可点击上方快捷按钮）');
    return;
  }
  const startD = new Date(form.value.startLocal);
  const endD = new Date(form.value.endLocal);
  if (startD >= endD) {
    useNotification().warning('开始时间需早于结束时间');
    return;
  }

  const common = {
    类型: form.value.type,
    开始时间: toFmt(startD),
    结束时间: toFmt(endD),
    备注: form.value.remark,
    家长联系电话: form.value.parentPhone.trim(),
    学生联系电话: form.value.studentPhone.trim()
  };

  // 编辑模式
  if (isEdit.value) {
    const base = props.editingRecord
    emit('update', { id: base.id, ...common })
    const changed = {}
    if (common.家长联系电话 !== (base.家长联系电话 || '')) changed.家长联系电话 = common.家长联系电话
    if (common.学生联系电话 !== (base.学生联系电话 || '')) changed.学生联系电话 = common.学生联系电话
    if (Object.keys(changed).length) {
      emit('ask-save-phones', { studentId: base.student_id, ...changed })
    }
    return
  }

  // 新增模式
  if (!selected.value) {
    useNotification().warning('请选择学生');
    return;
  }
  emit('confirm', {
    studentId: selected.value.id,
    姓名: selected.value.姓名,
    ...common
  });

  // 若用户修改了联系方式，询问是否同步保存到班级管理的学生表
  const changed = {}
  if (common.家长联系电话 !== (selected.value.家长联系电话 || '')) changed.家长联系电话 = common.家长联系电话
  if (common.学生联系电话 !== (selected.value.学生联系电话 || '')) changed.学生联系电话 = common.学生联系电话
  if (Object.keys(changed).length) {
    emit('ask-save-phones', { studentId: selected.value.id, ...changed })
  }
}
</script>