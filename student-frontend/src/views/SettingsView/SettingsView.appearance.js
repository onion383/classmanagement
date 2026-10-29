// ===== 设置页：外观主题、小组件/会话/USB、数据目录与加密、性能与重启 =====
// 纯代码搬运自 SettingsView.vue 的 methods，未改写逻辑；经 ctx 闭包调用（script setup）。
import axios from 'axios'
import { useNotification } from '../../composables/useNotification'
import { SEND, INVOKE } from '../../electronChannels.js'

export function useSettingsAppearance(ctx) {
  return {
    // Theme
    onThemeSelect() {
      ctx.themeStore.setTheme(ctx.selectedThemeId.value)
    },
    // 提示合并（立即生效，无需保存）
    onMergeNotificationsChange(value) {
      ctx.mergeNotifications.value = !!value
      localStorage.setItem('mergeNotifications', ctx.mergeNotifications.value ? '1' : '0')
    },
    // 图标样式：线性图标 / Emoji
    onIconStyleChange() {
      ctx.themeStore.setIconStyle(ctx.iconStyle.value)
    },
    // 顶栏/侧边栏毛玻璃配色：深蓝 / 白色调（立即生效）
    onTopbarColorChange() {
      ctx.themeStore.setTopbarColor(ctx.topbarColor.value)
    },
    // 日夜模式（仅支持夜间配色的主题）：手动切换即视为放弃「跟随系统」
    onSelectMode(value) {
      ctx.themeStore.setMode(value)
    },
    // 跟随系统开关：立即生效，开启时按系统深色/浅色偏好切换
    onFollowSystemChange(value) {
      ctx.themeStore.setFollowSystem(!!value)
    },
    // 动画效果总开关：立即生效，无需保存
    onAnimationsChange(value) {
      ctx.themeStore.setAnimationsEnabled(!!value)
    },
    // Background image
    async onBgImageFileChange(e) {
      const file = e.target.files[0]
      if (!file) return
      ctx.bgImageFileName.value = file.name

      // 检查是否在 Electron 环境中，且文件大于 2MB，使用后端存储
      if (window.electron && window.electron.invoke && file.size > 2 * 1024 * 1024) {
        // 读取文件为 base64 后传给主进程保存
        const reader = new FileReader()
        reader.onload = async (ev) => {
          try {
            const base64Data = ev.target.result.split(',')[1] // 去掉 data:image/...;base64, 前缀
            const result = await window.electron.invoke(INVOKE.SAVE_BACKGROUND_IMAGE, {
              name: file.name,
              base64: base64Data
            })
            if (result.success && result.url) {
              ctx.bgImageUrl.value = result.url
              ctx.themeStore.setBackgroundImage(result.url)
            } else {
              ctx.showAlert(result.error || '保存图片失败')
            }
          } catch (err) {
            console.error('保存图片失败:', err)
            ctx.showAlert('保存图片失败: ' + (err?.message || '未知错误'))
          }
        }
        // 读盘失败/取消时补上反馈，否则界面停在「已选择文件」却什么都没发生
        reader.onerror = () => {
          console.error('读取背景图片失败:', reader.error)
          ctx.showAlert('读取图片失败，请重试')
        }
        reader.onabort = () => ctx.showAlert('已取消读取图片')
        reader.readAsDataURL(file)
      } else {
        // 小图片或非 Electron 环境，使用 base64
        if (file.size > 2 * 1024 * 1024) {
          ctx.showAlert('图片过大，请选择 2MB 以下的图片')
          return
        }
        const reader = new FileReader()
        reader.onload = (ev) => {
          ctx.bgImageUrl.value = ev.target.result
          ctx.themeStore.setBackgroundImage(ev.target.result)
        }
        reader.onerror = () => {
          console.error('读取背景图片失败:', reader.error)
          ctx.showAlert('读取图片失败，请重试')
        }
        reader.onabort = () => ctx.showAlert('已取消读取图片')
        reader.readAsDataURL(file)
      }
    },
    clearBgImage() {
      ctx.bgImageUrl.value = ''
      ctx.bgImageFileName.value = ''
      ctx.themeStore.setBackgroundImage('')
      if (ctx.bgImageInput.value) ctx.bgImageInput.value.value = ''
    },
    onBgMaskOpacityChange(e) {
      ctx.themeStore.setBgMaskOpacity(parseFloat(e.target.value))
    },
    onGlassOpacityChange(e) {
      ctx.themeStore.setGlassOpacity(parseFloat(e.target.value))
    },
    // ==================== 工具箱设置 ====================
    async loadWidgetSettings() {
      try {
        const res = await axios.get('/api/widget-settings')
        if (res.data.success) {
          ctx.toolboxEnabled.value = res.data.data.toolboxEnabled
          ctx.noteSavePath.value = res.data.data.noteSavePath || ''
          ctx.screenshotSavePath.value = res.data.data.screenshotSavePath || ''
        }
      } catch (err) {
        console.error('加载工具箱设置失败:', err)
      } finally {
        ctx.loaded.value = true
      }
    },
    async saveWidgetSettings() {
      try {
        await axios.put('/api/widget-settings', {
          toolboxEnabled: ctx.toolboxEnabled.value,
          noteSavePath: ctx.noteSavePath.value,
          screenshotSavePath: ctx.screenshotSavePath.value
        })
        window.electron?.send(SEND.TO_WIDGET, { type: 'settings-changed' })
      } catch (err) {
        console.error('保存工具箱设置失败:', err)
      }
    },
    onToolboxChange(value) {
      ctx.toolboxEnabled.value = !!value
      if (!ctx.loaded.value) return
      ctx.saveWidgetSettings()
      // 立即生效（不再有「本次启用」这个会话开关）：
      // true 会重建/显示浮窗，false 会直接销毁浮窗释放渲染进程。
      window.electron?.send(SEND.WIDGET_SET_SESSION_VISIBLE, ctx.toolboxEnabled.value)
    },
    async loadUsbAutoOpen() {
      try {
        const res = await window.electron?.invoke(INVOKE.GET_USB_AUTO_OPEN)
        ctx.usbAutoOpen.value = !!res?.enabled
      } catch (_) {}
    },
    // 切换「启用桌面小组件」：持久化到 localStorage，并即时通知主进程创建/关闭桌面小组件窗口
    onDesktopWidgetChange(value) {
      ctx.desktopWidgetEnabled.value = !!value
      try { localStorage.setItem('desktopWidgetEnabled', ctx.desktopWidgetEnabled.value ? '1' : '0') } catch (_) {}
      window.electron?.send(SEND.DESKTOP_WIDGET_ENABLED, ctx.desktopWidgetEnabled.value)
    },
    async onUsbAutoOpenChange(value) {
      ctx.usbAutoOpen.value = !!value
      try {
        await window.electron?.invoke(INVOKE.SET_USB_AUTO_OPEN, ctx.usbAutoOpen.value)
      } catch (_) {
        console.error('保存U盘自动打开设置失败')
      }
    },
    async loadDataDirs() {
      try {
        const res = await window.electron?.invoke(INVOKE.GET_DATA_DIRECTORIES)
        if (res) {
          ctx.dataDir.value = res.dataDir
          ctx.thumbsDir.value = res.thumbsDir
          ctx.skillsDir.value = res.skillsDir
          ctx.screenshotDir.value = res.screenshotDir || ''
        }
      } catch (_) {}
    },
    async changeDataDir() {
      const picked = await ctx.pickDir()
      if (!picked) return
      ctx.showConfirm(`确定把数据库目录搬迁到「${picked}」吗？搬迁期间所有窗口会暂时关闭并显示迁移进度，请勿强行停止程序，完成后会自动重开主界面。`, async () => {
        ctx.busyDataDir.value = true
        try {
          const res = await window.electron.invoke(INVOKE.SET_DATA_DIR, picked)
          if (res?.ok) {
            ctx.dataDir.value = res.dataDir
            ctx.showAlert(res.changed ? '数据库目录搬迁成功，应用服务已重启。' : '目录未变化。')
          }
        } catch (err) {
          ctx.showAlert(err?.message || '数据库目录搬迁失败')
        } finally {
          ctx.busyDataDir.value = false
        }
      })
    },
    async changeThumbsDir() {
      const picked = await ctx.pickDir()
      if (!picked) return
      ctx.showConfirm(`确定把相册缩略图缓存目录改为「${picked}」吗？将自动重启应用服务，缩略图会按需重建。`, async () => {
        ctx.busyThumbsDir.value = true
        try {
          const res = await window.electron.invoke(INVOKE.SET_THUMBS_DIR, picked)
          if (res?.ok) {
            ctx.thumbsDir.value = res.thumbsDir
            ctx.showAlert(res.changed ? '缓存目录已切换，应用服务已重启。' : '目录未变化。')
          }
        } catch (err) {
          ctx.showAlert(err?.message || '缓存目录切换失败')
        } finally {
          ctx.busyThumbsDir.value = false
        }
      })
    },
    async changeSkillsDir() {
      const picked = await ctx.pickDir()
      if (!picked) return
      ctx.showConfirm(`确定把技能文件目录搬迁到「${picked}」吗？将把现有技能文件移动到该目录并重启应用服务。`, async () => {
        ctx.busySkillsDir.value = true
        try {
          const res = await window.electron.invoke(INVOKE.SET_SKILLS_DIR, picked)
          if (res?.ok) {
            ctx.skillsDir.value = res.skillsDir
            ctx.showAlert(res.changed ? '技能目录搬迁成功，应用服务已重启。' : '目录未变化。')
          }
        } catch (err) {
          ctx.showAlert(err?.message || '技能目录搬迁失败')
        } finally {
          ctx.busySkillsDir.value = false
        }
      })
    },
    // 读取本账号的安全等级
    async loadSecurityLevel() {
      try {
        const { data } = await axios.get('/api/account/security-level')
        ctx.securityLevel.value = data.level || ''
      } catch (_) { /* 读取失败保持空值 */ } finally {
        ctx.securityLevelLoading.value = false
      }
    },
    // 下拉切换安全等级：先弹确认框（按需收集当前密码 / 新密码），确认后再真正切换
    onSecurityLevelChange(target) {
      if (!target || target === ctx.securityLevel.value) return
      ctx.securityDialog.value = { open: true, target, password: '', newPassword: '', error: '' }
    },
    closeSecurityDialog() {
      if (ctx.busySecurityLevel.value) return
      ctx.securityDialog.value.open = false
    },
    async confirmSecurityLevel() {
      const d = ctx.securityDialog.value
      if (ctx.securityNeedsCurrent.value && !d.password) {
        d.error = '请输入当前登录密码'
        return
      }
      if (ctx.securityNeedsNew.value && String(d.newPassword).length < 6) {
        d.error = '新密码长度至少 6 位'
        return
      }
      ctx.busySecurityLevel.value = true
      d.error = ''
      try {
        const { data } = await axios.post('/api/account/security-level', {
          level: d.target,
          password: ctx.securityNeedsCurrent.value ? d.password : '',
          newPassword: ctx.securityNeedsNew.value ? d.newPassword : '',
        })
        ctx.securityLevel.value = data.level || d.target
        if (data.phrase) {
          ctx.privacyPhrase.value = data.phrase
          ctx.syncPrivacyPhraseGuard(true)
        }
        d.open = false
        d.password = ''
        d.newPassword = ''
        ctx.notifySuccess('安全等级已更新')
      } catch (err) {
        d.error = err.response?.data?.error || '切换失败'
      } finally {
        ctx.busySecurityLevel.value = false
      }
    },
    // 恢复词展示期间把窗口排除在屏幕捕获之外；离开设置页/关闭展示时恢复
    syncPrivacyPhraseGuard(on) {
      try {
        window.electron?.invoke(INVOKE.SET_CONTENT_PROTECTION, !!on)
      } catch (_) { /* 非 Electron 环境忽略 */ }
    },
    clearPrivacyPhrase() {
      ctx.privacyPhrase.value = ''
      ctx.syncPrivacyPhraseGuard(false)
    },
    async copyPrivacyPhrase() {
      try {
        if (window.electron?.invoke) {
          // 主进程写剪贴板并定时清空：避免恢复词长期留在系统剪贴板
          const ok = await window.electron.invoke(INVOKE.COPY_SENSITIVE_TEXT, {
            text: ctx.privacyPhrase.value,
            ttlMs: 60000,
          })
          if (!ok) throw new Error('copy failed')
        } else {
          await navigator.clipboard.writeText(ctx.privacyPhrase.value)
        }
        ctx.showAlert(
          window.electron?.invoke
            ? '恢复词已复制，60 秒后会自动清空剪贴板'
            : '恢复词已复制，请妥善离线保存'
        )
      } catch (_) {
        ctx.showAlert('复制失败，请手动抄写')
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
            ctx.noteSavePath.value = path
          } else {
            ctx.screenshotSavePath.value = path
          }
          ctx.saveWidgetSettings()
        }
      } catch (err) {
        console.error('选择文件夹失败:', err)
      }
    },
    // ==================== 性能面板 ====================
    // 轮询开关：进入页面（含从 KeepAlive 恢复）开始，离开即停，避免常驻采样
    _startPerfPolling() {
      if (ctx._perfTimer.value) return
      ctx.loadPerf()
      ctx._perfTimer.value = setInterval(() => {
        if (document.visibilityState !== 'visible') return
        ctx.loadPerf()
      }, 1000)
    },
    _stopPerfPolling() {
      if (!ctx._perfTimer.value) return
      clearInterval(ctx._perfTimer.value)
      ctx._perfTimer.value = null
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
          ctx.perfProcs.value = Array.isArray(snap.procs) ? snap.procs : []
          // 首位条形目标占比每次采样在 85%~95% 间跳动，避免最高占用恒为满格
          ctx.perfTopRatio.value = 0.85 + Math.random() * 0.1
          ctx.perfTotal.value = snap.total ?? null
          ctx.perfAvg.value = snap.avg1min ?? null
          ctx.perfMax.value = snap.max ?? null
          ctx.perfFront.value = snap.frontKB ?? null
          ctx.perfBackend.value = snap.backendKB ?? null
          ctx.perfOther.value = snap.otherKB ?? null
          ctx.perfAlive.value = {
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
        ctx.perfStartupTotal.value = t?.total || 0
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
      return Math.min(100, Math.max(3, Math.round((kb / ctx.perfMaxKB.value) * 100)))
    },
    // 手动回收：主进程 + 各渲染进程 + 后端
    async recycleAll() {
      if (ctx.busyGc.value) return
      ctx.busyGc.value = true
      try {
        await window.electron?.invoke(INVOKE.PERF_GC)
        await ctx.loadPerf()
        ctx.notifySuccess('已执行内存回收')
      } catch (_) {
        ctx.notifyError('内存回收失败')
      } finally {
        ctx.busyGc.value = false
      }
    },
    // 重启前端：页面会自行重载，无需提示
    restartFrontend() {
      window.electron?.invoke(INVOKE.PERF_RESTART_FRONTEND)
    },
    // 重启后端：复用已有的 restart-backend 通道
    async restartBackend() {
      if (ctx.busyRestartBackend.value) return
      ctx.busyRestartBackend.value = true
      try {
        await window.electron?.invoke(INVOKE.RESTART_BACKEND)
        await ctx.loadPerf()
        ctx.notifySuccess('后端已重启')
      } catch (_) {
        ctx.notifyError('后端重启失败')
      } finally {
        ctx.busyRestartBackend.value = false
      }
    },
    // 重启小组件：销毁并重建原本存在的窗口
    async restartWidget() {
      if (ctx.busyRestartWidget.value) return
      ctx.busyRestartWidget.value = true
      try {
        await window.electron?.invoke(INVOKE.PERF_RESTART_WIDGET)
        await ctx.loadPerf()
        ctx.notifySuccess('小组件已重启')
      } catch (_) {
        ctx.notifyError('小组件重启失败')
      } finally {
        ctx.busyRestartWidget.value = false
      }
    },
    // 全部重启：打包版直接重启 Electron 本体（主进程/前端/小组件/后端一并重启）。
    // 开发模式下 Electron 由 `npm run electron:dev` 的 concurrently --kill-others 托管，
    // app.relaunch 让 Electron 退出时会连带杀掉 Vite，新实例拿不到 dev server 会卡在
    // 加载页（停在「本地服务已就绪」），故 dev 退化为软重启：后端/小组件重启 + 前端重载。
    restartAll() {
      if (ctx.busyRestartAll.value) return
      ctx.busyRestartAll.value = true
      if (import.meta.env.DEV) {
        ctx._softRestartAll()
      } else {
        window.electron?.invoke(INVOKE.PERF_RELAUNCH_APP)
      }
    },
    async _softRestartAll() {
      try {
        await window.electron?.invoke(INVOKE.RESTART_BACKEND)
        await window.electron?.invoke(INVOKE.PERF_RESTART_WIDGET)
        ctx.notifySuccess('正在重启全部进程')
        window.electron?.invoke(INVOKE.PERF_RESTART_FRONTEND)
      } catch (_) {
        ctx.notifyError('全部重启失败')
        ctx.busyRestartAll.value = false
      }
    },
  }
}
