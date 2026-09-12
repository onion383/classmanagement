<template>
  <Teleport to="body">
  <Transition name="dialog">
    <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10006] pointer-events-auto" @click.self="cancel">
      <div class="shutdown-card dialog-card">
        <!-- 顶部条：左侧小标签 + 右侧 X 关闭 -->
        <div class="shutdown-header">
          <span class="shutdown-tag">退出行为</span>
          <button class="shutdown-x" @click="cancel" title="关闭">×</button>
        </div>

        <!-- 标题区 -->
        <div class="shutdown-title-wrap">
          <h2 class="shutdown-title">关闭班级管理系统</h2>
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

<script>
// 主窗口关闭选择菜单：复用 dialog-transition.css 的弹窗动画
import '../../styles/dialog-transition.css'
import { Monitor, PanelsTopLeft, LayoutGrid, Power } from '@lucide/vue'

export default {
  name: 'ShutdownMenuDialog',
  components: { Monitor, PanelsTopLeft, LayoutGrid, Power },
  props: {
    visible: Boolean,
    hasToolbox: Boolean,
    hasDesktop: Boolean,
  },
  data() {
    return { remember: false }
  },
  emits: ['choose', 'cancel'],
  methods: {
    choose(action) { this.$emit('choose', { action, remember: this.remember }) },
    cancel() { this.$emit('cancel') },
  },
}
</script>

<style scoped>
/* ========== 卡片容器 ========== */
.shutdown-card {
  position: relative;
  width: 460px;
  max-width: calc(100vw - 32px);
  padding: 24px 28px 20px;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.06);
  text-align: left;
  color: #1f2937;
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
  color: #6b7280;
  background: #f3f4f6;
  border-radius: 999px;
  letter-spacing: 0.5px;
}
.shutdown-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.shutdown-x:hover {
  background: #e5e7eb;
  color: #111827;
}

/* ========== 标题区 ========== */
.shutdown-title-wrap {
  margin-bottom: 18px;
}
.shutdown-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
  color: #111827;
  line-height: 1.3;
}
.shutdown-subtitle {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
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
  background: #f9fafb;
  border: 1px solid transparent;
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.shutdown-opt:hover:not(:disabled) {
  background: #f3f4f6;
  border-color: #e5e7eb;
}
.shutdown-opt:active:not(:disabled) {
  transform: scale(0.99);
}
.shutdown-opt.opt-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.shutdown-opt.opt-danger:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #fecaca;
}

/* 图标盒 */
.opt-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
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
  color: #111827;
  line-height: 1.4;
}
.opt-desc {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
}
.opt-muted-inline {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: #9ca3af;
}

/* ========== 复选框 ========== */
.shutdown-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin: 4px 0 12px;
  background: #f9fafb;
  border: 1px solid #f3f4f6;
  border-radius: 10px;
  font-size: 13px;
  color: #4b5563;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.shutdown-check:hover {
  background: #f3f4f6;
}
.shutdown-check input {
  display: none;
}
.shutdown-check .check-box {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border: 1.5px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  position: relative;
  transition: background 0.15s, border-color 0.15s;
}
.shutdown-check input:checked + .check-box {
  background: #2563eb;
  border-color: #2563eb;
}
.shutdown-check input:checked + .check-box::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 0px;
  width: 5px;
  height: 10px;
  border: solid #fff;
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
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  color: #374151;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.shutdown-cancel:hover {
  background: #f9fafb;
  border-color: #d1d5db;
  color: #111827;
}
</style>
