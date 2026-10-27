const express = require('express');
const router = express.Router();
const { db } = require('../db');

// 桌面小组件「常用软件」最多 8 个（4 列 × 2 行）。
// 渲染层会隐藏多余的添加入口，这里再兜一层：即使直接调接口也写不进第 9 个。
const MAX_DESKTOP_APPS = 8;

// 读取并裁剪已存列表：历史数据若超过 8 个，也按上限返回，避免界面被撑出第三行
function parseStoredApps(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.slice(0, MAX_DESKTOP_APPS) : [];
  } catch (_) {
    return [];
  }
}

// 写入前的统一清洗：字段类型收敛 + 丢弃空路径 + 截断到上限
function normalizeApps(list) {
  if (!Array.isArray(list)) return null;
  return list.map((it, index) => ({
    id: String(it?.id || `app-${Date.now()}-${index}`),
    name: String(it?.name ?? '').slice(0, 30),
    path: String(it?.path ?? '').trim(),
    icon: typeof it?.icon === 'string' ? it.icon : '',
  })).filter((it) => it.path).slice(0, MAX_DESKTOP_APPS);
}

// 获取小组件设置
router.get('/', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM widget_settings WHERE id = 1').get();
    const desktopApps = parseStoredApps(settings.desktop_apps);
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
    // 只传了其他字段（如工具箱开关）时保持原列表不动；传了列表才按上限重写
    const normalized = normalizeApps(desktopApps);
    const appsJson = normalized
      ? JSON.stringify(normalized)
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
    res.json({ success: true, data: parseStoredApps(settings.desktop_apps) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/apps', (req, res) => {
  try {
    // 超出 8 个的部分直接丢弃：前端已阻止继续添加，这里保证接口层同样不可突破
    const clean = normalizeApps(req.body?.desktopApps) || [];
    db.prepare('UPDATE widget_settings SET desktop_apps = ? WHERE id = 1').run(JSON.stringify(clean));
    res.json({ success: true, data: clean });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 首页班级信息（班名/口号/班风/学风）
router.get('/class-info', (req, res) => {
  try {
    const row = db.prepare('SELECT class_info FROM widget_settings WHERE id = 1').get();
    let ci = {};
    try { ci = JSON.parse(row.class_info || '{}'); } catch (_) { ci = {}; }
    res.json({ success: true, data: {
      name: ci.name || '',
      motto: ci.motto || '',
      mottoStyle: ci.mottoStyle || '',
      xuefeng: ci.xuefeng || '',
    }});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/class-info', (req, res) => {
  try {
    const { name, motto, mottoStyle, xuefeng } = req.body || {};
    const clean = {
      name: String(name ?? '').trim().slice(0, 50),
      motto: String(motto ?? '').trim().slice(0, 500),
      mottoStyle: String(mottoStyle ?? '').trim().slice(0, 500),
      xuefeng: String(xuefeng ?? '').trim().slice(0, 500),
    };
    db.prepare('UPDATE widget_settings SET class_info = ? WHERE id = 1').run(JSON.stringify(clean));
    res.json({ success: true, data: clean });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;