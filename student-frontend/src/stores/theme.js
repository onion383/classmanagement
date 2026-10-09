import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { resourceUrl } from '../utils/apiUrl'

const THEME_KEY = 'app-theme'
const CUSTOM_KEY = 'app-theme-custom'
const CUSTOM_THEMES_KEY = 'app-custom-themes'
const BG_IMAGE_KEY = 'app-bg-image'
const BG_MASK_KEY = 'app-bg-mask-opacity'
const GLASS_KEY = 'app-glass-opacity'
const ICON_STYLE_KEY = 'app-icon-style'
const TOPBAR_COLOR_KEY = 'app-topbar-color'

// 毛玻璃主题的内置默认背景图：放于 public/ 下，随前端一起打包，属前端静态资源，
// 不经 resourceUrl/鉴权直接加载。用户选择本地图片后由 backgroundImage 覆盖它；清除则回此图。
// 生产环境下用 window.location.origin 构造绝对 URL（app:// 协议），避免相对路径解析问题。
const DEFAULT_GLASS_BG = import.meta.env.PROD
  ? window.location.origin + '/glass-bg-opt.jpg'
  : `${import.meta.env.BASE_URL}glass-bg-opt.jpg`

const PRESETS = [
  { id: 'base', name: '彩色色块主题', editable: false },
  { id: 'glass', name: '毛玻璃主题', editable: true },
  { id: 'glass2', name: '新毛玻璃主题', editable: true },
  { id: 'win11', name: 'Win11 主题', editable: true },
  { id: 'minimal', name: '极简主题', editable: true },
]

export const useThemeStore = defineStore('theme', () => {
  const currentTheme = ref(localStorage.getItem(THEME_KEY) || 'glass')
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

  const allThemes = computed(() => [
    ...PRESETS,
    ...customThemes.value.map(t => ({ ...t, editable: true })),
  ])

  const currentThemeMeta = computed(() => allThemes.value.find(t => t.id === currentTheme.value) || PRESETS[0])

  const isPreset = computed(() => PRESETS.some(p => p.id === currentTheme.value))

  const applyTheme = () => {
    document.documentElement.dataset.theme = currentTheme.value
    // 标题栏/侧边栏毛玻璃配色：写 data-topbar-color，CSS 据此切深蓝/白色调
    document.documentElement.dataset.topbarColor = topbarColor.value
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
    const bg = (!isWin11 && backgroundImage.value) || (currentTheme.value === 'glass' ? DEFAULT_GLASS_BG : '')
    if (bg) {
      const bgUrl = isCustomBg ? resourceUrl(bg) : bg
      document.documentElement.style.setProperty('--bg-image', `url('${bgUrl}')`)
      document.documentElement.classList.add('has-bg-image')
    } else {
      document.documentElement.style.removeProperty('--bg-image')
      document.documentElement.classList.remove('has-bg-image')
    }
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

  watch(currentTheme, applyTheme)
  watch(backgroundImage, (val) => {
    localStorage.setItem(BG_IMAGE_KEY, val)
  })

  return {
    currentTheme,
    customColors,
    customThemes,
    backgroundImage,
    bgMaskOpacity,
    glassOpacity,
    iconStyle,
    topbarColor,
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
  }
})
