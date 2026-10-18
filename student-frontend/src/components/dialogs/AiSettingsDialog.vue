<template>
  <Teleport to="body">
  <Transition name="dialog">
    <div v-if="show" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10005]" @click.self="close">
      <div class="dialog-card bg-surface rounded-lg p-6 min-w-[32rem] w-auto min-h-[32rem] max-w-[calc(100vw-2rem)] border border-border shadow-lg flex flex-col" style="max-height: 90vh; overflow: visible;">
        <div class="flex items-center justify-between mb-5 flex-shrink-0">
          <h3 class="text-lg font-extrabold text-text tracking-wide">🧠 AI 助手设置</h3>
          <button @click="close" class="dlg-close" title="关闭">✕</button>
        </div>

        <div class="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          <!-- 启用开关 -->
          <div class="flex items-center justify-between mb-6">
            <span class="text-sm font-medium text-text">启用 AI</span>
            <label class="inline-flex items-center cursor-pointer">
              <input type="checkbox" :checked="enabled" @change="toggleEnabled" class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer" />
              <span class="ml-2 text-sm" :class="enabled ? 'text-text' : 'text-text-muted'">{{ enabled ? '已启用' : '已禁用' }}</span>
            </label>
          </div>

          <!-- 密钥管理 -->
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-bold text-text">密钥管理</span>
            <div class="flex items-center gap-3">
              <span class="text-xs text-text-muted" title="当前使用模型">当前：<span class="text-primary font-medium">{{ currentModelName }}</span></span>
              <button
                @click="openAdd"
                class="bg-primary hover:bg-primary-hover text-text-inverse text-sm px-3 py-1.5 rounded transition-theme cursor-pointer"
              >添加模型</button>
            </div>
          </div>

          <!-- 密钥卡片列表 -->
          <div v-if="!models.length" class="border border-border rounded-lg p-4 text-center text-sm text-text-muted">暂无密钥，点击右上角「添加模型」</div>
          <div v-else class="space-y-3">
            <div
              v-for="m in models"
              :key="m.id"
              @click="selectModel(m.id)"
              class="flex items-center justify-between gap-4 border border-border rounded-lg px-4 py-3 transition-theme cursor-pointer"
              :class="m.is_active ? 'bg-primary/10 border-primary' : 'bg-surface'"
            >
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-text truncate">{{ m.name || m.model }}</span>
                  <span v-if="m.is_active" class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-text-inverse flex-shrink-0">当前</span>
                </div>
                <div class="text-xs text-text-muted flex items-center gap-2">
                  <span class="flex-shrink-0">{{ providerName(m.provider) }}</span>
                  <span class="text-text-muted/50 flex-shrink-0">·</span>
                  <span @click.stop class="inline-flex items-center flex-shrink-0">
                    <AppSelect
                      v-model="m.model"
                      :options="modelOptions[m.id]"
                      @change="onCardModelChange(m.id)"
                      class="!w-44 !text-xs"
                      title="切换模型（自动验证连通）"
                      :disabled="!modelOptions[m.id] || !modelOptions[m.id].length"
                    />
                  </span>
                </div>
              </div>
              <div class="flex items-center gap-4 flex-shrink-0" @click.stop>
                <label class="inline-flex items-center gap-1.5 cursor-pointer" title="推理（思考模式）：DeepSeek / 智谱 / 通义 支持">
                  <input
                    type="checkbox"
                    :checked="m.reasoning"
                    @change="toggleReasoning(m, $event)"
                    class="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  />
                  <span class="text-xs" :class="m.reasoning ? 'text-text' : 'text-text-muted'">推理</span>
                </label>
                <button @click="openEdit(m)" class="text-primary hover:underline text-sm cursor-pointer">编辑</button>
                <button @click="removeModel(m)" class="text-danger hover:underline text-sm cursor-pointer">删除</button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </Transition>
  </Teleport>

  <!-- 添加 / 编辑模型二次弹窗（同一实例复用：传 edit-model 即切换为编辑态） -->
  <AddModelDialog :show="modelDialog || editDialog" :edit-model="editTarget" @close="closeModelDialog" @saved="onModelSaved" />

  <!-- 删除确认弹窗 -->
  <ConfirmDialog
    :visible="confirmShow"
    :message="confirmMessage"
    :show-cancel="true"
    @confirm="onRemoveConfirm"
    @cancel="confirmShow = false"
  />
</template>

<script>
import axios from 'axios'
import AppSelect from '../base/AppSelect.vue'
import AddModelDialog from './AddModelDialog.vue'
import ConfirmDialog from '../base/ConfirmDialog.vue'
import '../../styles/dialog-transition.css'

export default {
  name: 'AiSettingsDialog',
  components: { AppSelect, AddModelDialog, ConfirmDialog },
  props: {
    show: { type: Boolean, default: false },
  },
  emits: ['close', 'saved'],
  data() {
    return {
      enabled: false,
      models: [],
      modelDialog: false, // 是否打开「添加模型」二次弹窗
      editDialog: false,  // 是否打开「编辑模型」二次弹窗
      editTarget: null,   // 正在编辑的模型对象
      modelChoices: {},  // id -> 该服务商可用模型名列表（供卡片下拉切换）
      providerChoices: {}, // provider -> 可用模型名列表（按服务商共享，避免每张卡片单独请求）
      // 删除确认弹窗
      confirmShow: false,
      confirmTitle: '',
      confirmMessage: '',
      removeTarget: null,
      providerLabels: {
        deepseek: 'DeepSeek',
        openai: 'OpenAI',
        moonshot: 'Kimi（月之暗面）',
        qwen: '通义千问',
        glm: '智谱清言',
        custom: '自定义',
      },
    }
  },
  computed: {
    // 「添加模型」按钮旁的识别标签：当前选中的模型名
    currentModelName() {
      const a = this.models.find((m) => m.is_active)
      return a ? a.name || a.model : '未选择模型'
    },
    // 预计算每张卡片的下拉选项，避免模板中调用方法导致的响应式追踪问题
    modelOptions() {
      const result = {}
      this.models.forEach((m) => {
        const arr = this.modelChoices[m.id]
        result[m.id] = arr && arr.length ? arr.map((mId) => ({ value: mId, label: mId })) : []
      })
      return result
    },
  },
  watch: {
    show(val) {
      if (val) this.load()
    },
  },
  methods: {
    close() {
      this.$emit('close')
    },
    providerName(p) {
      return this.providerLabels[p] || p || '未知'
    },
    async load() {
      try {
        const cfg = await axios.get('/api/ai/config')
        this.enabled = cfg.data.success && cfg.data.data.enabled
        const list = await axios.get('/api/ai/models')
        this.models = list.data.success ? list.data.data : []
        // 先拉取所有服务商可用模型列表，再一次性更新 modelChoices（避免中间态闪烁）
        const providers = [...new Set(this.models.map((m) => m.provider))]
        const newChoices = {}
        await Promise.all(providers.map(async (p) => {
          try {
            const res = await axios.post('/api/ai/models/discover', { provider: p })
            newChoices[p] = res.data.success ? res.data.models : []
          } catch (err) {
            console.error('加载模型列表失败:', p, err)
            newChoices[p] = []
          }
        }))
        this.providerChoices = newChoices
        // 将服务商结果映射到各卡片（保留旧 choices 直到新数据就位）
        const next = {}
        this.models.forEach((m) => {
          if (newChoices[m.provider] && newChoices[m.provider].length) {
            next[m.id] = newChoices[m.provider]
          }
        })
        this.modelChoices = next
        console.log('[load] modelChoices:', JSON.stringify(next), 'providerChoices:', JSON.stringify(newChoices))
      } catch (err) {
        console.error('加载 AI 配置失败:', err)
      }
    },
    // 卡片下拉的可选模型（options 供 AppSelect）
    cardChoices(id) {
      const arr = this.modelChoices[id]
      console.log(`[cardChoices] id=${id}`, JSON.stringify(arr))
      if (!arr || !arr.length) return []
      return arr.map((mId) => ({ value: mId, label: mId }))
    },
    // 卡片下拉切换模型：先由后端验证连通，通过才保存
    async onCardModelChange(id) {
      const item = this.models.find((x) => x.id === id)
      if (!item || !item.model) return
      try {
        await axios.put(`/api/ai/models/${id}`, { model: item.model })
      } catch (err) {
        alert((err.response && err.response.data && err.response.data.error) || '切换失败')
      }
      await this.load()
      this.$emit('saved')
    },
    async toggleEnabled(e) {
      this.enabled = e.target.checked
      try {
        await axios.put('/api/ai/config', { enabled: this.enabled })
        this.$emit('saved')
      } catch (err) {
        console.error('切换失败:', err)
      }
    },
    // 切换该模型的推理开关（即时保存，无需确定按钮）
    async toggleReasoning(m, e) {
      const on = e.target.checked
      try {
        await axios.put(`/api/ai/models/${m.id}/reasoning`, { reasoning: on })
        m.reasoning = on
        this.$emit('saved')
      } catch (err) {
        e.target.checked = !on
        alert((err.response && err.response.data && err.response.data.error) || '切换失败')
      }
    },
    // 添加模型成功后的回调：刷新列表
    async onModelSaved() {
      await this.load()
      this.$emit('saved')
    },
    async selectModel(id) {
      try {
        await axios.put(`/api/ai/models/${id}/active`)
        await this.load()
        this.$emit('saved')
      } catch (err) {
        console.error('选中失败:', err)
      }
    },
    // 打开「添加模型」弹窗（清空编辑态目标）
    openAdd() {
      this.editTarget = null
      this.editDialog = false
      this.modelDialog = true
    },
    // 打开「编辑模型」弹窗，回填该条数据
    openEdit(m) {
      this.modelDialog = false
      this.editTarget = m
      this.editDialog = true
    },
    // 关闭添加/编辑弹窗（不清 editTarget，避免关闭动画期间标题从「编辑模型」闪回「添加模型」；
    // 下次打开时由 openAdd/openEdit 重新设置）
    closeModelDialog() {
      this.modelDialog = false
      this.editDialog = false
    },
    removeModel(m) {
      this.removeTarget = m
      this.confirmTitle = '删除密钥'
      this.confirmMessage = `确定删除密钥「${m.name || m.model}」？`
      this.confirmShow = true
    },
    async onRemoveConfirm() {
      const m = this.removeTarget
      if (!m) return
      this.confirmShow = false
      try {
        await axios.delete(`/api/ai/models/${m.id}`)
        await this.load()
        this.$emit('saved')
      } catch (err) {
        console.error('删除失败:', err)
      }
      this.removeTarget = null
    },
  },
}
</script>