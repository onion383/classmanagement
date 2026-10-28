const express = require('express');
const crypto = require('crypto');
const { db } = require('../../db');

const router = express.Router();

// ---------------- 配置 ----------------
function currentSettings() {
  // 启用状态来自 ai_settings；模型参数来自当前选中的模型
  const en = db.prepare('SELECT enabled FROM ai_settings WHERE id = 1').get() || {};
  const m = db.prepare('SELECT * FROM ai_models WHERE is_active = 1').get() || {};
  return {
    enabled: !!en.enabled,
    provider: m.provider || 'deepseek',
    base_url: m.base_url || '',
    model: m.model || '',
    api_key: m.api_key || '',
    reasoning: m.reasoning == null ? true : !!m.reasoning,
  };
}

// 提供商的默认 base_url / model（用户可自行覆盖）
const PROVIDER_PRESETS = {
  deepseek: { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
  openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  moonshot: { base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  qwen: { base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  glm: { base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  custom: { base_url: '', model: '' },
};

function resolveEndpoint(cfg) {
  const preset = PROVIDER_PRESETS[cfg.provider] || PROVIDER_PRESETS.custom;
  const base = (cfg.base_url || preset.base_url || '').replace(/\/+$/, '');
  const model = cfg.model || preset.model;
  return { url: `${base}/chat/completions`, model };
}

// 推理开关 → 各服务商的请求参数（不支持的服务商返回空对象，避免注入未知字段导致 400）
//   deepseek / glm：{"thinking":{"type":"enabled|disabled"}}
//   qwen（DashScope 兼容模式）：{"enable_thinking": true|false}
//   openai：仅开启时传 reasoning_effort（非推理模型不支持关闭，故关闭时不传）
function reasoningParams(provider, on) {
  switch (provider) {
    case 'deepseek':
    case 'glm':
      return { thinking: { type: on ? 'enabled' : 'disabled' } };
    case 'qwen':
      return { enable_thinking: !!on };
    case 'openai':
      return on ? { reasoning_effort: 'high' } : {};
    default:
      return {}; // moonshot / custom 等暂不注入
  }
}

// discover 的结果按「服务商 + 地址 + 密钥哈希」缓存 5 分钟。
// 理由：这是个**真实外网请求**（超时 20s），而前端每次打开设置页、每次新增模型都会
// 对每个服务商各发一次；来回切几次就反复联网，实测每次几百毫秒到数秒。
const DISCOVER_TTL_MS = 5 * 60 * 1000;
const DISCOVER_CACHE_MAX = 32;
const discoverCache = new Map(); // key -> { models, at }
function discoverCacheKey(provider, base, apiKey) {
  const kh = crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 16);
  return `${provider || ''}|${base}|${kh}`;
}

// 识别指定服务商可用模型：调用 OpenAI 兼容的 GET /models 接口
async function discoverModels(cfg) {
  if (!cfg.api_key) throw new Error('尚未填写 API Key');
  const preset = PROVIDER_PRESETS[cfg.provider] || PROVIDER_PRESETS.custom;
  const base = (cfg.base_url || preset.base_url || '').replace(/\/+$/, '');
  const cacheKey = discoverCacheKey(cfg.provider, base, cfg.api_key);
  const hit = discoverCache.get(cacheKey);
  if (hit && Date.now() - hit.at < DISCOVER_TTL_MS) return hit.models.slice();
  const r = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${cfg.api_key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`模型服务返回 ${r.status}: ${text.slice(0, 200)}`);
  }
  const j = await r.json();
  const models = (j.data || []).map((x) => x.id).filter(Boolean);
  if (models.length) {
    // 只缓存成功结果：失败不缓存，用户配好密钥重试时能立刻生效
    discoverCache.set(cacheKey, { models, at: Date.now() });
    // 简单容量上限：服务商/地址/密钥组合有限，超了淘汰最早插入的一条
    if (discoverCache.size > DISCOVER_CACHE_MAX) {
      discoverCache.delete(discoverCache.keys().next().value);
    }
  }
  return models;
}

// 通用连通性测试：向模型发一条极短请求验证，返回 { ok, message }
async function testConnection(cfg) {
  if (!cfg.api_key) return { ok: false, message: '尚未填写 API Key' };
  try {
    const { url, model } = resolveEndpoint(cfg);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      const text = await r.text();
      return { ok: false, message: `模型服务返回 ${r.status}: ${text.slice(0, 300)}` };
    }
    const j = await r.json();
    if (j.error) return { ok: false, message: `接口报错：${j.error.message || JSON.stringify(j.error)}` };
    return { ok: true, message: '连接成功' };
  } catch (err) {
    return { ok: false, message: `连接失败：${err.message || '网络错误'}` };
  }
}

// GET /api/ai/config —— 仅返回当前启用状态
router.get('/config', (req, res) => {
    res.json({ success: true, data: { enabled: !!currentSettings().enabled } });
});

// PUT /api/ai/config —— 仅切换启用状态
router.put('/config', (req, res) => {
    const { enabled } = req.body;
  db.prepare('UPDATE ai_settings SET enabled = ? WHERE id = 1').run(enabled ? 1 : 0);
  res.json({ success: true, message: '已保存' });
});

// GET /api/ai/models —— 模型列表（密钥仅标记是否已填，不下发明文）
router.get('/models', (req, res) => {
    const rows = db.prepare('SELECT id, name, provider, base_url, model, is_active, api_key, reasoning FROM ai_models ORDER BY id').all();
  res.json({
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      base_url: r.base_url,
      model: r.model,
      is_active: !!r.is_active,
      hasApiKey: !!r.api_key,
      reasoning: r.reasoning == null ? true : !!r.reasoning,
    })),
  });
});

// POST /api/ai/models —— 添加模型：先自动测连通，通过才保存
router.post('/models', async (req, res) => {
    const { name, provider, base_url, model, api_key } = req.body;
  if (!model) return res.status(400).json({ error: '请填写模型名' });
  // 同一服务商已配置过密钥时可留空自动复用；否则必须填写
  let key = api_key || '';
  if (!key) {
    const reuse = db.prepare("SELECT api_key FROM ai_models WHERE provider = ? AND api_key != '' ORDER BY id LIMIT 1").get(provider || 'deepseek');
    key = (reuse && reuse.api_key) || '';
  }
  if (!key) return res.status(400).json({ error: '请填写 API Key' });
  const t = await testConnection({ provider, base_url, model, api_key: key });
  if (!t.ok) return res.status(400).json({ error: t.message });
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM ai_models').get().c;
  const isActive = cnt === 0 ? 1 : 0; // 首个添加的模型自动设为选中
  const info = db.prepare(
    'INSERT INTO ai_models (name, provider, base_url, model, api_key, is_active) VALUES (?,?,?,?,?,?)'
  ).run(name || model, provider || 'deepseek', base_url || '', model, key, isActive);
  res.json({ success: true, message: t.message + '，已添加', id: info.lastInsertRowid });
});

// PUT /api/ai/models/:id/active —— 选中某个模型为当前使用
router.put('/models/:id/active', (req, res) => {
    const id = Number(req.params.id);
  // 先校验 id：原来的写法是「无条件先把所有模型清成未激活，再按 id 绑 1」，
  // 一旦 id 是 NaN / 不存在的值，第二步绑 0 行 —— 结果所有模型都没有 is_active，
  // AI 直接不可用，而且接口还返回 success。
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '模型 id 无效' });
  const exists = db.prepare('SELECT id FROM ai_models WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: '模型不存在' });
  // 同一事务内「先置目标激活、再清其余」：任一语句失败都不会留下「全空」的中间态
  db.transaction(() => {
    db.prepare('UPDATE ai_models SET is_active = 0 WHERE id != ?').run(id);
    db.prepare('UPDATE ai_models SET is_active = 1 WHERE id = ?').run(id);
  })();
  res.json({ success: true, message: '已选中该模型' });
});

// DELETE /api/ai/models/:id —— 删除模型；删除当前选中时将下一项设为选中
router.delete('/models/:id', (req, res) => {
    const id = Number(req.params.id);
  const m = db.prepare('SELECT is_active FROM ai_models WHERE id = ?').get(id);
  if (!m) return res.status(404).json({ error: '模型不存在' });
  const active = !!m.is_active;
  db.prepare('DELETE FROM ai_models WHERE id = ?').run(id);
  if (active) {
    const other = db.prepare('SELECT id FROM ai_models WHERE id != ? ORDER BY id LIMIT 1').get(id);
    if (other) db.prepare('UPDATE ai_models SET is_active = 1 WHERE id = ?').run(other.id);
  }
  res.json({ success: true, message: '已删除' });
});

// POST /api/ai/models/discover —— 用表单里填写的密钥识别该服务商可用模型（密钥为空则复用同服务商已有密钥）
router.post('/models/discover', async (req, res) => {
  try {
    const { provider, base_url, api_key } = req.body;
    let key = api_key || '';
    if (!key) {
      const reuse = db.prepare("SELECT api_key FROM ai_models WHERE provider = ? AND api_key != '' ORDER BY id LIMIT 1").get(provider || 'deepseek');
      key = (reuse && reuse.api_key) || '';
    }
    const models = await discoverModels({ provider, base_url, api_key: key });
    if (!models.length) throw new Error('该服务商未返回可用模型');
    res.json({ success: true, models });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/ai/models/:id/models —— 用该模型已存密钥列出其服务商可用模型（用于卡片下拉切换）
router.get('/models/:id/models', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const m = db.prepare('SELECT provider, base_url, api_key FROM ai_models WHERE id = ?').get(id);
    if (!m) return res.status(404).json({ error: '模型不存在' });
    const models = await discoverModels({ provider: m.provider, base_url: m.base_url, api_key: m.api_key });
    res.json({ success: true, models });
  } catch (err) {
    res.status(500).json({ error: err.message, models: [] });
  }
});

// PUT /api/ai/models/:id —— 编辑模型：可改 名称/服务商/模型名/Base URL/API Key，先验证连通再保存。
//   仅传 model（卡片内下拉切换）时，其余字段沿用原值。API Key 留空表示不改动（优先沿用本条已有密钥）。
router.put('/models/:id', async (req, res) => {
    const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM ai_models WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '模型不存在' });
  const { provider, name, base_url, model, api_key } = req.body;
  if (!model) return res.status(400).json({ error: '请选择模型' });
  const nextProvider = provider || existing.provider;
  const nextBaseUrl = base_url == null ? existing.base_url : base_url;
  // 密钥：填了用新的；服务商未变且留空时沿用本条已有密钥（或同服务商其它条目的密钥）
  let key = api_key || '';
  if (!key && nextProvider === existing.provider) {
    const reuse = db.prepare("SELECT api_key FROM ai_models WHERE provider = ? AND api_key != '' ORDER BY id LIMIT 1").get(nextProvider);
    key = (reuse && reuse.api_key) || existing.api_key || '';
  }
  if (!key) return res.status(400).json({ error: '请填写 API Key' });
  const t = await testConnection({ provider: nextProvider, base_url: nextBaseUrl, model, api_key: key });
  if (!t.ok) return res.status(400).json({ error: t.message });
  db.prepare('UPDATE ai_models SET name = ?, provider = ?, base_url = ?, model = ?, api_key = ? WHERE id = ?')
    .run(typeof name === 'string' && name.length ? name : existing.name, nextProvider, nextBaseUrl, model, key, id);
  res.json({ success: true, message: t.message + '，已保存' });
});

// PUT /api/ai/models/:id/reasoning —— 切换该模型是否开启推理（思考模式）
router.put('/models/:id/reasoning', (req, res) => {
    const id = Number(req.params.id);
  const on = req.body && req.body.reasoning ? 1 : 0;
  const info = db.prepare('UPDATE ai_models SET reasoning = ? WHERE id = ?').run(on, id);
  if (!info.changes) return res.status(404).json({ error: '模型不存在' });
  res.json({ success: true, message: '已保存' });
});

// POST /api/ai/config/test —— 测试当前选中模型的连通性
router.post('/config/test', async (req, res) => {
  try {
    const t = await testConnection(currentSettings());
    if (!t.ok) return res.status(400).json({ error: t.message });
    res.json({ success: true, message: t.message });
  } catch (err) {
    res.status(500).json({ error: err.message || '连接失败' });
  }
});


module.exports = router;
module.exports.resolveEndpoint = resolveEndpoint;
module.exports.currentSettings = currentSettings;
module.exports.reasoningParams = reasoningParams;
