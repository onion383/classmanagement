// 纯建表结构：可复用于任一「班主任库」。
// 这里只负责表结构与只读默认配置，不含任何业务示例数据、不含账号。
// 按域拆分为 schema.<part>.js 各子文件，本文件仅按依赖顺序汇总调用，导出接口与拆分前一致。
//
// 原 initSchema 内部分节（拆分后按域分散，此处保留原文便于对照）：
// ======================== 建表 ========================
//   → schema.core / leave / fee / schedule / seat / duty / score / undo / cadre / group / album / ai / activity / widget
const { migrateCore } = require('./schema.core');
const { migrateLeave } = require('./schema.leave');
const { migrateFee } = require('./schema.fee');
const { migrateSchedule } = require('./schema.schedule');
const { migrateWidget } = require('./schema.widget');
const { migrateAi } = require('./schema.ai');
const { migrateAlbum } = require('./schema.album');
const { migrateGroup } = require('./schema.group');
const { migrateScore } = require('./schema.score');
const { migrateActivity } = require('./schema.activity');
const { migrateSeat } = require('./schema.seat');
const { migrateDuty } = require('./schema.duty');
const { migrateUndo } = require('./schema.undo');
const { migrateCadre } = require('./schema.cadre');
const { migrateHistory } = require('./schema.history');

function initSchema(conn) {
  migrateCore(conn);
  migrateLeave(conn);
  migrateFee(conn);
  migrateSchedule(conn);
  migrateWidget(conn);
  migrateAi(conn);
  migrateAlbum(conn);
  migrateGroup(conn);
  migrateScore(conn);
  migrateActivity(conn);
  migrateSeat(conn);
  migrateDuty(conn);
  migrateUndo(conn);
  migrateCadre(conn);
  migrateHistory(conn);
}

module.exports = { initSchema };
