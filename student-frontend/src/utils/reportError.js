// 错误上报的统一入口：决定「这次失败要不要让用户看见」，并把文案格式固定下来。
//
// 为什么需要它：
//   项目里 23 个文件都有 notifyError，但实现的语义各不相同 ——
//   有的「保存失败」、有的「保存失败，改动未保存」、有的干脆只有 console.error。
//   同一个失败在不同页面的可见性不一样，用户就会遇到「点了没反应」。
//   真正的缺口不是缺一个函数，而是**没有判断标准**，所以这里把标准写进 API：
//
// 三档（判断标准一句话：用户点了按钮 → user；系统自己跑 → log；清理/探测 → silent）
//   user   —— 用户主动操作失败（保存/删除/导入/应用模板）：弹提示
//   log    —— 后台自动流程失败（轮询/预取/自动补存）：只记控制台
//   silent —— 清理与探测（revokeObjectURL、可选 API）：什么都不做
//
// 用法：
//   reportError(err, { action: '保存', hint: '改动未保存' })   // → 「保存失败，改动未保存」
//   reportError(err, { action: '添加' })                      // → 「添加失败：该用户名已被占用」
//   reportError(err, { level: 'log' })                        // → 只打控制台
//
// 文案规则（刻意与旧写法不同）：
//   旧写法是 `err.response?.data?.error || '保存失败'` —— 后端消息无条件优先，
//   于是 SQLITE_CONSTRAINT、Cannot read properties 这类技术文本会直接摆到用户面前，
//   用户看不懂，截图反馈时还会暴露内部结构。
//   这里反过来：**动作名优先**，后端消息只在「像人话」时才追加。

import { useNotification } from '../composables/useNotification.js'

// 看起来是「给开发者看」的内容。命中就不往用户文案里放。
// 宁可退化成通用文案，也不要让用户读栈信息。
const TECHNICAL_RE = /SQLITE_|SQL |ECONN|ETIMEDOUT|ENOTFOUND|EADDRINUSE|TypeError|ReferenceError|SyntaxError|Cannot read|is not a function|\[object Object\]|undefined is not|NaN-NaN/i

// 取后端返回的可读消息：统一是 { error }, 少数路由用 { message }
function backendMessage(err) {
  const d = err && err.response && err.response.data
  if (!d || typeof d !== 'object') return ''
  const m = d.error || d.message
  return typeof m === 'string' ? m.trim() : ''
}

// 返回 true 表示「弹给了用户」，false 表示「只记了日志/静默」。
// 调用方一般不关心返回值，保留是为了让「失败后要不要回滚」这类判断能复用它。
export function reportError(err, options = {}) {
  const { action = '', level = 'user', hint = '' } = options

  // 现场永远留全量：这是本地单用户工具，控制台是唯一的诊断入口。
  // 即使 level 是 silent 也打 —— 静默指的是「不打扰用户」，不是「不留痕」。
  console.error(`[captured]${action ? ' ' + action : ''}`, err)

  if (level !== 'user') return false

  const back = backendMessage(err)
  const usable = back && !TECHNICAL_RE.test(back)

  let text
  if (action) {
    // 有可读的后端消息就用它（对用户更有信息量，如「该用户名已被占用」），
    // 否则给「动作 + 结果」，比一句「操作失败」具体得多。
    text = usable ? `${action}失败：${back}` : `${action}失败${hint ? `，${hint}` : '，请重试'}`
  } else {
    text = usable ? back : (hint || '操作失败，请重试')
  }

  try {
    useNotification().error(text)
  } catch (_) {
    // best-effort: 通知系统自身不可用时不能再抛，否则「错误处理」本身成了错误源
  }
  return true
}
