<template>
  <div class="h-full">
    <!-- 顶部标题栏 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-6 py-5 border border-border">
      <h1 class="text-2xl font-bold text-text">🔧 小组件设置</h1>
    </div>

    <!-- ========== 工具箱设置 ========== -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-text mb-4">🧰 工具箱设置</h2>

      <div class="bg-surface rounded-lg border border-border p-6">
        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">是否启用工具箱</label>
          <label class="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              :checked="toolboxEnabled"
              @change="onToolboxChange"
              class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
            />
            <span class="ml-2 text-sm text-text-secondary">{{ toolboxEnabled ? '已启用' : '已禁用' }}</span>
          </label>
        </div>
      </div>
    </div>

    <!-- ========== 保存路径设置 ========== -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-text mb-4">📁 保存路径设置</h2>

      <div class="bg-surface rounded-lg border border-border p-6 space-y-6">
        <!-- 注释截屏保存位置 -->
        <div>
          <div class="flex items-center gap-4 mb-2">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">注释截屏保存位置</label>
            <div class="flex-1 flex gap-2">
              <input
                :value="noteSavePath"
                @input="onNotePathInput"
                placeholder="默认为图片/screenshots/"
                class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded"
              />
              <button
                @click="selectFolder('note')"
                class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme hover:bg-bg whitespace-nowrap"
              >
                浏览...
              </button>
            </div>
          </div>
          <p class="text-xs text-text-muted ml-40">注释工具保存截图的目录，留空则使用默认位置</p>
        </div>

        <!-- 一键截屏保存位置 -->
        <div>
          <div class="flex items-center gap-4 mb-2">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">一键截屏保存位置</label>
            <div class="flex-1 flex gap-2">
              <input
                :value="screenshotSavePath"
                @input="onScreenshotPathInput"
                placeholder="默认为图片/screenshots/"
                class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded"
              />
              <button
                @click="selectFolder('screenshot')"
                class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme hover:bg-bg whitespace-nowrap"
              >
                浏览...
              </button>
            </div>
          </div>
          <p class="text-xs text-text-muted ml-40">一键截屏工具保存截图的目录，留空则使用默认位置</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import { useNotification } from '../composables/useNotification'

export default {
  name: 'WidgetSettingsView',
  setup() {
    const { success, error } = useNotification()
    return { notifySuccess: success, notifyError: error }
  },
  data() {
    return {
      toolboxEnabled: true,
      noteSavePath: '',
      screenshotSavePath: '',
      loaded: false,
      _noteDebounce: null,
      _screenshotDebounce: null
    }
  },
  mounted() {
    this.loadSettings()
  },
  beforeUnmount() {
    clearTimeout(this._noteDebounce)
    clearTimeout(this._screenshotDebounce)
  },
  methods: {
    async loadSettings() {
      try {
        const res = await axios.get('/api/widget-settings')
        if (res.data.success) {
          this.toolboxEnabled = res.data.data.toolboxEnabled
          this.noteSavePath = res.data.data.noteSavePath
          this.screenshotSavePath = res.data.data.screenshotSavePath
        }
      } catch (err) {
        this.notifyError(err.response?.data?.error || '加载设置失败')
      } finally {
        this.loaded = true
      }
    },
    async saveSettings() {
      try {
        await axios.put('/api/widget-settings', {
          toolboxEnabled: this.toolboxEnabled,
          noteSavePath: this.noteSavePath,
          screenshotSavePath: this.screenshotSavePath
        })
        // 通知工具箱刷新设置
        window.electron.send('to-widget', { type: 'settings-changed' })
      } catch (err) {
        this.notifyError(err.response?.data?.error || '保存设置失败')
      }
    },
    onToolboxChange(e) {
      this.toolboxEnabled = e.target.checked
      if (!this.loaded) return
      this.saveSettings()
    },
    onNotePathInput(e) {
      this.noteSavePath = e.target.value
      if (!this.loaded) return
      clearTimeout(this._noteDebounce)
      this._noteDebounce = setTimeout(() => this.saveSettings(), 500)
    },
    onScreenshotPathInput(e) {
      this.screenshotSavePath = e.target.value
      if (!this.loaded) return
      clearTimeout(this._screenshotDebounce)
      this._screenshotDebounce = setTimeout(() => this.saveSettings(), 500)
    },
    async selectFolder(type) {
      try {
        const result = await window.electron.invoke('select-folder')
        if (result && result.filePaths && result.filePaths.length > 0) {
          const path = result.filePaths[0]
          if (type === 'note') {
            this.noteSavePath = path
          } else {
            this.screenshotSavePath = path
          }
          this.saveSettings()
        }
      } catch (err) {
        this.notifyError('选择文件夹失败')
      }
    },
  }
}
</script>