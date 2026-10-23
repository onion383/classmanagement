// 侧栏导航的页面清单（Sidebar 静态引入，模板不动、视觉不变）。
// 注意：搜索弹窗专用的索引数据与匹配逻辑已拆到 searchData.js ——
// 本文件被 Sidebar 静态引用、内容会进入首屏入口 chunk，这里只保留侧栏真正需要的清单。
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
      { to: '/album',         label: '班级相册', emoji: '📷', color: '#f472b6', lucide: Images, py: 'bjxc' },
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

