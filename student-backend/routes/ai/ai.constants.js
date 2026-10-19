// 可「读」的表及其中文说明（模型据此生成查询意图）
const READ_TABLES = {
  students: '学生列表（学号/姓名/年级/班级/年龄/家长联系电话/学生联系电话/备注）',
  leave_records: '请假记录（姓名/类型/开始时间/结束时间/状态/返校时间/家长联系电话/备注）',
  fee_records: '班费收支（收支编码/收支类型/收支金额/收支时间/备注/收据）',
  score_records: '加分扣分记录（姓名/类型/项目/分值/原因/加分时间/group_name/成员数）',
  activities: '班级活动（时间/主题/地点/简介/参与人员）',
  countdowns: '倒计时（名称/截止日/包含这一天）',
  groups: '分组（dimension_id/name/gender）',
  group_members: '组成员（group_id/member_name/remark）',
  group_dimensions: '分组维度（name/组长称呼/每组人数/小组组数）',
  cadres: '班干部职务（name 职务名/parent_id 上级职务id（0=顶级）/max_count 可任职人数/sort_order 排序）',
  cadre_members: '班干部任职（cadre_id 职务id/student_id 学生id/student_name 姓名/sort_order 排序）',
  semesters: '学期列表（name 学期名/start_date 开始日/end_date 结束日/is_current 是否当前学期（1 是））',
  widget_settings: '系统设置（toolbox_enabled 是否启用桌面悬浮小组件（1 启用/0 关闭）/note_save_path 随手记保存目录/screenshot_save_path 截图保存目录/desktop_apps JSON 数组：桌面软件列表，元素形如 {id,name,path,icon}/class_info JSON 对象：首页班级信息 {name 班名,motto 班级口号,mottoStyle 班风,xuefeng 学风}）',
  master_schedule: '主课表模板（cells 为 JSON 课程数据、settings 为 JSON 配置）',
  schedule: '当前课表（cells 为 JSON 课程数据、settings 为 JSON 配置）',
  schedule_history: '历史课表快照（week_start 周一起始日/cells JSON 课程数据/settings JSON/created_at 时间）',
  seat_layout: '当前座位表（mode 排布模式/rows 排数/cols 列数/seats JSON 座位数据/settings JSON 配置）',
  seat_template: '座位模板（mode/rows/cols/seats JSON/settings JSON）',
  seat_draft: '座位排表草稿（mode/rows/cols/seats JSON/conditions JSON 本次排表条件/saved_at 保存时间）',
  seat_weight: '座位权重表（mode/rows/cols/weights JSON 权重矩阵/settings JSON）',
  seat_history: '座位历史快照（week_start 周一起始日/snap_date 快照日期/mode/rows/cols/seats JSON 座位数据）',
  duty_settings: '值日设置（days JSON 星期列表/items JSON 值日项目：名称+辛苦度+需要人数）',
  duty_layout: '当前值日表（cells JSON：值日项目→星期→值日学生名单/settings JSON）',
  duty_template: '值日模板（cells JSON/settings JSON）',
  duty_weight: '值日权重表（weights JSON：值日项目→星期→权重/settings JSON）',
  duty_draft: '值日排表草稿（cells JSON/settings JSON/conditions JSON 本次条件/saved_at 保存时间）',
  duty_history: '值日历史快照（week_start 周一起始日/snap_date 快照日期/mode daily 或 big/cells JSON 值日数据）',
  albums: '班级相册（name 相册名/folder_path 文件夹路径/sort_order 排序）',
  album_photos: '相册照片（album_id 所属相册/file_name 文件名/photo_date 拍摄日期/file_size 大小）',
  undo_history: '操作撤销历史（key 资源标识/type 类型/label 描述/dir 1=可撤销 0=已撤销/ts 时间）',
};

// 可「写」（需用户确认）的表
// 仅收录：既有 REST 接口支持「按 id 增/改/删」、且撤销白名单（undo.js ALLOWED_TABLES）已放行的行式表
const WRITE_TABLES = {
  students: '学生',
  fee_records: '班费记录',
  activities: '班级活动',
  countdowns: '倒计时',
  leave_records: '请假记录',
  score_records: '加分扣分记录',
  cadres: '班干部职务',
};

// 可「整块写入」（需用户确认）的「非行式」表：
// 这些表的数据是「整块 JSON 存在单列里」（座位 seats / 权重 weights / 课表 cells…），
// 既不是按 id 的一行条记录，也没有行式增删改接口，只能按 id 覆盖指定列。
// 仅放开这几张表，且写入时只允许真实列（不含 id）。
const JSON_WRITE_TABLES = {
  schedule: '当前课表',
  master_schedule: '主课表模板',
  seat_layout: '当前座位表',
  seat_template: '座位模板',
  seat_weight: '座位权重表',
  duty_settings: '值日设置',
  duty_layout: '当前值日表',
  duty_template: '值日模板',
  duty_weight: '值日权重表',
  widget_settings: '系统设置',
};

// 整块写入对应的撤销分组 key（与各业务页 Ctrl+Z 的分组保持一致，便于在该页撤销）
const DOC_UNDO_KEY = {
  schedule: '课程表', master_schedule: '课程表',
  seat_layout: '座位表', seat_template: '座位表', seat_weight: '座位表',
  duty_settings: '值日表', duty_layout: '值日表', duty_template: '值日表', duty_weight: '值日表',
  widget_settings: '系统设置',
};

module.exports = { READ_TABLES, WRITE_TABLES, JSON_WRITE_TABLES, DOC_UNDO_KEY };

