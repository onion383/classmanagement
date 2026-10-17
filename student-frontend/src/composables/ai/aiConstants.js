// 会话列表折叠状态记忆键
export const CONV_COLLAPSE_KEY = 'app-ai-conv-collapsed'

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
