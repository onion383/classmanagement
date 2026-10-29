<template>
  <DialogShell :visible="visible" :z-index="10001" @overlay="$emit('cancel')">
    <div class="bg-surface p-5 rounded-xl w-[520px] max-w-full shadow-lg dialog-card">
      <h3 class="text-lg font-bold mb-4 text-text">{{ title }}</h3>

      <!-- 个人-编辑模式：只读学生姓名/学号 -->
      <div v-if="isEdit && mode === 'personal'" class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-sm text-text-secondary mb-1">学生姓名</label>
          <input readonly :value="editingRecord.姓名 || '-'" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border text-text-muted" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">学号</label>
          <input readonly :value="editingRecord.学号 || '-'" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border text-text-muted" />
        </div>
      </div>

      <!-- 小组-编辑模式：只读小组名/成员数 -->
      <div v-if="isEdit && mode === 'group'" class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-sm text-text-secondary mb-1">小组</label>
          <input readonly :value="editingRecord.group_name || '-'" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border text-text-muted" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">成员数</label>
          <input readonly :value="editingRecord.成员数 ?? '-'" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border text-text-muted" />
        </div>
      </div>

      <!-- 个人加分：学生选择（带候选列表） -- 仅新增模式 -->
      <div v-if="!isEdit && mode === 'personal'" class="mb-3">
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

      <!-- 小组加分：先选择分组，再选择小组 -- 仅新增模式 -->
      <div v-if="!isEdit && mode === 'group'" class="mb-3">
        <label class="block text-sm text-text-secondary mb-1">选择小组 <span class="text-danger">*</span></label>
        <div class="grid grid-cols-2 gap-3">
          <AppSelect
            v-model="activeDimId"
            @change="onDimChange"
            :options="dimOptions"
            class="w-full"
          />
          <AppSelect
            v-model="selectedGroupId"
            :options="groupOptions"
            class="w-full"
          />
        </div>
        <div v-if="selectedGroup" class="mt-2">
          <div class="text-xs text-text-secondary">将给「<span class="font-bold text-text">{{ groupLabel(selectedGroup, currentGroups.indexOf(selectedGroup)) }}</span>」组内 <span class="font-bold text-text">{{ selectedGroup.members.length }}</span> 人记录一条{{ form.type === '扣分' ? '扣分' : '加分' }}：</div>
          <div class="flex flex-wrap gap-1 mt-1">
            <span v-for="m in selectedGroup.members" :key="m.id" class="px-2 py-0.5 rounded bg-surface-hover text-xs text-text">{{ m.member_name }}</span>
            <span v-if="!selectedGroup.members.length" class="text-xs text-text-muted">该小组暂无成员</span>
          </div>
        </div>
      </div>

      <!-- 类型：加分/扣分 -->
      <div class="mb-3">
        <label class="block text-sm text-text-secondary mb-1">类型 <span class="text-danger">*</span></label>
        <div class="flex gap-2">
          <button
            type="button"
            @click="form.type = '加分'"
            :class="['px-5 py-1.5 rounded-lg text-sm transition-colors', form.type === '加分' ? 'bg-success text-text-inverse' : 'bg-surface-hover text-text-secondary hover:bg-border']"
          >＋ 加分</button>
          <button
            type="button"
            @click="form.type = '扣分'"
            :class="['px-5 py-1.5 rounded-lg text-sm transition-colors', form.type === '扣分' ? 'bg-danger text-text-inverse' : 'bg-surface-hover text-text-secondary hover:bg-border']"
          >－ 扣分</button>
        </div>
      </div>

      <!-- 项目 -->
      <div class="mb-3">
        <label class="block text-sm text-text-secondary mb-1">项目 <span class="text-danger">*</span></label>
        <input v-model="form.project" type="text" placeholder="如：卫生 / 纪律 / 学习 / 助人" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
        <div class="flex flex-wrap gap-1.5 mt-1.5">
          <button
            v-for="p in commonProjects"
            :key="p"
            type="button"
            @click="form.project = p"
            class="px-2 py-0.5 text-xs rounded bg-surface-hover border border-border text-text-secondary hover:bg-border transition-theme"
          >{{ p }}</button>
        </div>
      </div>

      <!-- 分值 + 加分时间 -->
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-sm text-text-secondary mb-1">分值 <span class="text-danger">*</span></label>
          <input v-model.number="form.score" type="number" min="0.5" step="0.5" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">加分时间</label>
          <input v-model="form.time" type="datetime-local" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary" />
        </div>
      </div>

      <!-- 原因 -->
      <div class="mb-4">
        <label class="block text-sm text-text-secondary mb-1">原因</label>
        <textarea v-model="form.reason" rows="2" :placeholder="mode === 'group' ? '如：本周卫生评比第一名（时间轴将显示「XX小组 因为 原因 加X分」）' : '如：主动打扫教室卫生（时间轴将显示「XXX 因为 原因 加X分」）'" class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary"></textarea>
      </div>

      <div class="flex justify-end gap-2">
        <button v-if="isEdit" type="button" @click="$emit('delete', editingRecord)" class="mr-auto px-4 py-2 rounded-lg bg-danger text-text-inverse hover:bg-danger-hover transition-theme">删除</button>
        <button type="button" @click="$emit('cancel')" class="px-4 py-2 rounded-lg bg-text-muted text-text-inverse hover:bg-text-secondary transition-theme">取消</button>
        <button type="button" @click="submit" class="px-4 py-2 rounded-lg bg-primary text-text-inverse hover:bg-primary-hover transition-theme">确认保存</button>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import axios from 'axios'
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import AppSelect from '../base/AppSelect.vue'
import DialogShell from '../base/DialogShell.vue'
import '../../styles/dialog-transition.css'
import { useNotification } from '../../composables/useNotification.js'
import { formatDateTimeLocal } from '../../utils/dateTime.js'

defineOptions({ name: 'AddScoreDialog' })

const props = defineProps({
  visible: { type: Boolean, default: false },
  students: { type: Array, default: () => [] },
  // 加分目标：personal 个人加分 / group 小组加分（由页眉下拉控制，完全独立）
  mode: { type: String, default: 'personal' },
  // 加分项目的常用快速选项（扣分与加分共用，可自行扩展）
  editingRecord: { type: Object, default: null }
})
const emit = defineEmits(['cancel', 'delete', 'update', 'confirm'])

const keyword = ref('');
const listVisible = ref(false);
const selected = ref(null);
const hideTimer = ref(null);
// 小组加分所需的分组数据
const dims = ref([]);
const activeDimId = ref(0);
const selectedGroupId = ref(0);
const activeDimGroups = ref([]);
const commonProjects = ref(['卫生', '纪律', '学习', '助人', '劳动', '进步']);
const form = ref({
  type: '加分',
  project: '',
  score: 1,
  reason: '',
  time: formatDateTimeLocal(new Date())
});

const filteredStudents = computed(() => {
  const kw = keyword.value.toLowerCase();
  return props.students.filter(s => !kw || String(s.姓名 || '').toLowerCase().includes(kw));
})
const isEdit = computed(() => {
  return !!(props.editingRecord && props.editingRecord.id != null)
})
const title = computed(() => {
  const group = props.mode === 'group'
  if (isEdit.value) return group ? '编辑小组加分' : '编辑加分'
  return group ? '小组加分登记' : '加分登记'
})
const currentGroups = computed(() => {
  return activeDimGroups.value
})
const selectedGroup = computed(() => {
  return dims.value.some(d => d.id === activeDimId.value) && selectedGroupId.value
    ? activeDimGroups.value.find(g => g.id === selectedGroupId.value) || null
    : null
})
const dimOptions = computed(() => {
  return [
    { value: 0, label: '先选择分组', disabled: true },
    ...dims.value.map(d => ({ value: d.id, label: d.name }))
  ]
})
const groupOptions = computed(() => {
  return [
    { value: 0, label: '再选择小组', disabled: true },
    ...currentGroups.value.map((g, i) => ({ value: g.id, label: groupLabel(g, i) }))
  ]
})

watch(() => props.visible, (v) => {
  if (v) {
    if (isEdit.value) presetFromRecord(props.editingRecord)
    else reset()
  }
})

// 下拉延迟收起定时器：弹窗关掉（组件卸载）后仍在跑就会往已销毁的实例上写状态
onBeforeUnmount(() => clearTimeout(hideTimer.value))

function reset() {
  keyword.value = '';
  selected.value = null;
  listVisible.value = false;
  dims.value = [];
  activeDimId.value = 0;
  selectedGroupId.value = 0;
  activeDimGroups.value = [];
  loadDims();
  form.value = {
    type: '加分',
    project: '',
    score: 1,
    reason: '',
    time: formatDateTimeLocal(new Date())
  };
}
// 加载分组维度列表
async function loadDims() {
  try {
    const res = await axios.get('/api/group-manage/bootstrap')
    dims.value = res.data.dimensions || []
  } catch (err) {
    // 分组数据不可用时，仅个人加分可用
    dims.value = []
  }
}
// 切换分组维度 → 加载该维度下的小组与成员
async function onDimChange() {
  selectedGroupId.value = 0
  activeDimGroups.value = []
  if (activeDimId.value) {
    try {
      const res = await axios.get(`/api/group-manage/${activeDimId.value}`)
      activeDimGroups.value = (res.data.groups) || []
    } catch (err) {
      activeDimGroups.value = []
    }
  }
}
function groupLabel(g, i) {
  return g.name || '第' + (i + 1) + '小组'
}
function presetFromRecord(r) {
  const d = r.加分时间 ? new Date(r.加分时间.replace(' ', 'T')) : new Date();
  form.value = {
    type: r.类型 === '扣分' ? '扣分' : '加分',
    project: r.项目 || '',
    score: r.分值 || 0,
    reason: r.原因 || '',
    time: isNaN(d.getTime()) ? '' : formatDateTimeLocal(d)
  };
}
function selectStudent(s) {
  selected.value = s;
  keyword.value = s.姓名 || '';
  listVisible.value = false;
}
function delayHide() {
  clearTimeout(hideTimer.value);
  hideTimer.value = setTimeout(() => { listVisible.value = false; }, 150);
}
function submit() {
  if (!isEdit.value) {
    if (props.mode === 'personal' && !selected.value) {
      useNotification().warning('请选择学生');
      return;
    }
    if (props.mode === 'group' && !selectedGroup.value) {
      useNotification().warning('请选择小组');
      return;
    }
  }
  if (!form.value.project.trim()) {
    useNotification().warning('请填写或选择项目');
    return;
  }
  const score = Number(form.value.score);
  if (!form.value.time) {
    useNotification().warning('请选择加分时间');
    return;
  }
  if (!score || score <= 0) {
    useNotification().warning('分值需大于 0');
    return;
  }
  const timeStr = form.value.time.replace('T', ' ');
  const common = {
    类型: form.value.type,
    项目: form.value.project.trim(),
    分值: score,
    原因: form.value.reason.trim(),
    加分时间: timeStr
  };
  if (isEdit.value) {
    emit('update', { id: props.editingRecord.id, ...common });
    return;
  }
  // 小组加分：独立成一条记录
  if (props.mode === 'group') {
    emit('confirm', {
      source: 'group',
      group_name: groupLabel(selectedGroup.value, currentGroups.value.indexOf(selectedGroup.value)),
      成员数: selectedGroup.value.members.length,
      ...common
    });
    return;
  }
  emit('confirm', {
    studentId: selected.value.id,
    姓名: selected.value.姓名,
    学号: selected.value.学号 || '',
    ...common
  });
}
</script>