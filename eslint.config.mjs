/**
 * ESLint 配置（最小规则集，覆盖前端 / 后端 / Electron 主进程）
 *
 * 定位：**只做「低级错误护栏」，不做风格管理**。
 * 不启用 eslint:recommended，也不启用 vue 的规则集——后者大量是审美类
 * （如 multi-word-component-names），对本项目没有价值，只会淹没真正的问题。
 *
 * 三块代码的运行环境不同，规则相同、languageOptions 不同：
 *   student-frontend/src  ESM + 浏览器全局（+ Vue 编译器宏）
 *   student-backend       CJS + Node 全局
 *   electron              CJS + Node 全局；其中 preload.js 跑在渲染进程，还要浏览器全局
 *
 * 用法：npm run lint（根目录一次跑全部）
 *
 * 刻意不做的事：
 *   1. **不挂进 build**：lint 失败不该挡住打包，尤其是历史告警没清完时。
 *   2. **不纳入 testjs/**：探针脚本故意有内联调试代码、临时 node -e 风格，纳入只会产生噪音。
 *   3. **不加格式化类规则**：现有写法是自洽的，强加风格只会制造 diff 噪音。
 *
 * 文件名用 .mjs：根 package.json 是 CJS，.js 会被按 CJS 解析而无法 import 这些 ESM 插件。
 */
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

// ---------- 共用规则：两档 ----------
const SHARED_RULES = {
  // error：命中即 bug
  'no-undef': 'error', // 用了没定义的变量（运行时会 ReferenceError）
  'no-dupe-keys': 'error', // 对象里重复的键（静默覆盖）
  'no-dupe-args': 'error',
  'no-unreachable': 'error', // return/throw 之后的死代码
  'no-cond-assign': 'error', // if (x = y) 这类赋值笔误
  'no-self-assign': 'error',
  'no-fallthrough': 'error', // switch 漏写 break
  'no-async-promise-executor': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],

  // warn：提示，不阻塞
  // 空 catch 在项目里大量用于探测性代码（localStorage 配额、可选 API 是否存在）
  'no-empty': ['warn', { allowEmptyCatch: true }],
  eqeqeq: ['warn', 'smart'],
  'no-unused-vars': [
    'warn',
    {
      args: 'none', // 事件回调常写多余参数（@click="fn($event)"）
      caughtErrors: 'none', // catch (err) 不处理错误对象是常见意图
      varsIgnorePattern: '^_', // _foo / _ 视为有意占位
      ignoreRestSiblings: true,
    },
  ],
  'no-prototype-builtins': 'warn',
  // 给未声明的变量赋值会静默创建全局变量（CJS 非严格模式不报错）——
  // ai.conversations.js 的 `ask` 就是这么串到并发请求之间的。
  'no-implicit-globals': 'error',
}

export default [
  {
    ignores: [
      'node_modules/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-verify-*/**',
      'student-frontend/public/**',
      'student-frontend/origin/**',
      'student-frontend/splash/**',
      'testjs/**',
      'electron/inno/**',
      'resources/**',
    ],
  },

  // flat/base 只提供 .vue 的 parser 与插件注册，不带任何规则（规则在下面手动开）
  ...pluginVue.configs['flat/base'],

  // ---------- 前端：ESM + 浏览器 ----------
  {
    files: ['student-frontend/src/**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Vue 编译器宏：<script setup> 里可直接使用，无需 import，ESLint 不认识它们
        defineProps: 'readonly',
        defineEmits: 'readonly',
        defineExpose: 'readonly',
        defineOptions: 'readonly',
        defineSlots: 'readonly',
        defineModel: 'readonly',
        withDefaults: 'readonly',
      },
    },
    rules: SHARED_RULES,
  },

  // ---------- 后端 + 主进程：CJS + Node ----------
  {
    files: ['student-backend/**/*.js', 'electron/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: SHARED_RULES,
  },

  // ---------- preload 特例：跑在渲染进程里 ----------
  {
    // preload 由渲染进程加载，既有 window/document，也能用 node 的 require
    files: ['electron/preload.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.browser, ...globals.node },
    },
  },
]
