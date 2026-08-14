import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

const THEME_KEY = 'app-theme'
const CUSTOM_KEY = 'app-theme-custom'
const CUSTOM_THEMES_KEY = 'app-custom-themes'
const BG_IMAGE_KEY = 'app-bg-image'
const BG_MASK_KEY = 'app-bg-mask-opacity'
const GLASS_KEY = 'app-glass-opacity'

const PRESETS = [
  { id: 'base', name: '默认主题', editable: false },
  { id: 'glass', name: '毛玻璃主题', editable: true },
  { id: 'minimal', name: '极简主题', editable: true },
]

export const useThemeStore = defineStore('theme', () => {
  const currentTheme = ref(localStorage.getItem(THEME_KEY) || 'base')
  const customColors = ref(JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}'))
  const customThemes = ref(JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) || '[]'))
  const backgroundImage = ref(localStorage.getItem(BG_IMAGE_KEY) || '')
  // 背景遮罩层不透明度（0~1，有自定义背景图时生效）
  const bgMaskOpacity = ref(parseFloat(localStorage.getItem(BG_MASK_KEY)) || 0.65)
  // 组件透明玻璃层不透明度（0~1，卡片基准值）
  const glassOpacity = ref(parseFloat(localStorage.getItem(GLASS_KEY)) || 0.5)

  const allThemes = computed(() => [
    ...PRESETS,
    ...customThemes.value.map(t => ({ ...t, editable: true })),
  ])

  const currentThemeMeta = computed(() => allThemes.value.find(t => t.id === currentTheme.value) || PRESETS[0])

  const isPreset = computed(() => PRESETS.some(p => p.id === currentTheme.value))

  const applyTheme = () => {
    document.documentElement.dataset.theme = currentTheme.value
    Object.entries(customColors.value).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--${key}`, value)
    })
    // 应用背景图（使用单引号避免 base64 data URL 中的双引号冲突）
    if (backgroundImage.value) {
      document.documentElement.style.setProperty('--bg-image', `url('${backgroundImage.value}')`)
      document.documentElement.classList.add('has-bg-image')
    } else {
      document.documentElement.style.removeProperty('--bg-image')
      document.documentElement.classList.remove('has-bg-image')
    }
    // 应用透明度设置
    document.documentElement.style.setProperty('--bg-mask-opacity', bgMaskOpacity.value)
    document.documentElement.style.setProperty('--glass-opacity', glassOpacity.value)
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
      setTheme('base')
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
  }
})
