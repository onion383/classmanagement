// ===== AiComposer：技能候选菜单的「/触发词」解析 =====
// 纯代码搬运自 AiComposer.vue 的 methods，未改写逻辑；只依赖入参，无组件状态。
// 解析输入框「光标前」的技能触发词：取光标前最后一个「/」，其后到光标之间不含空白即算触发词。
// 「/」出现在任意位置都能触发（不再要求行首或空格后）；全角「／」按半角处理（两串等长，下标对齐）。
// 仅排除紧挨着的「//」「:/」这类网址/路径写法，避免误弹。
export function _slashToken(value, caret) {
  const before = String(value || '').slice(0, caret).replace(/／/g, '/')
  const slash = before.lastIndexOf('/')
  if (slash < 0) return null
  if (slash > 0 && /[/:]/.test(before[slash - 1])) return null
  const query = before.slice(slash + 1)
  if (/\s/.test(query)) return null
  return { start: slash, query }
}
