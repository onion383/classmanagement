// AI 提问里内置「其他」补充项的哨兵值与标签：选中它即展开输入框，
// 用户填写的自由文本随答案一起回传给 AI（单选/多选均支持）
export const ASK_OTHER_KEY = '__other__'
export const ASK_OTHER_LABEL = '其他'

// 可写表的执行端点（与后端 propose_write 白名单保持一致）
export const EXEC = {
  students: { url: '/api/students', undoKey: 'students' },
  fee_records: { url: '/api/fee-records', undoKey: 'fee_records' },
  activities: { url: '/api/activities', undoKey: 'activities' },
  countdowns: { url: '/api/countdowns', undoKey: 'countdowns' },
  leave_records: { url: '/api/leaves', undoKey: 'leave_records' },
  score_records: { url: '/api/scores', undoKey: 'score_records' },
  cadres: { url: '/api/cadres', undoKey: 'cadres' },
}
export const LABELS = {
  students: '学生', fee_records: '班费记录', activities: '班级活动', countdowns: '倒计时',
  leave_records: '请假记录', score_records: '加分扣分记录', cadres: '班干部职务',
  schedule: '当前课表', master_schedule: '主课表模板',
  seat_layout: '当前座位表', seat_template: '座位模板', seat_weight: '座位权重表',
  duty_settings: '值日设置', duty_layout: '当前值日表', duty_template: '值日模板', duty_weight: '值日权重表',
}
// 整块写入（非行式表）对应的撤销分组 key，与各业务页 Ctrl+Z 的分组保持一致
export const DOC_UNDO_KEY = {
  schedule: '课程表', master_schedule: '课程表',
  seat_layout: '座位表', seat_template: '座位表', seat_weight: '座位表',
  duty_settings: '值日表', duty_layout: '值日表', duty_template: '值日表', duty_weight: '值日表',
}
// 前端设置项的展示名（AI 的 propose_frontend_setting 提案用，供预览与提示文案）
export const FRONT_LABELS = {
  theme: '主题', mode: '日夜模式', iconStyle: '图标样式', topbarColor: '标题栏配色',
  animations: '动画效果', bgMaskOpacity: '背景遮罩不透明度', glassOpacity: '毛玻璃不透明度',
  mergeNotifications: '提示合并',
}

// AI 表 key → 业务页路由（与后端 routes/search.js 的 route 保持一致），
// 供「改动明细 → 跳转到该表」使用。只有目标页实现了 useRowFocus（[data-row-id] + ?focus=）
// 的行状表才带 focus: true；网格表（课表/座位/值日）与班干部暂无行级定位，只做页面跳转。
// focusPrefix：把行 id 拼成目标页 useRowFocus 需要的 focus 值（如倒计时页要 'countdown:<id>'）。
export const TABLE_ROUTE = {
  students: { path: '/students', focus: true },
  leave_records: { path: '/leaves', focus: true },
  score_records: { path: '/scores', focus: true },
  fee_records: { path: '/fee', focus: true },
  activities: { path: '/activities', focus: true },
  countdowns: { path: '/activities', focus: true, focusPrefix: 'countdown:' },
  cadres: { path: '/group-manage' },
  schedule: { path: '/schedule' },
  master_schedule: { path: '/schedule' },
  seat_layout: { path: '/seats' }, seat_template: { path: '/seats' }, seat_weight: { path: '/seats' },
  duty_settings: { path: '/duty' }, duty_layout: { path: '/duty' }, duty_template: { path: '/duty' }, duty_weight: { path: '/duty' },
}

// 生成「跳转到该表」的路由目标：{ path, query }；表无对应页面时返回 null。
// id 为空或该表不支持行级定位时只返回 { path }（跳到页面、不定位到行）。
export function tableJumpTarget(table, id) {
  const r = TABLE_ROUTE[table]
  if (!r) return null
  if (r.focus && id != null && id !== '') {
    return { path: r.path, query: { focus: (r.focusPrefix || '') + id } }
  }
  return { path: r.path }
}

// AI 写入权限挡位（localStorage 持久化的用户偏好）：
// 'approve' 全部审批（默认）：每次写入提案都要用户点确认才执行；
// 'full'    完全权限：写入提案不再弹确认，流结束后直接执行。
export const AI_PERMISSION_KEY = 'ai_permission_mode'
export const AI_PERMISSION_FULL = 'full'

// 联网搜索开关（localStorage 持久化）：仅 DeepSeek 模式下可用，默认开启。
// 存 '0' 表示关闭，其它值（含未设置）均视为开启。
export const AI_WEB_SEARCH_KEY = 'ai_web_search_enabled'
