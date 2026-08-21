const { db, getFields, renumber } = require('../db');

// 列名白名单：与 addColumn/renameColumn 保持一致，防止列名拼入 SQL 造成注入。
// 仅允许中英文、数字、下划线，且禁止保留字段（id/position 由内部管理，atPosition 为插入位置参数）。
const COLUMN_NAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/;
const RESERVED_COLUMNS = ['id', 'position', 'atPosition'];

function assertValidColumn(name) {
  if (!name || RESERVED_COLUMNS.includes(name) || !COLUMN_NAME_RE.test(name)) {
    throw new Error('字段名不合法');
  }
}

function queryAll(tableName) {
  const results = db.prepare(`SELECT * FROM ${tableName} ORDER BY position ASC`).all();
  let fields = getFields(tableName);
  if (fields.length === 0 && results.length > 0) {
    fields = Object.keys(results[0]).filter(k => k !== 'id' && k !== 'position').map(k => ({ name: k, type: '文字' }));
  }
  return { data: results, fields };
}

function insertRow(tableName, data) {
  const atPosition = data.atPosition;
  delete data.atPosition;

  const keys = Object.keys(data);
  if (keys.length === 0) throw new Error('没有字段');

  const cleaned = {};
  keys.forEach(k => {
    assertValidColumn(k);
    cleaned[k] = (data[k] === '' || data[k] === undefined) ? null : data[k];
  });

  const maxPos = db.prepare(`SELECT MAX(position) AS maxPos FROM ${tableName}`).get().maxPos || 0;
  let insertPos;

  if (atPosition && atPosition <= maxPos) {
    insertPos = atPosition;
    db.prepare(`UPDATE ${tableName} SET position = position + 1 WHERE position >= ?`).run(atPosition);
  } else {
    insertPos = maxPos + 1;
  }

  cleaned.position = insertPos;
  const columns = Object.keys(cleaned).map(c => `"${c}"`).join(',');
  const placeholders = Object.keys(cleaned).map(() => '?').join(',');
  const values = Object.values(cleaned);

  const result = db.prepare(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`).run(...values);
  renumber(tableName);
  return { id: result.lastInsertRowid };
}

function updateRow(tableName, id, data) {
  const keys = Object.keys(data);
  if (keys.length === 0) throw new Error('没有字段');

  const cleaned = {};
  keys.forEach(k => {
    assertValidColumn(k);
    cleaned[k] = (data[k] === '' || data[k] === undefined) ? null : data[k];
  });

  const setClause = Object.keys(cleaned).map(k => `"${k}" = ?`).join(', ');
  const values = Object.values(cleaned);
  values.push(id);

  db.prepare(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`).run(...values);
}

function deleteRow(tableName, id, options = {}) {
  const { minCount = 0 } = options;

  if (minCount > 0) {
    const count = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
    if (count <= minCount) throw new Error('至少需要保留一条记录');
  }

  const row = db.prepare(`SELECT position FROM ${tableName} WHERE id = ?`).get(id);
  if (!row) throw new Error('记录不存在');

  db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
  db.prepare(`UPDATE ${tableName} SET position = position - 1 WHERE position > ?`).run(row.position);
}

function moveRow(tableName, id, direction) {
  if (!id || !direction) throw new Error('缺少参数');

  const row = db.prepare(`SELECT position FROM ${tableName} WHERE id = ?`).get(id);
  if (!row) throw new Error('记录不存在');

  const cur = row.position;
  const maxPos = db.prepare(`SELECT MAX(position) AS maxPos FROM ${tableName}`).get().maxPos;
  let target;
  if (direction === 'up') target = cur - 1;
  else if (direction === 'down') target = cur + 1;
  else throw new Error('无效方向');

  if (target < 1 || target > maxPos) throw new Error('已到边界');

  const targetRow = db.prepare(`SELECT id FROM ${tableName} WHERE position = ?`).get(target);
  if (!targetRow) throw new Error('目标行异常');

  db.prepare(`UPDATE ${tableName} SET position = CASE WHEN id = ? THEN ? WHEN id = ? THEN ? END WHERE id IN (?, ?)`)
    .run(id, target, targetRow.id, cur, id, targetRow.id);
}

function addColumn(tableName, columnName, dataType, after) {
  if (!columnName || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(columnName)) throw new Error('列名不合法');
  if (columnName === 'id' || columnName === 'position') throw new Error('不能使用保留字段');

  let sqlType = 'TEXT';
  if (dataType === '整数') sqlType = 'INTEGER';
  else if (dataType === '小数') sqlType = 'REAL';
  else if (dataType === '日期') sqlType = 'TEXT';

  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN "${columnName}" ${sqlType}`).run();

  const metas = db.prepare('SELECT column_name, sort_order FROM table_meta WHERE table_name = ? ORDER BY sort_order').all(tableName);
  let sortOrder;
  if (after === 'first' || !after) {
    sortOrder = 1;
    db.prepare('UPDATE table_meta SET sort_order = sort_order + 1 WHERE table_name = ?').run(tableName);
  } else {
    const targetMeta = metas.find(m => m.column_name === after);
    if (!targetMeta) throw new Error('目标列不存在');
    sortOrder = targetMeta.sort_order + 1;
    db.prepare('UPDATE table_meta SET sort_order = sort_order + 1 WHERE table_name = ? AND sort_order >= ?').run(tableName, sortOrder);
  }

  db.prepare('INSERT INTO table_meta (table_name, column_name, data_type, sort_order) VALUES (?, ?, ?, ?)')
    .run(tableName, columnName, dataType || '文字', sortOrder);
}

function deleteColumn(tableName, columnName, options = {}) {
  const { protectedColumns = [] } = options;

  if (columnName === 'id' || columnName === 'position') throw new Error('不能删除保留字段');
  if (protectedColumns.includes(columnName)) throw new Error('该字段受保护，无法删除');

  const deletable = db.prepare('SELECT COUNT(*) AS cnt FROM table_meta WHERE table_name = ?').get(tableName).cnt;
  if (deletable <= 1) throw new Error('至少需要保留一个数据字段');

  db.prepare('DELETE FROM table_meta WHERE table_name = ? AND column_name = ?').run(tableName, columnName);
  const remaining = db.prepare('SELECT column_name FROM table_meta WHERE table_name = ? ORDER BY sort_order').all(tableName);
  const stmt = db.prepare('UPDATE table_meta SET sort_order = ? WHERE table_name = ? AND column_name = ?');
  remaining.forEach((m, i) => stmt.run(i + 1, tableName, m.column_name));
}

function reorderRows(tableName, ids) {
  if (!ids || !Array.isArray(ids)) throw new Error('ids 必须为数组');
  const stmt = db.prepare(`UPDATE ${tableName} SET position = ? WHERE id = ?`);
  ids.forEach((id, index) => stmt.run(index + 1, id));
}

function moveColumn(tableName, columnName, targetColumnName, position) {
  if (!columnName || columnName === 'id' || columnName === 'position') {
    throw new Error('列名不合法或为保留字段');
  }
  if (position === 'after' && (targetColumnName === columnName || !targetColumnName)) {
    throw new Error('无效的目标列');
  }

  const metas = db.prepare('SELECT column_name, sort_order FROM table_meta WHERE table_name = ? ORDER BY sort_order').all(tableName);
  const col = metas.find(m => m.column_name === columnName);
  if (!col) throw new Error('列不存在');

  const target = position === 'first' ? null : metas.find(m => m.column_name === targetColumnName);
  if (position === 'after' && !target) throw new Error('目标列不存在');

  const withoutMoved = metas.filter(m => m.column_name !== columnName);
  let newOrder = [...withoutMoved];
  if (position === 'first') {
    newOrder.unshift(col);
  } else {
    const targetIdx = newOrder.findIndex(m => m.column_name === targetColumnName);
    newOrder.splice(targetIdx + 1, 0, col);
  }

  const stmt = db.prepare('UPDATE table_meta SET sort_order = ? WHERE table_name = ? AND column_name = ?');
  newOrder.forEach((m, i) => stmt.run(i + 1, tableName, m.column_name));
}

function importRows(tableName, fields, rows) {
  if (!fields || !rows || !Array.isArray(fields) || !Array.isArray(rows)) {
    throw new Error('缺少有效的字段或数据');
  }

  const existingFields = getFields(tableName).map(f => f.name);

  for (const f of fields) {
    assertValidColumn(f);
    if (!existingFields.includes(f)) {
      db.prepare(`ALTER TABLE ${tableName} ADD COLUMN "${f}" TEXT`).run();
      const maxSort = db.prepare(`SELECT MAX(sort_order) AS max FROM table_meta WHERE table_name = ?`).get(tableName).max || 0;
      db.prepare(`INSERT INTO table_meta (table_name, column_name, data_type, sort_order) VALUES (?, ?, '文字', ?)`)
        .run(tableName, f, maxSort + 1);
      existingFields.push(f);
    }
  }

  const placeholders = fields.map(() => '?').join(',');
  const columnNames = fields.map(f => `"${f}"`).join(',');
  const insertStmt = db.prepare(`INSERT INTO ${tableName} (${columnNames}) VALUES (${placeholders})`);

  const insertMany = db.transaction((dataRows) => {
    for (const row of dataRows) {
      const filledRow = fields.map((_, idx) => (row[idx] !== undefined ? row[idx] : ''));
      insertStmt.run(...filledRow);
    }
  });

  insertMany(rows);
  renumber(tableName);

  return rows.length;
}

function renameColumn(tableName, oldName, newName) {
  if (!oldName || !newName) throw new Error('缺少参数');
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(newName)) throw new Error('列名不合法');
  if (oldName === newName) throw new Error('新列名与旧列名相同');

  const existing = db.prepare('SELECT column_name FROM table_meta WHERE table_name = ? AND column_name = ?').get(tableName, newName);
  if (existing) throw new Error('该列名已存在');

  db.prepare(`ALTER TABLE ${tableName} RENAME COLUMN "${oldName}" TO "${newName}"`).run();
  db.prepare('UPDATE table_meta SET column_name = ? WHERE table_name = ? AND column_name = ?').run(newName, tableName, oldName);
}

module.exports = {
  queryAll, insertRow, updateRow, deleteRow, moveRow,
  addColumn, deleteColumn, reorderRows, moveColumn, importRows, renameColumn
};
