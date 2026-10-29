<template>
  <DialogShell :visible="visible" :z-index="10001" overlay-class="bg-black/50">
    <div class="bg-surface p-6 rounded-lg w-[750px] max-h-[85vh] flex flex-col shadow-card dialog-card">
      <h3 class="text-lg font-bold mb-4">⏱️ 作息时间设置</h3>

      <!-- 学期开始日期 -->
      <div v-if="showSemesterStart" class="mb-4">
        <span class="font-semibold">学期开始日期</span>
        <input
          type="date"
          :value="semesterStart"
          @input="$emit('update:semesterStart', $event.target.value)"
          class="border p-1 rounded text-sm mt-1 w-full"
        />
      </div>

      <!-- 一周天数 -->
      <div class="mb-4">
        <span class="font-semibold">一周天数</span>
        <div class="flex items-center gap-2 mt-1">
          <AppSelect v-model="startDay" :options="dayOptions" class="w-24" />
          <span class="text-sm">到</span>
          <AppSelect v-model="endDay" :options="dayOptions" class="w-24" />
        </div>
      </div>

      <!-- 各时段 -->
      <div class="flex-1 overflow-y-auto space-y-4 mb-4">
        <!-- 上午 -->
        <div class="border border-border rounded-xl p-3 bg-surface-hover">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-semibold">上午</h4>
            <button @click="addItem('morning')" class="bg-primary text-text-inverse px-2 py-1 rounded text-sm">＋ 新加上午时间段</button>
          </div>
          <div v-for="(item, idx) in sections.morning" :key="idx" class="flex items-center gap-2 mb-1">
            <AppSelect v-model="item.type" :options="[{ value: 'lesson', label: '学习' }, { value: 'rest', label: '休息' }]" class="w-16" />
            <input v-model="item.name" placeholder="名称" class="border p-1 text-sm rounded w-24" />
            <input type="time" v-model="item.start" class="border p-1 text-sm rounded w-20" />
            <span class="text-sm">到</span>
            <input type="time" v-model="item.end" class="border p-1 text-sm rounded w-20" />
            <button @click="removeItem('morning', idx)" class="text-danger text-sm">删除</button>
          </div>
        </div>

        <!-- 中午 -->
        <div class="border border-border rounded-xl p-3 bg-surface-hover">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-semibold">中午</h4>
            <button @click="addItem('noon')" class="bg-primary text-text-inverse px-2 py-1 rounded text-sm">＋ 新加中午时间段</button>
          </div>
          <div v-for="(item, idx) in sections.noon" :key="idx" class="flex items-center gap-2 mb-1">
            <AppSelect v-model="item.type" :options="[{ value: 'lesson', label: '学习' }, { value: 'rest', label: '休息' }]" class="w-16" />
            <input v-model="item.name" placeholder="名称" class="border p-1 text-sm rounded w-24" />
            <input type="time" v-model="item.start" class="border p-1 text-sm rounded w-20" />
            <span class="text-sm">到</span>
            <input type="time" v-model="item.end" class="border p-1 text-sm rounded w-20" />
            <button @click="removeItem('noon', idx)" class="text-danger text-sm">删除</button>
          </div>
        </div>

        <!-- 下午 -->
        <div class="border border-border rounded-xl p-3 bg-surface-hover">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-semibold">下午</h4>
            <button @click="addItem('afternoon')" class="bg-primary text-text-inverse px-2 py-1 rounded text-sm">＋ 新加下午时间段</button>
          </div>
          <div v-for="(item, idx) in sections.afternoon" :key="idx" class="flex items-center gap-2 mb-1">
            <AppSelect v-model="item.type" :options="[{ value: 'lesson', label: '学习' }, { value: 'rest', label: '休息' }]" class="w-16" />
            <input v-model="item.name" placeholder="名称" class="border p-1 text-sm rounded w-24" />
            <input type="time" v-model="item.start" class="border p-1 text-sm rounded w-20" />
            <span class="text-sm">到</span>
            <input type="time" v-model="item.end" class="border p-1 text-sm rounded w-20" />
            <button @click="removeItem('afternoon', idx)" class="text-danger text-sm">删除</button>
          </div>
        </div>

        <!-- 傍晚 -->
        <div class="border border-border rounded-xl p-3 bg-surface-hover">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-semibold">傍晚</h4>
            <button @click="addItem('evening')" class="bg-primary text-text-inverse px-2 py-1 rounded text-sm">＋ 新加傍晚时间段</button>
          </div>
          <div v-for="(item, idx) in sections.evening" :key="idx" class="flex items-center gap-2 mb-1">
            <AppSelect v-model="item.type" :options="[{ value: 'lesson', label: '学习' }, { value: 'rest', label: '休息' }]" class="w-16" />
            <input v-model="item.name" placeholder="名称" class="border p-1 text-sm rounded w-24" />
            <input type="time" v-model="item.start" class="border p-1 text-sm rounded w-20" />
            <span class="text-sm">到</span>
            <input type="time" v-model="item.end" class="border p-1 text-sm rounded w-20" />
            <button @click="removeItem('evening', idx)" class="text-danger text-sm">删除</button>
          </div>
        </div>

        <!-- 晚上 -->
        <div class="border border-border rounded-xl p-3 bg-surface-hover">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-semibold">晚上</h4>
            <button @click="addItem('night')" class="bg-primary text-text-inverse px-2 py-1 rounded text-sm">＋ 新加晚上时间段</button>
          </div>
          <div v-for="(item, idx) in sections.night" :key="idx" class="flex items-center gap-2 mb-1">
            <AppSelect v-model="item.type" :options="[{ value: 'lesson', label: '学习' }, { value: 'rest', label: '休息' }]" class="w-16" />
            <input v-model="item.name" placeholder="名称" class="border p-1 text-sm rounded w-24" />
            <input type="time" v-model="item.start" class="border p-1 text-sm rounded w-20" />
            <span class="text-sm">到</span>
            <input type="time" v-model="item.end" class="border p-1 text-sm rounded w-20" />
            <button @click="removeItem('night', idx)" class="text-danger text-sm">删除</button>
          </div>
        </div>
      </div>

      <div class="text-right">
        <button @click="$emit('cancel')" class="bg-surface-hover px-4 py-2 rounded mr-2 text-text">取消</button>
        <button @click="save" class="bg-info text-text-inverse px-4 py-2 rounded">保存设置</button>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'
import AppSelect from '../base/AppSelect.vue'
import { useNotification } from '../../composables/useNotification.js'
import { ref, watch } from 'vue'

defineOptions({ name: 'SettingsDialog' })

const props = defineProps({
  visible: Boolean,
  settings: { type: Object, default: () => ({}) },
  semesterStart: { type: String, default: '' } ,
  showSemesterStart: { type: Boolean, default: true }   // 补上这一行  // 新增
})
const emit = defineEmits(['save', 'cancel', 'update:semesterStart'])  // 新增

const startDay = ref(1);
const endDay = ref(5);
const sections = ref({
  morning: [],
  noon: [],
  afternoon: [],
  evening: [],
  night: []
});
const dayOptions = ref([
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 7 }
]);

watch(() => props.settings, (val) => {
  if (val.sections) {
    sections.value = {
      morning: val.sections.morning?.map(i => ({...i})) || [],
      noon: val.sections.noon?.map(i => ({...i})) || [],
      afternoon: val.sections.afternoon?.map(i => ({...i})) || [],
      evening: val.sections.evening?.map(i => ({...i})) || [],
      night: val.sections.night?.map(i => ({...i})) || []
    };
  } else if (val.periods) {
    resetToDefault(); // 简单降级
  }
  if (val.days) {
    const dayMap = { '周一':1,'周二':2,'周三':3,'周四':4,'周五':5,'周六':6,'周日':7 };
    startDay.value = dayMap[val.days[0]] || 1;
    endDay.value = dayMap[val.days[val.days.length-1]] || 5;
  }
}, {
  deep: true,
  immediate: true
});

function addItem(section) {
  sections.value[section].push({ name: '', start: '08:00', end: '08:45', type: 'lesson' });
}
function removeItem(section, idx) {
  sections.value[section].splice(idx, 1);
}
function resetToDefault() {
  sections.value = {
    morning: [
      { name: '第1节', start: '08:10', end: '08:55', type: 'lesson' },
      { name: '第2节', start: '09:05', end: '09:50', type: 'lesson' },
      { name: '大课间', start: '09:50', end: '10:20', type: 'rest' },
      { name: '第3节', start: '10:20', end: '11:05', type: 'lesson' },
      { name: '第4节', start: '11:15', end: '12:00', type: 'lesson' }
    ],
    noon: [
      { name: '午休', start: '12:00', end: '14:00', type: 'rest' }
    ],
    afternoon: [
      { name: '第5节', start: '14:30', end: '15:15', type: 'lesson' },
      { name: '第6节', start: '15:25', end: '16:10', type: 'lesson' }
    ],
    evening: [
      { name: '休息', start: '17:00', end: '18:30', type: 'rest' }
    ],
    night: [
      { name: '晚修1', start: '19:00', end: '19:45', type: 'lesson' },
      { name: '晚修2', start: '19:55', end: '20:40', type: 'lesson' }
    ]
  };
  startDay.value = 1;
  endDay.value = 5;
}
function save() {
  // 开始日晚于结束日会生成空 days 数组，后端保存后课表直接没有可用星期
  if (startDay.value > endDay.value) {
    useNotification().error('开始日不能晚于结束日')
    return
  }
  const dayNames = ['周一','周二','周三','周四','周五','周六','周日'];
  const days = [];
  for (let i = startDay.value; i <= endDay.value; i++) days.push(dayNames[i-1]);

  const sectionsData = JSON.parse(JSON.stringify(sections.value));
  const periods = [];
  ['morning','noon','afternoon','evening','night'].forEach(key => {
    sectionsData[key].forEach(item => {
      periods.push({ name: item.name, start: item.start, end: item.end, type: item.type });
    });
  });

  emit('save', { sections: sectionsData, periods, days });
}

if (!props.settings || !props.settings.sections) {
  resetToDefault();
}
</script>