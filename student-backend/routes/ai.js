const express = require('express');
const router = express.Router();
const { db } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 文件上传中间件：临时存储在系统临时目录
const upload = multer({ dest: path.join(os.tmpdir(), 'ai-uploads') });

// =========================================================================
// AI 助手后端
//   1. 配置读写（OpenAI 兼容协议，多模型可切换：DeepSeek/OpenAI/Kimi/通义…）。
//   2. 对话 + function calling：模型只能「读」表（query），「写」走 propose_write
//      生成提案，交由前端确认后通过既有 CRUD 执行——后端绝不直接改库。
// =========================================================================

// 可「读」的表及其中文说明（模型据此生成查询意图）
const READ_TABLES = {
  students: '学生列表（学号/姓名/年级/班级/年龄/家长联系电话/学生联系电话/备注）',
  leave_records: '请假记录（姓名/类型/开始时间/结束时间/状态/返校时间/家长联系电话/备注）',
  fee_records: '班费收支（收支编码/收支类型/收支金额/收支时间/备注/收据）',
  score_records: '加分扣分记录（姓名/类型/项目/分值/原因/加分时间/group_name/成员数）',
  activities: '班级活动（时间/主题/地点/简介/参与人员）',
  countdowns: '倒计时（名称/截止日/包含这一天）',
  groups: '分组（dimension_id/name/gender）',
  group_members: '组成员（group_id/member_name/remark）',
  group_dimensions: '分组维度（name/组长称呼/每组人数/小组组数）',
};

// 可「写」（需用户确认）的表
const WRITE_TABLES = {
  students: '学生',
  fee_records: '班费记录',
  activities: '班级活动',
  countdowns: '倒计时',
};

// 表列名缓存（PRAGMA 一次后复用，避免每个请求都读 schema）
const colCache = {};
function tableColumns(table) {
  if (colCache[table]) return colCache[table];
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  colCache[table] = cols;
  return cols;
}

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
  };
}

// 提供商的默认 base_url / model（用户可自行覆盖）
const PROVIDER_PRESETS = {
  deepseek: { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
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
    const rows = db.prepare('SELECT id, name, provider, base_url, model, is_active, api_key FROM ai_models ORDER BY id').all();
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

// ---------------- 工具定义 ----------------
const queryTool = {
  type: 'function',
  function: {
    name: 'query',
    description: '查询班级数据表。可指定表、过滤条件与排序。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(READ_TABLES), description: '要查询的表名' },
        where: { type: 'object', description: '过滤条件，如 {"状态":"请假中"}；键必须是该表的字段', additionalProperties: { type: 'string' } },
        order_by: { type: 'string', description: '排序字段（可选）' },
        order_dir: { type: 'string', enum: ['asc', 'desc'], description: '排序方向' },
        limit: { type: 'number', description: '最多返回条数，默认 100，上限 500' },
      },
      required: ['table'],
    },
  },
};

const proposeWriteTool = {
  type: 'function',
  function: {
    name: 'propose_write',
    description: '生成一条新增/修改/删除数据的提案。此调用不会真的修改数据，用户确认后才会执行。',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['add', 'update', 'delete'], description: 'add=新增, update=修改, delete=删除' },
        table: { type: 'string', enum: Object.keys(WRITE_TABLES), description: '目标表（仅支持可写表）' },
        data: {
          type: 'object',
          description: 'add: 完整新行对象；update: { id, changes }；delete: { id }',
        },
      },
      required: ['operation', 'table', 'data'],
    },
  },
};

function runQuery({ table, where, order_by, order_dir, limit }) {
  if (!READ_TABLES[table]) return { error: `不支持的查询表：${table}` };
  const cols = tableColumns(table);
  let sql = `SELECT * FROM "${table}"`;
  const params = [];
  if (where && typeof where === 'object') {
    const keys = Object.keys(where).filter((k) => cols.includes(k));
    if (keys.length) {
      sql += ' WHERE ' + keys.map((k) => `"${k}" = ?`).join(' AND ');
      keys.forEach((k) => params.push(where[k]));
    }
  }
  if (order_by && cols.includes(order_by)) {
    sql += ` ORDER BY "${order_by}" ${order_dir === 'desc' ? 'DESC' : 'ASC'}`;
  } else {
    sql += ' ORDER BY id';
  }
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  sql += ` LIMIT ${lim}`;
  const rows = db.prepare(sql).all(...params);
  return { count: rows.length, rows };
}

function normalizeProposal({ operation, table, data }) {
  if (!['add', 'update', 'delete'].includes(operation)) return { ok: false, error: '不支持的写操作' };
  if (!WRITE_TABLES[table]) return { ok: false, error: '该表暂不支持 AI 修改' };
  if (!data || typeof data !== 'object') return { ok: false, error: '缺少写入数据' };
  const name = WRITE_TABLES[table];
  const label = { add: `新增${name}`, update: `修改${name}`, delete: `删除${name}` }[operation];
  // students 新增至少要有姓名，活动/倒计时至少要有主题/名称
  if (operation === 'add') {
    if (table === 'students' && !data['姓名']) return { ok: false, error: '新增学生必须提供姓名' };
    if (table === 'activities' && !data['主题']) return { ok: false, error: '新增活动必须提供主题' };
    if (table === 'countdowns' && !data['名称']) return { ok: false, error: '新增倒计时必须提供名称' };
  }
  return { ok: true, operation, table, data, label };
}

const SYSTEM_PROMPT = `你是这个班级管理软件的 AI 助手，服务于一位班主任。

你可以通过 query 工具查询班级数据。可查询的数据：
${Object.entries(READ_TABLES).map(([k, v]) => `- ${k}：${v}`).join('\n')}

规则：
1. 回答用中文，简洁、贴近老师实际使用。
2. 需要数据时先调用 query 取数再作答；涉及统计/汇总（如某月班费支出、请假次数）时取数后自行计算。
3. 若要新增/修改/删除数据，调用 propose_write 生成提案即可，该调用不会实际改动数据，需用户确认后才会执行。生成提案时请填入真实合理的字段值。
4. 只允许修改可写表（students/fee_records/activities/countdowns），其它表只能查询。
5. 除非用户明确要求，不要一次性输出大段表格，重点信息总结即可。`;

async function callLLM(cfg, messages, tools) {
  const { url, model } = resolveEndpoint(cfg);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
    body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.2 }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`模型服务错误 ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

// POST /api/ai/chat —— body: { messages: [{ role, content }] }
router.post('/chat', async (req, res) => {
  try {
    const s = currentSettings();
    if (!s.enabled || !s.api_key) {
      return res.status(400).json({ error: '尚未启用 / 配置 AI，请先在【系统设置 → AI 助手设置】填写并启用' });
    }
    const { messages } = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: '缺少消息' });

    const history = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
    let proposal = null;

    for (let i = 0; i < 6; i++) {
      const completion = await callLLM(s, history, [queryTool, proposeWriteTool]);
      const msg = completion.choices && completion.choices[0] && completion.choices[0].message;
      if (!msg) throw new Error('模型未返回内容');

      if (msg.tool_calls && msg.tool_calls.length) {
        history.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.tool_calls.map((t) => ({
            id: t.id,
            type: 'function',
            function: { name: t.function.name, arguments: t.function.arguments },
          })),
        });
        for (const tc of msg.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { /* 参数解析失败则视为空 */ }
          let result;
          if (tc.function.name === 'query') {
            result = runQuery(args);
          } else if (tc.function.name === 'propose_write') {
            const p = normalizeProposal(args);
            if (p.ok) {
              proposal = { operation: p.operation, table: p.table, data: p.data, label: p.label };
              result = { ok: true, message: p.label, pending_user_confirmation: true };
            } else {
              result = { ok: false, error: p.error };
            }
          } else {
            result = { error: '未知工具' };
          }
          history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        // 一旦出现写提案，立即返回给前端确认，不再继续让模型渲染
        if (proposal) {
          const last = history[history.length - 1];
          res.json({ reply: last.role === 'assistant' ? last.content || '' : msg.content || '', proposal });
          return;
        }
        continue;
      }

      res.json({ reply: msg.content || '', proposal: proposal || null });
      return;
    }

    res.json({ reply: '已超过最大推理轮数，请换一种问法。', proposal: proposal || null });
  } catch (err) {
    res.status(502).json({ error: err.message || 'AI 请求失败' });
  }
});

// ---------------------------------------------------------------------------
// 对话记录持久化
// ---------------------------------------------------------------------------

// POST /api/ai/conversations —— 新建会话，body: { title? }
router.post('/conversations', (req, res) => {
  try {
    const title = (req.body && req.body.title) || '新对话';
    const info = db.prepare('INSERT INTO ai_conversations (title) VALUES (?)').run(title);
    res.json({ success: true, id: info.lastInsertRowid, title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/conversations —— 会话列表（按最近更新排序）
router.get('/conversations', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT c.id, c.title, c.updated_at,
             (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS msg_count
      FROM ai_conversations c
      ORDER BY c.updated_at DESC, c.id DESC
    `).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ai/conversations/:id —— 删除会话（含其消息）
router.delete('/conversations/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM ai_messages WHERE conversation_id = ?').run(req.params.id);
    db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/conversations/:id/messages —— 读取某会话的历史消息
router.get('/conversations/:id/messages', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, role, content, created_at FROM ai_messages
      WHERE conversation_id = ? ORDER BY id
    `).all(req.params.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/conversations/:id/messages —— 追加一条消息；默认截断过长历史
router.post('/conversations/:id/messages', (req, res) => {
  try {
    const { role, content } = req.body;
    if (!role || typeof content !== 'string') return res.status(400).json({ error: '缺少消息内容' });
    const info = db.prepare('INSERT INTO ai_messages (conversation_id, role, content) VALUES (?,?,?)').run(req.params.id, role, content);
    db.prepare('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    if (role === 'user') {
      // 用第一条用户消息作标题
      db.prepare("UPDATE ai_conversations SET title = ? WHERE id = ? AND title = '新对话'")
        .run((content || '新对话').slice(0, 30), req.params.id);
    }
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 流式对话（SSE）：逐字输出 + 工具调用 + 提案
// ---------------------------------------------------------------------------

// 读取 OpenAI 兼容服务的 SSE 流，逐块累积并回调文本增量
async function consumeStream(cfg, history, onDelta) {
  const { url, model } = resolveEndpoint(cfg);
  const body = { model, messages: history, tools: [queryTool, proposeWriteTool], tool_choice: 'auto', temperature: 0.2, stream: true };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`模型服务错误 ${r.status}: ${text.slice(0, 300)}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  const toolCalls = {}; // index -> { id, name, args }
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let chunk;
      try { chunk = JSON.parse(data); } catch (_) { continue; }
      const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        if (onDelta) onDelta(delta.content);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const slot = toolCalls[tc.index] || (toolCalls[tc.index] = { id: '', name: '', args: '' });
          if (tc.id) slot.id = tc.id;
          if (tc.function) {
            if (tc.function.name) slot.name += tc.function.name;
            if (tc.function.arguments) slot.args += tc.function.arguments;
          }
        }
      }
    }
  }
  const toolCallList = Object.values(toolCalls).map((t) => ({ id: t.id, name: t.name, arguments: t.args }));
  return { text, toolCalls: toolCallList };
}

// POST /api/ai/chat/stream —— body: { messages, conversationId? }
router.post('/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();
  const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) {} };

  let s;
  try { s = currentSettings(); } catch (_) {}
  if (!s || !s.enabled || !s.api_key) {
    send({ type: 'err', message: '尚未启用 / 配置 AI，请先在【系统设置 → AI 助手设置】填写并启用' });
    return res.end();
  }
  const { messages } = req.body;
  if (!Array.isArray(messages)) { send({ type: 'err', message: '缺少消息' }); return res.end(); }

  const history = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
  const conversationId = req.body.conversationId;
  let proposal = null;
  let reply = '';

  const saveMessage = (role, content) => {
    if (!conversationId) return;
    try {
      db.prepare('INSERT INTO ai_messages (conversation_id, role, content) VALUES (?,?,?)').run(conversationId, role, content || '');
      db.prepare('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversationId);
      if (role === 'user') {
        db.prepare("UPDATE ai_conversations SET title = ? WHERE id = ? AND title = '新对话'")
          .run((content || '新对话').slice(0, 30), conversationId);
      }
    } catch (_) {}
  };

  try {
    for (let r = 0; r < 6; r++) {
      send({ type: 'status', text: r === 0 ? '思考中…' : '继续思考…' });
      const { text, toolCalls } = await consumeStream(s, history, (d) => {
        reply += d;
        send({ type: 'delta', text: d });
      });

      if (toolCalls && toolCalls.length) {
        history.push({
          role: 'assistant',
          content: text || '',
          tool_calls: toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })),
        });
        send({ type: 'status', text: '查询数据中…' });
        let wrote = false;
        for (const tc of toolCalls) {
          let args = {};
          try { args = JSON.parse(tc.arguments || '{}'); } catch (_) {}
          let result;
          if (tc.name === 'query') {
            result = runQuery(args);
          } else if (tc.name === 'propose_write') {
            const p = normalizeProposal(args);
            if (p.ok) { proposal = { operation: p.operation, table: p.table, data: p.data, label: p.label }; }
            result = p.ok ? { ok: true, message: p.label, pending_user_confirmation: true } : { ok: false, error: p.error };
          } else {
            result = { error: '未知工具' };
          }
          history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          // 若本轮出现写提案，保存当前文本并停止继续推理
          if (proposal) {
            send({ type: 'proposal', proposal });
            if (conversationId) saveMessage('assistant', text);
            send({ type: 'done', reply });
            return res.end();
          }
          wrote = true;
        }
        // 纯查询轮：若没有文本则继续下一轮（可能模型还要再答）
        continue;
      }

      // 纯文本轮：stream 已把 delta 发给前端，这里是最终 reply
      reply = text || '';
      if (conversationId) saveMessage('assistant', reply);
      send({ type: 'done', reply });
      return res.end();
    }
    send({ type: 'done', reply });
    return res.end();
  } catch (err) {
    send({ type: 'err', message: err.message || 'AI 请求失败' });
    return res.end();
  }
});

// =========================================================================
// 文件上传解析接口：提取文本（PDF/Excel/Word/TXT/CSV等）返回给前端
// =========================================================================
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, error: '未上传文件' });
    }
    const { originalname, path: tempPath, mimetype } = req.file;
    let text = '';

    try {
      const ext = path.extname(originalname).toLowerCase();
      
      // TXT / CSV 纯文本：直接读取
      if (ext === '.txt' || ext === '.csv' || ext === '.md' || ext === '.json' || ext === '.xml' || ext === '.html') {
        text = fs.readFileSync(tempPath, 'utf-8');
      }
      // PDF：用 pdf-parse 提取文本（v2 起导出 PDFParse 类，不再是可调用函数）
      else if (ext === '.pdf') {
        // pdfjs 在 Node 下需要 DOMMatrix 全局；此前由 35MB 的 @napi-rs/canvas 提供。
        // 本应用只做文本提取（不渲染），改用纯 JS 轻量补丁，从而打包时剔除 canvas。
        // 必须在本行之前安装，pdf-parse 内部会用到该全局。
        require('../services/pdfDomShim');
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: fs.readFileSync(tempPath) });
        try {
          text = (await parser.getText()).text;
        } finally {
          await parser.destroy();
        }
      }
      // Word (.docx)：用 mammoth 提取文本
      else if (ext === '.docx' || ext === '.doc') {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: tempPath });
        text = result.value;
      }
      // Excel (.xlsx/.xls/.csv)：用 xlsx 提取所有单元格文本
      else if (ext === '.xlsx' || ext === '.xls') {
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(tempPath);
        const lines = [];
        workbook.SheetNames.forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          lines.push(`=== Sheet: ${sheetName} ===`);
          json.forEach((row) => {
            lines.push(row.map(String).join('\t'));
          });
        });
        text = lines.join('\n');
      }
      // 默认：尝试按文本读取
      else {
        text = fs.readFileSync(tempPath, 'utf-8');
      }

      // 限制总长度：AI 有 context 限制，这里截一下
      const MAX_LEN = 100000; // ~100KB，足够一般使用
      if (text.length > MAX_LEN) {
        text = text.slice(0, MAX_LEN) + `\n\n...（文件太长，已截断至 ${MAX_LEN} 字符）`;
      }
    } catch (err) {
      // 提取失败，直接返回文件名 + 错误提示
      text = `文件名：${originalname}\n\n错误：提取文本失败 (${err.message})`;
    } finally {
      // 删除临时文件
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }

    return res.json({
      success: true,
      data: {
        filename: originalname,
        text: text,
        length: text.length,
      },
    });
  } catch (err) {
    return res.json({ success: false, error: err.message || '解析文件失败' });
  }
});

module.exports = router;
module.exports.READ_TABLES = READ_TABLES;
module.exports.WRITE_TABLES = WRITE_TABLES;