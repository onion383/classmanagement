<template>
  <div class="setup-wrap">
    <div class="setup-card bg-surface">
      <!-- 顶部标题（可拖拽移动窗口；引导期间不可关闭） -->
      <div class="setup-head">
        <h1 class="setup-title">首次安装引导</h1>
        <p class="setup-desc">完成以下设置即可开始使用</p>
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
          <!-- ===== 账户设置 ===== -->
          <template v-if="current === 'account'">
            <!-- 已完成：只读摘要，避免重复建号 -->
            <div v-if="registered" class="done-box">
              <div class="done-title">账户已创建</div>
              <div class="f-row">
                <label class="f-label">用户名</label>
                <div class="f-static">{{ account.username }}</div>
              </div>
              <div class="f-row">
                <label class="f-label">保存方式</label>
                <div class="f-static">{{ account.saveMode === 'encrypted' ? '密文保存（已加密）' : '明文保存' }}</div>
              </div>
              <p class="f-hint">点击「下一步」继续设置班级信息。</p>
            </div>

            <template v-else>
              <!-- 保存方式 -->
              <div v-if="subKey === 'mode'" class="pane">
                <label class="opt-card" :class="{ 'is-active': account.saveMode === 'encrypted' }">
                  <input type="radio" value="encrypted" v-model="account.saveMode" class="hidden-radio" />
                  <span class="opt-body">
                    <span class="opt-name">密文保存（推荐）</span>
                    <span class="opt-desc">数据库以随机密钥加密落盘，可设置登录密码，安全性最高。</span>
                  </span>
                </label>
                <label class="opt-card" :class="{ 'is-active': account.saveMode === 'plain' }">
                  <input type="radio" value="plain" v-model="account.saveMode" class="hidden-radio" />
                  <span class="opt-body">
                    <span class="opt-name">明文保存</span>
                    <span class="opt-desc">数据库以明文保存，任何程序都可直接读取；明文模式下无法设置密码。</span>
                  </span>
                </label>
              </div>

              <!-- 账户信息 -->
              <div v-else-if="subKey === 'info'" class="pane">
                <div class="f-row">
                  <label class="f-label">用户名</label>
                  <input
                    v-model.trim="account.username"
                    class="f-input"
                    placeholder="2-30 个字符"
                    autocomplete="off"
                  />
                </div>
                <div class="f-row">
                  <label class="f-label">密码</label>
                  <input
                    v-model="account.password"
                    type="password"
                    class="f-input"
                    :disabled="!canSetPassword"
                    :placeholder="canSetPassword ? '至少 6 位（留空则无密码登录）' : '明文保存模式下不可设置密码'"
                    autocomplete="new-password"
                  />
                </div>
                <div class="f-row">
                  <label class="f-label">确认密码</label>
                  <input
                    v-model="account.confirm"
                    type="password"
                    class="f-input"
                    :disabled="!canSetPassword || !account.password"
                    placeholder="再次输入密码"
                    autocomplete="new-password"
                  />
                </div>
                <p v-if="errorMsg" class="f-error">{{ errorMsg }}</p>
              </div>

              <!-- 恢复密钥（仅设置了密码时出现） -->
              <div v-else class="pane">
                <p class="f-hint">请将下方恢复密钥保存到安全的地方，忘记密码时可凭它找回；随后抄写前 3 个词完成注册。</p>
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
  </div>
</template>

<script>
import axios from 'axios'
import { useThemeStore } from '../stores/theme'
import { waitForBackendReady } from '../utils/backendReady'

// 主题预览色：仅用于「主题选择」的缩略示意（真实配色由各主题 CSS 变量驱动）
const PREVIEW = {
  base: { bg: '#f9fafb', side: '#1f2937', bar: '#22c55e' },
  glass: { bg: '#dfe9f5', side: '#ffffff', bar: '#3b82f6' },
  glass2: { bg: '#e6ecff', side: '#ffffff', bar: '#5b7cfa' },
  win11: { bg: '#eef2f7', side: '#ffffff', bar: '#3b82f6' },
  minimal: { bg: '#ffffff', side: '#111827', bar: '#111827' },
}

const STEPS = [
  { key: 'account', label: '账户设置' },
  { key: 'class', label: '班级设置' },
  { key: 'theme', label: '主题选择' },
  { key: 'storage', label: '储存设置' },
  { key: 'perf', label: '性能优化' },
]

export default {
  name: 'Setup',
  data() {
    return {
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
        saveMode: 'encrypted', // 默认密文保存
      },
      recovery: {
        phrase: '',
        draftId: '',
        copyWords: '',
        saved: false,
      },
      classInfo: { name: '', mottoStyle: '', xuefeng: '' },
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
    activeNo() { return this.step + 1 },
    canPrev() { return this.step > 0 || this.sub > 0 },
    // 切换动画的 key：步骤或子步骤变化都会重新触发过渡
    paneKey() { return `${this.current}-${this.subKey}` },
    transitionName() { return this.dir < 0 ? 'slide-prev' : 'slide-next' },
    // 有密码时账户设置分 3 个子步骤，否则 2 个（无需抄写恢复密钥）
    subSteps() {
      const arr = [
        { key: 'mode', label: '保存方式' },
        { key: 'info', label: '账户信息' },
      ]
      if (this.recovery.phrase) arr.push({ key: 'recovery', label: '恢复密钥' })
      return arr
    },
    subKey() { return this.subSteps[Math.min(this.sub, this.subSteps.length - 1)].key },
    canSetPassword() { return this.account.saveMode === 'encrypted' },
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
    // 明文模式下强制清空密码（明文库不允许密码）
    'account.saveMode'(v) {
      if (v === 'plain') { this.account.password = ''; this.account.confirm = '' }
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
      api.on('from-main', this._onMain)
      // 通知主进程渲染层已就绪
      api.send('setup-ready')
      this.loadWarmup()
      this.loadDirs()
    }
    // 同步当前主题（新装默认毛玻璃）
    if (this.themeStore.currentTheme !== 'glass') this.themeStore.setTheme('glass')
  },
  beforeUnmount() {
    const api = window.electron
    if (api && this._onMain) api.off('from-main', this._onMain)
  },
  methods: {
    // ---------- 主题 ----------
    previewStyle(id) {
      const p = PREVIEW[id] || PREVIEW.glass
      return { background: p.bg, '--tp-side': p.side, '--tp-bar': p.bar }
    },
    pickTheme(id) {
      this.themeStore.setTheme(id)
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
        const w = await window.electron?.invoke('get-setup-warmup')
        if (w) this.applyWarmup(w)
      } catch (_) {}
    },
    // ---------- 储存设置 ----------
    async loadDirs() {
      try {
        const res = await window.electron?.invoke('get-data-directories')
        if (res) this.dirs = { dataDir: res.dataDir || '', thumbsDir: res.thumbsDir || '' }
      } catch (_) {}
    },
    async pickDir() {
      try {
        const res = await window.electron?.invoke('select-folder')
        if (res && res.filePaths && res.filePaths.length) return res.filePaths[0]
      } catch (_) {}
      return ''
    },
    openDir(p) {
      if (p) window.electron?.invoke('open-folder', p)
    },
    async changeDataDir() {
      const picked = await this.pickDir()
      if (!picked) return
      this.errorMsg = ''
      this.storageHint = ''
      this.busyDataDir = true
      try {
        const res = await window.electron.invoke('set-initial-data-dir', { dataDir: picked })
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
        const res = await window.electron.invoke('set-initial-data-dir', { thumbsDir: picked })
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
      if (this.current === 'account') return this.nextAccount()
      if (this.current === 'class') {
        if (!this.classInfo.name) { this.errorMsg = '请填写班级名称'; return }
        this.step = 2
        return
      }
      if (this.current === 'theme') { this.step = 3; return }
      if (this.current === 'storage') { this.step = 4; return }
      return this.finish()
    },
    prev() {
      this.errorMsg = ''
      this.storageHint = ''
      this.dir = -1
      if (this.current === 'account') {
        if (this.sub > 0) { this.sub -= 1; return }
        return
      }
      this.step -= 1
      if (this.current === 'account') this.sub = this.subSteps.length - 1
    },
    // ---------- 账户设置 ----------
    async nextAccount() {
      if (this.registered) { this.step = 1; this.sub = 0; return }
      const key = this.subKey
      if (key === 'mode') { this.sub = 1; return }
      if (key === 'info') return this.submitAccountInfo()
      return this.confirmRegister()
    },
    validateAccountInfo() {
      const { username, password, confirm } = this.account
      if (!username || username.length < 2 || username.length > 30) return '用户名需在 2-30 个字符之间'
      if (password) {
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
        const payload = {
          username: this.account.username,
          role: 'teacher',
          encrypted: this.account.saveMode === 'encrypted',
        }
        if (this.account.password) payload.password = this.account.password
        const { data } = await axios.post('/api/register', payload)
        if (data.draftId) {
          // 有密码：后端先返回草稿与恢复密钥，进入抄写确认子步骤
          this.recovery.draftId = data.draftId
          this.recovery.phrase = data.recovery?.phrase || ''
          this.recovery.copyWords = ''
          this.recovery.saved = false
          this.sub = 2
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
        const { data } = await axios.post('/api/register/confirm', { draftId: this.recovery.draftId })
        this.onRegistered(data)
      } catch (err) {
        this.errorMsg = err?.response?.data?.error || err?.message || '注册失败，请重试'
      } finally {
        this.busy = false
      }
    },
    onRegistered(data) {
      if (data && data.token) localStorage.setItem('token', data.token)
      if (data && data.user) localStorage.setItem('currentUser', JSON.stringify(data.user))
      this.registered = true
      this.sub = 0
      this.step = 1
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
        window.electron?.send('setup-complete')
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
/* 第二层毛玻璃：左右两栏各自一块半透明玻璃面板，叠加出层次 */
.glass-panel {
  background: rgba(255, 255, 255, var(--glass-opacity, 0.4));
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 12px;
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
  border-radius: 8px;
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
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.slide-next-enter-from { opacity: 0; transform: translateX(26px); }
.slide-next-leave-to { opacity: 0; transform: translateX(-26px); }
.slide-prev-enter-from { opacity: 0; transform: translateX(-26px); }
.slide-prev-leave-to { opacity: 0; transform: translateX(26px); }

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
  border-radius: 8px;
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
  border-radius: 8px;
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

/* 保存方式选项 */
.opt-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 13px;
  margin-bottom: 10px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.opt-card.is-active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.hidden-radio { display: none; }
.opt-body { display: flex; flex-direction: column; gap: 3px; }
.opt-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}
.opt-desc {
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-muted);
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
  border-radius: 10px;
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
  border-radius: 10px;
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
  border-radius: 6px;
  border: 1px solid var(--color-border);
  overflow: hidden;
}
.tp-side {
  position: absolute;
  left: 5px;
  top: 5px;
  bottom: 5px;
  width: 26%;
  border-radius: 4px;
  background: var(--tp-side, var(--color-surface));
  opacity: 0.95;
}
.tp-bar {
  position: absolute;
  left: 35%;
  right: 5px;
  top: 5px;
  height: 10px;
  border-radius: 4px;
  background: var(--tp-bar, var(--color-primary));
  opacity: 0.9;
}
.tp-dot {
  position: absolute;
  left: 35%;
  right: 5px;
  top: 20px;
  bottom: 5px;
  border-radius: 4px;
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
  border-radius: 8px;
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