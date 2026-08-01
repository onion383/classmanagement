<template>
  <div class="h-full">
    <!-- 顶部标题栏 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-6 py-5 border border-border">
      <h1 class="text-2xl font-bold text-text">⚙️ 设置</h1>
    </div>

    <!-- ========== 账号管理 ========== -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-text mb-4">👤 账号管理</h2>

      <div class="bg-surface rounded-lg border border-border p-6">
        <h3 class="text-lg font-semibold text-text mb-4">账号信息</h3>
        <div class="flex items-center justify-between flex-wrap gap-4">
          <div class="space-y-2 text-text-secondary">
            <p><span class="text-text-muted">当前用户：</span>{{ user.username }}</p>
            <p><span class="text-text-muted">权限：</span>{{ user.role === 'teacher' ? '班主任' : '科任老师' }}</p>
          </div>
          <div class="flex gap-3">
            <button @click="openModal('username')" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme">修改用户名</button>
            <button @click="openModal('password')" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme">修改密码</button>
            <button @click="confirmLogout" class="bg-danger hover:bg-danger-hover text-text-inverse px-4 py-2 rounded transition-theme">退出登录</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== 主题设置 ========== -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-text mb-4">🎨 主题设置</h2>

      <div class="bg-surface rounded-lg border border-border p-6">
          <!-- 主题选择 -->
          <div class="flex items-center gap-4 mb-6">
            <label class="text-sm font-medium text-text w-16 flex-shrink-0">主题</label>
            <select v-model="selectedThemeId" @change="onThemeSelect" class="border border-border bg-surface text-text px-3 py-2 rounded w-56">
              <option value="new">+ 新建主题</option>
              <option disabled>──────────</option>
              <option v-for="t in presetThemes" :key="t.id" :value="t.id">{{ t.name }}</option>
              <template v-if="customThemes.length">
                <option disabled>──────────</option>
                <option v-for="t in customThemes" :key="t.id" :value="t.id">{{ t.name }}</option>
              </template>
            </select>
          </div>

          <!-- 新建主题表单 -->
          <div v-if="isCreatingNewTheme" class="border-t border-border pt-6 mb-6">
            <h3 class="text-lg font-semibold text-text mb-4">新建主题</h3>
            <div class="flex items-center gap-4 mb-4">
              <label class="text-sm font-medium text-text w-16 flex-shrink-0">主题名</label>
              <input v-model="newThemeName" placeholder="输入主题名称" class="border border-border bg-surface text-text px-3 py-2 rounded w-64" />
            </div>
            <div class="flex items-center gap-4 mb-4">
              <label class="text-sm font-medium text-text w-16 flex-shrink-0">主色</label>
              <input type="color" v-model="newThemePrimary" class="w-10 h-10 p-0 border-0 rounded overflow-hidden cursor-pointer" />
              <span class="text-sm text-text-secondary">{{ newThemePrimary }}</span>
            </div>
            <div class="flex gap-3">
              <button @click="saveNewTheme" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme">保存主题</button>
              <button @click="cancelNewTheme" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme">取消</button>
            </div>
          </div>

          <!-- 颜色调整（非默认主题） -->
          <div v-if="showColorSettings" class="border-t border-border pt-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-semibold text-text">颜色调整</h3>
              <button v-if="!isPresetTheme" @click="deleteCurrentCustomTheme" class="text-sm text-danger hover:underline">删除此主题</button>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <div v-for="item in colorItems" :key="item.key" class="flex items-center gap-3 p-3 rounded border border-border bg-bg">
                <input
                  type="color"
                  :value="currentColor(item.key, item.default)"
                  @input="updateColor(item.key, $event.target.value)"
                  class="w-8 h-8 p-0 border-0 rounded overflow-hidden cursor-pointer flex-shrink-0"
                />
                <div>
                  <div class="text-sm font-medium text-text">{{ item.label }}</div>
                  <div class="text-xs text-text-muted">{{ currentColor(item.key, item.default) }}</div>
                </div>
              </div>
            </div>
            <div class="flex gap-3 mt-4">
              <button @click="resetThemeColors" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme">重置为默认</button>
            </div>
          </div>
        </div>
      </div>

    <!-- 内嵌弹窗：修改用户名 -->
    <div v-if="modalType === 'username'" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="closeModal">
      <div class="bg-surface rounded-lg p-6 w-96 border border-border shadow-lg">
        <h3 class="text-lg font-bold text-text mb-4">修改用户名</h3>
        <input v-model="newUsername" placeholder="新用户名" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" />
        <input v-model="usernamePassword" type="password" placeholder="当前密码" autocomplete="current-password" class="border border-border bg-surface text-text p-2 w-full mb-4 rounded" />
        <div class="flex justify-end gap-2">
          <button @click="closeModal" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme">取消</button>
          <button @click="changeUsername" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme">确认修改</button>
        </div>
      </div>
    </div>

    <!-- 内嵌弹窗：修改密码 -->
    <div v-if="modalType === 'password'" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="closeModal">
      <div class="bg-surface rounded-lg p-6 w-96 border border-border shadow-lg">
        <h3 class="text-lg font-bold text-text mb-4">修改密码</h3>
        <input v-model="oldPassword" type="password" placeholder="原密码" autocomplete="current-password" class="border border-border bg-surface text-text p-2 w-full mb-3 rounded" />
        <input v-model="newPassword" type="password" placeholder="新密码" autocomplete="new-password" class="border border-border bg-surface text-text p-2 w-full mb-4 rounded" />
        <div class="flex justify-end gap-2">
          <button @click="closeModal" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme">取消</button>
          <button @click="changePassword" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme">确认修改</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :visible="dialog.visible"
      :message="dialog.message"
      :type="dialog.type"
      :showCancel="dialog.showCancel"
      @confirm="onDialogConfirm"
      @cancel="dialog.visible = false"
    />
  </div>
</template>

<script>
import axios from 'axios'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { useThemeStore } from '../stores/theme'
import { storeToRefs } from 'pinia'

export default {
  components: { ConfirmDialog },
  setup() {
    const themeStore = useThemeStore()
    const { currentTheme, customColors, customThemes, isPreset } = storeToRefs(themeStore)

    return {
      themeStore,
      currentTheme,
      customColors,
      customThemes,
      isPreset,
    }
  },
  data() {
    return {
      // Modal
      modalType: '',
      newUsername: '',
      usernamePassword: '',
      oldPassword: '',
      newPassword: '',
      // Dialog
      dialog: {
        visible: false,
        message: '',
        type: 'alert',
        showCancel: false,
      },
      dialogCallback: null,
      // Theme
      selectedThemeId: '',
      isCreatingNewTheme: false,
      newThemeName: '',
      newThemePrimary: '#22c55e',
      presetThemes: [
        { id: 'base', name: '默认主题' },
        { id: 'glass', name: '毛玻璃主题' },
        { id: 'minimal', name: '极简主题' },
      ],
      colorItems: [
        { key: 'color-primary', label: '主色', default: '#22c55e' },
        { key: 'color-bg', label: '背景', default: '#f9fafb' },
        { key: 'color-surface', label: '卡片', default: '#ffffff' },
        { key: 'color-sidebar', label: '侧边栏', default: '#1f2937' },
        { key: 'color-text', label: '文字', default: '#111827' },
        { key: 'color-border', label: '边框', default: '#e5e7eb' },
        { key: 'color-success', label: '成功', default: '#22c55e' },
        { key: 'color-danger', label: '危险', default: '#ef4444' },
        { key: 'color-info', label: '信息', default: '#3b82f6' },
        { key: 'color-warning', label: '警告', default: '#f59e0b' },
      ],
    }
  },
  computed: {
    user() {
      return JSON.parse(localStorage.getItem('currentUser') || '{}')
    },
    showColorSettings() {
      return !this.isCreatingNewTheme && this.currentTheme !== 'base'
    },
  },
  mounted() {
    this.selectedThemeId = this.currentTheme
  },
  methods: {
    // Account
    openModal(type) {
      this.modalType = type
      this.newUsername = ''
      this.usernamePassword = ''
      this.oldPassword = ''
      this.newPassword = ''
    },
    closeModal() {
      this.modalType = ''
    },
    showAlert(msg) {
      this.dialog = { visible: true, message: msg, type: 'alert', showCancel: false }
    },
    showConfirm(msg, onConfirm) {
      this.dialog = { visible: true, message: msg, type: 'confirm', showCancel: true }
      this.dialogCallback = onConfirm
    },
    onDialogConfirm() {
      this.dialog.visible = false
      if (this.dialogCallback) {
        this.dialogCallback()
        this.dialogCallback = null
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
      this.showConfirm('确定要退出登录吗？', () => {
        localStorage.removeItem('token')
        localStorage.removeItem('currentUser')
        this.$router.push('/login')
      })
    },
    // Theme
    onThemeSelect() {
      if (this.selectedThemeId === 'new') {
        this.isCreatingNewTheme = true
        this.newThemeName = ''
        this.newThemePrimary = '#22c55e'
      } else {
        this.isCreatingNewTheme = false
        this.themeStore.setTheme(this.selectedThemeId)
        // 如果是自定义主题，加载其颜色
        const custom = this.customThemes.find(t => t.id === this.selectedThemeId)
        if (custom && custom.colors) {
          this.themeStore.resetCustomColors()
          Object.entries(custom.colors).forEach(([key, value]) => {
            this.themeStore.setCustomColor(key, value)
          })
        } else if (['base', 'glass', 'minimal'].includes(this.selectedThemeId)) {
          this.themeStore.resetCustomColors()
        }
      }
    },
    saveNewTheme() {
      if (!this.newThemeName.trim()) {
        this.showAlert('请输入主题名称')
        return
      }
      const colors = {
        'color-primary': this.newThemePrimary,
      }
      const id = this.themeStore.createCustomTheme(this.newThemeName.trim(), colors)
      this.themeStore.setTheme(id)
      this.themeStore.resetCustomColors()
      Object.entries(colors).forEach(([key, value]) => {
        this.themeStore.setCustomColor(key, value)
      })
      this.isCreatingNewTheme = false
      this.selectedThemeId = id
      this.showAlert('主题创建成功')
    },
    cancelNewTheme() {
      this.isCreatingNewTheme = false
      this.selectedThemeId = this.currentTheme
    },
    currentColor(key, defaultVal) {
      return this.customColors[key] || defaultVal
    },
    updateColor(key, value) {
      this.themeStore.setCustomColor(key, value)
      // 如果当前是自定义主题，同步更新主题的颜色配置
      const custom = this.customThemes.find(t => t.id === this.currentTheme)
      if (custom) {
        const newColors = { ...(custom.colors || {}), [key]: value }
        this.themeStore.updateCustomTheme(custom.id, { colors: newColors })
      }
    },
    resetThemeColors() {
      this.themeStore.resetCustomColors()
      // 如果当前是自定义主题，清空其颜色配置
      const custom = this.customThemes.find(t => t.id === this.currentTheme)
      if (custom) {
        this.themeStore.updateCustomTheme(custom.id, { colors: {} })
      }
    },
    deleteCurrentCustomTheme() {
      this.showConfirm('确定要删除此自定义主题吗？', () => {
        this.themeStore.deleteCustomTheme(this.currentTheme)
        this.selectedThemeId = 'base'
      })
    },
  },
}
</script>
