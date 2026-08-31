const express = require('express');
const router = express.Router();
const { db } = require('../db');

// 获取小组件设置
router.get('/', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM widget_settings WHERE id = 1').get();
    let desktopApps = [];
    try { desktopApps = JSON.parse(settings.desktop_apps || '[]'); } catch (_) { desktopApps = []; }
    res.json({
      success: true,
      data: {
        toolboxEnabled: !!settings.toolbox_enabled,
        noteSavePath: settings.note_save_path || '',
        screenshotSavePath: settings.screenshot_save_path || '',
        desktopApps
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新小组件设置
router.put('/', (req, res) => {
  try {
    const { toolboxEnabled, noteSavePath, screenshotSavePath, desktopApps } = req.body;
    const appsJson = Array.isArray(desktopApps)
      ? JSON.stringify(desktopApps.map((it) => ({
          id: String(it?.id || ''),
          name: String(it?.name ?? '').slice(0, 30),
          path: String(it?.path ?? '').trim(),
          icon: typeof it?.icon === 'string' ? it.icon : '',
        })))
      : db.prepare('SELECT desktop_apps FROM widget_settings WHERE id = 1').get()?.desktop_apps || '[]';
    db.prepare(`
      UPDATE widget_settings SET
        toolbox_enabled = ?,
        note_save_path = ?,
        screenshot_save_path = ?,
        desktop_apps = ?
      WHERE id = 1
    `).run(
      toolboxEnabled ? 1 : 0,
      noteSavePath || '',
      screenshotSavePath || '',
      appsJson
    );
    res.json({ success: true, message: '小组件设置已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 常用软件列表（独立读写，不触碰其他小组件设置）
router.get('/apps', (req, res) => {
  try {
    const settings = db.prepare('SELECT desktop_apps FROM widget_settings WHERE id = 1').get();
    let apps = [];
    try { apps = JSON.parse(settings.desktop_apps || '[]'); } catch (_) { apps = []; }
    res.json({ success: true, data: apps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/apps', (req, res) => {
  try {
    const list = Array.isArray(req.body?.desktopApps) ? req.body.desktopApps : [];
    const clean = list.map((it, index) => ({
      id: String(it?.id || `app-${Date.now()}-${index}`),
      name: String(it?.name ?? '').slice(0, 30),
      path: String(it?.path ?? '').trim(),
      icon: typeof it?.icon === 'string' ? it.icon : '',
    })).filter((it) => it.path);
    db.prepare('UPDATE widget_settings SET desktop_apps = ? WHERE id = 1').run(JSON.stringify(clean));
    res.json({ success: true, data: clean });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;