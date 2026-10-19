// ===== AI 工具门面：装配 schema / executors / subagent，并提供统一派发入口 =====
// 只负责 require 装配、runTool 派发与对外导出；
// 具体定义见 tools.schema.js（工具定义）、tools.executors/executors.js（执行逻辑）、tools.subagent.js（子助手）。
//
// 原 tools.js 的内部分节与拆分后的去向（原文保留，便于对照）：
//   ---------------- 工具定义 ----------------
//       → tools.schema.js
//   ===================== 通用小工具（日期 / JSON / 姓名） =====================
//       → tools.executors/executors.common.js
//   ===== export_image 工具：课表/座位表/值日表 → 排布图规格（前端渲染成 PNG） =====
//       → tools.executors/executors.image.js
const dbManager = require('../../../dbManager/dbManager');
const schema = require('./tools.schema');
const exec = require('./tools.executors/executors');
const { subagentTool, runSubagent } = require('./tools.subagent');

const {
  runQuery, runAggregate, runResolveStudent, runListChanges, runSearchAll, runChecks,
  runConflictChecks, runScoreWeights, buildExportImage, runDescribeTable, runSnapshotCreate,
  runSnapshotList, runSnapshotRestoreProposal, runDeleteImpact, runTeachingWeek, runShowRecord,
  runShowChart, currentTimeInfo, runWebSearch, runUndoChange, normalizeProposal,
  normalizeBatchProposal, normalizeBatchDelete, normalizeJsonProposal, normalizeFrontProposal,
  runProposeSkill, normalizeBatchUpdate, normalizeBatchOps, normalizeAsk, normalizeExport,
} = exec;

// 统一的工具执行入口：流式 / 非流式共用
//   ctx.blocks 收集 record / chart 数据块；返回 { result, proposal?, ask? }
//   async：OCR 等工具需要等待外部进程，故统一 await 调用
async function runTool(name, args, ctx) {
  switch (name) {
    case 'query':
      return { result: runQuery(args) };
    case 'aggregate':
      return { result: runAggregate(args) };
    case 'resolve_student':
      return { result: runResolveStudent(args) };
    case 'list_changes':
      return { result: runListChanges(args) };
    case 'search_all':
      return { result: runSearchAll(args) };
    case 'run_checks':
      return { result: runChecks(args) };
    case 'run_conflict_checks':
      return { result: runConflictChecks(args) };
    case 'score_weights':
      return { result: runScoreWeights(args) };
    case 'export_image': {
      const e = buildExportImage(args || {});
      if (e.error) return { result: { ok: false, error: e.error } };
      return {
        exportImage: e.spec,
        result: {
          ok: true,
          generated: true,
          targets: e.spec.items.map((it) => it.target),
          count: e.spec.items.length,
          note: '排布图已生成，界面会弹出系统保存对话框由用户选择保存位置；正文用一句话说明导出了什么即可，不要编造保存路径，也不要重复调用本工具',
        },
      };
    }
    case 'propose_write': {
      const p = normalizeProposal(args);
      if (!p.ok) return { result: { ok: false, error: p.error } };
      return {
        proposal: { operation: p.operation, table: p.table, data: p.data, label: p.label, ...(p.diff ? { diff: p.diff } : {}), ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: {
          ok: true, message: p.label, pending_user_confirmation: true,
          ...(p.diff && p.diff.length ? { diff: p.diff } : {}),
        },
      };
    }
    case 'propose_add_many': {
      const b = normalizeBatchProposal(args);
      if (!b.ok) return { result: { ok: false, error: b.error } };
      return {
        proposal: { operation: 'add', batch: true, table: b.table, data: { rows: b.rows }, label: b.label, ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: { ok: true, message: b.label, count: b.count, pending_user_confirmation: true },
      };
    }
    case 'propose_delete_many': {
      const d = normalizeBatchDelete(args);
      if (!d.ok) return { result: { ok: false, error: d.error } };
      return {
        proposal: { operation: 'delete', batch: true, table: d.table, data: { ids: d.ids }, label: d.label, ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: {
          ok: true, message: d.label, count: d.count, pending_user_confirmation: true,
          ...(d.missing.length ? { note: `已忽略不存在的 id：${d.missing.join('、')}` } : {}),
        },
      };
    }
    case 'propose_json_write': {
      const j = normalizeJsonProposal(args);
      if (!j.ok) return { result: { ok: false, error: j.error } };
      return {
        proposal: { kind: 'json', table: j.table, id: j.id, values: j.values, before: j.before, label: j.label, ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: { ok: true, message: j.label, pending_user_confirmation: true },
      };
    }
    case 'propose_frontend_setting': {
      const f = normalizeFrontProposal(args);
      if (!f.ok) return { result: { ok: false, error: f.error } };
      return {
        proposal: { kind: 'front', key: f.key, value: f.value, label: f.label },
        result: { ok: true, message: f.label, pending_user_confirmation: true },
      };
    }
    case 'propose_skill': {
      const s = runProposeSkill(args, ctx);
      if (s.error) return { result: { ok: false, error: s.error } };
      return {
        proposal: s.proposal,
        result: { ok: true, message: s.proposal.label, pending_user_confirmation: true },
      };
    }
    case 'propose_update_many': {
      const u = normalizeBatchUpdate(args || {});
      if (!u.ok) return { result: { ok: false, error: u.error } };
      return {
        proposal: { operation: 'update', batch: true, table: u.table, data: { updates: u.updates }, diffs: u.diffs, label: u.label, ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: { ok: true, message: u.label, count: u.count, diffs: u.diffs, pending_user_confirmation: true },
      };
    }
    case 'propose_batch': {
      const b = normalizeBatchOps(args || {});
      if (!b.ok) return { result: { ok: false, error: b.error } };
      return {
        proposal: { kind: 'batch_ops', ops: b.ops, label: b.label, ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: { ok: true, message: b.label, count: b.count, pending_user_confirmation: true },
      };
    }
    case 'describe_table':
      return { result: runDescribeTable(args || {}) };
    case 'snapshot_create':
      return { result: await runSnapshotCreate(ctx) };
    case 'snapshot_list':
      return { result: runSnapshotList(ctx) };
    case 'snapshot_restore': {
      const r = runSnapshotRestoreProposal(ctx && ctx.slug, args || {});
      if (!r.ok) return { result: { ok: false, error: r.error } };
      return {
        proposal: { kind: 'snapshot_restore', snapshot: r.snapshot, label: r.label, warning: '还原将覆盖当前全部数据（含快照之后的所有改动），且无法撤销' },
        result: { ok: true, message: r.label, pending_user_confirmation: true, warning: '还原会覆盖当前全部数据，请向用户说明清楚后再确认' },
      };
    }
    case 'delete_impact':
      return { result: runDeleteImpact(args || {}) };
    case 'teaching_week':
      return { result: runTeachingWeek(args || {}) };
    case 'run_subagent':
      return { result: await runSubagent(args || {}, ctx) };
    case 'show_record': {
      const sr = runShowRecord(args);
      if (!sr.block) return { result: { ok: false, error: sr.error } };
      ctx.blocks.push(sr.block);
      return { result: { ok: true, displayed: true, table: sr.table, count: sr.count, note: '前端已把完整数据渲染为表格，正文无需再罗列字段值' } };
    }
    case 'show_chart': {
      const sc = runShowChart(args);
      if (!sc.block) return { result: { ok: false, error: sc.error } };
      ctx.blocks.push(sc.block);
      return { result: { ok: true, displayed: true, type: sc.type, count: sc.count, title: sc.title, note: '前端已把图表渲染出来，正文只需一句话概括结论' } };
    }
    case 'get_time':
      return { result: currentTimeInfo() };
    case 'web_search':
      return { result: await runWebSearch(args, ctx) };
    case 'undo_change':
      return { result: await runUndoChange(args) };
    case 'save_memory': {
      const r = dbManager.appendMemory(ctx && ctx.slug, args.items);
      if (r.error) return { result: { ok: false, error: r.error } };
      return { result: { ok: true, saved: true, count: r.count, note: '已写入长期记忆，正文用一句话确认即可' } };
    }
    case 'ask_user': {
      const a = normalizeAsk(args);
      if (!a.ok) return { result: { ok: false, error: a.error } };
      return { ask: a.ask, result: { ok: true, asked: true, count: a.ask.questions.length, questions: a.ask.questions.map((q) => q.question) } };
    }
    case 'read_document': {
      // 读取本轮用户上传的附件内容（前端上传时已解析成文本并随请求带来，无需任何界面交互）
      const list = ((ctx && Array.isArray(ctx.attachments)) ? ctx.attachments : [])
        .map((a) => ({ name: String((a && a.name) || '文件'), text: String((a && a.text) || '') }))
        .filter((a) => a.text.trim());
      if (!list.length) {
        return { result: { ok: false, error: '本轮没有可读取的附件文件，请提示用户用输入框旁的「上传文件」按钮添加后再试' } };
      }
      const MAX_LEN = 100000; // 与上传解析接口保持一致的截断上限
      let body = list.map((a) => `文件「${a.name}」的内容：\n${a.text}`).join('\n\n');
      if (body.length > MAX_LEN) body = body.slice(0, MAX_LEN) + `\n\n...（文件过长，已截断至 ${MAX_LEN} 字符）`;
      return {
        result: {
          ok: true,
          count: list.length,
          names: list.map((a) => a.name),
          text: body,
          note: '以上是用户本轮上传的文件内容，请据此作答；正文不要原样照抄整段文件内容',
        },
      };
    }
    case 'ocr_image': {
      const imgs = (ctx && ctx.images) || [];
      if (!imgs.length) return { result: { ok: false, error: '当前对话里没有可识别的图片' } };
      const n = Math.min(Math.max(parseInt(args && args.image, 10) || 1, 1), imgs.length);
      const ocr = require('../../../services/ocr');
      const r = await ocr.recognizeDataUrl(imgs[n - 1]);
      if (!r.ok) return { result: { ok: false, error: r.error } };
      if (r.empty) {
        return { result: { ok: true, text: '', empty: true, note: '图片里没有识别到文字' } };
      }
      return { result: { ok: true, text: r.text, note: '以上是从图片中识别出的文字，请据此继续处理' } };
    }
    case 'export_file': {
      const e = normalizeExport(args || {});
      if (e.error) return { result: { ok: false, error: e.error } };
      return {
        exportFile: e.spec,
        result: {
          ok: true,
          generated: true,
          filename: e.spec.filename,
          format: e.spec.format,
          count: e.spec.rows.length,
          note: '导出文件已生成，界面会弹出系统保存对话框由用户选择保存位置；正文用一句话说明导出了什么即可，不要编造保存路径，也不要重复调用本工具',
        },
      };
    }
    default:
      return { result: { error: '未知工具' } };
  }
}

module.exports = {
  runTool,
  appendBlocks: exec.appendBlocks,
  latestUserImages: exec.latestUserImages,
  toolSummary: exec.toolSummary,
  toolDetailText: exec.toolDetailText,
  TOOL_INFO: exec.TOOL_INFO,
  MAX_BATCH_OPS: schema.MAX_BATCH_OPS,
  BATCH_ROW_TABLES: schema.BATCH_ROW_TABLES,
  SNAPSHOT_NAME_RE: exec.SNAPSHOT_NAME_RE,
  runSnapshotCreate: exec.runSnapshotCreate,
  runSnapshotList: exec.runSnapshotList,
  queryTool: schema.queryTool,
  proposeWriteTool: schema.proposeWriteTool,
  showRecordTool: schema.showRecordTool,
  batchAddTool: schema.batchAddTool,
  batchDeleteTool: schema.batchDeleteTool,
  jsonWriteTool: schema.jsonWriteTool,
  frontSettingTool: schema.frontSettingTool,
  chartTool: schema.chartTool,
  askUserTool: schema.askUserTool,
  memoryTool: schema.memoryTool,
  readDocumentTool: schema.readDocumentTool,
  ocrTool: schema.ocrTool,
  exportTool: schema.exportTool,
  timeTool: schema.timeTool,
  webSearchTool: schema.webSearchTool,
  undoTool: schema.undoTool,
  aggregateTool: schema.aggregateTool,
  resolveStudentTool: schema.resolveStudentTool,
  listChangesTool: schema.listChangesTool,
  searchAllTool: schema.searchAllTool,
  runChecksTool: schema.runChecksTool,
  conflictChecksTool: schema.conflictChecksTool,
  exportImageTool: schema.exportImageTool,
  scoreWeightsTool: schema.scoreWeightsTool,
  batchUpdateTool: schema.batchUpdateTool,
  batchOpsTool: schema.batchOpsTool,
  describeTableTool: schema.describeTableTool,
  snapshotCreateTool: schema.snapshotCreateTool,
  snapshotListTool: schema.snapshotListTool,
  snapshotRestoreTool: schema.snapshotRestoreTool,
  deleteImpactTool: schema.deleteImpactTool,
  teachingWeekTool: schema.teachingWeekTool,
  skillTool: schema.skillTool,
  subagentTool,
  runSubagent,
};
