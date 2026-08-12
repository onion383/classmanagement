<template>
  <div class="test-view" :class="themeClass">
    <!-- ==================== 主题切换栏 ==================== -->
    <div class="glass-bar">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">UI 组件测试</h1>
        <div class="flex items-center gap-2">
          <span class="text-sm text-text-secondary">主题：</span>
          <button
            v-for="t in themes"
            :key="t.value"
            @click="setTheme(t.value)"
            :class="['px-3 py-1.5 rounded-full text-sm font-medium transition-all', theme === t.value ? t.activeClass : 'bg-surface-hover text-text-muted hover:bg-surface']"
          >{{ t.label }}</button>
        </div>
      </div>
    </div>

    <!-- ==================== 毛玻璃专属：统计卡片 ==================== -->
    <section v-if="theme === 'glass'">
      <h2 class="section-title">毛玻璃统计卡片</h2>
      <div class="grid grid-cols-4 gap-4">
        <div class="glass-card glass-card-blue">
          <div class="glass-card-icon">👥</div>
          <div class="text-3xl font-bold">128</div>
          <div class="text-sm text-text-secondary">学生总数</div>
        </div>
        <div class="glass-card glass-card-green">
          <div class="glass-card-icon">🏫</div>
          <div class="text-3xl font-bold">6</div>
          <div class="text-sm text-text-secondary">班级数量</div>
        </div>
        <div class="glass-card glass-card-purple">
          <div class="glass-card-icon">📊</div>
          <div class="text-3xl font-bold">95%</div>
          <div class="text-sm text-text-secondary">出勤率</div>
        </div>
        <div class="glass-card glass-card-orange">
          <div class="glass-card-icon">💰</div>
          <div class="text-3xl font-bold">¥5,280</div>
          <div class="text-sm text-text-secondary">班费余额</div>
        </div>
      </div>
    </section>

    <!-- ==================== 毛玻璃专属：彩色面板 ==================== -->
    <section v-if="theme === 'glass'">
      <h2 class="section-title">毛玻璃彩色面板</h2>
      <div class="grid grid-cols-3 gap-4">
        <div class="glass-panel glass-panel-blue">
          <div class="glass-panel-dot"></div>
          <h3 class="font-semibold text-lg mb-1">课堂表现</h3>
          <p class="text-sm text-text-secondary">本月共记录 32 条课堂反馈，优秀率 87%</p>
        </div>
        <div class="glass-panel glass-panel-green">
          <div class="glass-panel-dot"></div>
          <h3 class="font-semibold text-lg mb-1">作业完成</h3>
          <p class="text-sm text-text-secondary">本周作业提交率 96%，3 人未交</p>
        </div>
        <div class="glass-panel glass-panel-pink">
          <div class="glass-panel-dot"></div>
          <h3 class="font-semibold text-lg mb-1">活动通知</h3>
          <p class="text-sm text-text-secondary">下周五举行春季运动会，请做好准备</p>
        </div>
      </div>
    </section>

    <!-- ==================== 毛玻璃专属：导航栏 ==================== -->
    <section v-if="theme === 'glass'">
      <h2 class="section-title">毛玻璃导航栏</h2>
      <div class="glass-nav">
        <span class="font-bold text-lg">MyApp</span>
        <div class="flex gap-4">
          <a href="#" class="text-sm text-text-secondary hover:text-text">首页</a>
          <a href="#" class="text-sm text-text-secondary hover:text-text">课程</a>
          <a href="#" class="text-sm text-primary font-medium">座位</a>
          <a href="#" class="text-sm text-text-secondary hover:text-text">设置</a>
        </div>
        <div class="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-text-inverse text-xs font-bold">M</div>
      </div>
    </section>

    <!-- ==================== 毛玻璃专属：输入框 ==================== -->
    <section v-if="theme === 'glass'">
      <h2 class="section-title">毛玻璃输入框</h2>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">搜索</label>
          <div class="glass-input-wrap">
            <span class="text-text-muted mr-2">🔍</span>
            <input type="text" placeholder="搜索学生、课程..." class="glass-input" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">邮箱</label>
          <input type="text" placeholder="example@mail.com" class="glass-input w-full" />
        </div>
      </div>
    </section>

    <!-- ==================== 毛玻璃专属：模态框 ==================== -->
    <section v-if="theme === 'glass'">
      <h2 class="section-title">毛玻璃模态框</h2>
      <div class="glass-backdrop-demo">
        <div class="glass-modal">
          <h3 class="text-lg font-bold mb-4">确认操作</h3>
          <p class="text-sm text-text-secondary mb-4">确定要删除该学生吗？此操作不可撤销。</p>
          <div class="flex justify-end gap-2">
            <button class="px-4 py-2 rounded-lg bg-white/30 text-text text-sm">取消</button>
            <button class="px-4 py-2 rounded-lg bg-danger text-white text-sm">删除</button>
          </div>
        </div>
      </div>
    </section>

    <!-- ==================== 按钮 ==================== -->
    <section>
      <h2 class="section-title">按钮</h2>
      <div class="space-y-3">
        <div>
          <span class="text-sm text-text-secondary mr-2">语义色：</span>
          <button class="bg-primary text-text-inverse px-4 py-2 rounded mr-2">Primary</button>
          <button class="bg-success text-text-inverse px-4 py-2 rounded mr-2">Success</button>
          <button class="bg-warning text-text-inverse px-4 py-2 rounded mr-2">Warning</button>
          <button class="bg-danger text-text-inverse px-4 py-2 rounded mr-2">Danger</button>
          <button class="bg-info text-text-inverse px-4 py-2 rounded mr-2">Info</button>
        </div>
        <div>
          <span class="text-sm text-text-secondary mr-2">尺寸：</span>
          <button class="bg-primary text-text-inverse px-2 py-1 text-sm rounded mr-2">小</button>
          <button class="bg-primary text-text-inverse px-4 py-2 rounded mr-2">中</button>
          <button class="bg-primary text-text-inverse px-6 py-3 text-lg rounded mr-2">大</button>
        </div>
        <div>
          <span class="text-sm text-text-secondary mr-2">禁用：</span>
          <button disabled class="bg-primary text-text-inverse px-4 py-2 rounded opacity-50 cursor-not-allowed mr-2">Disabled</button>
          <button disabled class="bg-surface-hover text-text-muted px-4 py-2 rounded cursor-not-allowed mr-2">取消</button>
        </div>
        <div>
          <span class="text-sm text-text-secondary mr-2">轮廓：</span>
          <button class="border border-primary text-primary px-4 py-2 rounded mr-2 bg-transparent">Outline</button>
          <button class="border border-danger text-danger px-4 py-2 rounded mr-2 bg-transparent">Danger Outline</button>
        </div>
        <div>
          <span class="text-sm text-text-secondary mr-2">圆角：</span>
          <button class="bg-info text-text-inverse px-4 py-2 rounded-sm mr-2">sm</button>
          <button class="bg-info text-text-inverse px-4 py-2 rounded-md mr-2">md</button>
          <button class="bg-info text-text-inverse px-4 py-2 rounded-lg mr-2">lg</button>
          <button class="bg-info text-text-inverse px-4 py-2 rounded-full mr-2">full</button>
        </div>
      </div>
    </section>

    <!-- ==================== 输入框 ==================== -->
    <section>
      <h2 class="section-title">输入框</h2>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">文本输入</label>
          <input type="text" placeholder="请输入文本" class="w-full border px-3 py-2 rounded" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">数字输入</label>
          <input type="number" placeholder="0" min="1" max="100" class="w-full border px-3 py-2 rounded" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">禁用状态</label>
          <input type="text" disabled value="不可编辑" class="w-full border px-3 py-2 rounded bg-surface-hover text-text-muted" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">只读状态</label>
          <input type="text" readonly value="只读内容" class="w-full border px-3 py-2 rounded bg-surface-hover" />
        </div>
      </div>
    </section>

    <!-- ==================== 选择器 ==================== -->
    <section>
      <h2 class="section-title">选择器</h2>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">下拉选择</label>
          <select class="w-full border px-3 py-2 rounded bg-surface">
            <option>选项一</option>
            <option>选项二</option>
            <option>选项三</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">复选框</label>
          <div class="space-y-1">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked /> 已选中
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" /> 未选中
            </label>
            <label class="flex items-center gap-2 cursor-pointer opacity-50">
              <input type="checkbox" disabled /> 禁用
            </label>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">单选框</label>
          <div class="space-y-1">
            <label class="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="test-radio" checked /> 选项 A
            </label>
            <label class="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="test-radio" /> 选项 B
            </label>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">开关</label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked class="sr-only peer" />
            <div class="w-10 h-5 bg-border rounded-full peer-checked:bg-primary relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:w-4 after:h-4 after:transition-all peer-checked:after:translate-x-5"></div>
            <span class="text-sm">启用</span>
          </label>
        </div>
      </div>
    </section>

    <!-- ==================== 卡片 / 面板 ==================== -->
    <section>
      <h2 class="section-title">卡片 / 面板</h2>
      <div class="grid grid-cols-3 gap-4">
        <div class="bg-surface rounded-lg p-4 shadow-card">
          <h3 class="font-semibold mb-1">默认卡片</h3>
          <p class="text-sm text-text-secondary">shadow-card 圆角 lg</p>
        </div>
        <div class="bg-surface rounded-lg p-4 shadow-md">
          <h3 class="font-semibold mb-1">中等阴影</h3>
          <p class="text-sm text-text-secondary">shadow-md</p>
        </div>
        <div class="bg-surface rounded-lg p-4 shadow-lg">
          <h3 class="font-semibold mb-1">大阴影</h3>
          <p class="text-sm text-text-secondary">shadow-lg</p>
        </div>
        <div class="bg-primary-light rounded-lg p-4 border border-primary/30">
          <h3 class="font-semibold text-primary">Primary 浅色</h3>
          <p class="text-sm text-text-secondary">bg-primary-light</p>
        </div>
        <div class="bg-warning-light rounded-lg p-4 border border-warning/30">
          <h3 class="font-semibold text-warning">Warning 浅色</h3>
          <p class="text-sm text-text-secondary">bg-warning-light</p>
        </div>
        <div class="bg-danger/10 rounded-lg p-4 border border-danger/30">
          <h3 class="font-semibold text-danger">Danger 浅色</h3>
          <p class="text-sm text-text-secondary">bg-danger/10</p>
        </div>
      </div>
    </section>

    <!-- ==================== 标签 / 徽章 ==================== -->
    <section>
      <h2 class="section-title">标签 / 徽章</h2>
      <div class="flex flex-wrap gap-2">
        <span class="bg-primary-light text-primary px-2 py-0.5 rounded-full text-xs font-medium">Primary</span>
        <span class="bg-success/20 text-success px-2 py-0.5 rounded-full text-xs font-medium">Success</span>
        <span class="bg-warning/20 text-warning px-2 py-0.5 rounded-full text-xs font-medium">Warning</span>
        <span class="bg-danger/20 text-danger px-2 py-0.5 rounded-full text-xs font-medium">Danger</span>
        <span class="bg-info/20 text-info px-2 py-0.5 rounded-full text-xs font-medium">Info</span>
        <span class="bg-surface-hover text-text-muted px-2 py-0.5 rounded-full text-xs font-medium">Default</span>
      </div>
    </section>

    <!-- ==================== 表格 ==================== -->
    <section>
      <h2 class="section-title">表格</h2>
      <div class="overflow-auto border rounded">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="bg-primary text-text-inverse border border-border px-3 py-2 text-left">姓名</th>
              <th class="bg-primary text-text-inverse border border-border px-3 py-2 text-left">班级</th>
              <th class="bg-primary text-text-inverse border border-border px-3 py-2 text-center">状态</th>
              <th class="bg-primary text-text-inverse border border-border px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr class="hover:bg-surface-hover">
              <td class="border border-border px-3 py-2">张三</td>
              <td class="border border-border px-3 py-2">三年级一班</td>
              <td class="border border-border px-3 py-2 text-center">
                <span class="bg-success/20 text-success px-2 py-0.5 rounded-full text-xs">在读</span>
              </td>
              <td class="border border-border px-3 py-2 text-right">
                <button class="text-info hover:underline text-sm mr-2">编辑</button>
                <button class="text-danger hover:underline text-sm">删除</button>
              </td>
            </tr>
            <tr class="hover:bg-surface-hover">
              <td class="border border-border px-3 py-2">李四</td>
              <td class="border border-border px-3 py-2">三年级一班</td>
              <td class="border border-border px-3 py-2 text-center">
                <span class="bg-warning/20 text-warning px-2 py-0.5 rounded-full text-xs">请假</span>
              </td>
              <td class="border border-border px-3 py-2 text-right">
                <button class="text-info hover:underline text-sm mr-2">编辑</button>
                <button class="text-danger hover:underline text-sm">删除</button>
              </td>
            </tr>
            <tr class="hover:bg-surface-hover">
              <td class="border border-border px-3 py-2">王五</td>
              <td class="border border-border px-3 py-2">三年级二班</td>
              <td class="border border-border px-3 py-2 text-center">
                <span class="bg-danger/20 text-danger px-2 py-0.5 rounded-full text-xs">退学</span>
              </td>
              <td class="border border-border px-3 py-2 text-right">
                <button class="text-info hover:underline text-sm mr-2">编辑</button>
                <button class="text-danger hover:underline text-sm">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ==================== 通知测试 ==================== -->
    <section>
      <h2 class="section-title">通知弹窗</h2>
      <div class="flex flex-wrap gap-2">
        <button @click="notifySuccess('操作已成功完成')" class="bg-success text-text-inverse px-4 py-2 rounded">Success</button>
        <button @click="notifyError('操作失败，请重试')" class="bg-danger text-text-inverse px-4 py-2 rounded">Error</button>
        <button @click="notifyWarning('请注意检查数据')" class="bg-warning text-text-inverse px-4 py-2 rounded">Warning</button>
        <button @click="notifyInfo('这是一条提示信息')" class="bg-info text-text-inverse px-4 py-2 rounded">Info</button>
        <button @click="notifyError('设置的行/列过大\n过大的行和列会引起显示问题和程序卡顿')" class="bg-danger text-text-inverse px-4 py-2 rounded">多行 Error</button>
      </div>
    </section>

    <!-- ==================== 排版 ==================== -->
    <section>
      <h2 class="section-title">排版</h2>
      <div class="space-y-2">
        <h1 class="text-2xl font-bold">Heading 1 (2xl / bold)</h1>
        <h2 class="text-xl font-semibold">Heading 2 (xl / semibold)</h2>
        <h3 class="text-lg font-medium">Heading 3 (lg / medium)</h3>
        <p class="text-base">正文 (base) — 这是默认的正文字号，用于大部分内容。</p>
        <p class="text-sm text-text-secondary">小字 (sm / secondary) — 用于辅助说明文字。</p>
        <p class="text-xs text-text-muted">超小字 (xs / muted) — 用于脚注和细微提示。</p>
      </div>
      <div class="mt-3 space-x-2">
        <span class="text-text">text</span>
        <span class="text-text-secondary">text-secondary</span>
        <span class="text-text-muted">text-muted</span>
        <span class="text-primary">text-primary</span>
        <span class="text-success">text-success</span>
        <span class="text-warning">text-warning</span>
        <span class="text-danger">text-danger</span>
        <span class="text-info">text-info</span>
      </div>
    </section>

    <!-- ==================== 对话框模拟 ==================== -->
    <section>
      <h2 class="section-title">对话框</h2>
      <div class="bg-surface rounded-lg p-6 w-80 shadow-card border">
        <h3 class="text-lg font-bold mb-4">座位设置</h3>
        <div class="mb-3">
          <label class="block text-sm font-medium">行数</label>
          <input type="number" min="1" max="50" class="w-full border px-3 py-2 rounded" value="6" />
        </div>
        <div class="mb-3">
          <label class="block text-sm font-medium">列数</label>
          <input type="number" min="1" max="30" class="w-full border px-3 py-2 rounded" value="7" />
        </div>
        <div class="mb-3">
          <label class="block text-sm font-medium mb-1">座位模式</label>
          <div class="flex gap-4">
            <label class="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="test-mode" checked /> 单桌
            </label>
            <label class="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="test-mode" /> 同桌
            </label>
          </div>
        </div>
        <div class="mb-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked /> 显示走廊
          </label>
          <p class="text-xs text-text-muted mt-1">单桌：每列间有走廊；同桌：每两列为一组，组间有走廊。</p>
        </div>
        <div class="flex justify-end gap-2">
          <button class="bg-surface-hover px-4 py-2 rounded text-text">取消</button>
          <button class="bg-info text-text-inverse px-4 py-2 rounded">保存</button>
        </div>
      </div>
    </section>

    <!-- ==================== 颜色色板 ==================== -->
    <section>
      <h2 class="section-title">颜色色板</h2>
      <div class="space-y-3">
        <div>
          <span class="text-sm text-text-secondary">品牌色：</span>
          <div class="flex gap-2 mt-1">
            <div class="w-12 h-12 rounded bg-primary flex items-center justify-center text-xs text-text-inverse">primary</div>
            <div class="w-12 h-12 rounded bg-primary-hover flex items-center justify-center text-xs text-text-inverse">hover</div>
            <div class="w-12 h-12 rounded bg-primary-active flex items-center justify-center text-xs text-text-inverse">active</div>
            <div class="w-12 h-12 rounded bg-primary-light flex items-center justify-center text-xs text-primary">light</div>
          </div>
        </div>
        <div>
          <span class="text-sm text-text-secondary">功能色：</span>
          <div class="flex gap-2 mt-1">
            <div class="w-12 h-12 rounded bg-success flex items-center justify-center text-xs text-text-inverse">success</div>
            <div class="w-12 h-12 rounded bg-warning flex items-center justify-center text-xs text-text-inverse">warning</div>
            <div class="w-12 h-12 rounded bg-danger flex items-center justify-center text-xs text-text-inverse">danger</div>
            <div class="w-12 h-12 rounded bg-info flex items-center justify-center text-xs text-text-inverse">info</div>
          </div>
        </div>
        <div>
          <span class="text-sm text-text-secondary">背景色：</span>
          <div class="flex gap-2 mt-1">
            <div class="w-12 h-12 rounded bg-bg border flex items-center justify-center text-xs text-text-muted">bg</div>
            <div class="w-12 h-12 rounded bg-surface border flex items-center justify-center text-xs text-text-muted">surface</div>
            <div class="w-12 h-12 rounded bg-surface-hover border flex items-center justify-center text-xs text-text-muted">hover</div>
            <div class="w-12 h-12 rounded bg-sidebar flex items-center justify-center text-xs text-text-inverse">sidebar</div>
          </div>
        </div>
        <div>
          <span class="text-sm text-text-secondary">文字色：</span>
          <div class="flex gap-2 mt-1">
            <div class="w-12 h-12 rounded bg-surface border flex items-center justify-center text-xs text-text">text</div>
            <div class="w-12 h-12 rounded bg-surface border flex items-center justify-center text-xs text-text-secondary">secondary</div>
            <div class="w-12 h-12 rounded bg-surface border flex items-center justify-center text-xs text-text-muted">muted</div>
            <div class="w-12 h-12 rounded bg-sidebar flex items-center justify-center text-xs text-text-inverse">inverse</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import { useNotification } from '../composables/useNotification.js'

export default {
  name: 'TestView',
  setup() {
    const { success, error, warning, info } = useNotification()
    return { notifySuccess: success, notifyError: error, notifyWarning: warning, notifyInfo: info }
  },
  data() {
    return {
      theme: 'default',
      themes: [
        { value: 'default', label: '默认', activeClass: 'bg-primary text-white' },
        { value: 'glass', label: '毛玻璃', activeClass: 'bg-primary text-white' },
        { value: 'minimal', label: '极简', activeClass: 'bg-primary text-white' }
      ]
    }
  },
  computed: {
    themeClass() {
      return this.theme === 'default' ? '' : `theme-${this.theme}`
    }
  },
  methods: {
    setTheme(t) {
      this.theme = t
      if (t === 'default') {
        document.documentElement.removeAttribute('data-theme')
      } else {
        document.documentElement.setAttribute('data-theme', t)
      }
    }
  }
}
</script>

<style scoped>
/* ========== 共享 ========== */
.section-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--color-border);
}

/* ========== 默认主题背景装饰 ========== */
.test-view {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  min-height: 100%;
}

/* ========== 毛玻璃主题 ========== */
.theme-glass {
  background: #ffffff;
}

/* 顶栏毛玻璃 */
.glass-bar {
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 16px;
  padding: 1rem 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

/* ---- 统计卡片（彩色玻璃） ---- */
.glass-card {
  border-radius: 20px;
  padding: 1.5rem 1.25rem;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid;
  box-shadow: 0 4px 20px rgba(0,0,0,0.04);
  transition: transform 0.2s, box-shadow 0.2s;
}
.glass-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 30px rgba(0,0,0,0.08);
}
.glass-card-icon {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}
.glass-card-blue {
  background: rgba(219, 234, 254, 0.55);
  border-color: rgba(147, 197, 253, 0.4);
}
.glass-card-green {
  background: rgba(220, 252, 231, 0.55);
  border-color: rgba(134, 239, 172, 0.4);
}
.glass-card-purple {
  background: rgba(237, 233, 254, 0.55);
  border-color: rgba(196, 181, 253, 0.4);
}
.glass-card-orange {
  background: rgba(255, 237, 213, 0.55);
  border-color: rgba(253, 186, 116, 0.4);
}

/* ---- 彩色面板 ---- */
.glass-panel {
  border-radius: 18px;
  padding: 1.25rem;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid;
  box-shadow: 0 4px 20px rgba(0,0,0,0.04);
  position: relative;
}
.glass-panel-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-bottom: 0.75rem;
}
.glass-panel-blue {
  background: rgba(239, 246, 255, 0.6);
  border-color: rgba(191, 219, 254, 0.5);
}
.glass-panel-blue .glass-panel-dot {
  background: #3b82f6;
}
.glass-panel-green {
  background: rgba(240, 253, 244, 0.6);
  border-color: rgba(187, 247, 208, 0.5);
}
.glass-panel-green .glass-panel-dot {
  background: #22c55e;
}
.glass-panel-pink {
  background: rgba(253, 242, 248, 0.6);
  border-color: rgba(251, 207, 232, 0.5);
}
.glass-panel-pink .glass-panel-dot {
  background: #ec4899;
}

/* 导航栏 */
.glass-nav {
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 16px;
  padding: 0.75rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

/* 输入框 */
.glass-input-wrap {
  display: flex;
  align-items: center;
  background: rgba(0,0,0,0.03);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 12px;
  padding: 0.5rem 0.75rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.glass-input-wrap:focus-within {
  border-color: rgba(59,130,246,0.4);
  box-shadow: 0 0 0 3px rgba(59,130,246,0.08);
}
.glass-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text);
  font-size: 0.875rem;
}
.glass-input::placeholder {
  color: var(--color-text-muted);
}
input.glass-input[type="text"] {
  background: rgba(0,0,0,0.03);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 12px;
  padding: 0.5rem 0.75rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
input.glass-input[type="text"]:focus {
  border-color: rgba(59,130,246,0.4);
  box-shadow: 0 0 0 3px rgba(59,130,246,0.08);
}

/* 模态框 */
.glass-backdrop-demo {
  background: rgba(0,0,0,0.08);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border-radius: 16px;
  padding: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.glass-modal {
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 20px;
  padding: 1.5rem;
  max-width: 320px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.1);
}

/* ========== 极简主题 ========== */
.theme-minimal {
  --shadow-sm: none;
  --shadow-md: none;
  --shadow-lg: none;
  --shadow-card: none;
  --radius-sm: 0px;
  --radius-md: 0px;
  --radius-lg: 0px;
  --radius-card: 0px;
}
</style>

<!-- 毛玻璃通用组件样式（非 scoped，确保覆盖 Tailwind） -->
<style>
/* ========== 毛玻璃按钮 ========== */
.theme-glass button {
  border-width: 1px;
  border-style: solid;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background-color 0.2s, box-shadow 0.2s, color 0.2s;
}
.theme-glass button.bg-primary.text-text-inverse {
  background-color: rgba(34, 197, 94, 0.12) !important;
  color: #16a34a !important;
  border-color: rgba(34, 197, 94, 0.25);
}
.theme-glass button.bg-primary.text-text-inverse:hover {
  background-color: rgba(34, 197, 94, 0.22) !important;
  box-shadow: 0 2px 12px rgba(34, 197, 94, 0.2);
}
.theme-glass button.bg-success.text-text-inverse {
  background-color: rgba(34, 197, 94, 0.12) !important;
  color: #16a34a !important;
  border-color: rgba(34, 197, 94, 0.25);
}
.theme-glass button.bg-success.text-text-inverse:hover {
  background-color: rgba(34, 197, 94, 0.22) !important;
  box-shadow: 0 2px 12px rgba(34, 197, 94, 0.2);
}
.theme-glass button.bg-warning.text-text-inverse {
  background-color: rgba(245, 158, 11, 0.12) !important;
  color: #d97706 !important;
  border-color: rgba(245, 158, 11, 0.25);
}
.theme-glass button.bg-warning.text-text-inverse:hover {
  background-color: rgba(245, 158, 11, 0.22) !important;
  box-shadow: 0 2px 12px rgba(245, 158, 11, 0.2);
}
.theme-glass button.bg-danger.text-text-inverse {
  background-color: rgba(239, 68, 68, 0.12) !important;
  color: #dc2626 !important;
  border-color: rgba(239, 68, 68, 0.25);
}
.theme-glass button.bg-danger.text-text-inverse:hover {
  background-color: rgba(239, 68, 68, 0.22) !important;
  box-shadow: 0 2px 12px rgba(239, 68, 68, 0.2);
}
.theme-glass button.bg-info.text-text-inverse {
  background-color: rgba(59, 130, 246, 0.12) !important;
  color: #2563eb !important;
  border-color: rgba(59, 130, 246, 0.25);
}
.theme-glass button.bg-info.text-text-inverse:hover {
  background-color: rgba(59, 130, 246, 0.22) !important;
  box-shadow: 0 2px 12px rgba(59, 130, 246, 0.2);
}
.theme-glass button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none !important;
}

/* ========== 毛玻璃输入框 / 下拉框 ========== */
.theme-glass input[type="text"],
.theme-glass input[type="number"],
.theme-glass select {
  background-color: rgba(255, 255, 255, 0.65) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
  transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
}
.theme-glass input[type="text"]:focus,
.theme-glass input[type="number"]:focus,
.theme-glass select:focus {
  border-color: rgba(59, 130, 246, 0.45) !important;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.08);
  background-color: rgba(255, 255, 255, 0.85) !important;
}
.theme-glass input[type="text"]:disabled,
.theme-glass input[type="number"]:disabled {
  background-color: rgba(0, 0, 0, 0.04) !important;
  opacity: 0.7;
}
.theme-glass select option {
  background-color: #ffffff;
  color: var(--color-text, #111827);
}

/* ========== 毛玻璃表格 ========== */
.theme-glass table {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.theme-glass table th {
  background-color: rgba(255, 255, 255, 0.7) !important;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: #1e293b !important;
  border-color: rgba(0, 0, 0, 0.06) !important;
  font-weight: 600;
}
.theme-glass table td {
  background-color: rgba(255, 255, 255, 0.45) !important;
  border-color: rgba(0, 0, 0, 0.06) !important;
}
.theme-glass table tbody tr:hover td {
  background-color: rgba(255, 255, 255, 0.85) !important;
}
</style>