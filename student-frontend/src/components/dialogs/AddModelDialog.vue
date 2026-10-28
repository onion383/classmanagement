<template>
  <DialogShell :visible="show" :z-index="10070" overlay-class="bg-black/50" @overlay="close">
      <div class="dialog-card bg-surface rounded-lg p-6 w-[28rem] max-w-[calc(100vw-2rem)] border border-border shadow-lg">
        <div class="flex items-center justify-between mb-5 flex-shrink-0">
          <h3 class="text-lg font-bold text-text">{{ isEdit ? '编辑模型' : '添加模型' }}</h3>
          <button @click="close" class="dlg-close" title="关闭">✕</button>
        </div>

        <div class="space-y-4">
          <div class="flex items-center gap-4">
            <label class="text-sm font-medium text-text w-20 flex-shrink-0">服务商</label>
            <AppSelect v-model="form.provider" @change="onProviderChange" :options="providerOptions" class="flex-1" />
            <a
              v-if="form.provider !== 'custom'"
              :href="providerDocs[form.provider]"
              target="_blank"
              rel="noopener"
              class="text-xs text-info hover:underline flex-shrink-0 whitespace-nowrap"
              @click="openDocs($event)"
            >获取 API Key</a>
          </div>
          <div class="flex items-center gap-4">
            <label class="text-sm font-medium text-text w-20 flex-shrink-0">模型名称</label>
            <input v-model="form.name" placeholder="用于识别，如「主模型」" class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded" />
          </div>
          <div class="flex items-center gap-4">
            <label class="text-sm font-medium text-text w-20 flex-shrink-0">模型名</label>
            <template v-if="mode === 'input'">
              <input v-model="form.model" placeholder="如 deepseek-v4-flash" class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded" />
              <button
                @click="discover"
                :disabled="discovering"
                class="flex-shrink-0 border border-border text-text px-3 py-2 rounded hover:bg-surface-hover disabled:opacity-40 text-sm cursor-pointer transition-theme"
              >{{ discovering ? '识别中…' : '识别' }}</button>
            </template>
            <template v-else>
              <AppSelect v-model="form.model" :options="selectOptions" class="flex-1" />
              <button
                @click="mode = 'input'"
                class="flex-shrink-0 text-xs text-info hover:underline cursor-pointer"
              >手填</button>
            </template>
          </div>
          <p v-if="discoverError" class="text-xs text-danger">{{ discoverError }}</p>
          <div class="flex items-center gap-4">
            <label class="text-sm font-medium text-text w-20 flex-shrink-0">Base URL</label>
            <input v-model="form.base_url" placeholder="默认已自动填充" class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded" />
          </div>
          <div class="flex items-center gap-4">
            <label class="text-sm font-medium text-text w-20 flex-shrink-0">API Key</label>
            <input v-model="form.api_key" type="password" :placeholder="isEdit ? '留空表示不修改密钥' : '同一服务商已配置过可留空自动复用'" class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded" autocomplete="off" />
          </div>

          <p v-if="error" class="text-xs text-danger">{{ error }}</p>
          <p class="text-xs text-text-muted">{{ isEdit ? '点击「确定」将自动检测模型连通性，通过后才保存；API Key 留空表示保持不变。' : '点击「确定」将自动检测模型连通性，通过后才保存；密钥仅存本机数据库，同一服务商可留空复用已有密钥。' }}</p>

          <div class="flex items-center justify-end gap-3 pt-1">
            <button @click="close" class="border border-border text-text px-4 py-2 rounded hover:bg-surface-hover cursor-pointer transition-theme">取消</button>
            <button
              @click="submit"
              :disabled="testing"
              class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded transition-theme disabled:opacity-40 cursor-pointer"
            >{{ testing ? '测试连接中…' : '确定' }}</button>
          </div>
        </div>
      </div>
  </DialogShell>
</template>

<script>
import axios from 'axios'
import AppSelect from '../base/AppSelect.vue'
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'
import { INVOKE } from '../../electronChannels.js'

export default {
  name: 'AddModelDialog',
  components: { AppSelect, DialogShell },
  props: {
    show: { type: Boolean, default: false },
    // 传入已有模型对象即为「编辑」模式：标题改为「编辑模型」并回填数据，保存时走更新接口
    editModel: { type: Object, default: null },
  },
  emits: ['close', 'saved'],
  data() {
    return {
      testing: false,
      error: '',
      // 模型识别：mode=input 手填；mode=select 用识别出的下拉选择
      mode: 'input',
      discovering: false,
      discoverError: '',
      discovered: [],
      form: {
        name: '',
        provider: 'deepseek',
        base_url: '',
        model: '',
        api_key: '',
      },
      providerPresets: {
        deepseek: { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
        openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        moonshot: { base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
        qwen: { base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
        glm: { base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
        custom: { base_url: '', model: '' },
      },
      providerDocs: {
        deepseek: 'https://platform.deepseek.com/',
        openai: 'https://platform.openai.com/',
        moonshot: 'https://platform.moonshot.cn/',
        qwen: 'https://dashscope.console.aliyun.com/',
        glm: 'https://open.bigmodel.cn/',
        custom: '',
      },
    }
  },
  computed: {
    // 是否编辑模式（有传入已有模型对象且带 id）
    isEdit() {
      return !!(this.editModel && this.editModel.id)
    },
    providerOptions() {
      return [
        { value: 'deepseek', label: 'DeepSeek（推荐）' },
        { value: 'moonshot', label: 'Kimi（月之暗面）' },
        { value: 'qwen', label: '通义千问' },
        { value: 'glm', label: '智谱清言' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'custom', label: '自定义（OpenAI 兼容）' },
      ]
    },
    selectOptions() {
      return this.discovered.map((mId) => ({ value: mId, label: mId }))
    },
  },
  watch: {
    show(val) {
      // 每次打开时重置表单：编辑模式回填已有数据，否则回到默认值
      if (val) {
        this.error = ''
        this.mode = 'input'
        this.discovered = []
        this.discoverError = ''
        if (this.isEdit) {
          const m = this.editModel
          this.form = {
            name: m.name || '',
            provider: m.provider || 'deepseek',
            base_url: m.base_url || '',
            model: m.model || '',
            api_key: '', // 留空表示不修改密钥
          }
        } else {
          this.form = { name: '', provider: 'deepseek', base_url: this.providerPresets.deepseek.base_url, model: this.providerPresets.deepseek.model, api_key: '' }
        }
      }
    },
  },
  methods: {
    close() {
      this.$emit('close')
    },
    onProviderChange() {
      const preset = this.providerPresets[this.form.provider] || { base_url: '', model: '' }
      this.form.base_url = preset.base_url
      this.form.model = preset.model
      this.mode = 'input'
      this.discovered = []
      this.discoverError = ''
    },
    // 「获取 API Key」：在系统默认浏览器打开服务商页面，不要用 Electron 内置窗口。
    // Electron 内阻止默认跳转、改走主进程 open-external；非 Electron 环境保留 href 默认行为。
    openDocs(event) {
      const url = this.providerDocs[this.form.provider]
      if (!url) return
      if (window.electron && window.electron.invoke) {
        event.preventDefault()
        window.electron.invoke(INVOKE.OPEN_EXTERNAL, url)
      }
    },
    // 点击「识别」：调用服务商 /models 接口获取可用模型，切换为下拉选择
    async discover() {
      this.discoverError = ''
      this.discovering = true
      try {
        const res = await axios.post('/api/ai/models/discover', {
          provider: this.form.provider,
          base_url: this.form.base_url,
          api_key: this.form.api_key,
        })
        if (res.data && res.data.success) {
          // models 可能是空数组：直接取 [0] 会得到 undefined，切到 select 模式后
          // 点保存时 form.model.trim() 就抛 TypeError。空列表应退回手动填写。
          const models = Array.isArray(res.data.models) ? res.data.models.filter(Boolean) : []
          if (models.length === 0) {
            this.mode = 'input'
            this.discoverError = '未识别到可用模型，请手动填写模型名'
            return
          }
          this.discovered = models
          this.form.model = models[0]
          this.mode = 'select'
        } else {
          this.mode = 'input'
          this.discoverError = (res.data && res.data.error) || '识别失败'
        }
      } catch (err) {
        this.mode = 'input'
        this.discoverError = (err.response && err.response.data && err.response.data.error) || '识别失败，请检查 Key'
      } finally {
        this.discovering = false
      }
    },
    async submit() {
      this.error = ''
      // 模型名可能来自「识别」返回的空列表（undefined）：先兜成字符串再 trim
      if (!String(this.form.model || '').trim()) { this.error = '请填写模型名'; return }
      this.testing = true
      try {
        const res = this.isEdit
          ? await axios.put(`/api/ai/models/${this.editModel.id}`, this.form)
          : await axios.post('/api/ai/models', this.form)
        if (res.data && res.data.success) {
          this.close()
          this.$emit('saved')
        } else {
          this.error = (res.data && res.data.error) || '连接失败，未保存'
        }
      } catch (err) {
        this.error = (err.response && err.response.data && err.response.data.error) || '连接失败，未保存'
      } finally {
        this.testing = false
      }
    },
  },
}
</script>