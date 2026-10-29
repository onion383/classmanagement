<template>
  <Teleport to="body">
  <Transition name="dialog">
    <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10006] pointer-events-auto" @click.self="cancel">
      <div class="shutdown-card dialog-card">
        <!-- 顶部条：左侧小标签 + 右侧 X 关闭 -->
        <div class="shutdown-header">
          <span class="shutdown-tag">退出行为</span>
          <button class="dlg-close" @click="cancel" title="关闭">×</button>
        </div>

        <!-- 标题区 -->
        <div class="shutdown-title-wrap">
          <h2 class="shutdown-title">关闭班集</h2>
          <p class="shutdown-subtitle">你可以保留后台进程与组件窗口，或者直接完全退出应用。</p>
        </div>

        <!-- 选项卡 -->
        <div class="shutdown-options">
          <button class="shutdown-opt" @click="choose('main')">
            <span class="opt-icon opt-icon-blue">
              <Monitor :size="22" stroke-width="1.8" />
            </span>
            <span class="opt-text">
              <span class="opt-title">关闭主窗口</span>
              <span class="opt-desc">仅关闭主窗口，工具箱与桌面组件继续在后台运行。</span>
            </span>
          </button>

          <button class="shutdown-opt" :class="{ 'opt-disabled': !hasToolbox }" :disabled="!hasToolbox" @click="choose('toolbox')">
            <span class="opt-icon opt-icon-cyan">
              <PanelsTopLeft :size="22" stroke-width="1.8" />
            </span>
            <span class="opt-text">
              <span class="opt-title">关闭主窗口和工具箱<span v-if="!hasToolbox" class="opt-muted-inline">（未开启）</span></span>
              <span class="opt-desc">关闭主窗口与浮窗工具箱，桌面组件继续运行。</span>
            </span>
          </button>

          <button class="shutdown-opt" :class="{ 'opt-disabled': !hasDesktop }" :disabled="!hasDesktop" @click="choose('desktop')">
            <span class="opt-icon opt-icon-green">
              <LayoutGrid :size="22" stroke-width="1.8" />
            </span>
            <span class="opt-text">
              <span class="opt-title">关闭主窗口和桌面组件<span v-if="!hasDesktop" class="opt-muted-inline">（未开启）</span></span>
              <span class="opt-desc">关闭主窗口与桌面小组件，工具箱继续运行。</span>
            </span>
          </button>

          <button class="shutdown-opt opt-danger" @click="choose('all')">
            <span class="opt-icon opt-icon-red">
              <Power :size="22" stroke-width="1.8" />
            </span>
            <span class="opt-text">
              <span class="opt-title">完全关闭</span>
              <span class="opt-desc">结束所有进程并停止后端服务，下次需要重新启动。</span>
            </span>
          </button>
        </div>

        <!-- 复选框：下次不再提示 -->
        <label class="shutdown-check">
          <input type="checkbox" v-model="remember" />
          <span class="check-box"></span>
          <span>下次不再提示，直接按本次选择处理</span>
        </label>

        <!-- 底部取消按钮 -->
        <div class="shutdown-footer">
          <button class="shutdown-cancel" @click="cancel">取消</button>
        </div>
      </div>
    </div>
  </Transition>
  </Teleport>
</template>

<script setup>
// 主窗口关闭选择菜单：复用 dialog-transition.css 的弹窗动画
import { ref } from 'vue'
import '../../styles/dialog-transition.css'
import { Monitor, PanelsTopLeft, LayoutGrid, Power } from '@lucide/vue'

defineOptions({ name: 'ShutdownMenuDialog' })
defineProps({
  visible: Boolean,
  hasToolbox: Boolean,
  hasDesktop: Boolean,
})
const emit = defineEmits(['choose', 'cancel'])

const remember = ref(false)

function choose(action) { emit('choose', { action, remember: remember.value }) }
function cancel() { emit('cancel') }
</script>

<style scoped>
/* ========== 卡片容器 ========== */
.shutdown-card {
  position: relative;
  width: 460px;
  max-width: calc(100vw - 32px);
  padding: 24px 28px 20px;
  /* 取色一律走主题变量：--color-surface 各主题都有定义，glass / glass2 的夜间取值
     已在 theme-night.css 里重映射，故日/夜与其它主题都会自动跟随，无硬编码颜色。
     再叠一层 backdrop-filter 做「第二层毛玻璃」（与引导页玻璃面板同一套做法）。 */
  background: var(--color-surface);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-surface);
  box-shadow: var(--shadow-lg);
  text-align: left;
  color: var(--color-text);
}

/* ========== 顶部：标签 + 关闭按钮 ========== */
.shutdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.shutdown-tag {
  display: inline-block;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
  border-radius: 999px;
  letter-spacing: 0.5px;
}
/* 关闭按钮：方形毛玻璃 × 统一走全局公共类 .dlg-close（见 styles/utilities.css） */

/* ========== 标题区 ========== */
.shutdown-title-wrap {
  margin-bottom: 18px;
}
.shutdown-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1.3;
}
.shutdown-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

/* ========== 选项卡 ========== */
.shutdown-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.shutdown-opt {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 16px;
  /* 用文字色按比例混出的弱底纹：日间接近原来的 #f9fafb，夜间自动变成浅色微亮，
     无需为深浅两套模式各写一份取色。 */
  background: color-mix(in srgb, var(--color-text) 4%, transparent);
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.shutdown-opt:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-text) 9%, transparent);
  border-color: var(--color-border-strong);
}
.shutdown-opt:active:not(:disabled) {
  transform: scale(0.99);
}
.shutdown-opt.opt-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.shutdown-opt.opt-danger:hover:not(:disabled) {
  /* 危险项 hover：用 --color-danger 按比例混出浅红底 / 描边（日间 ≈ 原来的 #fef2f2 / #fecaca），
     夜间由 theme-night.css 的 C3 覆盖成更明显的暗红。 */
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border-color: color-mix(in srgb, var(--color-danger) 28%, transparent);
}

/* 图标盒：底色/图标色沿用日间语义色，夜间在 theme-night.css C3 统一提亮 */
.opt-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-control);
}
.opt-icon-blue   { background: rgba(59, 130, 246, 0.12); color: #2563eb; }
.opt-icon-cyan   { background: rgba(6, 182, 212, 0.12);  color: #0891b2; }
.opt-icon-green  { background: rgba(34, 197, 94, 0.12);  color: #16a34a; }
.opt-icon-red    { background: rgba(239, 68, 68, 0.12);  color: #dc2626; }

/* 文本区 */
.opt-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.opt-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.4;
}
.opt-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.opt-muted-inline {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-muted);
}

/* ========== 复选框 ========== */
.shutdown-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin: 4px 0 12px;
  /* 弱底纹统一用文字色按比例混出：日间≈原来的 #f9fafb，夜间自动变浅色微亮 */
  background: color-mix(in srgb, var(--color-text) 4%, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.shutdown-check:hover {
  background: color-mix(in srgb, var(--color-text) 7%, transparent);
}
.shutdown-check input {
  display: none;
}
.shutdown-check .check-box {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--color-border-strong);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  position: relative;
  transition: background 0.15s, border-color 0.15s;
}
.shutdown-check input:checked + .check-box {
  background: var(--color-primary);
  border-color: var(--color-primary);
}
.shutdown-check input:checked + .check-box::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 0px;
  width: 5px;
  height: 10px;
  border: solid var(--color-text-inverse);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

/* ========== 底部：取消按钮 ========== */
.shutdown-footer {
  display: flex;
  justify-content: flex-end;
}
.shutdown-cancel {
  padding: 8px 22px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: 999px;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.shutdown-cancel:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border-strong);
  color: var(--color-text);
}
</style>
