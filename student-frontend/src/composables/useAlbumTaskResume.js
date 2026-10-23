// =========================================================================
// useAlbumTaskResume.js —— 启动后恢复「上次没跑完」的相册扫描任务
//
// 背景：相册扫描（尤其大相册的全量扫描）可能要跑很久。用户关掉软件 / 崩溃时，
// 正在跑的扫描会丢，下次打开要从头再来（缩略图全部重生成，很慢）。
// 后端把扫描断点持久化到 album_scan_tasks 表，重启后可据此续扫。
//
// 时机（重要，勿改）：
//   绝不能跟软件启动抢时间。恢复扫描是重活（读目录 + 生成缩略图，吃 CPU 与磁盘 IO），
//   在启动关键路径上跑会把首屏拖慢。
//   所以流程是：
//     app-visible（占位页移除，首屏真正可见）
//       → 小组件就绪上报（reportWidgetsReady，主进程建浮窗/小组件）
//       → 延迟 4 秒
//       → 才查 /api/album/tasks/pending 并触发续扫
//   4 秒的延迟让首屏渲染、路由 chunk 解析、主题预热等启动期工作先落地。
//
// 未登录时不做任何事（接口需要 token 才能绑定到正确的库）。
// =========================================================================
import { ref } from 'vue'
import axios from 'axios'
import { useNotification } from './useNotification.js'

// 启动完成后延迟多久才去查待恢复任务（毫秒）
const RESUME_DELAY_MS = 4000

export function useAlbumTaskResume() {
  const resumed = ref(false)
  // 是否有待恢复的任务（供 UI 判断要不要显示入口）
  const hasPending = ref(false)
  const pendingCount = ref(0)

  let timer = null
  let started = false

  const token = () => localStorage.getItem('token') || ''
  const authHeaders = () => ({ Authorization: 'Bearer ' + token() })

  // 查待恢复任务并续跑。返回续跑的任务数。
  async function checkAndResume() {
    if (!token()) return 0
    try {
      const res = await axios.get('/api/album/tasks/pending', { headers: authHeaders() })
      const list = (res.data && res.data.data) || []
      if (!list.length) { hasPending.value = false; pendingCount.value = 0; return 0 }
      hasPending.value = true
      pendingCount.value = list.length
      // 续跑：交给后端按断点接着扫
      const rr = await axios.post('/api/album/tasks/resume', { albumIds: list.map(t => t.albumId) }, { headers: authHeaders() })
      const n = (rr.data && rr.data.resumed) || 0
      resumed.value = n > 0
      if (n > 0) {
        const names = list.slice(0, 2).map(t => t.albumName).join('、')
        const more = list.length > 2 ? ` 等 ${list.length} 个相册` : ''
        useNotification().info(`班级相册有任务未完成，正在继续：${names}${more}`, 6000)
      }
      return n
    } catch (err) {
      // 静默失败：恢复不了不影响正常使用（用户仍可手动点「更新文件夹照片」）
      return 0
    }
  }

  // 延迟后触发一次
  function schedule() {
    if (started) return
    started = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; checkAndResume() }, RESUME_DELAY_MS)
  }

  // 取消（组件卸载时）
  function cancel() {
    started = true
    if (timer) { clearTimeout(timer); timer = null }
  }

  return { schedule, cancel, checkAndResume, resumed, hasPending, pendingCount }
}
