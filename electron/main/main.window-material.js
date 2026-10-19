// =========================================================================
// window-material.js —— 窗口原生背景材质（BackgroundMaterial / 亚克力）
//
// 使用 Electron 官方内置的 setBackgroundMaterial('acrylic'|'mica'|'none')，随主版本维护，
// 替代已停更的 electron-acrylic-window。仅 Windows 11 22H2+ 生效，其余系统自动回退普通背景。
// 备注：文档/经验记录原生材质在 Win11「节能器(省电)」开启时可能被干扰变灰，属系统级行为。
//
// 主窗口为「不透明无边框」窗口，backgroundMaterial 绘制在窗口背景上；CSS 半透明元素 +
// backdrop-filter 叠加即可磨砂透出材质。
// =========================================================================

// 应用背景材质。返回 true 表示已应用（系统支持时）。
function applyBackgroundMaterial(win, material = 'acrylic') {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return false
  try {
    const m = ['auto', 'none', 'mica', 'acrylic', 'tabbed'].includes(material) ? material : 'acrylic'
    win.setBackgroundMaterial(m)
    return m !== 'none'
  } catch (err) {
    console.error('[acrylic] setBackgroundMaterial 失败，回退普通背景:', err?.message || err)
    return false
  }
}

// 关闭窗口系统背景材质（恢复普通背景）。用于：窗口销毁前 / 系统不支持时。
const disableBackgroundMaterial = (win) => {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return
  try { win.setBackgroundMaterial('none') } catch (_) {}
}

module.exports = { applyBackgroundMaterial, disableBackgroundMaterial }