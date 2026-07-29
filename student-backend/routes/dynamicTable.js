const express = require('express');
const {
  queryAll, insertRow, updateRow, deleteRow, moveRow,
  addColumn, deleteColumn, reorderRows, moveColumn, importRows, renameColumn
} = require('../services/tableService');

function createDynamicTableRouter(tableName, options = {}) {
  const router = express.Router();
  const {
    minCount = 0,
    protectedColumns = [],
    fieldTypeOverrides = {},
    extraRoutes = null
  } = options;

  // GET /
  router.get('/', (req, res) => {
    try {
      const result = queryAll(tableName);
      if (fieldTypeOverrides && result.fields) {
        result.fields.forEach(f => {
          if (fieldTypeOverrides[f.name]) {
            f.type = fieldTypeOverrides[f.name];
          }
        });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /
  router.post('/', (req, res) => {
    try {
      const result = insertRow(tableName, req.body);
      res.json({ ...result, message: '添加成功' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // PUT /:id
  router.put('/:id', (req, res) => {
    try {
      updateRow(tableName, req.params.id, req.body);
      res.json({ message: '修改成功' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /:id
  router.delete('/:id', (req, res) => {
    try {
      deleteRow(tableName, req.params.id, { minCount });
      res.json({ message: '删除成功' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /move-row
  router.post('/move-row', (req, res) => {
    try {
      moveRow(tableName, req.body.id, req.body.direction);
      res.json({ message: '移动成功' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /move（兼容 feeRecords 原有的路径）
  router.post('/move', (req, res) => {
    try {
      moveRow(tableName, req.body.id, req.body.direction);
      res.json({ message: '移动成功' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /add-column
  router.post('/add-column', (req, res) => {
    try {
      const { columnName, dataType, after } = req.body;
      addColumn(tableName, columnName, dataType, after);
      res.json({ message: `字段 ${columnName} 添加成功` });
    } catch (err) {
      if (err.message.includes('duplicate column name')) {
        return res.status(400).json({ error: '该字段已存在' });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /columns/:columnName
  router.delete('/columns/:columnName', (req, res) => {
    try {
      deleteColumn(tableName, req.params.columnName, { protectedColumns });
      res.json({ message: `字段 ${req.params.columnName} 已删除` });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /reorder
  router.post('/reorder', (req, res) => {
    try {
      reorderRows(tableName, req.body.ids);
      res.json({ message: '顺序更新成功' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /move-column
  router.post('/move-column', (req, res) => {
    try {
      const { columnName, targetColumnName, position } = req.body;
      moveColumn(tableName, columnName, targetColumnName, position);
      res.json({ message: '列顺序已更新' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /import
  router.post('/import', (req, res) => {
    try {
      const { fields, rows } = req.body;
      const count = importRows(tableName, fields, rows);
      res.json({ message: `成功导入 ${count} 条记录` });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /rename-column
  router.post('/rename-column', (req, res) => {
    try {
      const { oldName, newName } = req.body;
      renameColumn(tableName, oldName, newName);
      res.json({ message: `列名已从"${oldName}"改为"${newName}"` });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 挂载额外路由（如上传收据等）
  if (extraRoutes) {
    extraRoutes(router);
  }

  return router;
}

module.exports = { createDynamicTableRouter };
