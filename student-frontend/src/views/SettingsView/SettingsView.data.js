// ===== 设置页：学期设置、撤销记录、弹窗/消息、账号与数据库导出 =====
// 纯代码搬运自 SettingsView.vue 的 methods，未改写逻辑；通过展开注册到组件 methods。
import axios from 'axios'
import { listUndo, undoById, redoById, clearUndo } from '../../api/undo'
import { pad2 } from '../../utils/dateTime.js'

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
      } catch (_) { /* 后端未就绪时静默忽略 */ }
    },
    // 选择学期：同时切换为当前学期（课程表、座位补存范围、座位指数结算都按它走）
    async onSelectSemester(id) {
      const target = this.semesters.find(s => s.id === id)
      if (!target) return
      this.semesterId = id
      this.semesterStart = target.start_date || ''
      this.semesterEnd = target.end_date || ''
      try {
        await axios.put('/api/schedule/semesters/current', { id })
      } catch (err) {
        this.notifyError(err.response?.data?.error || '切换学期失败')
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
        this.showAddSemester = false
        await this.loadSemesterSettings()
        this.notifySuccess(`已增加学期：${res.data.name}`)
      } catch (err) {
        this.notifyError(err.response?.data?.error || '增加学期失败')
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
        this.showRenameSemester = false
        await this.loadSemesterSettings()
        this.notifySuccess('学期名已修改')
      } catch (err) {
        this.notifyError(err.response?.data?.error || '修改学期名失败')
      }
    },
    // 改动即时保存（无需保存按钮）：写入所选学期的起止日期
    async saveSemesterSettings() {
      if (!this.semesterId) return
      try {
        await axios.put(`/api/schedule/semesters/${this.semesterId}`, {
          start_date: this.semesterStart,
          end_date: this.semesterEnd,
        })
      } catch (err) {
        this.showAlert(err.response?.data?.error || '学期设置保存失败')
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
        await this.loadSemesterSettings()
        this.notifySuccess('学期已删除')
      } catch (err) {
        this.notifyError(err.response?.data?.error || '删除学期失败')
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
      try {
        const res = await axios.put('/api/account/username', {
          newUsername: this.newUsername,
          password: this.usernamePassword,
        })
        const currentUser = JSON.parse(localStorage.getItem('currentUser'))
        currentUser.username = this.newUsername
        localStorage.setItem('currentUser', JSON.stringify(currentUser))
        this.closeModal()
        this.showAlert(res.data.message)
      } catch (err) {
        this.showAlert(err.response?.data?.error || '修改失败')
      }
    },
    async changePassword() {
      try {
        const res = await axios.put('/api/account/password', {
          oldPassword: this.oldPassword,
          newPassword: this.newPassword,
        })
        this.closeModal()
        this.showAlert(res.data.message)
      } catch (err) {
        this.showAlert(err.response?.data?.error || '修改失败')
      }
    },
    confirmLogout() {
      this.showConfirm('确认退出登录？', async () => {
        // 通知后端吊销本次会话：原 token 立即失效（先发请求再清本地，token 已清会 401）
        try { await axios.post('/api/auth/logout') } catch (_) {}
        localStorage.removeItem('token')
        localStorage.removeItem('currentUser')
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
