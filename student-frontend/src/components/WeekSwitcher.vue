<template>
  <div class="flex items-center justify-center gap-4 py-4">
    <button
      @click="goPrev"
      :disabled="!hasPrev"
      class="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-40"
    >
      ◀ 上一周
    </button>
    <div class="font-semibold text-lg">{{ formatWeek(currentWeek) }}</div>
    <button
      @click="goNext"
      :disabled="!hasNext"
      class="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-40"
    >
      下一周 ▶
    </button>
    <select
      v-if="weeks.length > 0"
      :value="currentWeek"
      @change="$emit('update:currentWeek', $event.target.value)"
      class="border rounded px-2 py-1 text-sm"
    >
      <option v-for="w in weeks" :key="w.week_start" :value="w.week_start">
        {{ formatWeek(w.week_start) }}
      </option>
    </select>
  </div>
</template>

<script>
export default {
  name: 'WeekSwitcher',
  props: {
    currentWeek: { type: String, required: true },
    weeks: { type: Array, default: () => [] }
  },
  emits: ['update:currentWeek'],
  computed: {
    hasPrev() {
      const idx = this.weeks.findIndex(w => w.week_start === this.currentWeek);
      return idx > 0;
    },
    hasNext() {
      const idx = this.weeks.findIndex(w => w.week_start === this.currentWeek);
      return idx !== -1 && idx < this.weeks.length - 1;
    }
  },
  methods: {
    goPrev() {
      const idx = this.weeks.findIndex(w => w.week_start === this.currentWeek);
      if (idx > 0) this.$emit('update:currentWeek', this.weeks[idx - 1].week_start);
    },
    goNext() {
      const idx = this.weeks.findIndex(w => w.week_start === this.currentWeek);
      if (idx !== -1 && idx < this.weeks.length - 1) {
        this.$emit('update:currentWeek', this.weeks[idx + 1].week_start);
      }
    },
    formatWeek(weekStart) {
      if (!weekStart) return '';
      const date = new Date(weekStart);
      const end = new Date(date);
      end.setDate(end.getDate() + 6);
      return `${date.toISOString().slice(0, 10)} ~ ${end.toISOString().slice(0, 10)}`;
    }
  }
};
</script>