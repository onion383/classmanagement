// 标题栏「全局搜索」的静态索引数据。
// 页面清单与侧栏导航同形（Sidebar 直接引入，模板不动、视觉不变），
// 设置分区/设置项从设置页搬出，两处共用一份，避免各存一份导致名称漂移。
// 后续阶段（后端数据搜索、拼音匹配）也在本文件扩展，不改动 App.vue 的渲染与交互。
import {
  Users, Network, CalendarDays, Coins, Armchair, Broom, BedDouble, Medal,
  Images, PartyPopper, Bot, Settings, Info, Home,
} from '@lucide/vue'

// 页面清单：结构与 Sidebar 的导航分组完全一致
export const PAGE_GROUPS = [
  {
    title: '概览',
    items: [
      { to: '/',              label: '班级概览', emoji: '🏠', color: '#10b981', lucide: Home, py: 'bjgl' },
    ],
  },
  {
    title: '基础信息',
    items: [
      { to: '/students',      label: '学生管理', emoji: '📚', color: '#60a5fa', lucide: Users, py: 'xsgl' },
      { to: '/group-manage',  label: '分组管理', emoji: '👥', color: '#818cf8', lucide: Network, py: 'fzgl' },
      { to: '/schedule',      label: '课程表',   emoji: '📅', color: '#a3e635', lucide: CalendarDays, py: 'kcb' },
    ],
  },
  {
    title: '核心管理',
    items: [
      { to: '/fee',           label: '班费管理', emoji: '💰', color: '#fbbf24', lucide: Coins, py: 'bfgl' },
      { to: '/seats',         label: '座位管理', emoji: '🪑', color: '#fb923c', lucide: Armchair, py: 'zwgl' },
      { to: '/duty',          label: '卫生值日', emoji: '🧹', color: '#34d399', lucide: Broom, py: 'wszr' },
      { to: '/leaves',        label: '请假管理', emoji: '🛌', color: '#a78bfa', lucide: BedDouble, py: 'qjgl' },
      { to: '/scores',        label: '加分管理', emoji: '🏅', color: '#f87171', lucide: Medal, py: 'jfgl' },
    ],
  },
  {
    title: '活动中心',
    items: [
      { to: '/album',         label: '学生相册', emoji: '📷', color: '#f472b6', lucide: Images, py: 'xsxc' },
      { to: '/activities',    label: '班级活动', emoji: '🎉', color: '#fb7185', lucide: PartyPopper, py: 'bjhd' },
    ],
  },
  {
    title: '系统管理',
    items: [
      { to: '/ai-assistant',  label: 'AI 助手',  emoji: '🤖', color: '#38bdf8', lucide: Bot, py: 'aizs' },
      { to: '/settings',      label: '系统设置', emoji: '⚙️', color: '#94a3b8', lucide: Settings, py: 'xtsz' },
      { to: '/about',         label: '关于软件', emoji: 'ℹ️', color: '#94a3b8', lucide: Info, py: 'gyrj' },
    ],
  },
]

// 摊平后的页面清单，供搜索使用
export const PAGES = PAGE_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.title })))

// 设置页的分区标题（key 同时是页面内的锚点 id：settings-section-<key>）
export const SETTINGS_SECTIONS = [
  { key: 'account',  label: '账号管理',       py: 'zhgl' },
  { key: 'semester', label: '学期设置',       py: 'xqsz' },
  { key: 'undo',     label: '撤销记录',       py: 'cxjl' },
  { key: 'theme',    label: '主题设置',       py: 'ztsz' },
  { key: 'toolbox',  label: '工具箱设置',     py: 'gjxsz' },
  { key: 'widget',   label: '桌面小组件设置', py: 'zmxjjsz' },
  { key: 'perf',     label: '性能',           py: 'xn' },
  { key: 'savepath', label: '保存路径设置',   py: 'bcljsz' },
  { key: 'datadir',  label: '数据目录设置',   py: 'sjmlsz' },
  { key: 'danger',   label: '危险操作',       py: 'wxcz' },
]

// 分区内的具体设置项（py 为标签拼音首字母，让单个字母也能命中）
export const SETTINGS_ITEMS = [
  { label: '选择学期',                 section: 'semester', py: 'xzq' },
  { label: '学期开始时间',             section: 'semester', py: 'xqkssj' },
  { label: '学期结束时间',             section: 'semester', py: 'xqjssj' },
  { label: '本学期时长',               section: 'semester', py: 'bxqsc' },
  { label: '主题',                     section: 'theme',    py: 'zt' },
  { label: '图标样式',                 section: 'theme',    py: 'tbys' },
  { label: '顶栏配色',                 section: 'theme',    py: 'dlps' },
  { label: '提示合并',                 section: 'theme',    py: 'tshb' },
  { label: '动画效果',                 section: 'theme',    py: 'dhxg' },
  { label: '背景遮罩层（有自定义背景图时）', section: 'theme', py: 'bjzzc' },
  { label: '组件透明玻璃层',           section: 'theme',    py: 'zjtmlbl' },
  { label: '是否启用工具箱',           section: 'toolbox',  py: 'sfqygjx' },
  { label: '本次启用工具箱',           section: 'toolbox',  py: 'bcqygjx' },
  { label: '新U盘插入自动打开',        section: 'toolbox',  py: 'xupcrzddk' },
  { label: '启用桌面小组件',           section: 'widget',   py: 'qyzmxjjs' },
  { label: '注释截屏保存位置',         section: 'savepath', py: 'zsjpbcwz' },
  { label: '一键截屏保存位置',         section: 'savepath', py: 'yjjpbcwz' },
  { label: '数据库目录',               section: 'datadir',  py: 'sjkml' },
  { label: '相册缩略图缓存',           section: 'datadir',  py: 'xcsltch' },
  { label: '数据库加密',               section: 'datadir',  py: 'sjkjm' },
]

// 关键词匹配：文本子串 + 手写首字母 + 拼音（pinyin-match）。
// pinyinMatch：pinyin-match 的 match 函数（懒加载前为 null，此时退化为纯文本/首字母匹配）。
// 传入后可命中汉语文本的拼音，如「zs」「zhangsan」→「张三」（支持首字母缩写、全拼、多音字）。
export function matchKeywords(text, keywords, q, pinyinMatch) {
  if (!q) return true
  const lower = text.toLowerCase()
  if (lower.includes(q)) return true
  if (keywords.some(k => k && String(k).toLowerCase().includes(q))) return true
  if (pinyinMatch) {
    try { if (pinyinMatch(lower, q)) return true } catch (_) {}
  }
  return false
}

// ==================== 远程数据源（第二阶段） ====================
// 后端 GET /api/search?q= 对业务表做 LIKE 匹配并分组返回；这里声明接口地址，
// 由 App.vue 在输入时 debounce 拉取，回填 remoteResults 并入搜索结果。
export const REMOTE_SOURCE = { key: 'remote', endpoint: '/api/search' }

// 后端分组结果 → 搜索结果项（结构与本地项一致：{ id, kind, group, label, route, query, emoji }）。
// query 携带 focus，供目标页「按记录定位」使用。
export function buildRemoteResults(groups) {
  const out = []
  for (const g of groups || []) {
    for (const it of g.items || []) {
      out.push({
        id: `remote:${g.table}:${it.id}`,
        kind: 'remote',
        group: g.group || '数据',
        label: it.label || '',
        sub: it.sub || '',
        emoji: g.emoji || '🔎',
        route: it.route || g.route,
        query: it.focus != null ? { focus: String(it.focus) } : undefined,
      })
    }
  }
  return out
}
