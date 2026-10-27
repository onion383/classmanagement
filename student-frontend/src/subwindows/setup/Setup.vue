<template>
  <div class="setup-wrap">
    <!-- 画面切换（提示 / 欢迎 / 步骤）：只让内容淡出/淡入，整窗卡片的背景与模糊保持不动 -->
    <Transition name="wfade" mode="out-in">
    <!-- 低版本系统提示：与安装器同款一屏，复用欢迎页的卡片与居中布局，仅内容区不同 -->
    <div v-if="screen === 'warning'" class="setup-card bg-surface welcome">
      <div class="welcome-inner">
        <img src="/logo.webp" alt="logo" class="welcome-logo" />
        <div class="welcome-title">
          <span class="welcome-name">班集</span>
        </div>
        <p class="ow-msg">检测到您正在运行的系统版本过低，可能导致软件异常或崩溃，建议将系统升级到 Windows 10 1709 或更高版本</p>
        <div class="ow-btns">
          <div class="ow-actions">
            <button type="button" class="ow-btn ow-ghost" @click="quitSetup">退出程序</button>
            <button type="button" class="ow-btn ow-primary" @click="ignoreWarn">忽略</button>
          </div>
          <button type="button" class="ow-btn ow-ghost ow-download" @click="openDownload">获取最新的 Windows</button>
        </div>
        <label class="ow-remember">
          <input type="checkbox" v-model="warnRemember" />
          <span>不再提示</span>
        </label>
      </div>
    </div>

    <!-- 欢迎页：引导前的独立一屏，点击「开始」再进入下面的引导流程 -->
    <div v-else-if="screen === 'welcome'" class="setup-card bg-surface welcome">
      <button
        type="button"
        class="welcome-x dlg-close absolute! top-3 right-3"
        title="关闭"
        @click="quitSetup"
      >&times;</button>
      <div class="welcome-inner">
        <img src="/logo.webp" alt="logo" class="welcome-logo" />
        <div class="welcome-title">
          <span class="welcome-name">班集</span>
          <span class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold text-white bg-blue-500 leading-none">预览版</span>
        </div>
        <p class="welcome-hi">欢迎使用~</p>
        <p class="welcome-tip">首次使用前，我们需要进行一些初始化设置</p>
        <button type="button" class="btn-primary welcome-btn" @click="screen = 'wizard'">开始</button>
      </div>
    </div>

    <div v-else class="setup-card bg-surface">
      <!-- 顶部标题（可拖拽移动窗口） -->
      <div class="setup-head">
        <h1 class="setup-title">首次安装引导</h1>
        <p class="setup-desc">完成以下设置即可开始使用</p>
        <!-- 右上角关闭：作为可拖拽标题栏的子元素（与欢迎页 × 同结构），
             no-drag 才会真正生效、点击才可响应；点击完全退出软件（前后端） -->
        <button
          type="button"
          class="setup-x dlg-close absolute! top-3 right-3"
          title="关闭"
          @click="quitSetup"
        >&times;</button>
      </div>

      <div class="setup-body">
        <!-- 左栏：只读进度（1-5 顺序编号，不可点击切换） -->
        <aside class="setup-side glass-panel">
          <div
            v-for="it in list"
            :key="it.key"
            class="setup-item"
            :class="{ 'is-done': it.state === 'done', 'is-active': it.state === 'active' }"
          >
            <span class="setup-item-idx">{{ it.state === 'done' ? '✓' : it.no }}</span>
            <span class="setup-item-label">{{ it.label }}</span>
          </div>
        </aside>

        <!-- 右栏：当前步骤内容 -->
        <section class="setup-main glass-panel">
          <Transition :name="transitionName" mode="out-in">
          <div :key="paneKey" class="pane-wrap">
          <!-- ===== 用户须知 ===== -->
          <template v-if="current === 'notice'">
            <div class="pane">
              <div class="notice-list">
                <div class="notice-item">
                  <div class="notice-title">非商业使用</div>
                  <p class="notice-desc">本软件依据 PolyForm Noncommercial License 1.0.0（PFNC）协议发布，仅供个人非商业用途使用；未经作者书面授权，不得将本软件用于任何商业用途。</p>
                </div>
                <div class="notice-item">
                  <div class="notice-title">本地优先，数据安全</div>
                  <p class="notice-desc">所有数据均保存在您的本地设备中，遵循「本地优先」原则；本软件不会采集、上传或分析您的任何数据，仅在您使用 AI 助手、以及检查与下载更新时才会使用网络。</p>
                </div>
                <div class="notice-item">
                  <div class="notice-title">密码提醒</div>
                  <p class="notice-desc">如果您设置了账户的密码并开启了超级隐私模式，请牢牢记住账户密码和 12 词恢复词，一旦两者都丢失将无法恢复（开发者也没有办法哦）。如果您担心忘记密码，可以设置无密码账户。</p>
                </div>
              </div>
            </div>
          </template>

          <!-- ===== 账户设置 ===== -->
          <template v-else-if="current === 'account'">
            <!-- 已完成：只读摘要，避免重复建号 -->
            <div v-if="registered" class="done-box">
              <div class="done-title">账户已创建</div>
              <div class="f-row">
                <label class="f-label">用户名</label>
                <div class="f-static">{{ account.username }}</div>
              </div>
              <div class="f-row">
                <label class="f-label">安全等级</label>
                <div class="f-static">{{ securityLevelLabel }}</div>
              </div>
              <p class="f-hint">点击「下一步」继续设置班级信息。</p>
            </div>

            <template v-else>
              <!-- 账户信息 -->
              <div v-if="subKey === 'info'" class="pane">
                <div class="f-row">
                  <label class="f-label">安全等级</label>
                  <AppSelect v-model="account.securityLevel" :options="securityLevels" class="flex-1 min-w-0" />
                </div>
                <div class="f-row">
                  <label class="f-label">用户名</label>
                  <input
                    v-model.trim="account.username"
                    class="f-input"
                    placeholder="2-30 个字符"
                    autocomplete="off"
                  />
                </div>
                <template v-if="canSetPassword">
                  <div class="f-row">
                    <label class="f-label">密码</label>
                    <input
                      v-model="account.password"
                      type="password"
                      class="f-input"
                      placeholder="至少 6 位"
                      autocomplete="new-password"
                    />
                  </div>
                  <div class="f-row">
                    <label class="f-label">确认密码</label>
                    <input
                      v-model="account.confirm"
                      type="password"
                      class="f-input"
                      placeholder="再次输入密码"
                      autocomplete="new-password"
                    />
                  </div>
                </template>
                <p v-if="account.securityLevel === 'plain'" class="f-hint ind">明文模式下数据库不加密，任何程序都可直接读取；之后可在系统设置中升级为加密等级。</p>
                <p v-else-if="account.securityLevel === 'nopass'" class="f-hint ind">数据仍加密，但登录无需密码；之后可在系统设置中切换为密码或隐私模式。</p>
                <p v-else-if="account.securityLevel === 'privacy'" class="f-hint ind">需凭密码或 12 词恢复词解锁数据库，两者都丢失将无法恢复。</p>
                <p v-if="errorMsg" class="f-error">{{ errorMsg }}</p>
              </div>

              <!-- 恢复密钥（仅超级隐私模式出现） -->
              <div v-else class="pane">
                <p class="f-hint">这是超级隐私模式的恢复词，也是忘记密码时的唯一凭证；请抄写保存，随后输入前 3 个词完成注册。</p>
                <div class="phrase-box">{{ recovery.phrase }}</div>
                <div class="btn-row">
                  <button type="button" class="btn-ghost" @click="downloadPhrase">下载文本</button>
                  <button type="button" class="btn-ghost" @click="copyPhrase">复制</button>
                </div>
                <div class="f-row">
                  <label class="f-label">抄写前 3 词</label>
                  <input
                    v-model="recovery.copyWords"
                    class="f-input"
                    placeholder="可带序号、可不带空格"
                    autocomplete="off"
                  />
                </div>
                <p v-if="errorMsg" class="f-error">{{ errorMsg }}</p>
              </div>
            </template>
          </template>

          <!-- ===== 班级设置 ===== -->
          <template v-else-if="current === 'class'">
            <div class="pane">
              <div class="f-row">
                <label class="f-label">班级名称 <i class="req">*</i></label>
                <input v-model.trim="classInfo.name" class="f-input" placeholder="如：高一（3）班" autocomplete="off" />
              </div>
              <div class="f-row">
                <label class="f-label">班风</label>
                <input v-model.trim="classInfo.mottoStyle" class="f-input" placeholder="如：团结、自律、进取" autocomplete="off" />
              </div>
              <div class="f-row">
                <label class="f-label">学风</label>
                <input v-model.trim="classInfo.xuefeng" class="f-input" placeholder="如：勤思、笃学、求真" autocomplete="off" />
              </div>
              <p v-if="errorMsg" class="f-error">{{ errorMsg }}</p>
              <p class="f-hint">班级名称必填，班风与学风可稍后在系统中修改。</p>
            </div>
          </template>

          <!-- ===== 主题选择 ===== -->
          <template v-else-if="current === 'theme'">
            <div class="pane">
              <!-- 列表来自 store 的 allThemes，已剔除被暂时屏蔽的主题（见 stores/theme.js 的 HIDDEN_THEME_IDS） -->
              <div class="theme-grid">
                <button
                  v-for="t in themeStore.allThemes"
                  :key="t.id"
                  type="button"
                  class="theme-card"
                  :class="{ 'is-active': themeStore.currentTheme === t.id }"
                  @click="pickTheme(t.id)"
                >
                  <span class="theme-preview" :style="previewStyle(t.id)">
                    <span class="tp-side"></span>
                    <span class="tp-bar"></span>
                    <span class="tp-dot"></span>
                  </span>
                  <span class="theme-name">{{ t.name }}</span>
                </button>
              </div>
              <!-- 日夜模式：与设置页同一控件；不支持夜间配色的主题固定日间并置灰 -->
              <div class="mode-row">
                <span class="f-label">日夜模式</span>
                <div class="mode-switch" :class="{ 'is-disabled': !nightSupported }">
                  <ViewSwitch :modelValue="pendingMode" :options="modeSwitchOptions" @update:modelValue="onSelectMode" />
                </div>
                <span class="mode-hint">{{ nightSupported ? '当前主题支持夜间配色' : '当前主题不支持夜间配色，固定为日间' }}</span>
              </div>
              <div class="anim-toggle">
                <span class="anim-toggle-text">
                  <span class="anim-toggle-label">启用动画效果</span>
                  <span class="anim-toggle-desc">关闭后禁用全部过渡与动画（含窗口淡入淡出、弹窗与列表动效）</span>
                </span>
                <AppSwitch :model-value="themeStore.animationsEnabled" aria-label="启用动画效果" @change="onAnimationsChange" />
              </div>
              <p class="f-hint">默认使用毛玻璃主题，点击即可实时预览效果。</p>
            </div>
          </template>

          <!-- ===== 储存设置 ===== -->
          <template v-else-if="current === 'storage'">
            <div class="pane">
              <div class="f-row">
                <label class="f-label">数据库目录</label>
                <div class="f-static truncate" :title="dirs.dataDir">{{ dirs.dataDir || '加载中…' }}</div>
                <button type="button" class="btn-info" :disabled="busyDataDir" @click="changeDataDir">
                  {{ busyDataDir ? '处理中…' : '修改' }}
                </button>
                <button type="button" class="btn-ghost" :disabled="busyDataDir" @click="openDir(dirs.dataDir)">打开</button>
              </div>
              <p class="f-hint ind">存放数据库与上传图片等用户数据的目录。</p>

              <div class="f-row">
                <label class="f-label">缩略图缓存</label>
                <div class="f-static truncate" :title="dirs.thumbsDir">{{ dirs.thumbsDir || '加载中…' }}</div>
                <button type="button" class="btn-info" :disabled="busyThumbsDir" @click="changeThumbsDir">
                  {{ busyThumbsDir ? '处理中…' : '修改' }}
                </button>
                <button type="button" class="btn-ghost" :disabled="busyThumbsDir" @click="openDir(dirs.thumbsDir)">打开</button>
              </div>
              <p class="f-hint ind">相册缩略图是可再生的缓存，可放到独立目录（如临时盘/SSD）。</p>

              <p v-if="errorMsg" class="f-error">{{ errorMsg }}</p>
              <p v-if="storageHint" class="f-ok">{{ storageHint }}</p>
            </div>
          </template>

          <!-- ===== 性能优化 ===== -->
          <template v-else>
            <div class="pane">
              <div class="perf-box">
                <template v-if="warmup.done">
                  <span class="perf-dot is-ok"></span>
                  <span class="perf-text">优化已经自动完成~</span>
                </template>
                <template v-else>
                  <span class="perf-dot is-run"></span>
                  <span class="perf-text">{{ warmup.phase || '正在进行首次初始化' }}</span>
                </template>
              </div>
              <div class="perf-bar">
                <div class="perf-bar-fill" :class="{ 'is-done': warmup.done }" :style="{ width: (warmup.percent || 0) + '%' }"></div>
              </div>
              <div class="perf-nums">
                <span>{{ warmup.detail || '请稍候…' }}</span>
                <span class="perf-percent">{{ warmup.percent || 0 }}%</span>
              </div>
              <p class="f-hint">初始化在后台进行，不影响继续设置；完成后会自动提示。</p>
            </div>
          </template>
          </div>
          </Transition>
        </section>
      </div>

      <!-- 底部操作 -->
      <div class="setup-foot">
        <button type="button" class="btn-ghost" :disabled="!canPrev || busy" @click="prev">上一步</button>
        <span class="step-indicator">{{ activeNo }} / {{ totalSteps }}</span>
        <button type="button" class="btn-primary" :disabled="busy" @click="next">
          {{ nextLabel }}
        </button>
      </div>
    </div>
    </Transition>
  </div>
  <!-- 安全等级风险说明：普通密码只有「确定」，超级隐私「确认 / 取消」（取消回退默认档） -->
  <ConfirmDialog
    v-if="levelTipVisible"
    :visible="levelTipVisible"
    title="安全等级说明"
    :message="levelTipMessage"
    :show-cancel="levelTipType === 'privacy'"
    :confirm-text="levelTipType === 'privacy' ? '确认' : '确定'"
    cancel-text="取消"
    @confirm="levelTipVisible = false"
    @cancel="onLevelTipCancel"
  />
</template>

<script>
import axios from 'axios'
import { useThemeStore } from '../../stores/theme'
import { waitForBackendReady } from '../../utils/backendReady'
import { SEND, INVOKE, RECEIVE } from '../../electronChannels.js'
import { storeMediaToken } from '../../utils/apiUrl'
import AppSelect from '../../components/base/AppSelect.vue'
import AppSwitch from '../../components/base/AppSwitch.vue'
import ViewSwitch from '../../components/base/ViewSwitch.vue'
import ConfirmDialog from '../../components/base/ConfirmDialog.vue'
import { Sun, Moon } from '@lucide/vue'

// 主题预览色：仅用于「主题选择」的缩略示意（真实配色由各主题 CSS 变量驱动）
const PREVIEW = {
  base: { bg: '#f9fafb', side: '#1f2937', bar: '#22c55e' },
  glass: { bg: '#dfe9f5', side: '#ffffff', bar: '#3b82f6' },
  glass2: { bg: '#e6ecff', side: '#ffffff', bar: '#5b7cfa' },
  win11: { bg: '#eef2f7', side: '#ffffff', bar: '#3b82f6' },
  minimal: { bg: '#ffffff', side: '#111827', bar: '#111827' },
}

const STEPS = [
  { key: 'notice', label: '用户须知' },
  { key: 'account', label: '账户设置' },
  { key: 'class', label: '班级设置' },
  { key: 'theme', label: '主题选择' },
  { key: 'storage', label: '储存设置' },
  { key: 'perf', label: '性能优化' },
]

const SECURITY_LEVELS = [
  { value: 'plain', label: '明文模式（不加密）' },
  { value: 'nopass', label: '无密码模式（加密，免密码登录）' },
  { value: 'password', label: '普通密码模式（加密 + 登录密码）' },
  { value: 'privacy', label: '超级隐私模式（密码 + 恢复词才能解锁）' },
]

export default {
  name: 'Setup',
  components: { AppSelect, AppSwitch, ViewSwitch, ConfirmDialog },
  props: {
    // 首屏画面，由 src/setup/main.js 依据主进程 launch-plan / URL 参数解析后传入
    initialScreen: { type: String, default: 'welcome' },
    // 本次启动计划：warn=提示画面，setup=是否还需走首次引导（决定「忽略」后去哪）
    plan: { type: Object, default: () => ({ warn: false, setup: true }) },
  },
  data() {
    return {
      // 当前画面：'warning'（低版本提示）| 'welcome'（欢迎）| 'wizard'（引导步骤）
      screen: this.initialScreen, // 首屏由主进程计划决定
      warnRemember: false, // 低版本提示页「不再提示」勾选
      step: 0,
      sub: 0,
      dir: 1, // 1=下一步（新卡片从右进）| -1=上一步（新卡片从左进）
      registered: false,
      busy: false,
      errorMsg: '',
      storageHint: '',
      account: {
        username: '',
        password: '',
        confirm: '',
        securityLevel: 'password', // plain=明文 | nopass=加密免密 | password=加密+密码 | privacy=超级隐私
      },
      // 安全等级风险说明弹窗（超级隐私模式的「取消」回退到普通密码）
      levelTipVisible: false,
      levelTipType: 'password',
      levelTipSuppress: false,
      recovery: {
        phrase: '',
        draftId: '',
        copyWords: '',
        saved: false,
      },
      classInfo: { name: '', mottoStyle: '', xuefeng: '' },
      // 日夜模式切换：与设置页同一套控件（仅 glass / glass2 支持夜间配色）
      modeSwitchOptions: [
        { value: 'day', label: '日间', icon: Sun },
        { value: 'night', label: '夜间', icon: Moon },
      ],
      dirs: { dataDir: '', thumbsDir: '' },
      busyDataDir: false,
      busyThumbsDir: false,
      warmup: { phase: '', detail: '', percent: 0, done: false },
      _onMain: null,
    }
  },
  computed: {
    themeStore() { return useThemeStore() },
    totalSteps() { return STEPS.length },
    current() { return STEPS[this.step].key },
    // 安全等级说明弹窗文案（与登录页注册保持一致）
    levelTipMessage() {
      return this.levelTipType === 'privacy'
        ? '请您妥善保管好您的密钥，如果丢失，任何人将无法打开您的数据（包括开发者），若担心密码丢失，请使用其他模式'
        : '普通密码模式只能保证其他 Windows 用户无法访问，并且能保证自己复制数据库到其他电脑无法打开。同一个 Windows 用户仍然可以通过数据恢复打开，如果需要严格的保护隐私，请使用超级隐私模式'
    },
    activeNo() { return this.step + 1 },
    // 总能「上一步」：即使在第一步，也会回到最前面的欢迎页
    canPrev() { return true },
    // 切换动画的 key：步骤或子步骤变化都会重新触发过渡
    paneKey() { return `${this.current}-${this.subKey}` },
    transitionName() { return this.dir < 0 ? 'slide-prev' : 'slide-next' },
    // 有密码时账户设置分 2 个子步骤，否则 1 个（无需抄写恢复密钥）
    subSteps() {
      const arr = [
        { key: 'info', label: '账户信息' },
      ]
      if (this.recovery.phrase) arr.push({ key: 'recovery', label: '恢复密钥' })
      return arr
    },
    subKey() { return this.subSteps[Math.min(this.sub, this.subSteps.length - 1)].key },
    canSetPassword() { return this.account.securityLevel === 'password' || this.account.securityLevel === 'privacy' },
    securityLevels() { return SECURITY_LEVELS },
    nightSupported() { return this.themeStore.nightSupported },
    pendingMode() { return this.themeStore.pendingMode },
    securityLevelLabel() {
      return {
        plain: '明文模式',
        nopass: '无密码模式',
        password: '普通密码模式',
        privacy: '超级隐私模式',
      }[this.account.securityLevel] || '—'
    },
    nextLabel() {
      if (this.current === 'perf') return this.busy ? '处理中…' : '完成'
      return this.busy ? '处理中…' : '下一步'
    },
    // 左栏进度：已过步骤为 done、当前为 active、其后为 pending
    list() {
      return STEPS.map((s, i) => ({
        key: s.key,
        label: s.label,
        no: i + 1,
        state: i < this.step ? 'done' : (i === this.step ? 'active' : 'pending'),
      }))
    },
  },
  watch: {
    // 安全等级变化：清理不适用的密码与旧草稿，避免用上一等级的草稿完成注册
    'account.securityLevel'(v) {
      if (v === 'plain' || v === 'nopass') {
        this.account.password = ''
        this.account.confirm = ''
      }
      this.recovery.phrase = ''
      this.recovery.draftId = ''
      this.recovery.copyWords = ''
      this.recovery.saved = false
      // 取消隐私模式后回退到普通密码是程序化赋值，不再弹一次普通密码说明
      if (!this.levelTipSuppress) this.tipSecurityLevel(v)
    },
    // 首次进入账户设置步骤时，先对默认等级（普通密码模式）做一次说明
    current(v) {
      if (v === 'account') this.tipSecurityLevel(this.account.securityLevel)
    },
    // 子步骤数量变化（密码清空 → 恢复密钥子步骤消失）时收敛下标
    subSteps() {
      if (this.sub > this.subSteps.length - 1) this.sub = this.subSteps.length - 1
    },
  },
  mounted() {
    const api = window.electron
    if (api) {
      this._onMain = (payload) => { if (payload && payload.type === 'setup-warmup') this.applyWarmup(payload) }
      api.on(RECEIVE.FROM_MAIN, this._onMain)
      // 通知主进程渲染层已就绪
      api.send(SEND.SETUP_READY)
      this.loadWarmup()
      this.loadDirs()
    }
    // 同步当前主题（新装默认毛玻璃）
    if (this.themeStore.currentTheme !== 'glass') this.themeStore.setTheme('glass')
  },
  beforeUnmount() {
    const api = window.electron
    if (api && this._onMain) api.off(RECEIVE.FROM_MAIN, this._onMain)
  },
  methods: {
    // 选择安全等级时的风险说明弹窗（与登录页注册一致）：普通密码只有「确定」，超级隐私「确认 / 取消」
    tipSecurityLevel(v) {
      if (v !== 'password' && v !== 'privacy') return
      this.levelTipType = v
      this.levelTipVisible = true
    },
    // 超级隐私模式的「取消」：回退到默认的普通密码模式，且不再连锁弹出普通密码说明
    onLevelTipCancel() {
      this.levelTipVisible = false
      this.levelTipSuppress = true
      this.account.securityLevel = 'password'
      this.$nextTick(() => { this.levelTipSuppress = false })
    },
    // ---------- 主题 ----------
    previewStyle(id) {
      const p = PREVIEW[id] || PREVIEW.glass
      return { background: p.bg, '--tp-side': p.side, '--tp-bar': p.bar }
    },
    pickTheme(id) {
      this.themeStore.setTheme(id)
      // 切到不支持夜间配色的主题时，立即回落到日间
      if (!this.themeStore.nightSupported && this.themeStore.pendingMode === 'night') {
        this.themeStore.setMode('day')
      }
    },
    // 日夜模式：仅支持夜间配色的主题可切换
    onSelectMode(value) {
      if (!this.nightSupported) return
      this.themeStore.setMode(value)
    },
    // 动画效果总开关：立即生效
    onAnimationsChange(value) {
      this.themeStore.setAnimationsEnabled(!!value)
    },
    // ---------- 预热进度 ----------
    applyWarmup(w) {
      this.warmup = {
        phase: w.phase || '',
        detail: w.detail || '',
        percent: typeof w.percent === 'number' ? w.percent : 0,
        done: !!w.done,
      }
    },
    async loadWarmup() {
      try {
        const w = await window.electron?.invoke(INVOKE.GET_SETUP_WARMUP)
        if (w) this.applyWarmup(w)
      } catch (_) {}
    },
    // ---------- 储存设置 ----------
    async loadDirs() {
      try {
        const res = await window.electron?.invoke(INVOKE.GET_DATA_DIRECTORIES)
        if (res) this.dirs = { dataDir: res.dataDir || '', thumbsDir: res.thumbsDir || '' }
      } catch (_) {}
    },
    async pickDir() {
      try {
        const res = await window.electron?.invoke(INVOKE.SELECT_FOLDER)
        if (res && res.filePaths && res.filePaths.length) return res.filePaths[0]
      } catch (_) {}
      return ''
    },
    openDir(p) {
      if (p) window.electron?.invoke(INVOKE.OPEN_FOLDER, p)
    },
    async changeDataDir() {
      const picked = await this.pickDir()
      if (!picked) return
      this.errorMsg = ''
      this.storageHint = ''
      this.busyDataDir = true
      try {
        const res = await window.electron.invoke(INVOKE.SET_INITIAL_DATA_DIR, { dataDir: picked })
        if (res && res.ok) {
          this.dirs = { dataDir: res.dataDir, thumbsDir: res.thumbsDir }
          this.storageHint = res.changed ? '数据库目录已更新' : '目录未变化'
        }
      } catch (err) {
        this.errorMsg = err?.message || '数据库目录修改失败'
      } finally {
        this.busyDataDir = false
      }
    },
    async changeThumbsDir() {
      const picked = await this.pickDir()
      if (!picked) return
      this.errorMsg = ''
      this.storageHint = ''
      this.busyThumbsDir = true
      try {
        const res = await window.electron.invoke(INVOKE.SET_INITIAL_DATA_DIR, { thumbsDir: picked })
        if (res && res.ok) {
          this.dirs = { dataDir: res.dataDir, thumbsDir: res.thumbsDir }
          this.storageHint = res.changed ? '缩略图缓存目录已更新' : '目录未变化'
        }
      } catch (err) {
        this.errorMsg = err?.message || '缩略图缓存目录修改失败'
      } finally {
        this.busyThumbsDir = false
      }
    },
    // ---------- 导航 ----------
    next() {
      this.errorMsg = ''
      this.dir = 1
      if (this.current === 'notice') { this.step += 1; return }
      if (this.current === 'account') return this.nextAccount()
      if (this.current === 'class') {
        if (!this.classInfo.name) { this.errorMsg = '请填写班级名称'; return }
        this.step += 1
        return
      }
      if (this.current === 'theme') { this.step += 1; return }
      if (this.current === 'storage') { this.step += 1; return }
      return this.finish()
    },
    prev() {
      this.errorMsg = ''
      this.storageHint = ''
      this.dir = -1
      if (this.current === 'account' && this.sub > 0) { this.sub -= 1; return }
      // 已在第一步：返回欢迎页（整个引导的最前面）
      if (this.step === 0 && this.sub === 0) { this.screen = 'welcome'; return }
      this.step -= 1
      if (this.current === 'account') this.sub = this.subSteps.length - 1
    },
    // ---------- 账户设置 ----------
    async nextAccount() {
      if (this.registered) { this.step += 1; this.sub = 0; return }
      const key = this.subKey
      if (key === 'info') return this.submitAccountInfo()
      return this.confirmRegister()
    },
    validateAccountInfo() {
      const { username, password, confirm } = this.account
      if (!username || username.length < 2 || username.length > 30) return '用户名需在 2-30 个字符之间'
      if (this.canSetPassword) {
        if (!password) return '请设置登录密码'
        if (password.length < 6) return '密码长度至少 6 位'
        if (password !== confirm) return '两次输入的密码不一致'
      }
      return ''
    },
    async submitAccountInfo() {
      const bad = this.validateAccountInfo()
      if (bad) { this.errorMsg = bad; return }
      this.busy = true
      try {
        const level = this.account.securityLevel
        const payload = {
          username: this.account.username,
          role: 'teacher',
          encrypted: level !== 'plain',
        }
        if (level === 'privacy') payload.privacy = true
        if (this.canSetPassword) payload.password = this.account.password
        const { data } = await axios.post('/api/register', payload)
        if (data.draftId) {
          // 有密码：后端先返回草稿与恢复密钥，进入抄写确认子步骤
          this.recovery.draftId = data.draftId
          this.recovery.phrase = data.recovery?.phrase || ''
          this.recovery.copyWords = ''
          this.recovery.saved = false
          this.sub = 1
        } else {
          this.onRegistered(data)
        }
      } catch (err) {
        this.errorMsg = err?.response?.data?.error || err?.message || '注册失败，请重试'
      } finally {
        this.busy = false
      }
    },
    async confirmRegister() {
      if (!this.recovery.saved) { this.errorMsg = '请先下载或复制恢复密钥'; return }
      if (!this.checkCopyWords()) { this.errorMsg = '抄写的前 3 个词不正确，请核对'; return }
      this.busy = true
      try {
        // 超级隐私模式：复用这份恢复词作为隐私恢复词，确认时一并提交密码与恢复词
        const body = { draftId: this.recovery.draftId }
        if (this.account.securityLevel === 'privacy') {
          body.password = this.account.password
          body.phrase = this.recovery.phrase
        }
        const { data } = await axios.post('/api/register/confirm', body)
        this.onRegistered(data)
      } catch (err) {
        this.errorMsg = err?.response?.data?.error || err?.message || '注册失败，请重试'
      } finally {
        this.busy = false
      }
    },
    onRegistered(data) {
      if (data && data.token) localStorage.setItem('token', data.token)
      storeMediaToken(data && data.mediaToken)
      if (data && data.user) localStorage.setItem('currentUser', JSON.stringify(data.user))
      this.registered = true
      this.sub = 0
      this.step += 1
    },
    // 前端比对前 3 词：兼容序号、空格、连写（与登录页一致）
    checkCopyWords() {
      const norm = (s) => String(s || '').replace(/[\s\d.、,，]/g, '')
      const words = String(this.recovery.phrase || '').split(/\s+/).filter(Boolean).slice(0, 3).map(norm)
      return words.length === 3 && norm(this.recovery.copyWords) === words.join('')
    },
    downloadPhrase() {
      const blob = new Blob([this.recovery.phrase], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `恢复密钥-${this.account.username || 'account'}.txt`
      a.click()
      URL.revokeObjectURL(url)
      this.recovery.saved = true
      this.errorMsg = ''
    },
    async copyPhrase() {
      try {
        await navigator.clipboard.writeText(this.recovery.phrase)
        this.recovery.saved = true
        this.errorMsg = ''
      } catch (_) {
        this.errorMsg = '复制失败，请手动选择文本复制'
      }
    },
    // ---------- 关闭引导 ----------
    // 关闭按钮（欢迎页与各步骤页）：通知主进程完全退出软件（前端窗口 + 后端子进程），
    // 且不写「引导完成」标记——下次启动仍会重新进入引导，不会直接进入主窗口。
    quitSetup() {
      window.electron?.send(SEND.SETUP_QUIT)
    },
    // ---------- 低版本系统提示 ----------
    // 忽略：记录「不再提示」（如勾选），随即从提示画面进入下一屏。
    // 还需引导时本页自行切到欢迎画面；纯提示时主进程会直接开主窗口并关闭本窗口。
    ignoreWarn() {
      window.electron?.send(SEND.LAUNCH_SKIP_WARN, { remember: this.warnRemember })
      if (!this.plan || this.plan.setup) this.screen = 'welcome'
    },
    // 获取最新的 Windows：默认浏览器打开系统下载页，随后主进程退出班集
    openDownload() {
      window.electron?.send(SEND.LAUNCH_OPEN_DOWNLOAD)
    },
    // ---------- 完成 ----------
    async finish() {
      this.busy = true
      this.errorMsg = ''
      try {
        await this.waitBackend()
        await axios.put('/api/widget-settings/class-info', {
          name: this.classInfo.name,
          mottoStyle: this.classInfo.mottoStyle,
          xuefeng: this.classInfo.xuefeng,
        })
      } catch (err) {
        // 班级信息保存失败不阻塞进入系统，仅记录
        console.error('[setup] 保存班级信息失败:', err)
      } finally {
        this.busy = false
        window.electron?.send(SEND.SETUP_COMPLETE)
      }
    },
    // 储存目录变更会重启后端，等待其恢复后再写入班级信息
    async waitBackend(timeout = 15000) {
      const start = Date.now()
      for (;;) {
        try {
          await axios.get('/api/accounts')
          return true
        } catch (_) {}
        if (Date.now() - start > timeout) return false
        // 优先等就绪信号：后端一就绪立即重试；信号缺失时退化为 300ms 退避
        await waitForBackendReady(300)
      }
    },
  },
}
</script>

<style scoped>
.setup-wrap {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}
/* 第一层毛玻璃：整窗卡片（窗外为系统亚克力） */
.setup-card {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0 !important;
  overflow: hidden;
}
/* 欢迎页：整窗居中一屏，可拖拽移动窗口 */
.welcome {
  position: relative;
  align-items: center;
  justify-content: center;
  -webkit-app-region: drag;
}
/* 右上角关闭按钮：与弹窗 × 同款，不可拖拽 */
.welcome-x {
  -webkit-app-region: no-drag;
}
/* 步骤页右上角关闭按钮：定位/尺寸等复用与欢迎页 × 相同的 Tailwind 工具类
   （必须用 absolute! 覆盖 theme-glass.css 里 `:root[data-theme] button { position: relative }`），
   这里仅补一条不可拖拽声明 */
.setup-x {
  -webkit-app-region: no-drag;
}
.welcome-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0 24px;
  /* 整体略向下偏移：正中最容易显得上方空旷 */
  transform: translateY(24px);
}
.welcome-logo {
  width: 96px;
  height: 96px;
  object-fit: contain;
}
.welcome-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 18px;
}
.welcome-name {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  color: var(--color-text);
}
.welcome-hi {
  margin: 8px 0 0;
  font-size: 16px;
  color: var(--color-text-secondary);
}
.welcome-tip {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--color-text-muted);
}
.welcome-btn {
  margin-top: 28px;
  padding: 10px 44px;
  font-size: 15px;
  -webkit-app-region: no-drag;
}

/* 低版本系统提示画面：复用欢迎页的卡片/居中布局，仅内容区样式不同（红字文案 + 两个按钮 + 下载链接 + 勾选框） */
.ow-msg {
  margin: 16px 0 0;
  max-width: 420px;
  font-size: 14px;
  line-height: 1.6;
  color: #b91c1c;
}
/* 按钮区：两行等宽对齐——下载按钮宽度 = 上排两按钮 + 间距 的总宽（132*2 + 14 = 278） */
.ow-btns {
  width: 278px;
  margin-top: 24px;
}
.ow-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}
/* 上排两按钮等分整行，保证与下方下载按钮左右对齐 */
.ow-actions .ow-btn { flex: 1; }
/* 三个按钮统一尺寸：定高 + 定最小宽度，保证「退出程序 / 忽略」完全等大，下载按钮同高 */
.ow-btn {
  box-sizing: border-box;
  height: 40px;
  min-width: 132px;
  padding: 0 22px;
  font-size: 14px;
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: background-color .12s ease, border-color .12s ease;
  -webkit-app-region: no-drag;
}
/* 忽略：与欢迎页「开始」按钮同色（主题主色填充） */
.ow-primary {
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: var(--color-text-inverse);
}
.ow-primary:hover { background: var(--color-primary-hover); border-color: var(--color-primary-hover); }
/* 次要按钮（退出程序 / 获取最新的 Windows）：主色描边、浅底 */
.ow-ghost {
  border: 1px solid rgba(30, 64, 175, .35);
  background: #fff;
  color: #1e40af;
}
.ow-ghost:hover { background: rgba(30, 64, 175, .06); }
/* 获取最新的 Windows：独立一行，宽度铺满与上排两按钮总宽一致 */
.ow-download { width: 100%; margin-top: 12px; }
.ow-remember {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--color-text-muted);
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.ow-remember input { cursor: pointer; }

/* 第二层毛玻璃：左右两栏各自一块半透明玻璃面板，叠加出层次 */
.glass-panel {
  background: rgba(255, 255, 255, var(--glass-opacity, 0.4));
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--radius-surface);
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.06);
}

/* 字号阶梯：20 标题 / 16 状态标题 / 15 强调 / 14 正文 / 13 辅助 / 12 微标 */
.setup-head {
  padding: 14px 18px 8px;
  -webkit-app-region: drag;
}
.setup-title {
  margin: 0;
  font-size: 20px;
  line-height: 1.25;
  font-weight: 700;
  color: var(--color-text);
}
.setup-desc {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--color-text-muted);
}

.setup-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 0 16px;
}

/* 左栏：只读进度 */
.setup-side {
  width: 190px;
  flex-shrink: 0;
  padding: 8px;
  overflow: hidden;
}
.setup-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-control);
  font-size: 15px;
  color: var(--color-text-muted);
}
.setup-item + .setup-item {
  margin-top: 4px;
}
.setup-item-idx {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
}
.setup-item.is-active {
  color: var(--color-text);
  font-weight: 600;
  background: var(--color-primary-light);
}
.setup-item.is-active .setup-item-idx {
  color: var(--color-text-inverse);
  background: var(--color-primary);
  border-color: var(--color-primary);
}
.setup-item.is-done {
  color: var(--color-text-secondary);
}
.setup-item.is-done .setup-item-idx {
  color: var(--color-text-inverse);
  background: var(--color-success);
  border-color: var(--color-success);
}

/* 右栏：当前步骤 */
.setup-main {
  flex: 1;
  min-width: 0;
  padding: 16px 18px;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-app-region: no-drag;
}

/* 步骤卡片容器 + 左右切换过渡 */
.pane-wrap {
  min-height: 100%;
}
.slide-next-enter-active,
.slide-next-leave-active,
.slide-prev-enter-active,
.slide-prev-leave-active {
  transition: opacity 0.11s ease, transform 0.11s ease;
}
.slide-next-enter-from { opacity: 0; transform: translateX(26px); }
.slide-next-leave-to { opacity: 0; transform: translateX(-26px); }
.slide-prev-enter-from { opacity: 0; transform: translateX(-26px); }
.slide-prev-leave-to { opacity: 0; transform: translateX(26px); }

/* 欢迎页 → 步骤页过渡：只让正文内容淡出/淡入。
   - 卡片自身只提供过渡时长给 Vue 计时、不改变任何视觉属性 → 背景与模糊始终不淡出；
   - 右上角关闭按钮（.welcome-x / .setup-x）排除在外，全程保持常显；
   - 步骤页的 × 嵌在 .setup-head 内，故此处用 :not(.setup-x) 只淡出标题/说明。 */
.wfade-leave-active,
.wfade-enter-active {
  transition-duration: 0.08s;
}
.wfade-leave-active .welcome-inner,
.wfade-enter-active .welcome-inner,
.wfade-leave-active .setup-head > :not(.setup-x),
.wfade-enter-active .setup-head > :not(.setup-x),
.wfade-leave-active .setup-body,
.wfade-enter-active .setup-body,
.wfade-leave-active .setup-foot,
.wfade-enter-active .setup-foot {
  transition: opacity 0.08s ease;
}
.wfade-leave-to .welcome-inner,
.wfade-leave-to .setup-head > :not(.setup-x),
.wfade-leave-to .setup-body,
.wfade-leave-to .setup-foot { opacity: 0; }
.wfade-enter-from .welcome-inner,
.wfade-enter-from .setup-head > :not(.setup-x),
.wfade-enter-from .setup-body,
.wfade-enter-from .setup-foot { opacity: 0; }

/* 表单 */
.f-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.f-label {
  width: 92px;
  flex-shrink: 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text);
}
.req { color: var(--color-danger); font-style: normal; }
.f-input {
  flex: 1;
  min-width: 0;
  padding: 8px 11px;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.f-input::placeholder { color: var(--color-text-muted); }
.f-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}
.f-input:disabled { opacity: 0.6; cursor: not-allowed; }
.f-static {
  flex: 1;
  min-width: 0;
  padding: 8px 11px;
  font-size: 14px;
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.f-hint {
  margin: 0 0 0 104px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-muted);
}
.f-hint.ind { margin: -6px 0 12px 104px; }
.f-error {
  margin: 0 0 0 104px;
  font-size: 13px;
  color: var(--color-danger);
}
.f-ok {
  margin: 0 0 0 104px;
  font-size: 13px;
  color: var(--color-success);
}

/* ===== 夜间配色微调（仅引导窗口，不影响主界面） ===== */
/* 文字整体提亮：在本窗口内重映射文本色变量，层级保留但不发灰 */
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="glass2"]) .setup-card {
  --color-text: #f2f6fd;
  --color-text-secondary: #cfdaeb;
  --color-text-muted: #aab8cd;
}
/* 第二层毛玻璃：夜间改为更淡的深蓝磨砂，去掉白色叠加造成的发灰感 */
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="glass2"]) .glass-panel {
  background: rgba(34, 49, 80, 0.28);
  border-color: rgba(255, 255, 255, 0.07);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(8px) saturate(1.05);
  -webkit-backdrop-filter: blur(8px) saturate(1.05);
}
/* 低版本系统提示：红字与白底按钮跟随深色 */
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="glass2"]) .ow-msg {
  color: #fca5a5;
}
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="glass2"]) .ow-ghost {
  border-color: rgba(147, 197, 253, 0.35);
  background: rgba(59, 130, 246, 0.12);
  color: #bfdbfe;
}
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="glass2"]) .ow-ghost:hover {
  background: rgba(59, 130, 246, 0.22);
}

/* 用户须知 */
.notice-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.notice-item {
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-bg);
}
.notice-title {
  margin-bottom: 5px;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}
.notice-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

/* 恢复密钥 */
.phrase-box {
  padding: 11px 13px;
  margin-bottom: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  word-break: break-all;
  user-select: text;
}
.btn-row {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

/* 主题选择 */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}
.theme-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-bg);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.theme-card.is-active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.theme-preview {
  position: relative;
  display: block;
  height: 52px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  overflow: hidden;
}
.tp-side {
  position: absolute;
  left: 5px;
  top: 5px;
  bottom: 5px;
  width: 26%;
  border-radius: var(--radius-xs);
  background: var(--tp-side, var(--color-surface));
  opacity: 0.95;
}
.tp-bar {
  position: absolute;
  left: 35%;
  right: 5px;
  top: 5px;
  height: 10px;
  border-radius: var(--radius-xs);
  background: var(--tp-bar, var(--color-primary));
  opacity: 0.9;
}
.tp-dot {
  position: absolute;
  left: 35%;
  right: 5px;
  top: 20px;
  bottom: 5px;
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  opacity: 0.75;
}
.theme-name {
  font-size: 13px;
  text-align: center;
  color: var(--color-text-secondary);
}
.theme-card.is-active .theme-name {
  color: var(--color-primary);
  font-weight: 600;
}

/* 日夜模式（与设置页同一控件；不支持夜间配色的主题置灰） */
.mode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 14px;
}
.mode-switch { display: inline-flex; }
.mode-switch.is-disabled { opacity: 0.5; pointer-events: none; }
.mode-hint {
  font-size: 13px;
  color: var(--color-text-muted);
}

/* 动画效果开关 */
.anim-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-bg);
}
.anim-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.anim-toggle-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}
.anim-toggle-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

/* 完成态摘要 */
.done-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-success);
  margin-bottom: 12px;
}

/* 性能优化 */
.perf-box {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.perf-dot {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  border-radius: 50%;
}
.perf-dot.is-run { background: var(--color-primary); animation: perf-pulse 1.2s ease-in-out infinite; }
.perf-dot.is-ok { background: var(--color-success); }
@keyframes perf-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.perf-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}
.perf-bar {
  height: 10px;
  border-radius: 999px;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  overflow: hidden;
}
.perf-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--color-primary);
  transition: width 0.2s ease;
}
.perf-bar-fill.is-done { background: var(--color-success); }
.perf-nums {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.perf-percent {
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

/* 底部 */
.setup-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px 14px;
  -webkit-app-region: no-drag;
}
.step-indicator {
  font-size: 13px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.btn-primary,
.btn-ghost,
.btn-info {
  padding: 8px 18px;
  border-radius: var(--radius-control);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
  -webkit-app-region: no-drag;
}
.btn-primary {
  border: none;
  color: var(--color-text-inverse);
  background: var(--color-primary);
}
.btn-primary:hover { background: var(--color-primary-hover); }
.btn-ghost {
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
}
.btn-ghost:hover { background: var(--color-border); }
.btn-info {
  color: var(--color-text-inverse);
  background: var(--color-info);
  border: none;
  padding: 8px 13px;
  white-space: nowrap;
}
.btn-info:hover { background: var(--color-info-hover); }
.btn-primary:disabled,
.btn-ghost:disabled,
.btn-info:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>