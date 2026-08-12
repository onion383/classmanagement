const express = require('express');
const router = express.Router();
const { db } = require('../db');

// 获取小组件设置
router.get('/', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM widget_settings WHERE id = 1').get();
    res.json({
      success: true,
      data: {
        toolboxEnabled: !!settings.toolbox_enabled,
        noteSavePath: settings.note_save_path || '',
        screenshotSavePath: settings.screenshot_save_path || ''
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新小组件设置
router.put('/', (req, res) => {
  try {
    const { toolboxEnabled, noteSavePath, screenshotSavePath } = req.body;
    db.prepare(`
      UPDATE widget_settings SET
        toolbox_enabled = ?,
        note_save_path = ?,
        screenshot_save_path = ?
      WHERE id = 1
    `).run(
      toolboxEnabled ? 1 : 0,
      noteSavePath || '',
      screenshotSavePath || ''
    );
    res.json({ success: true, message: '小组件设置已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;