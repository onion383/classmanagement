<template>
  <DialogShell :visible="visible" :z-index="50" overlay-class="bg-black/30">
      <div class="bg-surface rounded-xl p-6 w-[680px] max-w-[94vw] shadow-card border border-border dialog-card">
        <h3 class="text-lg font-bold mb-4">值日设置</h3>

        <!-- 时间（星期几） -->
        <div class="mb-5">
          <p class="font-semibold mb-2 text-text">时间</p>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="d in weekDays"
              :key="d"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer select-none text-sm transition-theme"
              :class="isDayOn(d) ? 'bg-info/15 border-info text-info' : 'bg-surface-hover border-border text-text-secondary'"
            >
              <input type="checkbox" class="accent-info" :value="d" v-model="localDays" />
              {{ d }}
            </label>
          </div>
        </div>

        <!-- 劳动项目 -->
        <div class="mb-4">
          <p class="font-semibold mb-2 text-text">劳动项目</p>
          <div
            class="min-h-[120px] rounded-lg border-2 border-dashed border-border p-2 space-y-2"
            :class="dragSource ? 'border-primary/60' : ''"
            @dragover.prevent="onBoxOver"
            @drop.prevent="onBoxDrop"
          >
            <div
              v-for="(it, i) in localItems"
              :key="it.name"
              class="flex items-center gap-2 bg-surface-hover rounded-lg px-2 py-1.5 border border-border"
              :class="dragSource && dragSource.type === 'box' && overIndex === i ? 'ring-2 ring-primary/50' : ''"
              @dragover.prevent.stop="onRowOver(i)"
              @drop.prevent.stop="onRowDrop(i)"
            >
              <span
                class="grip cursor-grab text-text-muted select-none px-1"
                title="拖动排序"
                draggable="true"
                @dragstart="onGripDrag(i)"
              >⋮⋮</span>

              <span class="flex-1 min-w-0 font-medium text-text truncate">{{ it.name }}</span>

              <div class="flex items-center gap-1 text-xs whitespace-nowrap">
                <span class="text-text-muted">辛苦度</span>
                <input v-model.number="it.difficulty" type="number" step="0.1" min="0" class="w-14 border rounded px-1 py-0.5 text-sm" />
              </div>

              <div class="flex items-center gap-1 text-xs whitespace-nowrap">
                <span class="text-text-muted">人数</span>
                <input v-model.number="it.count" type="number" min="1" class="w-14 border rounded px-1 py-0.5 text-sm" />
              </div>

              <button class="text-danger hover:bg-danger/10 rounded px-1.5 py-0.5 text-sm" title="删除" @click="removeItem(i)">删除</button>
            </div>

            <div v-if="!localItems.length" class="text-center py-6 text-text-muted/60 text-sm">
              从下方拖动劳动项目到此处
            </div>
          </div>
          <p class="text-xs text-text-muted mt-1">提示：可拖动下方项目放入上面，或拖动项目左侧 ⋮⋮ 调整顺序</p>
        </div>

        <!-- 可拖入的项目池 -->
        <div class="mb-5">
          <p class="font-semibold mb-2 text-text">可选项目</p>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="name in poolChips"
              :key="name"
              class="px-3 py-1.5 rounded-lg border text-sm cursor-move select-none transition-theme"
              :class="isInList(name)
                ? 'opacity-40 border-border bg-surface-hover text-text-muted'
                : 'border-info/40 bg-info/10 text-info hover:bg-info/20'"
              :draggable="!isInList(name)"
              @dragstart="onPoolDrag(name)"
              :title="isInList(name) ? '已在列表' : '拖入上方方框'"
            >{{ name }}</span>

            <!-- 添加项目 -->
            <div class="flex items-center gap-1.5">
              <template v-if="adding">
                <input
                  v-model="newPoolName"
                  ref="newInput"
                  class="w-28 border px-2 py-1 rounded text-sm"
                  placeholder="项目名"
                  @keyup.enter="confirmAdd"
                  @blur="confirmAdd"
                />
                <button class="text-info hover:bg-info/10 rounded px-1.5 py-0.5 text-sm" @click="confirmAdd">✓</button>
                <button class="text-text-muted hover:bg-surface-hover rounded px-1.5 py-0.5 text-sm" @click="cancelAdd">✕</button>
              </template>
              <button
                v-else
                class="px-3 py-1.5 rounded-lg border border-dashed border-text-muted text-text-secondary text-sm hover:bg-surface-hover"
                @click="startAdd"
              >+ 添加项目</button>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-border">
          <button class="bg-surface-hover px-4 py-2 rounded text-text" @click="cancel">取消</button>
          <button class="bg-info text-text-inverse px-4 py-2 rounded" @click="save">保存设置</button>
        </div>
      </div>
  </DialogShell>
</template>

<script>
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'

const WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const DEFAULT_POOL = ['擦黑板', '倒垃圾', '拖地', '扫地', '摆桌子']

export default {
  name: 'DutySettingsDialog',
  components: { DialogShell },
  props: {
    visible: Boolean,
    days: { type: Array, default: () => ['周一', '周二', '周三', '周四', '周五'] },
    items: { type: Array, default: () => [] }
  },
  emits: ['save', 'cancel'],
  // 组件内部使用本地副本，避免直接修改父传入的 props/响应式数据
  data() {
    return {
      localDays: [],
      localItems: [],
      customPool: [],
      weekDays: WEEK,
      dragSource: null, // { type: 'pool', name } 或 { type: 'box', index }
      overIndex: -1,
      adding: false,
      newPoolName: ''
    }
  },
  computed: {
    poolChips() {
      return [...DEFAULT_POOL, ...this.customPool]
    },
    isInList() {
      return (name) => this.localItems.some(it => it.name === name)
    }
  },
  watch: {
    visible(val) {
      if (val) {
        this.localDays = [...this.days]
        this.localItems = this.items.map(it => ({ name: it.name, difficulty: it.difficulty == null ? 0.6 : it.difficulty, count: it.count || 1 }))
        this.customPool = []
        this.adding = false
        this.newPoolName = ''
        this.dragSource = null
        this.overIndex = -1
      }
    }
  },
  methods: {
    isDayOn(d) { return this.localDays.includes(d) },
    removeItem(i) { this.localItems.splice(i, 1) },
    // 项目池拖入
    onPoolDrag(name) { this.dragSource = { type: 'pool', name } },
    // 列表内拖动排序
    onGripDrag(i) {
      if (i >= this.localItems.length) return
      this.dragSource = { type: 'box', index: i }
    },
    // 悬停在空区域（末尾追加）
    onBoxOver() {
      if (this.dragSource) this.overIndex = this.localItems.length
    },
    // 悬停在某一行
    onRowOver(i) {
      if (this.dragSource) this.overIndex = i
    },
    onRowDrop(i) {
      if (!this.dragSource) return
      this.placeAt(i)
    },
    onBoxDrop() {
      if (!this.dragSource) return
      this.placeAt(this.overIndex >= 0 ? this.overIndex : this.localItems.length)
    },
    placeAt(targetIdx) {
      const idx = Math.max(0, Math.min(targetIdx, this.localItems.length))
      const source = this.dragSource
      if (source.type === 'pool') {
        if (!this.localItems.some(it => it.name === source.name)) {
          this.localItems.splice(idx, 0, { name: source.name, difficulty: 0.6, count: 1 })
        }
      } else if (source.type === 'box' && source.index !== idx) {
        const moved = this.localItems.splice(source.index, 1)[0]
        this.localItems.splice(idx, 0, moved)
      }
      this.dragSource = null
      this.overIndex = -1
    },
    startAdd() {
      this.adding = true
      this.newPoolName = ''
      this.$nextTick(() => { if (this.$refs && this.$refs.newInput) this.$refs.newInput.focus() })
    },
    cancelAdd() {
      this.adding = false
      this.newPoolName = ''
    },
    confirmAdd() {
      const name = (this.newPoolName || '').trim()
      if (name) {
        if (this.defaultPoolHas(name) || this.customPool.includes(name)) {
          this.adding = false
          this.newPoolName = ''
          return
        }
        this.customPool.push(name)
      }
      this.adding = false
      this.newPoolName = ''
    },
    defaultPoolHas(name) { return DEFAULT_POOL.includes(name) },
    save() {
      // 过滤空姓名
      const items = this.localItems
        .filter(it => (it.name || '').trim())
        .map(it => ({ name: it.name.trim(), difficulty: Number(it.difficulty) || 0, count: Math.max(1, Math.round(Number(it.count)) || 1) }))
      // 天数按 周一到周日 固定顺序输出，避免因勾选顺序导致列乱序
      const days = WEEK.filter(d => this.localDays.includes(d))
      this.$emit('save', { days, items })
    },
    cancel() { this.$emit('cancel') }
  }
}
</script>

<style scoped>
.grip { cursor: grab; }
.grip:active { cursor: grabbing; }
</style>