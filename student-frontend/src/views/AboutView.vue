<template>
  <div>
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="about" /> 关于软件</h1>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- 应用信息 -->
      <div class="bg-surface shadow-md rounded-xl border border-border p-6 md:col-span-2">
        <div class="flex items-center gap-4 mb-4">
          <div class="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-3xl">🏫</div>
          <div>
            <div class="text-xl font-bold text-text">班级管理系统</div>
            <div class="text-sm text-text-muted">班级管理一站式桌面应用</div>
          </div>
        </div>
        <p class="text-text-secondary text-sm leading-relaxed">
          班级管理系统是一个面向班级日常管理的轻量化桌面应用，整合了班级管理、班费、课程表、座位安排、
          请假考勤、班级相册等常用功能，帮助班主任与班委高效完成日常事务。
        </p>

        <div class="flex flex-wrap items-center gap-3 mt-4">
          <button @click="dialogProtocol = true" class="px-4 py-2 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            PolyForm Noncommercial 协议
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

    <div class="text-center text-xs text-text-muted mt-6 pb-2 space-y-1">
      <div>本软件遵循 <a href="https://polyformproject.org/licenses/noncommercial/1.0.0" target="_blank" rel="noopener" @click="openExternal($event, 'https://polyformproject.org/licenses/noncommercial/1.0.0')" class="text-primary hover:underline">PolyForm Noncommercial License 1.0.0</a> 发布</div>
      <div class="text-text-muted/70">仅非商业使用，商业使用需本人授权</div>
      <div>
        Copyright &copy; 无聊的小洋葱 2026 &nbsp;|&nbsp;
        <a href="https://github.com/onion383/classmanagement" target="_blank" rel="noopener" @click="openExternal($event, 'https://github.com/onion383/classmanagement')" class="text-primary hover:underline">仓库地址</a>
      </div>
      <div class="text-[10px] text-text-muted/50">https://github.com/onion383/classmanagement</div>
    </div>

    <!-- 协议弹窗 -->
    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="dialogProtocol" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" @click.self="dialogProtocol = false">
          <div class="dialog-card bg-surface rounded-xl shadow-2xl border border-border w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" @click.stop>
          <div class="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
            <h2 class="text-lg font-semibold text-text">PolyForm Noncommercial License 1.0.0</h2>
            <button @click="dialogProtocol = false" class="text-text-muted hover:text-text text-xl leading-none">&times;</button>
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
          <div class="dialog-card bg-surface rounded-xl shadow-2xl border border-border w-full max-w-sm mx-4" @click.stop>
          <div class="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 class="text-lg font-semibold text-text">版本更新</h2>
            <button @click="dialogVersion = false" class="text-text-muted hover:text-text text-xl leading-none">&times;</button>
          </div>
          <div class="px-6 py-4 text-sm text-text-secondary space-y-2">
            <div class="flex justify-between"><span>当前版本</span><span class="text-text font-medium">v1.0.0</span></div>
            <div class="flex justify-between"><span>最新版本</span><span class="text-text font-medium">v1.0.0</span></div>
            <div class="flex justify-between"><span>更新状态</span><span class="text-emerald-500 font-medium">已是最新版本</span></div>
          </div>
          <div class="px-6 py-4 border-t border-border flex justify-end">
            <button @click="dialogVersion = false" class="px-4 py-2 rounded-lg bg-primary text-text-inverse text-sm">关闭</button>
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
            <button @click="dialogDonate = false" class="text-text-muted hover:text-text text-xl leading-none">&times;</button>
          </div>
          <div class="px-6 py-4 text-sm text-text-secondary text-center">
            <p class="mb-4">本软件个人免费使用，如果你觉得好的话欢迎打赏我们</p>
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <div class="text-text font-medium">微信</div>
                <div class="w-full aspect-square bg-black/5 dark:bg-white/5 rounded-lg flex items-center justify-center text-text-muted text-xs">
                  微信收款码
                </div>
              </div>
              <div class="space-y-2">
                <div class="text-text font-medium">支付宝</div>
                <div class="w-full aspect-square bg-black/5 dark:bg-white/5 rounded-lg flex items-center justify-center text-text-muted text-xs">
                  支付宝收款码
                </div>
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
import { ref } from 'vue'
import '../styles/dialog-transition.css'

// Electron 内用系统浏览器打开外链，非 Electron 环境让浏览器默认行为处理
function openExternal(event, url) {
  if (window.electron && window.electron.invoke) {
    event.preventDefault()
    window.electron.invoke('open-external', url)
  }
  // 非 Electron：不阻止默认行为，让 href 直接在新标签页打开
}

// 弹窗状态
const dialogProtocol = ref(false)
const dialogVersion = ref(false)
const dialogDonate = ref(false)

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
      { desc: '无边框亚克力', name: 'electron-acrylic-window', url: 'https://github.com/wizo06/electron-acrylic-window', license: 'MIT' },
      { desc: '应用打包', name: 'electron-builder', url: 'https://github.com/electron-userland/electron-builder', license: 'MIT' },
    ],
  },
  {
    category: '前端',
    items: [
      { desc: '前端框架', name: 'Vue 3', url: 'https://github.com/vuejs/core', license: 'MIT' },
      { desc: '前端路由', name: 'Vue Router', url: 'https://github.com/vuejs/vue-router', license: 'MIT' },
      { desc: '状态管理', name: 'Pinia', url: 'https://github.com/vuejs/pinia', license: 'MIT' },
      { desc: '构建工具', name: 'Vite', url: 'https://github.com/vitejs/vite', license: 'MIT' },
      { desc: 'CSS 框架', name: 'Tailwind CSS', url: 'https://github.com/tailwindlabs/tailwindcss', license: 'MIT' },
      { desc: 'HTTP 请求', name: 'Axios', url: 'https://github.com/axios/axios', license: 'MIT' },
      { desc: '图标库', name: 'lucide', url: 'https://github.com/lucide-icons/lucide', license: 'ISC' },
      { desc: 'XSS 过滤', name: 'DOMPurify', url: 'https://github.com/cure53/DOMPurify', license: 'Apache-2.0' },
      { desc: 'Markdown 解析', name: 'marked', url: 'https://github.com/markedjs/marked', license: 'MIT' },
    ],
  },
  {
    category: '后端',
    items: [
      { desc: '后端框架', name: 'Express', url: 'https://github.com/expressjs/express', license: 'MIT' },
      { desc: '加密数据库', name: 'better-sqlite3-multiple-ciphers', url: 'https://github.com/m4heshd/better-sqlite3-multiple-ciphers', license: 'MIT' },
      { desc: '关系数据库', name: 'mysql2', url: 'https://github.com/sidorares/node-mysql2', license: 'MIT' },
      { desc: '图片处理', name: 'Sharp', url: 'https://github.com/lovell/sharp', license: 'Apache-2.0' },
      { desc: '跨域支持', name: 'cors', url: 'https://github.com/expressjs/cors', license: 'MIT' },
      { desc: '文件上传', name: 'Multer', url: 'https://github.com/expressjs/multer', license: 'MIT' },
      { desc: '视频抽帧', name: 'FFmpeg（LGPL 构建）', url: 'https://github.com/BtbN/FFmpeg-Builds', license: 'LGPL' },
      { desc: '压缩包解压', name: 'extract-zip', url: 'https://github.com/inchingorg/extract-zip', license: 'MIT' },
      { desc: 'Word 转换', name: 'Mammoth', url: 'https://github.com/mwilliamson/mammoth.js', license: 'BSD-2-Clause' },
      { desc: 'PDF 解析', name: 'pdf-parse', url: 'https://github.com/PhilippKurz30/node-pdf-parse', license: 'MIT' },
      { desc: '回收站删除', name: 'trash', url: 'https://github.com/sindresorhus/trash', license: 'MIT' },
    ],
  },
  {
    category: '安全支持',
    items: [
      { desc: 'JWT 鉴权', name: 'jsonwebtoken', url: 'https://github.com/auth0/node-jsonwebtoken', license: 'MIT' },
      { desc: '密码加密', name: 'bcryptjs', url: 'https://github.com/dcodeIO/bcrypt.js', license: 'MIT' },
    ],
  },
  {
    category: '数据处理',
    items: [
      { desc: '表格导出', name: 'ExcelJS', url: 'https://github.com/exceljs/exceljs', license: 'MIT' },
      { desc: '电子表格', name: 'SheetJS (xlsx)', url: 'https://github.com/SheetJS/sheetjs', license: 'Apache-2.0' },
      { desc: 'PDF 生成', name: 'jsPDF', url: 'https://github.com/parallax/jsPDF', license: 'MIT' },
      { desc: 'PDF 表格', name: 'jsPDF-AutoTable', url: 'https://github.com/simonbengtsson/jsPDF-AutoTable', license: 'MIT' },
      { desc: '截图渲染', name: 'html2canvas', url: 'https://github.com/niklasvh/html2canvas', license: 'MIT' },
      { desc: '拖拽排序', name: 'SortableJS', url: 'https://github.com/SortableJS/Sortable', license: 'MIT' },
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
  border-radius: 4px;
}
</style>