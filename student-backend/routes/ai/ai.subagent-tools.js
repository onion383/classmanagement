// =========================================================================
// ai.subagent-tools.js —— 子助手「只读工具」白名单（唯一来源）
//
// run_subagent 启动的子助手必须在机制上「只能查、不能写」：
//   · ai.llm.js 用这份名单决定下发给子模型的工具清单；
//   · tools.subagent.js 用同一份名单在执行前校验模型返回的 tool_calls。
// 两者共用同一来源，避免「清单收窄了但执行侧没拦」这类漂移。
//
// 这里刻意不 require 任何业务模块（dbManager / ai.llm），保证可以被单测直接加载。
// =========================================================================

const SUBAGENT_TOOL_NAMES = new Set([
  'query', 'aggregate', 'resolve_student', 'search_all',
  'run_checks', 'run_conflict_checks', 'score_weights',
  'describe_table', 'teaching_week', 'get_time',
])

function isSubagentToolAllowed(name) {
  return typeof name === 'string' && SUBAGENT_TOOL_NAMES.has(name)
}

module.exports = { SUBAGENT_TOOL_NAMES, isSubagentToolAllowed }
