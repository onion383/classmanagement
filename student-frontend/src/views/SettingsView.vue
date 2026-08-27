<template>
  <div class="h-full">
    <!-- 顶部标题栏 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-6 py-5 border border-border min-h-[4.5rem] flex items-center">
      <h1 class="text-2xl font-bold text-text">⚙️ 系统设置</h1>
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
            <button @click="openModal('export')" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded transition-theme" :disabled="busyExport">导出数据库</button>
            <button @click="confirmLogout" class="bg-danger hover:bg-danger-hover text-text-inverse px-4 py-2 rounded transition-theme">退出登录</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== 撤销记录 ========== -->
    <div class="mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-text">↩️ 撤销记录</h2>
        <button
          v-if="hasUndoRecords"
          @click="clearUndo"
          class="text-sm text-danger hover:underline disabled:opacity-40"
          :disabled="busyUndo"
        >清空所有撤销记录</button>
      </div>

      <div class="bg-surface rounded-lg border border-border p-6">

        <div v-if="!hasUndoRecords" class="text-sm text-text-muted text-center py-8">
          暂无编辑记录。在表格中修改数据后，这里会记录该次操作，之后可一键撤销、跨重启保留。
        </div>

        <div v-else class="space-y-6">
          <div v-for="group in undoGroups" :key="group.key" class="border border-border rounded-lg overflow-hidden">
            <div class="flex items-center justify-between px-4 py-2.5 bg-surface-hover border-b border-border">
              <span class="font-medium text-text">{{ groupLabel(group.key) }}</span>
              <span class="text-xs text-text-muted">{{ undoableCount(group) }} 步可撤销</span>
            </div>
            <ul class="divide-y divide-border max-h-72 overflow-auto">
              <li v-for="rec in group.records" :key="rec.id"
                  class="flex items-center justify-between gap-3 px-4 py-2 hover:bg-surface-hover">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-xs text-text-muted flex-shrink-0">{{ fmtTs(rec.ts) }}</span>
                  <span class="text-sm text-text truncate">{{ rec.label }}</span>
                  <span v-if="rec.dir === 0" class="text-[11px] text-info flex-shrink-0">已撤销</span>
                </div>
                <div class="flex-shrink-0">
                  <button
                    v-if="rec.dir === 1"
                    @click="undoOne(rec.id)"
                    class="bg-warning hover:bg-warning-hover text-text-inverse text-xs px-3 py-1 rounded transition-theme disabled:opacity-40"
                    :disabled="busyUndo"
                  >撤销</button>
                  <button
                    v-else
                    @click="redoOne(rec.id)"
                    class="bg-info hover:bg-info-hover text-text-inverse text-xs px-3 py-1 rounded transition-theme disabled:opacity-40"
                    :disabled="busyUndo"
                  >重做</button>
                </div>
              </li>
            </ul>
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
            <AppSelect
              v-model="selectedThemeId"
              @change="onThemeSelect"
              :options="themeOptions"
              class="w-56"
            />
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
              <button v-if="!isPreset" @click="deleteCurrentCustomTheme" class="text-sm text-danger hover:underline">删除此主题</button>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <div v-for="item in colorItems" :key="item.key" class="flex items-center gap-3 p-3 rounded border border-border bg-surface-hover">
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

          <!-- 背景图片（仅毛玻璃主题） -->
          <div v-if="currentTheme === 'glass'" class="border-t border-border pt-6 mt-6">
            <h3 class="text-lg font-semibold text-text mb-4">🖼️ 背景图片</h3>
            <div class="flex items-center gap-3 mb-2">
              <input
                ref="bgImageInput"
                type="file"
                accept="image/*"
                @change="onBgImageFileChange"
                class="hidden"
              />
              <button @click="$refs.bgImageInput.click()" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme whitespace-nowrap">📁 选择本地图片</button>
              <span v-if="bgImageFileName" class="text-sm text-text-secondary">已选: {{ bgImageFileName }}</span>
              <button v-if="bgImageUrl" @click="clearBgImage" class="text-sm text-danger hover:underline">清除</button>
            </div>
            <p class="text-xs text-text-muted">支持 JPG / PNG / GIF / WebP，留空使用默认弥散光斑</p>
            <div v-if="bgImageUrl" class="mt-3">
              <img :src="bgImagePreviewUrl" class="max-h-40 rounded border border-border object-cover shadow-sm" />
            </div>
          </div>

          <!-- 透明度设置（仅毛玻璃主题） -->
          <div v-if="currentTheme === 'glass'" class="border-t border-border pt-6 mt-6">
            <h3 class="text-lg font-semibold text-text mb-4">🎚️ 透明度设置</h3>
            <div class="space-y-5">
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-sm font-medium text-text">背景遮罩层（有自定义背景图时）</label>
                  <span class="text-xs text-text-muted">{{ Math.round(bgMaskOpacity * 100) }}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  :value="bgMaskOpacity"
                  @input="onBgMaskOpacityChange"
                  class="w-full"
                />
                <p class="text-xs text-text-muted mt-1">数值越高，背景图越不明显；越低，背景图越清晰</p>
              </div>
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-sm font-medium text-text">组件透明玻璃层</label>
                  <span class="text-xs text-text-muted">{{ Math.round(glassOpacity * 100) }}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  :value="glassOpacity"
                  @input="onGlassOpacityChange"
                  class="w-full"
                />
                <p class="text-xs text-text-muted mt-1">控制卡片、表格、通知弹窗等玻璃层的透明度</p>
              </div>
            </div>
          </div>
        </div>
      </div>

    <!-- ========== 工具箱设置 ========== -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-text mb-4">🧰 工具箱设置</h2>
      <div class="bg-surface rounded-lg border border-border p-6">
        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">是否启用工具箱</label>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" :checked="toolboxEnabled" @change="onToolboxChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
            <span class="ml-2 text-sm text-text-secondary">{{ toolboxEnabled ? '已启用' : '已禁用' }}</span>
          </label>
        </div>
        <p class="text-xs text-text-muted mt-2 ml-40">下次启动时是否显示工具箱（本次运行不受此开关影响）</p>
        <div class="flex items-center gap-4 mt-6">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">本次启用工具箱</label>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" :checked="sessionEnabled" @change="onSessionChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
            <span class="ml-2 text-sm text-text-secondary">{{ sessionEnabled ? '已启用' : '已禁用' }}</span>
          </label>
        </div>
        <p class="text-xs text-text-muted mt-2 ml-40">仅本次运行立即显示/隐藏工具箱；重启后按上方「是否启用」决定</p>
        <div class="flex items-center gap-4 mt-6">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">新U盘插入自动打开</label>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" :checked="usbAutoOpen" @change="onUsbAutoOpenChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
            <span class="ml-2 text-sm text-text-secondary">{{ usbAutoOpen ? '已开启' : '已关闭' }}</span>
          </label>
        </div>
        <p class="text-xs text-text-muted mt-2 ml-40">插入新U盘时自动用文件资源管理器打开（仅Windows，即时生效）</p>
      </div>
    </div>

    <!-- ========== 保存路径设置 ========== -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-text mb-4">📁 保存路径设置</h2>
      <div class="bg-surface rounded-lg border border-border p-6 space-y-6">
        <div>
          <div class="flex items-center gap-4 mb-2">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">注释截屏保存位置</label>
            <div class="flex-1 flex gap-2">
              <input :value="noteSavePath" @input="onNotePathInput" placeholder="默认为图片/screenshots/" class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded" />
              <button @click="selectFolder('note')" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme hover:bg-bg whitespace-nowrap">浏览...</button>
            </div>
          </div>
          <p class="text-xs text-text-muted ml-40">注释工具保存截图的目录，留空则使用默认位置</p>
        </div>
        <div>
          <div class="flex items-center gap-4 mb-2">
            <label class="text-sm font-medium text-text w-40 flex-shrink-0">一键截屏保存位置</label>
            <div class="flex-1 flex gap-2">
              <input :value="screenshotSavePath" @input="onScreenshotPathInput" placeholder="默认为图片/screenshots/" class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded" />
              <button @click="selectFolder('screenshot')" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme hover:bg-bg whitespace-nowrap">浏览...</button>
            </div>
          </div>
          <p class="text-xs text-text-muted ml-40">一键截屏工具保存截图的目录，留空则使用默认位置</p>
        </div>
      </div>
    </div>

    <!-- ========== AI 助手设置 ========== -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-text mb-4">🧠 AI 助手设置</h2>
      <div class="bg-surface rounded-lg border border-border p-6 space-y-5">
        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">启用 AI 助手</label>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" :checked="ai.enabled" @change="onAiEnabledChange" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
            <span class="ml-2 text-sm text-text-secondary">{{ ai.enabled ? '已启用' : '已禁用' }}</span>
          </label>
        </div>

        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">模型服务</label>
          <AppSelect v-model="ai.provider" @change="onAiProviderChange" :options="aiProviderOptions" class="w-56" />
          <a v-if="ai.provider !== 'custom'" :href="aiProviderDocs[ai.provider]" target="_blank" rel="noopener" class="text-xs text-info hover:underline">获取 API Key</a>
        </div>

        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">Base URL</label>
          <input v-model="ai.base_url" @input="onAiBaseUrlInput" placeholder="留空使用默认" class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded" />
        </div>

        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">模型名</label>
          <input v-model="ai.model" @input="onAiModelInput" placeholder="留空使用默认" class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded" />
        </div>

        <div class="flex items-center gap-4">
          <label class="text-sm font-medium text-text w-40 flex-shrink-0">API Key</label>
          <input v-model="ai.api_key" type="password" @input="onAiKeyInput" :placeholder="ai.hasApiKey ? '已配置（留空保持不变）' : '粘贴 API Key'" class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded" autocomplete="off" />
        </div>

        <div class="flex items-center gap-3 ml-40">
          <button @click="testAi" :disabled="aiTesting" class="bg-info hover:bg-info-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-40">
            {{ aiTesting ? '测试中…' : '测试连接' }}
          </button>
          <span v-if="aiTestResult" class="text-sm" :class="aiTestOk ? 'text-success' : 'text-danger'">{{ aiTestResult }}</span>
        </div>
        <p class="text-xs text-text-muted ml-40">密钥仅保存在本机加密数据库中，不会上传或进入前端界面。支持 OpenAI 兼容协议的服务均可接入。</p>
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

    <!-- 内嵌弹窗：导出数据库 -->
    <div v-if="modalType === 'export'" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]" @click.self="closeModal">
      <div class="bg-surface rounded-lg p-6 w-96 border border-border shadow-lg">
        <h3 class="text-lg font-bold text-text mb-4">导出数据库</h3>
        <p class="text-xs text-text-muted mb-3">输入你的登录密码即可导出当前库（业务数据 + 应用设置 + 账号），换机后可用同一密码恢复。</p>
        <input v-model="exportPassword" type="password" placeholder="登录密码" autocomplete="current-password" class="border border-border bg-surface text-text p-2 w-full mb-4 rounded" />
        <div class="flex justify-end gap-2">
          <button @click="closeModal" class="bg-surface-hover text-text px-4 py-2 rounded border border-border transition-theme">取消</button>
          <button @click="exportDb" :disabled="busyExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50">
            {{ busyExport ? '导出中…' : '导出备份' }}
          </button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-if="dialogMounted"
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
import { defineAsyncComponent } from 'vue'
import AppSelect from '../components/base/AppSelect.vue'
import { useThemeStore } from '../stores/theme'
import { storeToRefs } from 'pinia'
import { resourceUrl } from '../utils/apiUrl'

// 弹窗类组件懒加载：打开时才加载对应 chunk
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))

export default {
  components: { AppSelect, ConfirmDialog },
  // 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
  watch: {
    'dialog.visible'(n) { if (n) this.dialogMounted = true }
  },
  data() {
    const themeStore = useThemeStore()
    const { currentTheme, customColors, customThemes, isPreset, bgMaskOpacity, glassOpacity } = storeToRefs(themeStore)

    return {
      themeStore,
      currentTheme,
      customColors,
      customThemes,
      isPreset,
      bgMaskOpacity,
      glassOpacity,
      // Modal
      modalType: '',
      newUsername: '',
      usernamePassword: '',
      oldPassword: '',
      newPassword: '',
      // Export database
      exportPassword: '',
      busyExport: false,
      // Dialog
      dialog: {
        visible: false,
        message: '',
        type: 'alert',
        showCancel: false,
      },
      dialogMounted: false,
      dialogCallback: null,
      // 工具箱设置
      toolboxEnabled: true,
      sessionEnabled: true,
      sessionLoaded: false,
      noteSavePath: '',
      screenshotSavePath: '',
      usbAutoOpen: false,
      loaded: false,
      _noteDebounce: null,
      _screenshotDebounce: null,
      _fromMainHandler: null,
      // 撤销记录
      undoGroups: [],
      busyUndo: false,
      // Theme
      selectedThemeId: '',
      isCreatingNewTheme: false,
      newThemeName: '',
      newThemePrimary: '#22c55e',
      // Background image
      bgImageUrl: '',
      bgImageFileName: '',
      presetThemes: [
        { id: 'base', name: '彩色色块主题' },
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
      // AI 助手设置
      ai: {
        enabled: false,
        provider: 'deepseek',
        base_url: '',
        model: '',
        api_key: '',
        hasApiKey: false,
      },
      aiTesting: false,
      aiTestResult: '',
      aiTestOk: false,
      _aiDebounce: null,
      _aiKeyDebounce: null,
      aiProviderPresets: {
        deepseek: { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        moonshot: { base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
        qwen: { base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
        glm: { base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
        custom: { base_url: '', model: '' },
      },
      aiProviderDocs: {
        deepseek: 'https://platform.deepseek.com/',
        openai: 'https://platform.openai.com/',
        moonshot: 'https://platform.moonshot.cn/',
        qwen: 'https://dashscope.console.aliyun.com/',
        glm: 'https://open.bigmodel.cn/',
        custom: 'https://example.com',
      },
    }
  },
  computed: {
    user() {
      return JSON.parse(localStorage.getItem('currentUser') || '{}')
    },
    showColorSettings() {
      return !this.isCreatingNewTheme && this.currentTheme !== 'base'
    },
    // 预览图走 resourceUrl：补完整后端地址并追加 ?token=，保证打包版 file:// 下能通过鉴权
    bgImagePreviewUrl() {
      return this.bgImageUrl ? resourceUrl(this.bgImageUrl) : ''
    },
    themeOptions() {
      const opts = [
        { value: 'new', label: '+ 新建主题' },
        { value: '', label: '──────────', disabled: true },
        ...this.presetThemes.map(t => ({ value: t.id, label: t.name })),
      ]
      if (this.customThemes.length) {
        opts.push({ value: '', label: '──────────', disabled: true })
        opts.push(...this.customThemes.map(t => ({ value: t.id, label: t.name })))
      }
      return opts
    },
    hasUndoRecords() {
      return this.undoGroups.length > 0
    },
    _undoKeyLabels() {
      return { students: '学生表', fee_records: '收费记录', leave_records: '请假记录', score_records: '成绩记录', group_manage: '分组管理', album: '班级相册' }
    },
    aiProviderOptions() {
      return [
        { value: 'deepseek', label: 'DeepSeek（推荐）' },
        { value: 'moonshot', label: 'Kimi（月之暗面）' },
        { value: 'qwen', label: '通义千问' },
        { value: 'glm', label: '智谱清言' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'custom', label: '自定义（OpenAI 兼容）' },
      ]
    },
  },
  mounted() {
    this.selectedThemeId = this.currentTheme
    this.bgImageUrl = this.themeStore.backgroundImage
    this.loadUndo()
    this.loadWidgetSettings()
    this.loadSession()
    this.loadUsbAutoOpen()
    this.loadAiConfig()
    this._fromMainHandler = window.electron?.on('from-main', (data) => {
      if (data && data.type === 'session-widget-changed') this.loadSession()
    })
  },
  beforeUnmount() {
    clearTimeout(this._noteDebounce)
    clearTimeout(this._screenshotDebounce)
    if (this._fromMainHandler) {
      window.electron?.off('from-main', this._fromMainHandler)
    }
  },
  methods: {
    // ==================== 撤销记录 ====================
    async loadUndo() {
      try {
        const { data } = await axios.get('/api/undo')
        this.undoGroups = data.groups || []
      } catch { }
    },
    async undoOne(id) {
      if (this.busyUndo) return
      this.busyUndo = true
      try {
        const { data } = await axios.post(`/api/undo/${id}/undo`)
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
        const { data } = await axios.post(`/api/undo/${id}/redo`)
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
          await axios.delete(`/api/undo?key=all`)
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
      const p = n => String(n).padStart(2, '0')
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    },
    // Account
    openModal(type) {
      this.modalType = type
      this.newUsername = ''
      this.usernamePassword = ''
      this.oldPassword = ''
      this.newPassword = ''
      this.exportPassword = ''
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
    async exportDb() {
      const pwd = this.exportPassword
      if (!pwd) {
        this.showAlert('请输入登录密码以导出数据库')
        return
      }
      this.busyExport = true
      try {
        const res = await axios.get('/api/account/export', { params: { password: pwd } })
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
        this.showAlert('导出成功。请保管好备份文件与你在本页填写的密码/助记词（线上明文不保存）')
      } catch (err) {
        this.showAlert(err.response?.data?.error || '导出失败')
      } finally { this.busyExport = false }
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
            const result = await window.electron.invoke('save-background-image', {
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
        window.electron?.send('to-widget', { type: 'settings-changed' })
      } catch (err) {
        console.error('保存工具箱设置失败:', err)
      }
    },
    onToolboxChange(e) {
      this.toolboxEnabled = e.target.checked
      if (!this.loaded) return
      this.saveWidgetSettings()
    },
    async loadSession() {
      try {
        this.sessionEnabled = await window.electron?.invoke('get-session-widget-visible')
      } catch (_) {}
      if (this.sessionEnabled === null || this.sessionEnabled === undefined) {
        this.sessionEnabled = this.toolboxEnabled
        window.electron?.send('widget-set-session-visible', this.sessionEnabled)
      }
      this.sessionLoaded = true
    },
    onSessionChange(e) {
      this.sessionEnabled = e.target.checked
      if (!this.sessionLoaded) return
      window.electron?.send('widget-set-session-visible', this.sessionEnabled)
    },
    onNotePathInput(e) {
      this.noteSavePath = e.target.value
      if (!this.loaded) return
      clearTimeout(this._noteDebounce)
      this._noteDebounce = setTimeout(() => this.saveWidgetSettings(), 500)
    },
    onScreenshotPathInput(e) {
      this.screenshotSavePath = e.target.value
      if (!this.loaded) return
      clearTimeout(this._screenshotDebounce)
      this._screenshotDebounce = setTimeout(() => this.saveWidgetSettings(), 500)
    },
    async loadUsbAutoOpen() {
      try {
        const res = await window.electron?.invoke('get-usb-auto-open')
        this.usbAutoOpen = !!res?.enabled
      } catch (_) {}
    },
    async onUsbAutoOpenChange(e) {
      this.usbAutoOpen = e.target.checked
      try {
        await window.electron?.invoke('set-usb-auto-open', this.usbAutoOpen)
      } catch (_) {
        console.error('保存U盘自动打开设置失败')
      }
    },
    async selectFolder(type) {
      try {
        const result = await window.electron?.invoke('select-folder')
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
    // ==================== AI 助手设置 ====================
    async loadAiConfig() {
      try {
        const { data } = await axios.get('/api/ai/config')
        if (data.success) {
          this.ai.enabled = data.data.enabled
          this.ai.provider = data.data.provider
          this.ai.base_url = data.data.base_url
          this.ai.model = data.data.model
          this.ai.hasApiKey = data.data.hasApiKey
        }
      } catch (err) {
        console.error('加载 AI 配置失败:', err)
      }
    },
    async saveAiConfig() {
      try {
        await axios.put('/api/ai/config', {
          enabled: this.ai.enabled,
          provider: this.ai.provider,
          base_url: this.ai.base_url,
          model: this.ai.model,
          api_key: this.ai.api_key,
        })
        if (this.ai.api_key) this.ai.hasApiKey = true
        this.aiTestResult = ''
      } catch (err) {
        console.error('保存 AI 配置失败:', err)
        this.aiTestResult = err.response?.data?.error || '保存失败'
        this.aiTestOk = false
      }
    },
    onAiEnabledChange(e) {
      this.ai.enabled = e.target.checked
      this.saveAiConfig()
    },
    onAiProviderChange() {
      const preset = this.aiProviderPresets[this.ai.provider]
      if (preset) {
        this.ai.base_url = preset.base_url
        this.ai.model = preset.model
      }
      this.saveAiConfig()
    },
    onAiBaseUrlInput() {
      clearTimeout(this._aiDebounce)
      this._aiDebounce = setTimeout(() => this.saveAiConfig(), 400)
    },
    onAiModelInput() {
      clearTimeout(this._aiDebounce)
      this._aiDebounce = setTimeout(() => this.saveAiConfig(), 400)
    },
    onAiKeyInput() {
      clearTimeout(this._aiKeyDebounce)
      this._aiKeyDebounce = setTimeout(() => this.saveAiConfig(), 400)
    },
    async testAi() {
      this.aiTesting = true
      this.aiTestResult = ''
      this.aiTestOk = false
      try {
        const { data } = await axios.post('/api/ai/config/test')
        this.aiTestOk = true
        this.aiTestResult = data.message || '连接成功'
      } catch (err) {
        this.aiTestOk = false
        this.aiTestResult = err.response?.data?.error || '连接失败'
      } finally {
        this.aiTesting = false
      }
    },
  },
}
</script>
