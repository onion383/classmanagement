<template>
  <div class="mig-wrap">
    <div class="mig-card bg-surface">
      <!-- 失败态（迁移数据库）：旧数据未改动；新目录是否清理由用户确认 -->
      <template v-if="state === 'error' && mode === 'move'">
        <div class="mig-head">
          <span class="mig-dot-err"></span>
          <h1 class="mig-title">移动失败</h1>
        </div>
        <div class="mig-body">
          <p class="mig-line">原有文件没有改动</p>
          <p class="mig-line">存在部分文件已经复制，请确认该文件夹无重要文件后，点击下面的按钮清除</p>
          <p class="mig-path">{{ targetDir }}</p>
          <p class="mig-reason" v-if="errorMessage">{{ errorMessage }}</p>
        </div>
        <div class="mig-actions">
          <button class="mig-btn is-ghost" @click="openTarget">打开文件夹</button>
          <div class="mig-actions-right">
            <button class="mig-btn is-ghost" @click="finish(false)">取消</button>
            <button class="mig-btn" @click="finish(true)">确定</button>
          </div>
        </div>
      </template>

      <!-- 失败态（数据库加密转换）：原库已还原、未发生改动，只需确认返回 -->
      <template v-else-if="state === 'error'">
        <div class="mig-head">
          <span class="mig-dot-err"></span>
          <h1 class="mig-title">{{ title }}</h1>
        </div>
        <div class="mig-body">
          <p class="mig-line">数据库未发生改动</p>
          <p class="mig-reason" v-if="errorMessage">{{ errorMessage }}</p>
        </div>
        <div class="mig-actions">
          <div class="mig-actions-right">
            <button class="mig-btn" @click="finish(false)">返回主界面</button>
          </div>
        </div>
      </template>

      <!-- 进行中 / 完成 -->
      <template v-else>
        <div class="mig-head">
          <span class="mig-spin" v-if="state === 'running'"></span>
          <span class="mig-dot-ok" v-else></span>
          <h1 class="mig-title">{{ title }}</h1>
        </div>

        <div class="mig-body">
          <div class="mig-phase">{{ phase || '正在准备…' }}</div>
          <div class="mig-detail">{{ detail || '请稍候' }}</div>

          <div class="mig-bar">
            <div class="mig-bar-fill" :class="{ 'is-done': state === 'done' }" :style="{ width: percent + '%' }"></div>
          </div>

          <div class="mig-nums">
            <span class="mig-files">{{ filesTotal > 0 ? `${filesDone}/${filesTotal} 个文件` : '—' }}</span>
            <span class="mig-percent">{{ percent }}%</span>
          </div>
        </div>

        <p class="mig-warn" v-if="state === 'running'">{{ runningWarn }}</p>
        <p class="mig-warn is-ok" v-else>{{ doneText }}</p>
      </template>
    </div>
  </div>
</template>

<script>
import { SEND, INVOKE, RECEIVE } from '../../electronChannels.js'
import { apiUrl } from '../../utils/apiUrl'
import { applyAuthHeader } from '../../composables/secureChannel'
export default {
  name: 'Migration',
  data() {
    return {
      state: 'running', // running | done | error
      mode: 'move', // move=数据目录搬迁 | crypt=数据库加密转换
      encrypt: true, // crypt 模式下的目标状态：true=启用加密 / false=关闭加密
      phase: '',
      detail: '',
      filesDone: 0,
      filesTotal: 0,
      percent: 0,
      errorMessage: '',
      targetDir: '',
      _onMain: null,
    }
  },
  computed: {
    title() {
      if (this.mode === 'crypt') return this.encrypt ? '启用数据库加密' : '关闭数据库加密'
      return '迁移数据库'
    },
    runningWarn() {
      if (this.mode === 'crypt') return '正在转换数据库加密方式，请不要强行停止程序，否则可能会导致数据损坏'
      return '正在迁移数据库，请不要强行停止程序，否则可能会导致数据损坏'
    },
    doneText() {
      return this.mode === 'crypt' ? '转换完成，正在重新打开主界面…' : '迁移完成，正在重新打开主界面…'
    },
  },
  mounted() {
    const api = window.electron
    if (!api) return
    this._onMain = (payload) => this.onMain(payload)
    api.on(RECEIVE.FROM_MAIN, this._onMain)
    // 通知主进程渲染层已就绪，可以开始推送进度
    api.send(SEND.MIGRATION_READY)
  },
  beforeUnmount() {
    const api = window.electron
    if (api && this._onMain) api.off(RECEIVE.FROM_MAIN, this._onMain)
  },
  methods: {
    onMain(payload) {
      if (!payload || typeof payload !== 'object') return
      if (payload.type === 'crypt-start') {
        // 主进程已完成关窗准备，开始执行加密转换（由本窗口直接调用后端流式接口）
        this.mode = 'crypt'
        this.encrypt = !!payload.encrypt
        this.startCrypt(payload.token)
      } else if (payload.type === 'migration-progress') {
        if (typeof payload.phase === 'string') this.phase = payload.phase
        if (typeof payload.detail === 'string') this.detail = payload.detail
        if (typeof payload.filesDone === 'number') this.filesDone = payload.filesDone
        if (typeof payload.filesTotal === 'number') this.filesTotal = payload.filesTotal
        if (typeof payload.percent === 'number') this.percent = payload.percent
      } else if (payload.type === 'migration-done') {
        this.state = 'done'
        this.percent = 100
      } else if (payload.type === 'migration-error') {
        this.state = 'error'
        this.errorMessage = payload.message || ''
        this.targetDir = payload.target || ''
      }
    },
    // 调用后端加密转换接口（NDJSON 流）：逐步读取进度并刷新界面；结束后回报主进程
    async startCrypt(token) {
      try {
        // 凭据统一走信道：安全模式下明文 Authorization 会被后端拒绝（NDJSON 流式响应不受响应加密影响）
        const headers = { 'Content-Type': 'application/json' }
        await applyAuthHeader(headers, token)
        const resp = await fetch(apiUrl('/api/account/db-encryption'), {
          method: 'POST',
          headers,
          body: JSON.stringify({ encrypt: this.encrypt }),
        })
        if (!resp.ok || !resp.body) throw new Error(`请求后端失败（${resp.status}）`)
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let ok = false
        let failMsg = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim()
            buf = buf.slice(idx + 1)
            if (!line) continue
            let msg
            try { msg = JSON.parse(line) } catch (_) { continue }
            if (msg.type === 'progress') {
              if (msg.phase) this.phase = msg.phase
              if (msg.detail) this.detail = msg.detail
              if (typeof msg.percent === 'number') this.percent = msg.percent
            } else if (msg.type === 'done') {
              if (msg.ok) ok = true
              else failMsg = msg.message || '转换失败'
            }
          }
        }
        // 流结束后缓冲区可能还剩最后一帧（对端未以换行结尾）：补解析一次
        if (buf.trim()) {
          let tailMsg
          try { tailMsg = JSON.parse(buf.trim()) } catch (_) { tailMsg = null }
          if (tailMsg?.type === 'done') {
            if (tailMsg.ok) ok = true
            else failMsg = tailMsg.message || '转换失败'
          }
        }
        if (ok) {
          this.state = 'done'
          this.percent = 100
          // 短暂停留展示「完成」后回报主进程，由其设置提示条并重开主窗口
          setTimeout(() => window.electron?.send(SEND.MIGRATION_DISMISS, { ok: true }), 700)
        } else {
          this.state = 'error'
          // 没收到 done（进程提前退出/输出被截断）时 failMsg 为空，必须给可读兜底文案
          this.errorMessage = failMsg || '转换未完成：未收到完成消息，请重试或查看日志'
        }
      } catch (err) {
        this.state = 'error'
        this.errorMessage = err?.message || String(err)
      }
    },
    // 打开已复制内容所在的目标文件夹，供用户自行确认
    openTarget() {
      if (this.targetDir) window.electron?.invoke(INVOKE.OPEN_FOLDER, this.targetDir)
    },
    // clean=true：「确定」按用户确认清除已复制内容；clean=false：「取消」原样保留
    finish(clean) {
      window.electron?.send(SEND.MIGRATION_DISMISS, { clean: !!clean })
    },
  },
}
</script>

<style scoped>
.mig-wrap {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  /* 卡片铺满整窗，与窗口、背景图三层完全对齐，背景图只从毛玻璃后面透出、不从边缘露出 */
  padding: 0;
}
.mig-card {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 20px 24px 22px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  /* 直角铺满：圆角交由系统按窗口绘制（Win11），避免卡片自身圆角让背景从四角露出 */
  border-radius: 0 !important;
  box-shadow: none;
  overflow: hidden;
}

.mig-head {
  display: flex;
  align-items: center;
  gap: 10px;
  -webkit-app-region: drag;
}
.mig-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
}

.mig-spin {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid var(--color-primary-light);
  border-top-color: var(--color-primary);
  animation: mig-rotate 0.8s linear infinite;
}
@keyframes mig-rotate {
  to { transform: rotate(360deg); }
}
.mig-dot-ok,
.mig-dot-err {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  border-radius: 50%;
}
.mig-dot-ok { background: var(--color-success); }
.mig-dot-err { background: var(--color-danger); }

.mig-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-top: 8px;
}

.mig-phase {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}
.mig-detail {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
  min-height: 16px;
}

.mig-bar {
  margin-top: 14px;
  height: 10px;
  border-radius: 999px;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  overflow: hidden;
}
.mig-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--color-primary);
  transition: width 0.12s linear;
}
.mig-bar-fill.is-done {
  background: var(--color-success);
}

.mig-nums {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.mig-percent {
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.mig-warn {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-warning-hover);
}
.mig-warn.is-ok {
  color: var(--color-success-hover);
}

.mig-line {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text);
}
.mig-path {
  margin: 0;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  word-break: break-all;
}
.mig-reason {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-danger-hover);
  word-break: break-all;
}

.mig-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
}
.mig-actions-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mig-btn {
  padding: 8px 18px;
  border: none;
  border-radius: var(--radius-control);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-inverse);
  background: var(--color-primary);
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background-color 0.15s ease;
}
.mig-btn:hover {
  background: var(--color-primary-hover);
}
.mig-btn.is-ghost {
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
}
.mig-btn.is-ghost:hover {
  background: var(--color-border);
}
</style>