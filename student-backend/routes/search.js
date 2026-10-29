const express = require('express')
const router = express.Router()
const { db } = require('../db')
// 值日数据「按模式拆分」的唯一实现（此前本文件自己抄了一份 toModeMap）
const { unpackMode } = require('../services/dutyMode')

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
    // 请假记录对应时间轴上的「离开校园」节点（无开始时间则退回「已申请」）：focus 加 tl: 前缀，
    // 目标页据此定位到时间轴那一项。时间轴渲染了全部记录，比分页表格更可靠地命中目标。
    focus: r => 'tl:' + r.id + (r['开始时间'] ? '-leave' : '-apply'),
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

// 座位表：seats 是二维 JSON（seats[行][真实列] = 学生 id 或姓名）。focus 形如 `seat:行:真实列`
// （真实列不含走廊列），由目标页按自身几何换算成显示列后定位到对应单元格。
const SEAT_TABLES = [
  { table: 'seat_layout', group: '座位 · 当前座位', anchor: 'seat' },
  { table: 'seat_template', group: '座位 · 座位模板', anchor: 'seatt' },
]

// 值日表：cells 是 {项目:{星期:[人名]}}，页面按项目人数把每个项目展开成多行；
// items/cells 有日常(daily)/大扫除(big) 两套（可能按模式分键打包），需按模式解包。
// focus 形如 `duty:<mode>:行:列`（dutyt 为值日模板）。
const DUTY_TABLES = [
  { table: 'duty_layout', group: '值日 · 当前值日', anchor: 'duty' },
  { table: 'duty_template', group: '值日 · 值日模板', anchor: 'dutyt' },
]

// 模式解包复用 services/dutyMode（见文件顶部 import）：顶层键全是 daily/big 视为新模式结构，
// 否则整块归入日常。这段判断与 duty.js / ai.dataRoutes.js / AI 工具执行器必须完全一致。

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

    // 座位表（cells 存学生 id 或姓名，需 id→姓名映射后再按姓名匹配；focus 用页面显示列）
    let idNameMap = null
    const nameOfSeat = (v) => {
      if (v === null || v === undefined || v === '') return ''
      if (typeof v === 'number') {
        if (!idNameMap) {
          idNameMap = {}
          try { for (const s of db.prepare('SELECT id, 姓名 FROM students').all()) idNameMap[s.id] = s['姓名'] || '' } catch (_) {}
        }
        return idNameMap[v] || ''
      }
      return String(v)
    }
    for (const st of SEAT_TABLES) {
      let row = null
      try { row = db.prepare(`SELECT seats FROM ${st.table} WHERE id = 1`).get() } catch (_) { continue }
      if (!row) continue
      let seats = []
      try { seats = JSON.parse(row.seats || '[]') } catch (_) { continue }
      if (!Array.isArray(seats) || !seats.length) continue
      const items = []
      for (let r = 0; r < seats.length && items.length < PER_GROUP; r++) {
        const line = Array.isArray(seats[r]) ? seats[r] : []
        for (let c = 0; c < line.length && items.length < PER_GROUP; c++) {
          const name = nameOfSeat(line[c]).trim()
          if (!name || !nameHit(name, q, pm)) continue
          // focus 用真实列（不含走廊列），目标页据此换算显示列
          items.push({ id: r + ':' + c, label: name, sub: `第${r + 1}行 · 列${c + 1}`, focus: st.anchor + ':' + r + ':' + c })
        }
      }
      if (items.length) groups.push({ table: st.table, group: st.group, emoji: '🪑', route: '/seats', items })
    }

    // 值日表（项目×星期；行按项目人数展开，与页面 buildGridRows 的行号一致）
    let dutyDays = DEFAULT_DAYS, dutyItemsField = null
    try {
      const g = db.prepare('SELECT days, items FROM duty_settings WHERE id = 1').get()
      if (g) {
        try { const d = JSON.parse(g.days || '[]'); if (Array.isArray(d) && d.length) dutyDays = d } catch (_) {}
        dutyItemsField = g.items
      }
    } catch (_) {}
    for (const dt of DUTY_TABLES) {
      let row = null
      try { row = db.prepare(`SELECT cells FROM ${dt.table} WHERE id = 1`).get() } catch (_) { continue }
      if (!row) continue
      for (const mode of ['daily', 'big']) {
        const cells = unpackMode(row.cells, mode)
        const items = dutyItemsField ? unpackMode(dutyItemsField, mode, []) : []
        if (!Array.isArray(items) || !items.length) continue
        if (!cells || !Object.keys(cells).length) continue
        const out = []
        let rowIdx = 0
        for (const it of items) {
          const n = Math.max(1, Number(it.count) || 1)
          for (let k = 0; k < n; k++) {
            if (out.length >= PER_GROUP) break
            const byDay = cells[it.name] || {}
            for (let di = 0; di < dutyDays.length && out.length < PER_GROUP; di++) {
              const raw = byDay[dutyDays[di]]
              const name = Array.isArray(raw) ? String(raw[k] || '').trim() : String(raw || '').trim()
              if (!name || !nameHit(name, q, pm)) continue
              out.push({ id: mode + ':' + rowIdx + ':' + di, label: name, sub: `${it.name} · ${dutyDays[di]}`, focus: dt.anchor + ':' + mode + ':' + rowIdx + ':' + di })
            }
            rowIdx++
          }
          if (out.length >= PER_GROUP) break
        }
        if (out.length) groups.push({ table: dt.table, group: dt.group + (mode === 'big' ? '（大扫除）' : ''), emoji: '🧹', route: '/duty', items: out })
      }
    }

    res.json({ groups })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
