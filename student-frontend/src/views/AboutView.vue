<template>
  <div>
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="about" /> 关于软件</h1>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- 应用信息 -->
      <div class="bg-surface shadow-md rounded-xl border border-border p-6 md:col-span-2">
        <div class="flex items-center gap-4 mb-4">
          <div class="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden">
            <img src="/logo.webp" alt="logo" class="w-full h-full object-contain" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xl font-bold text-text">班集</span>
              <span class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold text-white bg-blue-500 leading-none">预览版</span>
            </div>
            <div class="text-sm text-text-muted">班级管理一站式桌面应用</div>
          </div>
        </div>
        <p class="text-text-secondary text-sm leading-relaxed">
          班集是一个面向班级日常管理的轻量化桌面应用，整合了班级管理、班费、课程表、座位安排、
          请假考勤、班级相册等常用功能，帮助班主任与班委高效完成日常事务。
        </p>

        <div class="flex flex-wrap items-center gap-3 mt-4">
          <button @click="dialogProtocol = true" class="px-4 py-2 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            非商用免费协议
          </button>
          <button @click="dialogVersion = true" class="px-4 py-2 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            版本更新
          </button>
          <button @click="dialogDonate = true" class="px-4 py-2 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            打赏
          </button>
        </div>
      </div>

      <!-- 功能特性 -->
      <div class="bg-surface shadow-md rounded-xl border border-border p-6">
        <h2 class="font-semibold text-text mb-4">功能特性</h2>
        <ul class="space-y-3 text-sm text-text-secondary">
          <li class="flex items-center gap-2">
            <span class="text-emerald-500"><IconGlyph name="check" :size="16" /></span> 简洁的界面和操作
          </li>
          <li class="flex items-center gap-2">
            <span class="text-emerald-500"><IconGlyph name="check" :size="16" /></span> 班级管理的定制化功能
          </li>
          <li class="flex items-center gap-2">
            <span class="text-emerald-500"><IconGlyph name="check" :size="16" /></span> 智能排表算法
          </li>
          <li class="flex items-center gap-2">
            <span class="text-emerald-500"><IconGlyph name="check" :size="16" /></span> 优美简洁的主题
          </li>
          <li class="flex items-center gap-2">
            <span class="text-emerald-500"><IconGlyph name="check" :size="16" /></span> 分布计算性能优化
          </li>
        </ul>
      </div>
    </div>

    <!-- 技术栈（毛玻璃卡片） -->
    <div class="mt-6 bg-surface shadow-md rounded-xl border border-border p-6">
      <h2 class="font-semibold text-text mb-4 flex items-center gap-2"><IconGlyph name="wrench" :size="20" /> 使用的开源项目</h2>
      <p class="text-xs text-text-muted mb-3 px-1 leading-relaxed">感谢所有开源提供者，本项目基于众多优秀开源项目构建，第三方组件遵循各自开源许可证。</p>
      <div class="max-h-64 overflow-y-auto pr-1 scroll-smooth">
        <div v-for="group in libGroups" :key="group.category" class="mb-3 last:mb-0">
          <div class="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5 px-1">{{ group.category }}</div>
          <div class="space-y-0.5">
            <a v-for="lib in group.items" :key="lib.name" :href="lib.url" target="_blank" rel="noopener"
              @click="openExternal($event, lib.url)"
              class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors no-underline group text-sm">
              <span class="text-text-secondary shrink-0 min-w-[5.5rem]">{{ lib.desc }}</span>
              <span class="text-text font-medium">{{ lib.name }}</span>
              <span class="text-[11px] text-text-muted/50 shrink-0">{{ lib.url.replace('https://', '') }}</span>
              <span class="text-xs font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-text-muted shrink-0 ml-auto">{{ lib.license }}</span>
            </a>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-6 bg-surface shadow-md rounded-xl border border-border p-6 text-center text-sm text-text-muted space-y-1.5">
      <div>本软件遵循 <a href="https://polyformproject.org/licenses/noncommercial/1.0.0" target="_blank" rel="noopener" @click="openExternal($event, 'https://polyformproject.org/licenses/noncommercial/1.0.0')" class="text-primary hover:underline">PolyForm Noncommercial License 1.0.0</a> 发布</div>
      <div class="text-text-muted/70">仅非商业使用，商业使用需本人授权</div>
      <div>
        Copyright &copy; 无聊的小洋葱 2026 &nbsp;|&nbsp;
        <a href="https://github.com/onion383/classmanagement" target="_blank" rel="noopener" @click="openExternal($event, 'https://github.com/onion383/classmanagement')" class="text-primary hover:underline">仓库地址</a>
      </div>
      <div class="text-text-muted/50">https://github.com/onion383/classmanagement</div>
    </div>

    <!-- 协议弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="dialogProtocol" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" @click.self="dialogProtocol = false">
          <div class="dialog-card bg-surface rounded-xl shadow-2xl border border-border w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" @click.stop>
          <div class="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
            <h2 class="text-lg font-semibold text-text">PolyForm Noncommercial License 1.0.0</h2>
            <button @click="dialogProtocol = false" class="dlg-close">&times;</button>
          </div>
          <div class="overflow-y-auto px-6 py-4 text-sm text-text-secondary leading-relaxed whitespace-pre-line flex-1">{{ licenseText }}</div>
          <div class="px-6 py-4 border-t border-border shrink-0 flex justify-end">
            <button @click="dialogProtocol = false" class="px-4 py-2 rounded-lg bg-primary text-text-inverse text-sm">关闭</button>
          </div>
        </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 版本更新弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="dialogVersion" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" @click.self="dialogVersion = false">
          <div class="dialog-card bg-surface rounded-xl shadow-2xl border border-border w-full max-w-md mx-4 relative flex flex-col max-h-[85vh]" @click.stop>
          <button @click="dialogVersion = false" class="dlg-close absolute! top-3 right-3">&times;</button>

          <!-- 上半部分：居中信息 -->
          <div class="px-6 pt-8 pb-4 text-center shrink-0">
            <img src="/logo.webp" alt="logo" class="w-16 h-16 mx-auto object-contain" />
            <div class="mt-4 flex items-center justify-center gap-2">
              <span class="text-base font-semibold text-text">v{{ currentVersion || '0.8.0' }}</span>
              <span class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold text-white bg-blue-500 leading-none">预览版</span>
              <button @click="checkUpdate" :disabled="updateBusy" class="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">检查更新</button>
            </div>
            <div class="mt-3 text-xs text-text-muted">仅非商业使用，商业使用需本人授权</div>
            <div class="mt-1 text-xs text-text-muted">Copyright &copy; 无聊的小洋葱 2026</div>

            <!-- 更新状态与下载进度 -->
            <div class="mt-3 text-xs font-medium" :class="statusClass">{{ statusText }}</div>
            <div v-if="updateStatus === 'downloading'" class="mt-2">
              <div class="h-1.5 rounded-full bg-bg border border-border overflow-hidden">
                <div class="h-full rounded-full bg-primary transition-[width] duration-300" :style="{ width: updatePercent + '%' }"></div>
              </div>
            </div>
            <button v-if="updateStatus === 'downloaded'" @click="installUpdate" class="mt-3 px-4 py-2 rounded-lg bg-primary text-text-inverse text-sm">重启并安装</button>
          </div>

          <!-- 下半部分：更新历史（可滚动文本框） -->
          <div class="px-6 pb-6 flex-1 min-h-0 flex flex-col">
            <div class="text-sm font-semibold text-text mb-2">更新历史</div>
            <div class="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-bg p-3 space-y-3 text-sm">
              <div v-for="c in changelog" :key="c.version">
                <div class="flex items-baseline gap-2">
                  <span class="text-text font-medium">v{{ c.version }}</span>
                  <span class="text-xs text-text-muted">{{ c.date }}</span>
                </div>
                <ul class="mt-1 pl-5 list-disc space-y-0.5 text-text-secondary">
                  <li v-for="(n, i) in c.notes" :key="i">{{ n }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 打赏弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="dialogDonate" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" @click.self="dialogDonate = false">
          <div class="dialog-card bg-surface rounded-xl shadow-2xl border border-border w-full max-w-md mx-4" @click.stop>
          <div class="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 class="text-lg font-semibold text-text">打赏</h2>
            <button @click="dialogDonate = false" class="dlg-close">&times;</button>
          </div>
          <div class="px-6 py-4 text-sm text-text-secondary text-center">
            <p class="mb-4">本软件个人免费使用，如果你觉得好的话欢迎打赏我们</p>
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <div class="text-text font-medium">微信</div>
                <img src="/wechatpay.webp" alt="微信收款码" class="w-full h-auto rounded-lg border border-border" />
              </div>
              <div class="space-y-2">
                <div class="text-text font-medium">支付宝</div>
                <img src="/alipay.webp" alt="支付宝收款码" class="w-full h-auto rounded-lg border border-border" />
              </div>
            </div>
          </div>
          <div class="px-6 py-4 border-t border-border flex justify-end">
            <button @click="dialogDonate = false" class="px-4 py-2 rounded-lg bg-primary text-text-inverse text-sm">确定</button>
          </div>
        </div>
      </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { SEND, INVOKE, RECEIVE } from '../electronChannels.js'
import '../styles/dialog-transition.css'

// Electron 内用系统浏览器打开外链，非 Electron 环境让浏览器默认行为处理
function openExternal(event, url) {
  if (window.electron && window.electron.invoke) {
    event.preventDefault()
    window.electron.invoke(INVOKE.OPEN_EXTERNAL, url)
  }
  // 非 Electron：不阻止默认行为，让 href 直接在新标签页打开
}

// 弹窗状态
const dialogProtocol = ref(false)
const dialogVersion = ref(false)
const dialogDonate = ref(false)

// ---- 版本更新 ----
// 状态由主进程作为唯一权威来源，通过 from-main{type:'update-state'} 广播；
// 这里只做展示：打开弹窗时主动查一次，并订阅后续变化（下载进度等）。
const currentVersion = ref('')
const latestVersion = ref('')
const updateStatus = ref('idle') // idle | checking | available | downloading | downloaded | not-available | error
const updatePercent = ref(0)
const updateError = ref('')
let updateListener = null

const statusText = computed(() => {
  switch (updateStatus.value) {
    case 'checking': return '正在检查…'
    case 'available': return latestVersion.value ? `发现新版本 v${latestVersion.value}，正在下载…` : '发现新版本，正在下载…'
    case 'downloading': return `正在下载 ${updatePercent.value}%`
    case 'downloaded': return '新版本已下载，重启即可安装'
    case 'not-available': return '已经是最新版本'
    case 'error': return updateError.value ? `更新失败：${updateError.value}` : '更新失败'
    default: return '等待检查'
  }
})
const statusClass = computed(() => {
  if (updateStatus.value === 'downloaded' || updateStatus.value === 'not-available') return 'text-emerald-500'
  if (updateStatus.value === 'error') return 'text-red-500'
  return 'text-primary'
})
// 检查/下载进行中：禁用「检查更新」按钮，避免重复触发
const updateBusy = computed(() => ['checking', 'available', 'downloading'].includes(updateStatus.value))

// 更新历史（手动维护，发版时在最上方追加一条）
const changelog = [
  {
    version: '0.8.0',
    date: '2026-10-10',
    notes: [
      '预览版',
      '班级管理、班费、课程表、座位安排、请假考勤、班级相册等功能',
      '桌面工具箱浮窗：计时器、点名器、截图、注释',
    ],
  },
]

function applyUpdateState(s) {
  if (!s) return
  updateStatus.value = s.status || 'idle'
  if (s.currentVersion) currentVersion.value = s.currentVersion
  if (s.latestVersion) latestVersion.value = s.latestVersion
  updatePercent.value = typeof s.percent === 'number' ? s.percent : 0
  updateError.value = s.error || ''
}

async function fetchAppVersion() {
  try {
    const v = await window.electron?.invoke(INVOKE.GET_APP_VERSION)
    if (v) currentVersion.value = v
  } catch (_) { /* 非 Electron 环境忽略 */ }
}

async function checkUpdate() {
  try {
    const s = await window.electron?.invoke(INVOKE.UPDATE_CHECK)
    applyUpdateState(s)
  } catch (e) {
    // 原来静默吞掉：用户点了「检查更新」后界面毫无变化，分不清「已是最新」还是「检查失败」。
    // updateError 会在弹窗里展示（与主进程推送的 update-state.error 同一处）。
    updateError.value = '检查更新失败，请检查网络后重试'
    console.error(e)
  }
}

function installUpdate() {
  window.electron?.send(SEND.UPDATE_INSTALL)
}

onMounted(() => {
  fetchAppVersion()
  updateListener = window.electron?.on(RECEIVE.FROM_MAIN, (data) => {
    if (data && data.type === 'update-state') applyUpdateState(data.state)
  })
})

onUnmounted(() => {
  if (updateListener) window.electron?.off(RECEIVE.FROM_MAIN, updateListener)
})

// 打开弹窗时刷新一次版本号并触发检查
watch(dialogVersion, (open) => {
  if (open) {
    fetchAppVersion()
    checkUpdate()
  }
})

// 协议全文
const licenseText = `# PolyForm Noncommercial License 1.0.0

https://polyformproject.org/licenses/noncommercial/1.0.0

## Acceptance

In order to get any license under these terms, you must agree to them as both strict obligations and conditions to all your licenses.

## Copyright License

The licensor grants you a copyright license for the software to do everything you might do with the software that would otherwise infringe the licensor's copyright in it for any permitted purpose. However, you may only distribute the software according to Distribution License and make changes or new works based on the software according to Changes and New Works License.

## Distribution License

The licensor grants you an additional copyright license to distribute copies of the software. Your license to distribute covers distributing the software with changes and new works permitted by Changes and New Works License.

## Notices

You must ensure that anyone who gets a copy of any part of the software from you also gets a copy of these terms or the URL for them above, as well as copies of any plain-text lines beginning with \`Required Notice:\` that the licensor provided with the software. For example:

Required Notice: Copyright Yoyodyne, Inc. (http://example.com)

## Changes and New Works License

The licensor grants you an additional copyright license to make changes and new works based on the software for any permitted purpose.

## Patent License

The licensor grants you a patent license for the software that covers patent claims the licensor can license, or becomes able to license, that you would infringe by using the software.

## Noncommercial Purposes

Any noncommercial purpose is a permitted purpose.

## Personal Uses

Personal use for research, experiment, and testing for the benefit of public knowledge, personal study, private entertainment, hobby projects, amateur pursuits, or religious observance, without any anticipated commercial application, is use for a permitted purpose.

## Noncommercial Organizations

Use by any charitable organization, educational institution, public research organization, public safety or health organization, environmental protection organization, or government institution is use for a permitted purpose regardless of the source of funding or obligations resulting from the funding.

## Fair Use

You may have "fair use" rights for the software under the law. These terms do not limit them.

## No Other Rights

These terms do not allow you to sublicense or transfer any of your licenses to anyone else, or prevent the licensor from granting licenses to anyone else. These terms do not imply any other licenses.

## Patent Defense

If you make any written claim that the software infringes or contributes to infringement of any patent, your patent license for the software granted under these terms ends immediately. If your company makes such a claim, your patent license ends immediately for work on behalf of your company.

## Violations

The first time you are notified in writing that you have violated any of these terms, or done anything with the software not covered by your licenses, your licenses can nonetheless continue if you come into full compliance with these terms, and take practical steps to correct past violations, within 32 days of receiving notice. Otherwise, all your licenses end immediately.

## No Liability

As far as the law allows, the software comes as is, without any warranty or condition, and the licensor will not be liable to you for any damages arising out of these terms or the use or nature of the software, under any kind of legal claim.

## Definitions

The licensor is the individual or entity offering these terms, and the software is the software the licensor makes available under these terms.

You refers to the individual or entity agreeing to these terms.

Your company is any legal entity, sole proprietorship, or other kind of organization that you work for, plus all organizations that have control over, are under the control of, or are under common control with that organization. Control means ownership of substantially all the assets of an entity, or the power to direct its management and policies by vote, contract, or otherwise. Control can be direct or indirect.

Your licenses are all the licenses granted to you for the software under these terms.

Use means anything you do with the software requiring one of your licenses.`

const libGroups = [
  {
    category: '桌面壳',
    items: [
      { desc: '桌面框架', name: 'Electron', url: 'https://github.com/electron/electron', license: 'MIT' },
      { desc: '应用打包', name: 'electron-builder', url: 'https://github.com/electron-userland/electron-builder', license: 'MIT' },
      { desc: '原生 FFI', name: 'koffi', url: 'https://github.com/Koromix/koffi', license: 'MIT' },
    ],
  },
  {
    category: '前端',
    items: [
      { desc: '前端框架', name: 'Vue 3', url: 'https://github.com/vuejs/core', license: 'MIT' },
      { desc: '前端路由', name: 'Vue Router', url: 'https://github.com/vuejs/router', license: 'MIT' },
      { desc: '状态管理', name: 'Pinia', url: 'https://github.com/vuejs/pinia', license: 'MIT' },
      { desc: '构建工具', name: 'Vite', url: 'https://github.com/vitejs/vite', license: 'MIT' },
      { desc: 'CSS 框架', name: 'Tailwind CSS', url: 'https://github.com/tailwindlabs/tailwindcss', license: 'MIT' },
      { desc: 'HTTP 请求', name: 'Axios', url: 'https://github.com/axios/axios', license: 'MIT' },
      { desc: '图标库', name: '@lucide/vue', url: 'https://github.com/lucide-icons/lucide', license: 'ISC' },
      { desc: 'XSS 过滤', name: 'DOMPurify', url: 'https://github.com/cure53/DOMPurify', license: 'MPL-2.0 OR Apache-2.0' },
      { desc: 'Markdown 解析', name: 'marked', url: 'https://github.com/markedjs/marked', license: 'MIT / BSD-3-Clause' },
      { desc: 'DevTools 接口', name: '@vue/devtools-api', url: 'https://github.com/vuejs/devtools', license: 'MIT' },
      { desc: 'Vue 编译插件', name: '@vitejs/plugin-vue', url: 'https://github.com/vitejs/vite-plugin-vue', license: 'MIT' },
      { desc: 'Tailwind 插件', name: '@tailwindcss/vite', url: 'https://github.com/tailwindlabs/tailwindcss', license: 'MIT' },
    ],
  },
  {
    category: '后端',
    items: [
      { desc: '后端框架', name: 'Express', url: 'https://github.com/expressjs/express', license: 'MIT' },
      { desc: '加密数据库', name: 'better-sqlite3-multiple-ciphers', url: 'https://github.com/m4heshd/better-sqlite3-multiple-ciphers', license: 'MIT' },
      { desc: '图片处理', name: 'Sharp', url: 'https://github.com/lovell/sharp', license: 'Apache-2.0' },
      { desc: '跨域支持', name: 'cors', url: 'https://github.com/expressjs/cors', license: 'MIT' },
      { desc: '文件上传', name: 'Multer', url: 'https://github.com/expressjs/multer', license: 'MIT' },
      { desc: '视频抽帧', name: 'FFmpeg（LGPL 构建）', url: 'https://ffmpeg.org', license: 'LGPL-2.1-or-later' },
      { desc: '压缩包解压', name: 'extract-zip', url: 'https://github.com/maxogden/extract-zip', license: 'BSD-2-Clause' },
      { desc: 'Word 转换', name: 'Mammoth', url: 'https://github.com/mwilliamson/mammoth.js', license: 'BSD-2-Clause' },
      { desc: 'PDF 解析', name: 'pdf-parse', url: 'https://github.com/mehmet-kozan/pdf-parse', license: 'Apache-2.0' },
      { desc: '回收站删除', name: 'trash', url: 'https://github.com/sindresorhus/trash', license: 'MIT' },
    ],
  },
  {
    category: '安全支持',
    items: [
      { desc: 'JWT 鉴权', name: 'jsonwebtoken', url: 'https://github.com/auth0/node-jsonwebtoken', license: 'MIT' },
      { desc: '密码加密', name: 'bcryptjs', url: 'https://github.com/dcodeIO/bcrypt.js', license: 'BSD-3-Clause' },
    ],
  },
  {
    category: '数据处理',
    items: [
      { desc: '表格导出', name: 'ExcelJS', url: 'https://github.com/exceljs/exceljs', license: 'MIT' },
      { desc: '电子表格', name: 'SheetJS (xlsx)', url: 'https://git.sheetjs.com/SheetJS/sheetjs', license: 'Apache-2.0' },
      { desc: 'PDF 生成', name: 'jsPDF', url: 'https://github.com/parallax/jsPDF', license: 'MIT' },
      { desc: 'PDF 表格', name: 'jsPDF-AutoTable', url: 'https://github.com/simonbengtsson/jsPDF-AutoTable', license: 'MIT' },
      { desc: '截图渲染', name: 'html2canvas', url: 'https://github.com/niklasvh/html2canvas', license: 'MIT' },
      { desc: '拖拽排序', name: 'SortableJS', url: 'https://github.com/SortableJS/Sortable', license: 'MIT' },
      { desc: '拼音匹配', name: 'pinyin-match', url: 'https://github.com/xmflswood/pinyin-match', license: 'MIT' },
    ],
  },
  {
    category: '开发工具',
    items: [
      { desc: '并行启动', name: 'concurrently', url: 'https://github.com/open-cli-tools/concurrently', license: 'MIT' },
      { desc: '端口就绪等待', name: 'wait-on', url: 'https://github.com/jeffbski/wait-on', license: 'MIT' },
      { desc: '原生模块重编译', name: '@electron/rebuild', url: 'https://github.com/electron/rebuild', license: 'MIT' },
    ],
  },
]
</script>

<style scoped>
/* 滚动区域美化 */
.bg-surface .overflow-y-auto::-webkit-scrollbar {
  width: 4px;
}
.bg-surface .overflow-y-auto::-webkit-scrollbar-track {
  background: transparent;
}
.bg-surface .overflow-y-auto::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.25);
  border-radius: var(--radius-xs);
}
</style>