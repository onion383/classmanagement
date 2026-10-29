<template>
  <!-- 右侧「数据改动」抽屉：与左侧会话抽屉 / 网页抽屉同款毛玻璃卡片，从右侧滑入。
       按项（每个数据表 / 每个技能 md 文件）列出改了什么，并复用既有表格 / 网格 / 行级 diff 展示明细。 -->
  <div class="change-panel pointer-events-auto absolute top-3 right-3 bottom-3 w-[520px] max-w-[72%] bg-surface border border-border shadow-md overflow-hidden flex flex-col">
    <div class="flex items-center gap-2 px-3.5 py-2.5 border-b border-border flex-shrink-0">
      <IconGlyph name="folder" :size="13" tint="current" class="text-text-muted flex-shrink-0" />
      <span class="text-[13px] font-semibold text-text whitespace-nowrap">数据改动</span>
      <span class="text-[11px] text-text-muted whitespace-nowrap">共 {{ summary.total }} 个文件</span>
      <span class="text-[11px] text-success whitespace-nowrap">+{{ summary.added }}</span>
      <span class="text-[11px] text-danger whitespace-nowrap">-{{ summary.removed }}</span>
      <button class="dlg-close ml-auto flex-shrink-0" title="关闭" @click="$emit('close')">✕</button>
    </div>
    <div class="flex-1 min-h-0 p-3">
      <div class="inner-card h-full overflow-y-auto p-3 space-y-3">
      <div v-if="!summary.total" class="text-center text-xs text-text-muted py-6">本轮没有数据改动</div>
      <div v-for="it in summary.items" :key="it.key" class="rounded-lg border border-border overflow-hidden">
        <div class="flex items-center gap-2 px-3 py-2">
          <span class="text-xs font-semibold text-text min-w-0 truncate" :title="it.label">{{ it.label }}</span>
          <span class="ml-auto text-xs text-success flex-shrink-0">+{{ it.added }}</span>
          <span class="text-xs text-danger flex-shrink-0">-{{ it.removed }}</span>
          <button
            v-if="canJump(it)"
            class="jump-btn flex-shrink-0 text-[11px] leading-none px-2 py-1 cursor-pointer text-text-muted hover:text-primary transition-theme"
            title="跳转到该表"
            @click="goto(it, null, gridFocus(it))"
          >跳转</button>
        </div>
        <div class="border-t border-border divide-y divide-border">
          <div v-for="(a, ai) in it.actions" :key="ai" class="px-3 py-2">
            <div class="flex items-center gap-2 mb-1.5">
              <div class="text-[11px] text-text-muted">{{ actionLabel(a, it) }}</div>
              <button
                v-if="actionJumpId(a) != null && canJump(it)"
                class="jump-btn text-[11px] leading-none px-2 py-1 cursor-pointer text-text-muted hover:text-primary transition-theme"
                title="跳转到该行"
                @click="goto(it, actionJumpId(a))"
              >跳转</button>
            </div>
            <!-- 行状表：新增 / 删除（删除用执行时留下的原始行快照）→ 只读表格 -->
            <DynamicTable
              v-if="(a.type === 'add' || a.type === 'del') && a.rows && a.rows.length"
              :fields="fieldsOf(a.rows)"
              :rows="keyedRows(a.rows)"
              :max-height="240"
              readonly
              hideMoveButtons
              hideAddRow
              noRowDrag
            />
            <!-- 修改：字段 → 新值（批量修改为「旧值 → 新值」）；每行带独立「跳转」（精确到行） -->
            <div v-else-if="a.type === 'update'" class="space-y-0.5">
              <div v-for="(u, ui) in (a.rows || [])" :key="ui" class="flex items-center gap-2 text-xs text-text">
                <span class="min-w-0 break-all">
                  <span v-if="u.id != null" class="text-text-muted">#{{ u.id }}　</span>{{ updateText(u) }}
                </span>
                <button
                  v-if="u.id != null && canJump(it)"
                  class="jump-btn flex-shrink-0 text-[11px] leading-none px-2 py-1 cursor-pointer text-text-muted hover:text-primary transition-theme"
                  title="跳转到该行"
                  @click="goto(it, u.id)"
                >跳转</button>
              </div>
            </div>
            <!-- 网格表：复用只读网格预览（按写入的新值渲染） -->
            <AiGridPreview v-else-if="a.type === 'cells'" :table="tableOfItem(it)" :override="a.values" />
            <!-- 技能 md：行级 diff（只列变更行） -->
            <div v-else-if="a.type === 'lines'" class="font-mono text-xs leading-5 max-h-60 overflow-auto">
              <div
                v-for="(l, li) in diffLines(a)"
                :key="li"
                class="whitespace-pre-wrap break-words"
                :class="l.type === 'add' ? 'text-success' : 'text-danger'"
              >{{ l.type === 'add' ? '+ ' : '- ' }}{{ l.text }}</div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import DynamicTable from '../tables/DynamicTable/DynamicTable.vue'
import AiGridPreview from '../tables/AiGridPreview.vue'
import { summarizeProposalChanges, gridCellFocus } from '../../composables/ai/aiMessages.js'
import { TABLE_ROUTE } from '../../composables/ai/aiConstants.js'
import { computed } from 'vue'

defineOptions({ name: 'AiChangePanel' })

const props = defineProps({
  proposal: { type: Object, default: null },
})
const emit = defineEmits(['close', 'goto'])

const summary = computed(() => summarizeProposalChanges(props.proposal))

// 该项对应的表是否有可跳转的业务页（技能 md 无对应表 → 不显示跳转）
function canJump(it) { return !!TABLE_ROUTE[tableOfItem(it)] }
// 发起跳转：向上抛给宿主（AiAssistant）做路由跳转并关闭抽屉。
// focus 为网格表可选的「精确到格子」定位串（课时行/座位列等），为空则只跳到页面。
function goto(it, id, focus) { emit('goto', { table: tableOfItem(it), id, focus: focus || null }) }
// 网格表（课表/座位/权重）改动 → 计算第一个变化格子的定位串，供跳转时精确到格子；
// 行状表或无法确定坐标时返回 null（回退为只跳页面）。
function gridFocus(it) {
  const table = tableOfItem(it)
  const a = (it.actions || []).find((x) => x.type === 'cells')
  return a ? gridCellFocus(table, a.before, a.values) : null
}
// 动作级「精确到行」的跳转目标 id：仅当该动作只作用于单独一行时返回该行 id，否则返回 null
function actionJumpId(a) {
  if (!a || (a.type !== 'add' && a.type !== 'del')) return null
  const rows = a.rows || []
  return rows.length === 1 && rows[0] && rows[0].id != null ? rows[0].id : null
}
// 每个动作行的说明文案（增删条数 / 修改字段数 / 写入格子数 / md 行数）
function actionLabel(a, it) {
  if (a.type === 'add') return `增加 ${a.count} 条数据`
  if (a.type === 'del') return `删除 ${a.count} 条数据`
  if (a.type === 'update') return `修改 ${a.count} 个字段`
  if (a.type === 'cells') return `写入 ${a.count} 个格子`
  if (a.type === 'lines') return `新增 ${it.added} 行 · 删除 ${it.removed} 行`
  return ''
}
// 项的 key 形如 grid:schedule / table:students / skill:xxx，取回原始表名供网格预览使用
function tableOfItem(it) { return (it.key || '').split(':')[1] || '' }
// 只读表格：各行列可能不同，取并集做表头并保持首次出现的顺序
function fieldsOf(rows) {
  const keys = []
  for (const r of rows) for (const k of Object.keys(r || {})) if (!keys.includes(k)) keys.push(k)
  return keys.map((name) => ({ name }))
}
function keyedRows(rows) { return rows.map((r, i) => ({ ...r, _rowKey: i })) }
function fmtVal(v) {
  if (v == null) return ''
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch (_) { return String(v) } }
  return String(v)
}
// 修改明细：单条为「字段: 新值」，批量修改为「字段: 旧值 → 新值」
function updateText(u) {
  if (u && u.changes && typeof u.changes === 'object') {
    return Object.entries(u.changes).map(([k, v]) => `${k}: ${fmtVal(v)}`).join('、')
  }
  if (u && Array.isArray(u.diff)) {
    return u.diff.map((d) => `${d.field}: ${fmtVal(d.from)} → ${fmtVal(d.to)}`).join('、')
  }
  return ''
}
function diffLines(a) { return a && a.diff ? a.diff.lines.filter((l) => l.type !== 'ctx') : [] }
</script>

<style scoped>
/* 面板本体：position 必须保持 absolute（压掉 .bg-surface 自带的 relative），玻璃配方对齐左侧会话抽屉。
   选择器用 .bg-surface.change-panel 提高到 (0,3,0)，理由同 AiConversationPanel（主题注入顺序会飘）。 */
.bg-surface.change-panel {
  position: absolute !important;
  backdrop-filter: blur(30px) saturate(1.2) !important;
  background-color: rgba(255, 255, 255, 0.5) !important;
  /* 极淡暖黄调，与左右两个抽屉一致 */
  background-image: linear-gradient(rgba(255, 205, 130, 0.01), rgba(255, 205, 130, 0.01));
}
/* 抽屉内圆角统一为主题表面圆角，压掉毛玻璃主题给 button 的皮肤与 .dlg-close 的默认档。 */
.change-panel,
.change-panel button {
  border-radius: var(--radius-surface) !important;
}
/* 内容区再套一层卡片：在抽屉的毛玻璃之上叠一层主题卡片底 + 描边，
   让明细内容浮在卡片上，而不是直接贴在玻璃上。
   底色用 color-mix 由 --color-surface 派生（深色模式随之变暗，不额外提亮）。
   同心：.inner-card 内缩在抽屉的 p-3（12px）之内，圆角 = 抽屉圆角 − 12px，
   内外圆弧共享圆心；改抽屉圆角时内层自动跟随，不会脱节。 */
.inner-card {
  border-radius: calc(var(--radius-surface) - var(--radius-concentric-gap));
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface, #fff) 45%, transparent);
}
/* 「跳转」小按钮：与抽屉内其它小按钮一致的描边皮肤 */
.jump-btn {
  border: 1px solid var(--color-border);
}
.jump-btn:hover { border-color: var(--color-primary); }
</style>
