// ===== 设置页：学期设置、撤销记录、弹窗/消息、账号与数据库导出 =====
// 纯代码搬运自 SettingsView.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
import { reportError } from '../../utils/reportError.js'
import axios from 'axios'
import { listUndo, undoById, redoById, clearUndo } from '../../api/undo'
import { pad2 } from '../../utils/dateTime.js'
import { invalidateSemesterStart } from '../../utils/semesterStart.js'
import { clearMediaToken } from '../../utils/apiUrl'

export function useSettingsData() {
  return {
    // ==================== 学期设置 ====================
    // 载入学期列表：默认选中当前学期（播种/新增学期时后端会把最新学期标为当前）
    async loadSemesterSettings() {
      try {
        const { data } = await axios.get('/api/schedule/semesters')
        this.semesters = data.semesters || []
        const cur = data.current || this.semesters[0] || null
        this.semesterId = cur ? cur.id : null
        this.semesterStart = cur ? (cur.start_date || '') : ''
        this.semesterEnd = cur ? (cur.end_date || '') : ''
        this.semesterDateErrorText = ''
      } catch (_) { /* 后端未就绪时静默忽略 */ }
    },
    // 选择学期：同时切换为当前学期（课程表、座位补存范围、座位指数结算都按它走）
    async onSelectSemester(id) {
      const target = this.semesters.find(s => s.id === id)
      if (!target) return
      this.semesterId = id
      this.semesterStart = target.start_date || ''
      this.semesterEnd = target.end_date || ''
      // 换学期等于换了一组日期，之前那个学期的未保存改动不再有意义
      this.semesterDateErrorText = ''
      try {
        await axios.put('/api/schedule/semesters/current', { id })
        // 换学期 = 换开学日：值日/座位那边缓存的 semester_start 必须失效
        invalidateSemesterStart()
      } catch (err) {
        reportError(err, { action: '切换学期' })
      }
    },
    // 增加学期：先弹小窗输入学期名（必填），起止日期留空由后端按当前月份推算默认值
    openAddSemester() {
      this.newSemesterName = ''
      this.showAddSemester = true
    },
    async confirmAddSemester() {
      const name = (this.newSemesterName || '').trim()
      if (!name) {
        this.notifyError('请输入学期名')
        return
      }
      if (this.busySemester) return
      this.busySemester = true
      try {
        const res = await axios.post('/api/schedule/semesters', { name })
        // 新增学期会被后端标为「当前学期」，即 semester_start 变了 → 缓存必须失效
        invalidateSemesterStart()
        this.showAddSemester = false
        await this.loadSemesterSettings()
        this.notifySuccess(`已增加学期：${res.data.name}`)
      } catch (err) {
        reportError(err, { action: '增加学期' })
      } finally {
        this.busySemester = false
      }
    },
    openRenameSemester() {
      const cur = this.activeSemester
      if (!cur) return
      this.semesterNameDraft = cur.name || ''
      this.showRenameSemester = true
    },
    async saveSemesterName() {
      const id = this.semesterId
      const name = (this.semesterNameDraft || '').trim()
      if (!id || !name) return
      try {
        await axios.put(`/api/schedule/semesters/${id}`, { name })
        invalidateSemesterStart()
        this.showRenameSemester = false
        await this.loadSemesterSettings()
        this.notifySuccess('学期名已修改')
      } catch (err) {
        reportError(err, { action: '修改学期名' })
      }
    },
    // 学期起止日期：改完点「保存」才写入。
    // 原来用 @change 即时保存，但那样改一半就会写库 —— 典型场景是先把开始日期往后挪，
    // 此时结束日期还停在原处，区间瞬间变成「结束 < 开始」，把非法值存进去。
    // 即时保存还完全静默：成功零反馈、失败只弹 alert，用户无法确认到底存上没有。
    async saveSemesterSettings() {
      if (!this.semesterId) return
      if (this.busySemesterDate) return
      // 先校验，不通过就不发请求（后端也拦一道，见 schedule.js 的 validateSemesterRange）
      const err = this.semesterDateError
      if (err) {
        this.semesterDateErrorText = err
        this.notifyError(err)
        return
      }
      this.semesterDateErrorText = ''
      this.busySemesterDate = true
      try {
        await axios.put(`/api/schedule/semesters/${this.semesterId}`, {
          start_date: this.semesterStart,
          end_date: this.semesterEnd,
        })
        invalidateSemesterStart()
        // 同步本地列表里的这一条：否则 semesterDatesDirty 仍会认为「有未保存的改动」，
        // 保存按钮一直可点，用户会以为没存上而反复点。
        const row = this.semesters.find(s => s.id === this.semesterId)
        if (row) {
          row.start_date = this.semesterStart
          row.end_date = this.semesterEnd
        }
        this.notifySuccess('学期起止日期已保存')
      } catch (err) {
        this.semesterDateErrorText = err.response?.data?.error || '学期设置保存失败'
        this.notifyError(this.semesterDateErrorText)
      } finally {
        this.busySemesterDate = false
      }
    },
    // 删除学期：先弹确认框，确认后调 DELETE；删的是当前学期时后端会自动把剩下的设为当前
    requestDeleteSemester() {
      if (!this.semesterId) return
      this.showDeleteSemester = true
    },
    async confirmDeleteSemester() {
      const id = this.semesterId
      this.showDeleteSemester = false
      if (!id || this.busySemester) return
      this.busySemester = true
      try {
        await axios.delete(`/api/schedule/semesters/${id}`)
        invalidateSemesterStart()
        await this.loadSemesterSettings()
        this.notifySuccess('学期已删除')
      } catch (err) {
        reportError(err, { action: '删除学期' })
      } finally {
        this.busySemester = false
      }
    },
    // ==================== 撤销记录 ====================
    async loadUndo() {
      try {
        const { data } = await listUndo()
        this.undoGroups = data.groups || []
      } catch { }
    },
    async undoOne(id) {
      if (this.busyUndo) return
      this.busyUndo = true
      try {
        const { data } = await undoById(id)
        if (data.ok) this.showAlert(data.label ? `已撤销：${data.label}` : '已成功撤销')
      } catch (err) {
        this.showAlert(err.response?.data?.error || '撤销失败，可能目标数据已被删除')
      } finally {
        this.busyUndo = false
        await this.loadUndo()
      }
    },
    async redoOne(id) {
      if (this.busyUndo) return
      this.busyUndo = true
      try {
        const { data } = await redoById(id)
        if (data.ok) this.showAlert(data.label ? `已重做：${data.label}` : '已成功重做')
      } catch (err) {
        this.showAlert(err.response?.data?.error || '重做失败')
      } finally {
        this.busyUndo = false
        await this.loadUndo()
      }
    },
    clearUndo() {
      if (this.busyUndo) return
      this.showConfirm('确定清空所有撤销记录吗？此操作不可恢复。', async () => {
        this.busyUndo = true
        try {
          await clearUndo('all')
        } finally {
          this.busyUndo = false
          await this.loadUndo()
        }
      })
    },
    groupLabel(key) {
      return this._undoKeyLabels[key] || key
    },
    undoableCount(group) {
      return (group.records || []).filter(r => r.dir === 1).length
    },
    fmtTs(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    },
    // Account
    openModal(type) {
      this.modalType = type
      this.newUsername = ''
      this.usernamePassword = ''
      this.oldPassword = ''
      this.newPassword = ''
      this.confirmPassword = ''
      this.pwdError = ''
      this.busyPwd = false
      this.usernameError = ''
      this.busyUsername = false
      this.exportPassword = ''
      this.exportEncrypt = this.dbEncrypted
      this.exportDbPwd = ''
    },
    closeModal() {
      this.modalType = ''
    },
    showAlert(msg) {
      this.dialog = { visible: true, message: msg, type: 'alert', showCancel: false }
    },
    showConfirm(msg, onConfirm, confirmText) {
      this.dialog = { visible: true, message: msg, type: 'confirm', showCancel: true, confirmText }
      this.dialogCallback = onConfirm
    },
    onDialogConfirm() {
      this.clearDeleteTimer()
      this.dialog.visible = false
      if (this.dialogCallback) {
        this.dialogCallback()
        this.dialogCallback = null
      }
    },
    // 取消/关闭弹窗：一并停掉倒计时定时器
    onDialogCancel() {
      this.clearDeleteTimer()
      this.dialog.visible = false
    },
    clearDeleteTimer() {
      if (this.deleteTimer) {
        clearInterval(this.deleteTimer)
        this.deleteTimer = null
      }
    },
    async changeUsername() {
      if (this.busyUsername) return
      this.usernameError = ''
      const name = String(this.newUsername || '').trim()
      if (!name) { this.usernameError = '请输入新用户名'; return }
      if (name === this.user.username) { this.usernameError = '新用户名和当前用户名相同'; return }
      if (!this.usernamePassword) { this.usernameError = '请输入当前密码'; return }
      this.busyUsername = true
      try {
        const res = await axios.put('/api/account/username', {
          newUsername: name,
          password: this.usernamePassword,
        })
        const currentUser = JSON.parse(localStorage.getItem('currentUser'))
        currentUser.username = name
        localStorage.setItem('currentUser', JSON.stringify(currentUser))
        this.closeModal()
        this.showAlert(res.data.message)
      } catch (err) {
        // 与修改密码一致：服务端错误就地显示，别用 alert 把输入清空
        this.usernameError = err.response?.data?.error || '修改失败，请稍后重试'
      } finally {
        this.busyUsername = false
      }
    },
    async changePassword() {
      if (this.busyPwd) return
      this.pwdError = ''
      const oldPwd = this.oldPassword
      const newPwd = this.newPassword
      // 这几条后端都拦不住（PUT /account/password 原来只校验「新密码非空」），必须前端先挡：
      // 长度、两次是否一致、是否与原密码相同。少任何一条，用户都可能把密码设成自己都打不出来的东西。
      if (!newPwd) { this.pwdError = '请输入新密码'; return }
      if (String(newPwd).length < 6) { this.pwdError = '新密码长度至少 6 位'; return }
      if (newPwd !== this.confirmPassword) { this.pwdError = '两次输入的新密码不一致'; return }
      if (oldPwd && newPwd === oldPwd) { this.pwdError = '新密码不能和原密码相同'; return }
      this.busyPwd = true
      try {
        const res = await axios.put('/api/account/password', {
          oldPassword: oldPwd,
          newPassword: newPwd,
        })
        this.closeModal()
        this.showAlert(res.data.message)
      } catch (err) {
        // 服务端错误（如「原密码错误」）就地显示在弹窗内：用 alert 会连带清空已输入的三个框，
        // 用户得从头再填一遍，而这里本来就是最容易再错一次的地方。
        this.pwdError = err.response?.data?.error || '修改失败，请稍后重试'
      } finally {
        this.busyPwd = false
      }
    },
    confirmLogout() {
      this.showConfirm('确认退出登录？', async () => {
        // 通知后端吊销本次会话：原 token 立即失效（先发请求再清本地，token 已清会 401）
        try { await axios.post('/api/auth/logout') } catch (_) {}
        localStorage.removeItem('token')
        localStorage.removeItem('currentUser')
        clearMediaToken()
        this.$router.push('/login')
      }, '确认')
    },
    // 打开「删除账号」警告弹窗：确定按钮先置灰，10 秒倒计时结束后才可点击
    openDeleteAccount() {
      this.clearDeleteTimer()
      this.dialog = {
        visible: true,
        title: '警告',
        message: '删除账号后无法恢复，请谨慎决定',
        type: 'confirm',
        showCancel: true,
        confirmText: '确定(10)',
        confirmDisabled: true,
      }
      this.dialogCallback = () => this.performDeleteAccount()
      let remain = 10
      this.deleteTimer = setInterval(() => {
        remain -= 1
        if (remain <= 0) {
          this.clearDeleteTimer()
          this.dialog.confirmText = '确定'
          this.dialog.confirmDisabled = false
        } else {
          this.dialog.confirmText = `确定(${remain})`
        }
      }, 1000)
    },
    // 真正删除当前账号：删除后清除本地登录态并回到登录页
    async performDeleteAccount() {
      try {
        await axios.delete('/api/account')
        localStorage.removeItem('token')
        localStorage.removeItem('currentUser')
        clearMediaToken()
        this.$router.push('/login')
      } catch (err) {
        this.showAlert(err.response?.data?.error || '删除失败')
      }
    },
    async exportDb() {
      const needsPassword = !!this.user.hasPassword
      const loginPwd = this.exportPassword
      // 有密码账号：必须先校验登录密码
      if (needsPassword && !loginPwd) {
        this.showAlert('请输入登录密码以导出数据库')
        return
      }
      // 勾选加密（仅加密库有意义）：无密码账号必须提供一个导出密码（否则没有口令可供包裹库钥匙）
      if (this.dbEncrypted && this.exportEncrypt && !needsPassword && !this.exportDbPwd) {
        this.showAlert('该账号未设置密码，请设置一个导出密码以加密备份')
        return
      }
      this.busyExport = true
      try {
        const body = { encrypt: this.exportEncrypt ? '1' : '0' }
        if (needsPassword) body.password = loginPwd
        if (this.dbEncrypted && this.exportEncrypt && this.exportDbPwd) body.dbPassword = this.exportDbPwd
        const res = await axios.post('/api/account/export', body)
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = this.user.username + '-backup.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        this.closeModal()
        this.showAlert('导出成功。请保管好备份文件与本次使用的数据库密码（线上明文不保存）')
      } catch (err) {
        this.showAlert(err.response?.data?.error || '导出失败')
      } finally { this.busyExport = false }
    },
  }
}
