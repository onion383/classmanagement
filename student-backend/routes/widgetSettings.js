const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { cleanPath } = require('../services/sanitize');

// 桌面小组件「常用软件」最多 8 个（4 列 × 2 行）。
// 渲染层会隐藏多余的添加入口，这里再兜一层：即使直接调接口也写不进第 9 个。
const MAX_DESKTOP_APPS = 8;
// 图标是主进程 getFileIcon 生成的 256px PNG dataURL，正常 5～30KB。
// 不设上限等于允许一个请求往库里塞任意大的字符串（还会被每次读设置时下发到渲染层）。
const MAX_ICON_LEN = 512 * 1024;

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
  const out = [];
  for (let index = 0; index < list.length; index++) {
    const it = list[index];
    // path 最终会被主进程拿去启动程序：必须与其它路径字段同一套清洗
    // （拒「..」上跳与非法字符），不能只 trim。单个条目非法时丢弃该条，
    // 不因为一个坏条目把整张常用软件表都拒掉。
    let p;
    try {
      p = cleanPath(it?.path, '软件路径');
    } catch (_) {
      continue;
    }
    if (!p) continue;
    // icon 超长时**整条丢弃图标**而不是截断：dataURL 截一半是非法 base64，
    // <img> 加载必然失败，界面会显示成灰框；清空则退回「名字首字」占位。
    const rawIcon = typeof it?.icon === 'string' ? it.icon : '';
    out.push({
      id: String(it?.id || `app-${Date.now()}-${index}`),
      name: String(it?.name ?? '').slice(0, 30),
      path: p,
      icon: rawIcon.length > MAX_ICON_LEN ? '' : rawIcon,
    });
    if (out.length >= MAX_DESKTOP_APPS) break;
  }
  return out;
}

// 获取小组件设置
router.get('/', (req, res) => {
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
});

// 更新小组件设置
router.put('/', (req, res) => {
  try {
    const { toolboxEnabled, noteSavePath, screenshotSavePath, desktopApps } = req.body;
    // 保存目录同样禁止「..」上跳与非法字符，避免桌面挂件把文件写到预期之外的位置
    let notePath;
    let shotPath;
    try {
      notePath = cleanPath(noteSavePath, '笔记保存路径') || '';
      shotPath = cleanPath(screenshotSavePath, '截屏保存路径') || '';
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
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
      notePath,
      shotPath,
      appsJson
    );
    res.json({ success: true, message: '小组件设置已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 常用软件列表（独立读写，不触碰其他小组件设置）
router.get('/apps', (req, res) => {
    const settings = db.prepare('SELECT desktop_apps FROM widget_settings WHERE id = 1').get();
  res.json({ success: true, data: parseStoredApps(settings.desktop_apps) });
});

router.put('/apps', (req, res) => {
    // 超出 8 个的部分直接丢弃：前端已阻止继续添加，这里保证接口层同样不可突破
  const clean = normalizeApps(req.body?.desktopApps) || [];
  db.prepare('UPDATE widget_settings SET desktop_apps = ? WHERE id = 1').run(JSON.stringify(clean));
  res.json({ success: true, data: clean });
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
    const { name, motto, mottoStyle, xuefeng } = req.body || {};
  const clean = {
    name: String(name ?? '').trim().slice(0, 50),
    motto: String(motto ?? '').trim().slice(0, 500),
    mottoStyle: String(mottoStyle ?? '').trim().slice(0, 500),
    xuefeng: String(xuefeng ?? '').trim().slice(0, 500),
  };
  db.prepare('UPDATE widget_settings SET class_info = ? WHERE id = 1').run(JSON.stringify(clean));
  res.json({ success: true, data: clean });
});

module.exports = router;