<template>
  <Teleport to="body">
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001] pointer-events-auto" @click.self="$emit('cancel')">
    <div class="bg-surface p-5 rounded-xl w-[600px] max-w-full shadow-lg dialog-card">
      <h3 class="text-lg font-bold mb-4 text-text">{{ title }}</h3>

      <!-- p-1：聚焦时输入框有 3px 外发光（box-shadow），滚动容器 overflow 会裁掉四边，留出内边距避免蓝色边（尤其最下面一排的底边）被挡住 -->
      <div class="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto p-1">
        <div v-for="f in fields" :key="f.name">
          <label class="block text-sm text-text-secondary mb-1">
            {{ f.name }}<span v-if="requiredField === f.name" class="text-danger"> *</span>
          </label>

          <!-- 下拉字段 -->
          <AppSelect
            v-if="f.control === 'select'"
            v-model="form[f.name]"
            :options="selectOptions(f)"
            class="w-full"
          />
          <!-- 日期字段 -->
          <input
            v-else-if="f.type === '日期'"
            v-model="form[f.name]"
            type="date"
            autocomplete="off"
            class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary"
          />
          <!-- 数字字段 -->
          <input
            v-else-if="f.type === '整数'"
            v-model.number="form[f.name]"
            type="number"
            step="1"
            :placeholder="`请输入${f.name}`"
            class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary"
          />
          <input
            v-else-if="f.type === '小数'"
            v-model.number="form[f.name]"
            type="number"
            step="0.5"
            :placeholder="`请输入${f.name}`"
            class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary"
          />
          <!-- 文字及其他字段 -->
          <input
            v-else
            v-model="form[f.name]"
            type="text"
            autocomplete="off"
            :placeholder="`请输入${f.name}`"
            class="w-full px-3 py-2 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      <div class="flex justify-end gap-2 mt-4">
        <button type="button" @click="$emit('cancel')" class="px-4 py-2 rounded-lg bg-text-muted text-text-inverse hover:bg-text-secondary">取消</button>
        <button type="button" @click="submit" class="px-4 py-2 rounded-lg bg-primary text-text-inverse hover:bg-primary-hover">确认保存</button>
      </div>
    </div>
  </div>
  </Transition>
  </Teleport>
</template>

<script>
import AppSelect from '../base/AppSelect.vue'
import '../../styles/dialog-transition.css'
import { useNotification } from '../../composables/useNotification.js'
export default {
  name: 'AddStudentDialog',
  components: { AppSelect },
  props: {
    visible: { type: Boolean, default: false },
    fields: { type: Array, default: () => [] },
    requiredField: { type: String, default: '' },
    title: { type: String, default: '添加学生' }
  },
  data() {
    return { form: {} }
  },
  watch: {
    visible: {
      immediate: true,
      handler(v) {
        if (v) this.reset()
      }
    }
  },
  methods: {
    selectOptions(f) {
      return ['', ...(f.options || [])].map(v => ({ value: v, label: v || '未选择' }))
    },
    reset() {
      const form = {}
      this.fields.forEach(f => {
        form[f.name] = (f.type === '整数' || f.type === '小数') ? '' : ''
      })
      this.form = form
    },
    submit() {
      if (this.requiredField && !String(this.form[this.requiredField] || '').trim()) {
        useNotification().warning(`请填写${this.requiredField}`)
        return
      }
      const data = {}
      this.fields.forEach(f => {
        let v = this.form[f.name]
        if (f.type === '整数' || f.type === '小数') {
          v = v === '' || v == null ? '' : String(v)
        } else {
          v = v == null ? '' : String(v)
        }
        data[f.name] = v
      })
      this.$emit('confirm', data)
    }
  }
}
</script>