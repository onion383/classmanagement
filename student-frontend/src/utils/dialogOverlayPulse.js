/* ==================== 弹窗遮罩点击提示（事件委托，一次性全局注册） ====================
 * 目标：点击弹窗遮罩（窗口外部）时，不再关闭弹窗，而是弹一条提示条「请关闭弹窗」。
 * 要点：
 *   - 捕获阶段 pointerdown 判定被点元素「就是遮罩本尊」(class 含 inset-0 且 bg-black/)，
 *     点卡片内部/其他元素一律不处理。
 *   - 找到遮罩直接子元素的 .dialog-card 确认是弹窗类遮罩（无卡片的查看器遮罩不干预）。
 *   - 只弹 toast，不改动弹窗自身的显隐状态。
 * 用法：在 main.js 里 import('./utils/dialogOverlayPulse') 一次即可，全局生效。
 */
import { useNotification } from '../composables/useNotification'

export function initDialogOverlayPulse() {
  const isOverlay = (el) =>
    el &&
    el.classList &&
    typeof el.className === 'string' &&
    el.className.includes('inset-0') &&
    el.className.includes('bg-black/')

  document.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target
      // 只有点到遮罩本尊才触发；点卡片及其内部、或其他任意元素一律不处理
      if (!isOverlay(target)) return

      // 确认是弹窗类遮罩（直接子节点含 .dialog-card）；无卡片的查看器类遮罩不干预
      let hasCard = false
      for (const child of target.children) {
        if (child.classList && child.classList.contains('dialog-card')) {
          hasCard = true
          break
        }
      }
      if (!hasCard) return

      // 拦截默认行为，阻止气泡到 @click.self，避免弹窗被关闭
      e.preventDefault()
      e.stopPropagation()

      // 提示用户自行关闭弹窗
      const { info } = useNotification()
      info('请关闭弹窗')
    },
    true,
  )
}