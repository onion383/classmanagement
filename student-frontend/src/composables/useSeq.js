// 异步竞态的序号守卫。
//
// 问题：一个异步加载函数可能被连续触发（切相册、切 tab、改筛选、连点刷新），
// 先发的请求可能后到，旧结果写进状态就覆盖了新结果 —— 界面显示的是「上一次」的数据。
// 本地后端的延迟虽然只有几毫秒，但用户连点/快速切换时窗口真实存在，这类 bug
// 表现为「偶发、刷新一下又好了」，最难复现。
//
// 用法（四条约定，缺一条就会漏）：
//   const seq = useSeq()
//
//   async function load() {
//     const my = seq.take()                 // ① 发请求前取号
//     loading.value = true
//     try {
//       const r = await axios.get(url)
//       if (!seq.isLatest(my)) return        // ② 每个 await 之后、写状态之前都要判断
//       rows.value = r.data
//     } catch (e) {
//       if (!seq.isLatest(my)) return        // ③ catch 里也要判断：
//       notifyError(e)                       //    否则旧请求的失败会盖掉新请求的成功
//     } finally {
//       if (seq.isLatest(my)) loading.value = false  // ④ 只让最新请求收尾，否则 loading 提前关掉
//     }
//   }
//
// 为什么不复用 AbortController：
//   本项目的后端在 127.0.0.1，请求生命周期通常 1–20ms，取消带来的收益远小于
//   每个调用点都要管理控制器、并在卸载时 abort 的复杂度。序号守卫只丢弃结果、
//   不中断传输，代码量和出错面都小得多。真正需要「用户主动中断」的流式请求
//   （aiChat 的 SSE）仍然用 AbortController，两者不冲突。
//
// 已有采用点（迁移后请保持写法一致，别再各写一份 `let xxxSeq = 0`）：
//   views/AlbumView.vue（photosSeq）、components/tables/AiGridPreview.vue（_loadSeq）、
//   components/import-export/ExportAlbumIndex.vue（rebuildSeq）、ImportExcel.vue（parseSeq）

export function useSeq() {
  // 用闭包普通变量而非 ref：序号不参与渲染，做成响应式只会带来无谓的依赖收集
  let n = 0
  return {
    // 取号（从 1 开始，0 可安全表示「尚未发起」）
    take() {
      return ++n
    },
    // 读当前号但不递增：用于「同一批请求的第二阶段」——
    // 例如先选文件取号，读盘完成后再解析，两步属于同一次操作，不该各自取号。
    current() {
      return n
    },
    // 该号是否仍是最新一次
    isLatest(my) {
      return my === n
    },
    // 主动作废所有在途请求（如组件卸载、筛选被清空）
    invalidate() {
      n++
    },
  }
}
