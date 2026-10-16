import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { resourceUrl } from '../utils/apiUrl'

const THEME_KEY = 'app-theme'
// 全局日/夜模式：与「主题」正交，任何主题之上再叠一层夜间配色（见 styles/theme-night.css）。
// 目前仅 glass / glass2 实现了夜间配色，其余主题保持日间外观（切换按钮禁用）。
const MODE_KEY = 'app-mode'
const NIGHT_THEMES = ['glass', 'glass2']
const CUSTOM_KEY = 'app-theme-custom'
const CUSTOM_THEMES_KEY = 'app-custom-themes'
const BG_IMAGE_KEY = 'app-bg-image'
const BG_MASK_KEY = 'app-bg-mask-opacity'
const GLASS_KEY = 'app-glass-opacity'
const ICON_STYLE_KEY = 'app-icon-style'
const TOPBAR_COLOR_KEY = 'app-topbar-color'
const ANIMATIONS_KEY = 'app-animations'

// 毛玻璃主题的内置默认背景图：放于 public/ 下，随前端一起打包，属前端静态资源，
// 不经 resourceUrl/鉴权直接加载。用户选择本地图片后由 backgroundImage 覆盖它；清除则回此图。
// 生产环境下用 window.location.origin 构造绝对 URL（app:// 协议），避免相对路径解析问题。
const DEFAULT_GLASS_BG = import.meta.env.PROD
  ? window.location.origin + '/glass-bg-opt.jpg'
  : `${import.meta.env.BASE_URL}glass-bg-opt.jpg`
// glass 夜间模式的默认底图：本身已是深色风景图，故其上的黑色遮罩要更轻（见 theme-night.css
// 的 .bg-night-default 规则），否则会把图压死。仅夜间生效，日间仍用 DEFAULT_GLASS_BG。
const DEFAULT_GLASS_BG_NIGHT = import.meta.env.PROD
  ? window.location.origin + '/glass-bg-night.jpg'
  : `${import.meta.env.BASE_URL}glass-bg-night.jpg`

const PRESETS = [
  { id: 'base', name: '彩色色块主题', editable: false },
  { id: 'glass', name: '毛玻璃主题', editable: true },
  { id: 'glass2', name: '新毛玻璃主题', editable: true },
  { id: 'win11', name: 'Win11 主题', editable: true },
  { id: 'minimal', name: '极简主题', editable: true },
]

export const useThemeStore = defineStore('theme', () => {
  const currentTheme = ref(localStorage.getItem(THEME_KEY) || 'glass')
  // 全局日/夜模式：'day' | 'night'（默认日间，保持现有观感）
  const mode = ref(localStorage.getItem(MODE_KEY) === 'night' ? 'night' : 'day')
  const isNight = computed(() => mode.value === 'night')
  // 当前主题是否已实现夜间配色（决定切换按钮是否可用）
  const nightSupported = computed(() => NIGHT_THEMES.includes(currentTheme.value))
  const customColors = ref(JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}'))
  const customThemes = ref(JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) || '[]'))
  const backgroundImage = ref(localStorage.getItem(BG_IMAGE_KEY) || '')
  // 背景遮罩层不透明度（0~1，有自定义背景图时生效）
  const bgMaskOpacity = ref(parseFloat(localStorage.getItem(BG_MASK_KEY)) || 0.6)
  // 组件透明玻璃层不透明度（0~1，卡片基准值）
  const glassOpacity = ref(parseFloat(localStorage.getItem(GLASS_KEY)) || 0.4)
  // 图标样式：'color'（彩色图标）| 'emoji'（Emoji）
  const iconStyle = ref(localStorage.getItem(ICON_STYLE_KEY) || 'color')
  // 标题栏/侧边栏毛玻璃配色：'blue'（深蓝，旧款）| 'light'（白色调，新款默认）
  const topbarColor = ref(localStorage.getItem(TOPBAR_COLOR_KEY) || 'light')
  // 动画效果总开关：关闭后全局禁用过渡与动画（含窗口淡入淡出、弹窗/列表动效等）
  const animationsEnabled = ref(localStorage.getItem(ANIMATIONS_KEY) !== '0')

  const allThemes = computed(() => [
    ...PRESETS,
    ...customThemes.value.map(t => ({ ...t, editable: true })),
  ])

  const currentThemeMeta = computed(() => allThemes.value.find(t => t.id === currentTheme.value) || PRESETS[0])

  const isPreset = computed(() => PRESETS.some(p => p.id === currentTheme.value))

  const applyTheme = () => {
    document.documentElement.dataset.theme = currentTheme.value
    // 全局日/夜模式：写 data-mode，styles/theme-night.css 据此叠加夜间配色
    document.documentElement.dataset.mode = mode.value
    // 标题栏/侧边栏毛玻璃配色：写 data-topbar-color，CSS 据此切深蓝/白色调
    document.documentElement.dataset.topbarColor = topbarColor.value
    // 动画总开关：关闭时给根元素打 no-animations，配合全局 CSS 瞬时化所有动效
    document.documentElement.classList.toggle('no-animations', !animationsEnabled.value)
    Object.entries(customColors.value).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--${key}`, value)
    })
    // 应用背景图（使用单引号避免 base64 data URL 中的双引号冲突）
    // resourceUrl 会补完整后端地址并追加 ?token=，保证 file:// 打包版下背景图能通过鉴权加载。
    // 毛玻璃主题无自定义图时使用内置默认背景（前端静态资源，无需鉴权，直接引用）；
    // 自定义图仍走 resourceUrl。其余主题保持无背景。
    const isWin11 = currentTheme.value === 'win11'
    // Win11 主题：由主进程对窗口开启窗外亚克力模糊，页面自身保持透明让模糊透出，
    // 因此不设背景图、不画底色。切换走 IPC 通知主进程。
    if (!isWin11) {
      document.documentElement.classList.remove('win11-acrylic')
    }
    const isCustomBg = Boolean(backgroundImage.value)
    // glass 内置默认底图：日/夜各一张（夜间图本身是深色风景图，遮罩随之变轻）
    const defaultGlassBg = mode.value === 'night' ? DEFAULT_GLASS_BG_NIGHT : DEFAULT_GLASS_BG
    const bg = (!isWin11 && backgroundImage.value) || (currentTheme.value === 'glass' ? defaultGlassBg : '')
    if (bg) {
      const bgUrl = isCustomBg ? resourceUrl(bg) : bg
      document.documentElement.style.setProperty('--bg-image', `url('${bgUrl}')`)
      document.documentElement.classList.add('has-bg-image')
    } else {
      document.documentElement.style.removeProperty('--bg-image')
      document.documentElement.classList.remove('has-bg-image')
    }
    // 夜间内置默认底图标记：仅「glass + 夜间 + 未用自定义图」时加。
    // 供 theme-night.css 给这张深色图配一层更轻的遮罩；自定义图仍走通用遮罩系数。
    document.documentElement.classList.toggle(
      'bg-night-default',
      !isCustomBg && currentTheme.value === 'glass' && mode.value === 'night'
    )
    // 应用透明度设置
    document.documentElement.style.setProperty('--bg-mask-opacity', bgMaskOpacity.value)
    document.documentElement.style.setProperty('--glass-opacity', glassOpacity.value)
    // 通知主进程：窗口统一为无边框亚克力（恒 frameless）。主进程传 frameless 会触发
    // recreateMainWindow 的「当前已相同」直接返回，故主题切换不会重建窗口（见 electron/main.js）。
    if (window.electron?.send) {
      window.electron.send('theme-chrome', { mode: 'frameless' })
    }
  }

  const setTheme = (themeId) => {
    currentTheme.value = themeId
    localStorage.setItem(THEME_KEY, themeId)
    applyTheme()
  }

  const setCustomColor = (key, value) => {
    customColors.value[key] = value
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customColors.value))
    document.documentElement.style.setProperty(`--${key}`, value)
  }

  const resetCustomColors = () => {
    customColors.value = {}
    localStorage.removeItem(CUSTOM_KEY)
    applyTheme()
  }

  const createCustomTheme = (name, colors) => {
    const id = `custom_${Date.now()}`
    const theme = { id, name, colors }
    customThemes.value.push(theme)
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes.value))
    return id
  }

  const deleteCustomTheme = (id) => {
    customThemes.value = customThemes.value.filter(t => t.id !== id)
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes.value))
    if (currentTheme.value === id) {
      setTheme('glass')
      resetCustomColors()
    }
  }

  const updateCustomTheme = (id, updates) => {
    const idx = customThemes.value.findIndex(t => t.id === id)
    if (idx !== -1) {
      customThemes.value[idx] = { ...customThemes.value[idx], ...updates }
      localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes.value))
    }
  }

  const setBackgroundImage = (url) => {
    backgroundImage.value = url
    localStorage.setItem(BG_IMAGE_KEY, url)
    applyTheme()
  }

  const setBgMaskOpacity = (value) => {
    bgMaskOpacity.value = value
    localStorage.setItem(BG_MASK_KEY, value)
    applyTheme()
  }

  const setGlassOpacity = (value) => {
    glassOpacity.value = value
    localStorage.setItem(GLASS_KEY, value)
    applyTheme()
  }

  const setIconStyle = (value) => {
    iconStyle.value = value
    localStorage.setItem(ICON_STYLE_KEY, value)
  }

  const setTopbarColor = (value) => {
    topbarColor.value = value
    localStorage.setItem(TOPBAR_COLOR_KEY, value)
    document.documentElement.dataset.topbarColor = value
  }

  // 动画总开关：立即生效（写 localStorage + 重应用主题类）
  const setAnimationsEnabled = (value) => {
    animationsEnabled.value = !!value
    localStorage.setItem(ANIMATIONS_KEY, value ? '1' : '0')
    applyTheme()
  }

  // 全局日/夜模式：立即生效（写 localStorage + 重应用主题类）
  const setMode = (value) => {
    mode.value = value === 'night' ? 'night' : 'day'
    localStorage.setItem(MODE_KEY, mode.value)
    applyTheme()
  }

  const toggleMode = () => setMode(mode.value === 'night' ? 'day' : 'night')

  watch(currentTheme, applyTheme)
  watch(backgroundImage, (val) => {
    localStorage.setItem(BG_IMAGE_KEY, val)
  })

  return {
    currentTheme,
    mode,
    isNight,
    nightSupported,
    customColors,
    customThemes,
    backgroundImage,
    bgMaskOpacity,
    glassOpacity,
    iconStyle,
    topbarColor,
    animationsEnabled,
    allThemes,
    currentThemeMeta,
    isPreset,
    setTheme,
    setCustomColor,
    resetCustomColors,
    createCustomTheme,
    deleteCustomTheme,
    updateCustomTheme,
    applyTheme,
    setBackgroundImage,
    setBgMaskOpacity,
    setGlassOpacity,
    setIconStyle,
    setTopbarColor,
    setAnimationsEnabled,
    setMode,
    toggleMode,
  }
})
