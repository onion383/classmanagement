const express = require('express');
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

// 识别指定服务商可用模型：调用 OpenAI 兼容的 GET /models 接口
async function discoverModels(cfg) {
  if (!cfg.api_key) throw new Error('尚未填写 API Key');
  const preset = PROVIDER_PRESETS[cfg.provider] || PROVIDER_PRESETS.custom;
  const base = (cfg.base_url || preset.base_url || '').replace(/\/+$/, '');
  const r = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${cfg.api_key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`模型服务返回 ${r.status}: ${text.slice(0, 200)}`);
  }
  const j = await r.json();
  return (j.data || []).map((x) => x.id).filter(Boolean);
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
  try {
    res.json({ success: true, data: { enabled: !!currentSettings().enabled } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/ai/config —— 仅切换启用状态
router.put('/config', (req, res) => {
  try {
    const { enabled } = req.body;
    db.prepare('UPDATE ai_settings SET enabled = ? WHERE id = 1').run(enabled ? 1 : 0);
    res.json({ success: true, message: '已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/models —— 模型列表（密钥仅标记是否已填，不下发明文）
router.get('/models', (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/models —— 添加模型：先自动测连通，通过才保存
router.post('/models', async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/ai/models/:id/active —— 选中某个模型为当前使用
router.put('/models/:id/active', (req, res) => {
  try {
    const id = Number(req.params.id);
    db.prepare('UPDATE ai_models SET is_active = 0').run();
    db.prepare('UPDATE ai_models SET is_active = 1 WHERE id = ?').run(id);
    res.json({ success: true, message: '已选中该模型' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ai/models/:id —— 删除模型；删除当前选中时将下一项设为选中
router.delete('/models/:id', (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// PUT /api/ai/models/:id —— 切换该模型的 model（先用现有密钥验证连通，通过才保存）
router.put('/models/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { model, name } = req.body;
    if (!model) return res.status(400).json({ error: '请选择模型' });
    const m = db.prepare('SELECT provider, base_url, api_key FROM ai_models WHERE id = ?').get(id);
    if (!m) return res.status(404).json({ error: '模型不存在' });
    const t = await testConnection({ provider: m.provider, base_url: m.base_url, model, api_key: m.api_key });
    if (!t.ok) return res.status(400).json({ error: t.message });
    db.prepare('UPDATE ai_models SET model = ?, name = COALESCE(?, name) WHERE id = ?')
      .run(model, typeof name === 'string' && name.length ? name : null, id);
    res.json({ success: true, message: t.message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/ai/models/:id/reasoning —— 切换该模型是否开启推理（思考模式）
router.put('/models/:id/reasoning', (req, res) => {
  try {
    const id = Number(req.params.id);
    const on = req.body && req.body.reasoning ? 1 : 0;
    const info = db.prepare('UPDATE ai_models SET reasoning = ? WHERE id = ?').run(on, id);
    if (!info.changes) return res.status(404).json({ error: '模型不存在' });
    res.json({ success: true, message: '已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
