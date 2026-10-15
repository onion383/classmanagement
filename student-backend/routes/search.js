const express = require('express')
const router = express.Router()
const { db } = require('../db')

// 标题栏「全局搜索」的服务端数据源：对若干业务表的文本列做 LIKE 匹配，分组返回。
// 表名/列名全部来自本文件的白名单常量（不接受请求参数拼接），杜绝注入。
// 单组最多返回 PER_GROUP 条，避免一次搜索把整库拉给前端。

const PER_GROUP = 8

// 拼音匹配（懒加载）：仅当查询为纯字母（如 zs / zhangsan）时启用。
// 首次真正需要时才 require，避免拖慢启动；require 失败则退化为纯 LIKE 匹配。
let pinyinMatch = null
let pinyinLoaded = false
function getPinyinMatch() {
  if (!pinyinLoaded) {
    pinyinLoaded = true
    try { pinyinMatch = require('pinyin-match').match } catch (_) { pinyinMatch = null }
  }
  return pinyinMatch
}

// 拼音补充匹配的候选行扫描上限：SQLite 无法直接按拼音匹配，只能取回候选行在 JS 中过滤。
// 本地班级数据量小，1000 行足够且开销可控。
const SCAN_LIMIT = 1000

// 每个数据源：table=表名；match=参与 LIKE 匹配的文本列（白名单）；
// label/sub 从命中行派生展示文案；focus 生成跳转页的定位 id。
const SOURCES = [
  {
    table: 'students',
    group: '学生',
    emoji: '📚',
    route: '/students',
    match: ['姓名', '学号', '年级', '班级', '家长联系电话', '学生联系电话', '备注'],
    label: r => r['姓名'] || r['学号'] || ('学生#' + r.id),
    sub: r => [r['年级'], r['班级'], r['学号']].filter(Boolean).join(' · '),
    focus: r => String(r.id),
  },
  {
    table: 'leave_records',
    group: '请假记录',
    emoji: '🛌',
    route: '/leaves',
    match: ['姓名', '类型', '开始时间', '结束时间', '家长联系电话', '学生联系电话', '状态', '返校时间', '备注'],
    label: r => [r['姓名'], r['类型']].filter(Boolean).join(' ') || ('请假#' + r.id),
    sub: r => [r['开始时间'], r['结束时间']].filter(Boolean).join(' ~ '),
    focus: r => String(r.id),
  },
  {
    table: 'score_records',
    group: '加扣分记录',
    emoji: '🏅',
    route: '/scores',
    match: ['姓名', '学号', '类型', '项目', '原因', '加分时间', 'group_name', 'source'],
    label: r => [r['姓名'], r['项目'] || r['类型']].filter(Boolean).join(' · ') || ('记录#' + r.id),
    sub: r => [r['分值'], r['原因']].filter(v => v !== null && v !== undefined && v !== '').join(' · '),
    focus: r => String(r.id),
  },
  {
    table: 'fee_records',
    group: '班费记录',
    emoji: '💰',
    route: '/fee',
    match: ['收支编码', '收支类型', '收支时间', '备注'],
    label: r => r['收支编码'] || r['收支类型'] || ('记录#' + r.id),
    sub: r => [r['收支金额'], r['收支时间'], r['备注']].filter(v => v !== null && v !== undefined && v !== '').join(' · '),
    focus: r => String(r.id),
  },
  {
    table: 'activities',
    group: '班级活动',
    emoji: '🎉',
    route: '/activities',
    match: ['时间', '主题', '地点', '简介', '参与人员'],
    label: r => r['主题'] || ('活动#' + r.id),
    sub: r => [r['时间'], r['地点']].filter(Boolean).join(' · '),
    focus: r => String(r.id),
  },
  {
    table: 'countdowns',
    group: '倒计时',
    emoji: '⏳',
    route: '/activities',
    match: ['名称', '截止日'],
    label: r => r['名称'] || ('倒计时#' + r.id),
    sub: r => r['截止日'] || '',
    // 倒计时挂在「班级活动」页的倒计时页签：focus 加前缀让该页先切页签再定位
    focus: r => 'countdown:' + r.id,
  },
  {
    table: 'groups',
    group: '分组',
    emoji: '👥',
    route: '/group-manage',
    match: ['name'],
    label: r => r['name'] || ('分组#' + r.id),
    sub: () => '',
    // 组可能不在当前选中维度下：focus 带上 dimension_id，目标页先切维度再定位
    focus: r => `dim:${r.dimension_id}:${r.id}`,
  },
  {
    table: 'albums',
    group: '相册',
    emoji: '📷',
    route: '/album',
    match: ['name'],
    label: r => r['name'] || ('相册#' + r.id),
    sub: () => '',
    focus: r => String(r.id),
  },
]

// 课程表：内容不是按行存储，而是存在 cells 这一列的二维 JSON 里
// （cells[节次索引][周几索引] = { course, ... }），无法用 LIKE + 行 id，
// 故单独解析后分组返回；focus 形如 `s:节次:周几`（s=实行课表，m=一般课表）。
const SCHEDULE_TABLES = [
  { table: 'schedule', group: '课程 · 实行课表', anchor: 's' },
  { table: 'master_schedule', group: '课程 · 一般课表', anchor: 'm' },
]
const DEFAULT_DAYS = ['周一', '周二', '周三', '周四', '周五']

// LIKE 元字符转义：把用户输入里的 % _ \ 当作普通字符，避免被当成通配符。
function likePattern(q) {
  return '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%'
}

// 单列拼音匹配：值转拼音后判断是否命中查询（支持首字母缩写与全拼）。空值/异常不命中。
function matchPinyin(fn, value, q) {
  if (value === null || value === undefined || value === '') return false
  try { return !!fn(String(value), q) } catch (_) { return false }
}

// 名称匹配（用于非 SQL 的课程表数据）：文本子串（忽略大小写）或拼音。
function nameHit(name, q, pm) {
  if (name.toLowerCase().includes(q)) return true
  return pm ? matchPinyin(pm, name, q) : false
}

router.get('/', (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) return res.json({ groups: [] })
    const pattern = likePattern(q)
    // 纯字母查询才启用拼音匹配（zs / zhangsan 这类）；中文/数字查询走原有 LIKE
    const pm = /^[a-z]+$/i.test(q) ? getPinyinMatch() : null
    const groups = []
    for (const src of SOURCES) {
      // 列名来自本文件常量白名单，直接内联到 SQL；每个列一个占位符
      const where = src.match.map(c => `"${c}" LIKE ? ESCAPE '\\'`).join(' OR ')
      let rows = []
      try {
        rows = db.prepare(
          `SELECT * FROM ${src.table} WHERE ${where} ORDER BY id LIMIT ?`
        ).all(...src.match.map(() => pattern), SCAN_LIMIT)
      } catch (_) {
        rows = [] // 单表异常（如存量库缺列）不影响其它分组
      }
      // 拼音补充：把 LIKE 未命中的行按拼音再筛一遍，与命中行合并（按 id 去重）
      if (pm) {
        try {
          const seen = new Set(rows.map(r => r.id))
          const all = db.prepare(`SELECT * FROM ${src.table} ORDER BY id LIMIT ?`).all(SCAN_LIMIT)
          for (const r of all) {
            if (seen.has(r.id)) continue
            if (src.match.some(c => matchPinyin(pm, r[c], q))) { rows.push(r); seen.add(r.id) }
          }
        } catch (_) {}
      }
      if (!rows.length) continue
      groups.push({
        table: src.table,
        group: src.group,
        emoji: src.emoji,
        route: src.route,
        items: rows.slice(0, PER_GROUP).map(r => ({
          id: r.id,
          label: src.label(r),
          sub: src.sub(r),
          focus: src.focus(r),
        })),
      })
    }
    // 课程表（cells 是二维 JSON，不走 SQL LIKE，单独解析）
    for (const sc of SCHEDULE_TABLES) {
      let row = null
      try { row = db.prepare(`SELECT cells, settings FROM ${sc.table} WHERE id = 1`).get() } catch (_) { continue }
      if (!row) continue
      let cells = []
      let settings = {}
      try { cells = JSON.parse(row.cells || '[]'); settings = JSON.parse(row.settings || '{}') } catch (_) { continue }
      if (!Array.isArray(cells) || !cells.length) continue
      const days = Array.isArray(settings.days) && settings.days.length ? settings.days : DEFAULT_DAYS
      const items = []
      for (let li = 0; li < cells.length && items.length < PER_GROUP; li++) {
        const line = cells[li]
        if (!Array.isArray(line)) continue
        for (let di = 0; di < line.length && items.length < PER_GROUP; di++) {
          const cell = line[di]
          const name = cell && typeof cell === 'object' && cell.course != null ? String(cell.course).trim() : ''
          if (!name || !nameHit(name, q, pm)) continue
          items.push({
            id: li + ':' + di,
            label: name,
            sub: (days[di] || '第' + (di + 1) + '列') + ' 第' + (li + 1) + '节',
            focus: sc.anchor + ':' + li + ':' + di,
          })
        }
      }
      if (items.length) groups.push({ table: sc.table, group: sc.group, emoji: '📖', route: '/schedule', items })
    }
    res.json({ groups })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
