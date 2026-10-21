// 标题栏「全局搜索」专用的索引数据与匹配逻辑。
// 从 searchIndex.js 分离出来：Sidebar 只需要 PAGE_GROUPS（页面清单），
// 而设置项、匹配函数、远程结果拼装只有搜索弹窗用到。原先它们同处一个文件、
// 被 Sidebar 静态引用，整份文件都会被算进入口 chunk；分离后这些内容随
// SearchDialog 的懒加载 chunk 按需下载，入口不再携带。
import { PAGE_GROUPS } from './searchIndex.js'

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
  { label: '桌面组件关闭最底层',       section: 'widget',   py: 'zmzjgbzdc' },
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
// 由 SearchDialog 在输入时 debounce 拉取，回填 remoteResults 并入搜索结果。
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
