// ===== 设置页：外观主题、小组件/会话/USB、数据目录与加密、性能与重启 =====
// 纯代码搬运自 SettingsView.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
import axios from 'axios'
import { useNotification } from '../../composables/useNotification'
import { SEND, INVOKE } from '../../electronChannels.js'

export function useSettingsAppearance() {
  return {
    // Theme
    onThemeSelect() {
      this.themeStore.setTheme(this.selectedThemeId)
    },
    // 提示合并（立即生效，无需保存）
    onMergeNotificationsChange(value) {
      this.mergeNotifications = !!value
      localStorage.setItem('mergeNotifications', this.mergeNotifications ? '1' : '0')
    },
    // 图标样式：线性图标 / Emoji
    onIconStyleChange() {
      this.themeStore.setIconStyle(this.iconStyle)
    },
    // 顶栏/侧边栏毛玻璃配色：深蓝 / 白色调（立即生效）
    onTopbarColorChange() {
      this.themeStore.setTopbarColor(this.topbarColor)
    },
    // 日夜模式（仅支持夜间配色的主题）：手动切换即视为放弃「跟随系统」
    onSelectMode(value) {
      this.themeStore.setMode(value)
    },
    // 跟随系统开关：立即生效，开启时按系统深色/浅色偏好切换
    onFollowSystemChange(value) {
      this.themeStore.setFollowSystem(!!value)
    },
    // 动画效果总开关：立即生效，无需保存
    onAnimationsChange(value) {
      this.themeStore.setAnimationsEnabled(!!value)
    },
    // Background image
    async onBgImageFileChange(e) {
      const file = e.target.files[0]
      if (!file) return
      this.bgImageFileName = file.name

      // 检查是否在 Electron 环境中，且文件大于 2MB，使用后端存储
      if (window.electron && window.electron.invoke && file.size > 2 * 1024 * 1024) {
        try {
          // 读取文件为 base64 后传给主进程保存
          const reader = new FileReader()
          reader.onload = async (ev) => {
            const base64Data = ev.target.result.split(',')[1] // 去掉 data:image/...;base64, 前缀
            const result = await window.electron.invoke(INVOKE.SAVE_BACKGROUND_IMAGE, {
              name: file.name,
              base64: base64Data
            })
            if (result.success && result.url) {
              this.bgImageUrl = result.url
              this.themeStore.setBackgroundImage(result.url)
            } else {
              this.showAlert(result.error || '保存图片失败')
            }
          }
          reader.readAsDataURL(file)
        } catch (err) {
          console.error('保存图片失败:', err)
          this.showAlert('保存图片失败: ' + err.message)
        }
      } else {
        // 小图片或非 Electron 环境，使用 base64
        if (file.size > 2 * 1024 * 1024) {
          this.showAlert('图片过大，请选择 2MB 以下的图片')
          return
        }
        const reader = new FileReader()
        reader.onload = (ev) => {
          this.bgImageUrl = ev.target.result
          this.themeStore.setBackgroundImage(ev.target.result)
        }
        reader.readAsDataURL(file)
      }
    },
    clearBgImage() {
      this.bgImageUrl = ''
      this.bgImageFileName = ''
      this.themeStore.setBackgroundImage('')
      if (this.$refs.bgImageInput) this.$refs.bgImageInput.value = ''
    },
    onBgMaskOpacityChange(e) {
      this.themeStore.setBgMaskOpacity(parseFloat(e.target.value))
    },
    onGlassOpacityChange(e) {
      this.themeStore.setGlassOpacity(parseFloat(e.target.value))
    },
    // ==================== 工具箱设置 ====================
    async loadWidgetSettings() {
      try {
        const res = await axios.get('/api/widget-settings')
        if (res.data.success) {
          this.toolboxEnabled = res.data.data.toolboxEnabled
          this.noteSavePath = res.data.data.noteSavePath || ''
          this.screenshotSavePath = res.data.data.screenshotSavePath || ''
        }
      } catch (err) {
        console.error('加载工具箱设置失败:', err)
      } finally {
        this.loaded = true
      }
    },
    async saveWidgetSettings() {
      try {
        await axios.put('/api/widget-settings', {
          toolboxEnabled: this.toolboxEnabled,
          noteSavePath: this.noteSavePath,
          screenshotSavePath: this.screenshotSavePath
        })
        window.electron?.send(SEND.TO_WIDGET, { type: 'settings-changed' })
      } catch (err) {
        console.error('保存工具箱设置失败:', err)
      }
    },
    onToolboxChange(value) {
      this.toolboxEnabled = !!value
      if (!this.loaded) return
      this.saveWidgetSettings()
      // 立即生效（不再有「本次启用」这个会话开关）：
      // true 会重建/显示浮窗，false 会直接销毁浮窗释放渲染进程。
      window.electron?.send(SEND.WIDGET_SET_SESSION_VISIBLE, this.toolboxEnabled)
    },
    async loadUsbAutoOpen() {
      try {
        const res = await window.electron?.invoke(INVOKE.GET_USB_AUTO_OPEN)
        this.usbAutoOpen = !!res?.enabled
      } catch (_) {}
    },
    // 切换「启用桌面小组件」：持久化到 localStorage，并即时通知主进程创建/关闭桌面小组件窗口
    onDesktopWidgetChange(value) {
      this.desktopWidgetEnabled = !!value
      try { localStorage.setItem('desktopWidgetEnabled', this.desktopWidgetEnabled ? '1' : '0') } catch (_) {}
      window.electron?.send(SEND.DESKTOP_WIDGET_ENABLED, this.desktopWidgetEnabled)
    },
    async onUsbAutoOpenChange(value) {
      this.usbAutoOpen = !!value
      try {
        await window.electron?.invoke(INVOKE.SET_USB_AUTO_OPEN, this.usbAutoOpen)
      } catch (_) {
        console.error('保存U盘自动打开设置失败')
      }
    },
    async loadDataDirs() {
      try {
        const res = await window.electron?.invoke(INVOKE.GET_DATA_DIRECTORIES)
        if (res) {
          this.dataDir = res.dataDir
          this.thumbsDir = res.thumbsDir
          this.skillsDir = res.skillsDir
          this.screenshotDir = res.screenshotDir || ''
        }
      } catch (_) {}
    },
    async changeDataDir() {
      const picked = await this.pickDir()
      if (!picked) return
      this.showConfirm(`确定把数据库目录搬迁到「${picked}」吗？搬迁期间所有窗口会暂时关闭并显示迁移进度，请勿强行停止程序，完成后会自动重开主界面。`, async () => {
        this.busyDataDir = true
        try {
          const res = await window.electron.invoke(INVOKE.SET_DATA_DIR, picked)
          if (res?.ok) {
            this.dataDir = res.dataDir
            this.showAlert(res.changed ? '数据库目录搬迁成功，应用服务已重启。' : '目录未变化。')
          }
        } catch (err) {
          this.showAlert(err?.message || '数据库目录搬迁失败')
        } finally {
          this.busyDataDir = false
        }
      })
    },
    async changeThumbsDir() {
      const picked = await this.pickDir()
      if (!picked) return
      this.showConfirm(`确定把相册缩略图缓存目录改为「${picked}」吗？将自动重启应用服务，缩略图会按需重建。`, async () => {
        this.busyThumbsDir = true
        try {
          const res = await window.electron.invoke(INVOKE.SET_THUMBS_DIR, picked)
          if (res?.ok) {
            this.thumbsDir = res.thumbsDir
            this.showAlert(res.changed ? '缓存目录已切换，应用服务已重启。' : '目录未变化。')
          }
        } catch (err) {
          this.showAlert(err?.message || '缓存目录切换失败')
        } finally {
          this.busyThumbsDir = false
        }
      })
    },
    async changeSkillsDir() {
      const picked = await this.pickDir()
      if (!picked) return
      this.showConfirm(`确定把技能文件目录搬迁到「${picked}」吗？将把现有技能文件移动到该目录并重启应用服务。`, async () => {
        this.busySkillsDir = true
        try {
          const res = await window.electron.invoke(INVOKE.SET_SKILLS_DIR, picked)
          if (res?.ok) {
            this.skillsDir = res.skillsDir
            this.showAlert(res.changed ? '技能目录搬迁成功，应用服务已重启。' : '目录未变化。')
          }
        } catch (err) {
          this.showAlert(err?.message || '技能目录搬迁失败')
        } finally {
          this.busySkillsDir = false
        }
      })
    },
    // 读取本账号的安全等级
    async loadSecurityLevel() {
      try {
        const { data } = await axios.get('/api/account/security-level')
        this.securityLevel = data.level || ''
      } catch (_) { /* 读取失败保持空值 */ } finally {
        this.securityLevelLoading = false
      }
    },
    // 下拉切换安全等级：先弹确认框（按需收集当前密码 / 新密码），确认后再真正切换
    onSecurityLevelChange(target) {
      if (!target || target === this.securityLevel) return
      this.securityDialog = { open: true, target, password: '', newPassword: '', error: '' }
    },
    closeSecurityDialog() {
      if (this.busySecurityLevel) return
      this.securityDialog.open = false
    },
    async confirmSecurityLevel() {
      const d = this.securityDialog
      if (this.securityNeedsCurrent && !d.password) {
        d.error = '请输入当前登录密码'
        return
      }
      if (this.securityNeedsNew && String(d.newPassword).length < 6) {
        d.error = '新密码长度至少 6 位'
        return
      }
      this.busySecurityLevel = true
      d.error = ''
      try {
        const { data } = await axios.post('/api/account/security-level', {
          level: d.target,
          password: this.securityNeedsCurrent ? d.password : '',
          newPassword: this.securityNeedsNew ? d.newPassword : '',
        })
        this.securityLevel = data.level || d.target
        if (data.phrase) {
          this.privacyPhrase = data.phrase
          this.syncPrivacyPhraseGuard(true)
        }
        d.open = false
        d.password = ''
        d.newPassword = ''
        this.notifySuccess('安全等级已更新')
      } catch (err) {
        d.error = err.response?.data?.error || '切换失败'
      } finally {
        this.busySecurityLevel = false
      }
    },
    // 恢复词展示期间把窗口排除在屏幕捕获之外；离开设置页/关闭展示时恢复
    syncPrivacyPhraseGuard(on) {
      try {
        window.electron?.invoke(INVOKE.SET_CONTENT_PROTECTION, !!on)
      } catch (_) { /* 非 Electron 环境忽略 */ }
    },
    clearPrivacyPhrase() {
      this.privacyPhrase = ''
      this.syncPrivacyPhraseGuard(false)
    },
    async copyPrivacyPhrase() {
      try {
        if (window.electron?.invoke) {
          // 主进程写剪贴板并定时清空：避免恢复词长期留在系统剪贴板
          const ok = await window.electron.invoke(INVOKE.COPY_SENSITIVE_TEXT, {
            text: this.privacyPhrase,
            ttlMs: 60000,
          })
          if (!ok) throw new Error('copy failed')
        } else {
          await navigator.clipboard.writeText(this.privacyPhrase)
        }
        this.showAlert(
          window.electron?.invoke
            ? '恢复词已复制，60 秒后会自动清空剪贴板'
            : '恢复词已复制，请妥善离线保存'
        )
      } catch (_) {
        this.showAlert('复制失败，请手动抄写')
      }
    },
    async pickDir() {
      try {
        const result = await window.electron?.invoke(INVOKE.SELECT_FOLDER)
        if (result && result.filePaths && result.filePaths.length > 0) {
          return result.filePaths[0]
        }
      } catch (_) {}
      return ''
    },
    async openDir(path) {
      if (!path) return
      try {
        await window.electron?.invoke(INVOKE.OPEN_FOLDER, path)
      } catch (err) {
        console.error('打开文件夹失败:', err)
      }
    },
    async selectFolder(type) {
      try {
        const result = await window.electron?.invoke(INVOKE.SELECT_FOLDER)
        if (result && result.filePaths && result.filePaths.length > 0) {
          const path = result.filePaths[0]
          if (type === 'note') {
            this.noteSavePath = path
          } else {
            this.screenshotSavePath = path
          }
          this.saveWidgetSettings()
        }
      } catch (err) {
        console.error('选择文件夹失败:', err)
      }
    },
    // ==================== 性能面板 ====================
    // 轮询开关：进入页面（含从 KeepAlive 恢复）开始，离开即停，避免常驻采样
    _startPerfPolling() {
      if (this._perfTimer) return
      this.loadPerf()
      this._perfTimer = setInterval(() => {
        if (document.visibilityState !== 'visible') return
        this.loadPerf()
      }, 1000)
    },
    _stopPerfPolling() {
      if (!this._perfTimer) return
      clearInterval(this._perfTimer)
      this._perfTimer = null
    },
    // 提示条：复用项目统一的 useNotification
    notifySuccess(msg) {
      useNotification().success(msg)
    },
    notifyError(msg) {
      useNotification().error(msg)
    },
    // 取一次逐进程内存快照，并更新三个重启目标的存活状态
    async loadPerf() {
      try {
        const snap = await window.electron?.invoke(INVOKE.PERF_SNAPSHOT)
        if (snap) {
          this.perfProcs = Array.isArray(snap.procs) ? snap.procs : []
          // 首位条形目标占比每次采样在 85%~95% 间跳动，避免最高占用恒为满格
          this.perfTopRatio = 0.85 + Math.random() * 0.1
          this.perfTotal = snap.total ?? null
          this.perfAvg = snap.avg1min ?? null
          this.perfMax = snap.max ?? null
          this.perfFront = snap.frontKB ?? null
          this.perfBackend = snap.backendKB ?? null
          this.perfOther = snap.otherKB ?? null
          this.perfAlive = {
            front: !!(snap.alive && snap.alive.front),
            backend: !!(snap.alive && snap.alive.backend),
            widget: !!(snap.alive && snap.alive.widget),
          }
        }
      } catch (_) { /* 后端未就绪等场景静默忽略 */ }
    },
    // 取上次启动耗时
    async loadStartup() {
      try {
        const t = await window.electron?.invoke(INVOKE.PERF_STARTUP)
        // 不做取整：主进程传来的 total 带 getCreationTime 的微秒级小数，
        // 面板按秒原样呈现（如 1.17285693359375 s）。
        this.perfStartupTotal = t?.total || 0
      } catch (_) {}
    },
    // KB → MB 文本；无数据时占位，保持列宽稳定
    fmtMem(kb) {
      if (kb === null || kb === undefined) return '--'
      return `${Math.round(kb / 1024)} MB`
    },
    // 条形宽度百分比：以总计为分母，最小值 3% 让很小的值也可见，封顶 100%
    barPct(kb) {
      if (!kb) return 0
      return Math.min(100, Math.max(3, Math.round((kb / this.perfMaxKB) * 100)))
    },
    // 手动回收：主进程 + 各渲染进程 + 后端
    async recycleAll() {
      if (this.busyGc) return
      this.busyGc = true
      try {
        await window.electron?.invoke(INVOKE.PERF_GC)
        await this.loadPerf()
        this.notifySuccess('已执行内存回收')
      } catch (_) {
        this.notifyError('内存回收失败')
      } finally {
        this.busyGc = false
      }
    },
    // 重启前端：页面会自行重载，无需提示
    restartFrontend() {
      window.electron?.invoke(INVOKE.PERF_RESTART_FRONTEND)
    },
    // 重启后端：复用已有的 restart-backend 通道
    async restartBackend() {
      if (this.busyRestartBackend) return
      this.busyRestartBackend = true
      try {
        await window.electron?.invoke(INVOKE.RESTART_BACKEND)
        await this.loadPerf()
        this.notifySuccess('后端已重启')
      } catch (_) {
        this.notifyError('后端重启失败')
      } finally {
        this.busyRestartBackend = false
      }
    },
    // 重启小组件：销毁并重建原本存在的窗口
    async restartWidget() {
      if (this.busyRestartWidget) return
      this.busyRestartWidget = true
      try {
        await window.electron?.invoke(INVOKE.PERF_RESTART_WIDGET)
        await this.loadPerf()
        this.notifySuccess('小组件已重启')
      } catch (_) {
        this.notifyError('小组件重启失败')
      } finally {
        this.busyRestartWidget = false
      }
    },
    // 全部重启：打包版直接重启 Electron 本体（主进程/前端/小组件/后端一并重启）。
    // 开发模式下 Electron 由 `npm run electron:dev` 的 concurrently --kill-others 托管，
    // app.relaunch 让 Electron 退出时会连带杀掉 Vite，新实例拿不到 dev server 会卡在
    // 加载页（停在「本地服务已就绪」），故 dev 退化为软重启：后端/小组件重启 + 前端重载。
    restartAll() {
      if (this.busyRestartAll) return
      this.busyRestartAll = true
      if (import.meta.env.DEV) {
        this._softRestartAll()
      } else {
        window.electron?.invoke(INVOKE.PERF_RELAUNCH_APP)
      }
    },
    async _softRestartAll() {
      try {
        await window.electron?.invoke(INVOKE.RESTART_BACKEND)
        await window.electron?.invoke(INVOKE.PERF_RESTART_WIDGET)
        this.notifySuccess('正在重启全部进程')
        window.electron?.invoke(INVOKE.PERF_RESTART_FRONTEND)
      } catch (_) {
        this.notifyError('全部重启失败')
        this.busyRestartAll = false
      }
    },
  }
}
