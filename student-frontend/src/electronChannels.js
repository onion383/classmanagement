// IPC 通道名单一来源：直接读取 electron/ipc-channels.json（与 preload 白名单同一份文件）。
// 渲染层所有 window.electron.invoke / send / on 都用本模块导出的常量，避免通道名字符串
// 在 views / subwindows 里各写一份、与 preload 白名单失配。
//
// 常量命名：通道名中的非字母数字统一换成下划线并转大写
//   'save-file'          -> INVOKE.SAVE_FILE
//   'widget-drag-start'  -> SEND.WIDGET_DRAG_START
//   'from-main'          -> RECEIVE.FROM_MAIN
import channels from '../../electron/ipc-channels.json'

const toKey = (name) => name.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()
const build = (list) => Object.fromEntries(list.map((name) => [toKey(name), name]))

export const SEND = build(channels.send)
export const INVOKE = build(channels.invoke)
export const RECEIVE = build(channels.receive)

export default { SEND, INVOKE, RECEIVE }
