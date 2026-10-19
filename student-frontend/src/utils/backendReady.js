// 后端就绪等待：后端在 app.listen 回调里通过 IPC（process.send）上报就绪，
// 主进程收到后广播为 from-main 的 'backend-ready' 事件；同时暴露 backend-status 查询，
// 兜住「后端先就绪、渲染层后注册监听」的竞态（事件广播会漏掉这类窗口）。
//
// 契约：resolve(true) = 已就绪（可能远早于 timeout）；resolve(false) = 等满 timeout 仍未知。
// 调用方把它当成「可提前结束的退避等待」：慢不过原来的固定 sleep，快则在后端就绪瞬间立即重试。

import { INVOKE, RECEIVE } from '../electronChannels.js'

let ready = false
const waiters = new Set()
let subscribed = false

function electronApi() {
  return typeof window !== 'undefined' ? window.electron : null
}

function subscribe() {
  if (subscribed) return
  subscribed = true
  const api = electronApi()
  if (!api || typeof api.on !== 'function') return
  api.on(RECEIVE.FROM_MAIN, (msg) => {
    if (!msg) return
    if (msg.type === 'backend-ready') {
      ready = true
      for (const fn of [...waiters]) fn()
    }
  })
}

// 「后端不可达」判定：无响应（连接被拒/中断）或网关错误都算同一类故障。
// 后者是 dev 模式的产物——Vite 代理连不上上游时会把「连接被拒」包装成真正的
// HTTP 502（见 vite proxy），此时 error.response 存在，若不特判就会被 axios 拦截器
// 当成业务错误而跳过重试。502/503/504 在本项目里只会由「后端未就绪/不可达」产生，
// 故与网络错误合并处理，统一走「等后端就绪再重试」。
export function isBackendUnreachable(error) {
  if (!error.response) return true
  const s = error.response.status
  return s === 502 || s === 503 || s === 504
}

export function waitForBackendReady(timeoutMs = 4000) {
  if (ready) return Promise.resolve(true)
  const api = electronApi()
  // 无就绪信号通道（纯浏览器调试）：退化为普通退避等待，交由请求重试兜底
  if (!api || typeof api.invoke !== 'function') {
    return new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  }
  subscribe()
  return new Promise((resolve) => {
    let done = false
    let timer = null
    const onReady = () => finish(true)
    const finish = (v) => {
      if (done) return
      done = true
      waiters.delete(onReady)
      clearTimeout(timer)
      resolve(v)
    }
    waiters.add(onReady)
    timer = setTimeout(() => finish(ready), timeoutMs)
    // 主动查一次当前状态：事件可能在本监听注册之前就已经广播过了
    api.invoke(INVOKE.BACKEND_STATUS).then((v) => { if (v) finish(true) }).catch(() => {})
  })
}
