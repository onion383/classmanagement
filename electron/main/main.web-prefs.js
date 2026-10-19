// =========================================================================
// web-prefs.js —— BrowserWindow 的 webPreferences 公共模板
//
// 应用内所有窗口（主窗口 / 引导窗口 / 迁移窗口 / 工具箱浮窗 / 桌面组件）采用同一套
// 渲染进程安全配置：contextIsolation + sandbox + 关闭 nodeIntegration + 预加载脚本，
// 生产环境开启 webSecurity。差异只有三点：是否开启 devTools、是否关闭后台节流
// （需要持续重绘的浮窗类），以及预加载脚本路径（所有窗口共用同一份，故无需传参）。
// =========================================================================

const path = require('path')
const { app } = require('electron')

// 统一构造 webPreferences。
// devTools：是否允许开发者工具（默认随环境：生产关闭、开发开启）。
// backgroundThrottling：传入时写入该项（浮窗类传 false 以保持后台绘帧）。
// webviewTag：是否允许该窗口使用 <webview> 内嵌网页（仅主窗口的右侧网页抽屉需要，默认关闭，
//             避免给其余窗口无谓地多开一项渲染能力）。
function buildWebPreferences({ devTools, backgroundThrottling, webviewTag } = {}) {
  const isDev = !app.isPackaged
  const prefs = {
    preload: path.join(__dirname, '..', 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    // 开启 OS 级沙箱：即使注入成功也跑不出渲染进程安全边界。
    // contextIsolation + nodeIntegration:false 仍是软件层兜底。
    sandbox: true,
    // 标记渲染进程启用安全通道（preload 据此暴露 window.__SECURE_CHANNEL__，
    // 前端只在置位后才对业务 JSON API 启用加密传输）
    additionalArguments: ['--secure-channel'],
    // webSecurity 仅开发模式关闭（用于加载自签名 https 的 Vite 服务）；
    // 生产环境必须保持开启，禁止在打包后关闭网页安全策略。
    webSecurity: !isDev,
    spellcheck: false,
    devTools: devTools === undefined ? isDev : devTools,
  }
  if (backgroundThrottling !== undefined) prefs.backgroundThrottling = backgroundThrottling
  if (webviewTag !== undefined) prefs.webviewTag = webviewTag
  return prefs
}

module.exports = { buildWebPreferences }