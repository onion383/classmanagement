<template>
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]">
    <div class="bg-surface p-6 rounded-lg w-[750px] max-h-[85vh] flex flex-col shadow-card">
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
          <select v-model="startDay" class="border p-1 rounded text-sm">
            <option v-for="d in dayOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
          <span class="text-sm">到</span>
          <select v-model="endDay" class="border p-1 rounded text-sm">
            <option v-for="d in dayOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </div>
      </div>

      <!-- 各时段 -->
      <div class="flex-1 overflow-y-auto space-y-4 mb-4">
        <!-- 上午 -->
        <div class="border border-border rounded p-3 bg-bg">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-semibold">上午</h4>
            <button @click="addItem('morning')" class="bg-primary text-text-inverse px-2 py-1 rounded text-sm">＋ 新加上午时间段</button>
          </div>
          <div v-for="(item, idx) in sections.morning" :key="idx" class="flex items-center gap-2 mb-1">
            <select v-model="item.type" class="border p-1 text-sm rounded w-16">
              <option value="lesson">学习</option>
              <option value="rest">休息</option>
            </select>
            <input v-model="item.name" placeholder="名称" class="border p-1 text-sm rounded w-24" />
            <input type="time" v-model="item.start" class="border p-1 text-sm rounded w-20" />
            <span class="text-sm">到</span>
            <input type="time" v-model="item.end" class="border p-1 text-sm rounded w-20" />
            <button @click="removeItem('morning', idx)" class="text-danger text-sm">删除</button>
          </div>
        </div>

        <!-- 中午 -->
        <div class="border border-border rounded p-3 bg-bg">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-semibold">中午</h4>
            <button @click="addItem('noon')" class="bg-primary text-text-inverse px-2 py-1 rounded text-sm">＋ 新加中午时间段</button>
          </div>
          <div v-for="(item, idx) in sections.noon" :key="idx" class="flex items-center gap-2 mb-1">
            <select v-model="item.type" class="border p-1 text-sm rounded w-16">
              <option value="lesson">学习</option>
              <option value="rest">休息</option>
            </select>
            <input v-model="item.name" placeholder="名称" class="border p-1 text-sm rounded w-24" />
            <input type="time" v-model="item.start" class="border p-1 text-sm rounded w-20" />
            <span class="text-sm">到</span>
            <input type="time" v-model="item.end" class="border p-1 text-sm rounded w-20" />
            <button @click="removeItem('noon', idx)" class="text-danger text-sm">删除</button>
          </div>
        </div>

        <!-- 下午 -->
        <div class="border border-border rounded p-3 bg-bg">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-semibold">下午</h4>
            <button @click="addItem('afternoon')" class="bg-primary text-text-inverse px-2 py-1 rounded text-sm">＋ 新加下午时间段</button>
          </div>
          <div v-for="(item, idx) in sections.afternoon" :key="idx" class="flex items-center gap-2 mb-1">
            <select v-model="item.type" class="border p-1 text-sm rounded w-16">
              <option value="lesson">学习</option>
              <option value="rest">休息</option>
            </select>
            <input v-model="item.name" placeholder="名称" class="border p-1 text-sm rounded w-24" />
            <input type="time" v-model="item.start" class="border p-1 text-sm rounded w-20" />
            <span class="text-sm">到</span>
            <input type="time" v-model="item.end" class="border p-1 text-sm rounded w-20" />
            <button @click="removeItem('afternoon', idx)" class="text-danger text-sm">删除</button>
          </div>
        </div>

        <!-- 傍晚 -->
        <div class="border border-border rounded p-3 bg-bg">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-semibold">傍晚</h4>
            <button @click="addItem('evening')" class="bg-primary text-text-inverse px-2 py-1 rounded text-sm">＋ 新加傍晚时间段</button>
          </div>
          <div v-for="(item, idx) in sections.evening" :key="idx" class="flex items-center gap-2 mb-1">
            <select v-model="item.type" class="border p-1 text-sm rounded w-16">
              <option value="lesson">学习</option>
              <option value="rest">休息</option>
            </select>
            <input v-model="item.name" placeholder="名称" class="border p-1 text-sm rounded w-24" />
            <input type="time" v-model="item.start" class="border p-1 text-sm rounded w-20" />
            <span class="text-sm">到</span>
            <input type="time" v-model="item.end" class="border p-1 text-sm rounded w-20" />
            <button @click="removeItem('evening', idx)" class="text-danger text-sm">删除</button>
          </div>
        </div>

        <!-- 晚上 -->
        <div class="border border-border rounded p-3 bg-bg">
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-semibold">晚上</h4>
            <button @click="addItem('night')" class="bg-primary text-text-inverse px-2 py-1 rounded text-sm">＋ 新加晚上时间段</button>
          </div>
          <div v-for="(item, idx) in sections.night" :key="idx" class="flex items-center gap-2 mb-1">
            <select v-model="item.type" class="border p-1 text-sm rounded w-16">
              <option value="lesson">学习</option>
              <option value="rest">休息</option>
            </select>
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
  </div>
</template>

<script>
export default {
  name: 'SettingsDialog',
  props: {
    visible: Boolean,
    settings: { type: Object, default: () => ({}) },
    semesterStart: { type: String, default: '' } ,
    showSemesterStart: { type: Boolean, default: true }   // 补上这一行  // 新增
  },
  emits: ['save', 'cancel', 'update:semesterStart'],  // 新增
  data() {
    return {
      startDay: 1,
      endDay: 5,
      sections: {
        morning: [],
        noon: [],
        afternoon: [],
        evening: [],
        night: []
      },
      dayOptions: [
        { label: '周一', value: 1 },
        { label: '周二', value: 2 },
        { label: '周三', value: 3 },
        { label: '周四', value: 4 },
        { label: '周五', value: 5 },
        { label: '周六', value: 6 },
        { label: '周日', value: 7 }
      ]
    };
  },
  watch: {
    settings: {
      handler(val) {
        if (val.sections) {
          this.sections = {
            morning: val.sections.morning?.map(i => ({...i})) || [],
            noon: val.sections.noon?.map(i => ({...i})) || [],
            afternoon: val.sections.afternoon?.map(i => ({...i})) || [],
            evening: val.sections.evening?.map(i => ({...i})) || [],
            night: val.sections.night?.map(i => ({...i})) || []
          };
        } else if (val.periods) {
          this.resetToDefault(); // 简单降级
        }
        if (val.days) {
          const dayMap = { '周一':1,'周二':2,'周三':3,'周四':4,'周五':5,'周六':6,'周日':7 };
          this.startDay = dayMap[val.days[0]] || 1;
          this.endDay = dayMap[val.days[val.days.length-1]] || 5;
        }
      },
      deep: true,
      immediate: true
    }
  },
  methods: {
    addItem(section) {
      this.sections[section].push({ name: '', start: '08:00', end: '08:45', type: 'lesson' });
    },
    removeItem(section, idx) {
      this.sections[section].splice(idx, 1);
    },
    resetToDefault() {
      this.sections = {
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
      this.startDay = 1;
      this.endDay = 5;
    },
    save() {
      const dayNames = ['周一','周二','周三','周四','周五','周六','周日'];
      const days = [];
      for (let i = this.startDay; i <= this.endDay; i++) days.push(dayNames[i-1]);

      const sections = JSON.parse(JSON.stringify(this.sections));
      const periods = [];
      ['morning','noon','afternoon','evening','night'].forEach(key => {
        sections[key].forEach(item => {
          periods.push({ name: item.name, start: item.start, end: item.end, type: item.type });
        });
      });

      this.$emit('save', { sections, periods, days });
    }
  },
  created() {
    if (!this.settings || !this.settings.sections) {
      this.resetToDefault();
    }
  }
};
</script>