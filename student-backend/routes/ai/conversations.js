const express = require('express');
const { db } = require('../../db');
const { currentSettings } = require('./config');
const { buildSystemPrompt, callLLM, consumeStream, getTools } = require('./llm');
// 工具执行器惰性加载：仅在执行工具/取工具信息时才 require
const tools = () => require('./tools');
const { loadConversationContext, compressConversation, CONTEXT_COMPRESS_AT, compressingConvs } = require('./memory');
// 安全通道：SSE 逐帧封包（仅在加密会话下生效，否则明文直通）
const { encodeStreamEvent } = require('../../services/secureChannel');

const router = express.Router();

// POST /api/ai/chat —— body: { messages: [{ role, content }] }
router.post('/chat', async (req, res) => {
  try {
    const s = currentSettings();
    if (!s.enabled || !s.api_key) {
      return res.status(400).json({ error: '尚未启用 / 配置 AI，请先在【系统设置 → AI 助手设置】填写并启用' });
    }
    const { messages } = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: '缺少消息' });

    // 本轮附件：前端上传时已解析成文本，随请求带给后端，供 read_document 按需读取
    const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
    const history = [{ role: 'system', content: buildSystemPrompt(req.user && req.user.dbSlug, attachments) }, ...messages];
    let proposal = null;
    let exportFile = null;
    let exportImage = null;
    const blocks = [];
    const ctx = { blocks, slug: req.user && req.user.dbSlug, images: tools().latestUserImages(messages), attachments };

    for (let i = 0; i < 6; i++) {
      const completion = await callLLM(s, history, getTools());
      const msg = completion.choices && completion.choices[0] && completion.choices[0].message;
      if (!msg) throw new Error('模型未返回内容');

      if (msg.tool_calls && msg.tool_calls.length) {
        history.push({
          role: 'assistant',
          content: msg.content || '',
          ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}),
          tool_calls: msg.tool_calls.map((t) => ({
            id: t.id,
            type: 'function',
            function: { name: t.function.name, arguments: t.function.arguments },
          })),
        });
        for (const tc of msg.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { /* 参数解析失败则视为空 */ }
          const out = await tools().runTool(tc.function.name, args, ctx);
          if (out.proposal) proposal = out.proposal;
          if (out.ask) ask = out.ask;
          if (out.exportFile) exportFile = out.exportFile;
          if (out.exportImage) exportImage = out.exportImage;
          history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out.result) });
        }
        // 一旦出现写提案，立即返回给前端确认，不再继续让模型渲染
        if (proposal) {
          const last = history[history.length - 1];
          res.json({ reply: tools().appendBlocks(last.role === 'assistant' ? last.content || '' : msg.content || '', blocks), proposal });
          return;
        }
        // 出现提问：返回给前端展示选项，等用户点选后作为新一轮消息继续
        if (ask) {
          res.json({ reply: tools().appendBlocks(msg.content || '', blocks), ask });
          return;
        }
        continue;
      }

      res.json({ reply: tools().appendBlocks(msg.content || '', blocks), proposal: proposal || null, exportFile: exportFile || null, exportImage: exportImage || null });
      return;
    }

    res.json({ reply: tools().appendBlocks('已超过最大推理轮数，请换一种问法。', blocks), proposal: proposal || null, exportFile: exportFile || null, exportImage: exportImage || null });
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
    // limit 存在时只取最近 N 条（升序返回），用于前端快速恢复会话，避免一次加载全部历史
    const limit = Number(req.query.limit);
    const rows = (Number.isInteger(limit) && limit > 0)
      ? db.prepare(`
          SELECT id, role, content, process_json, attachments_json, created_at FROM (
            SELECT id, role, content, process_json, attachments_json, created_at FROM ai_messages
            WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
          ) ORDER BY id
        `).all(req.params.id, limit)
      : db.prepare(`
          SELECT id, role, content, process_json, attachments_json, created_at FROM ai_messages
          WHERE conversation_id = ? ORDER BY id
        `).all(req.params.id);
    // 过程块 / 附件按 JSON 字符串落库，返回前解析成对象
    const data = rows.map((r) => {
      const { process_json: pj, attachments_json: aj, ...rest } = r;
      let process = null;
      if (pj) { try { process = JSON.parse(pj); } catch (_) { process = null; } }
      let attachments = [];
      if (aj) { try { const p = JSON.parse(aj); if (Array.isArray(p)) attachments = p; } catch (_) { /* 忽略损坏记录 */ } }
      return { ...rest, process, attachments };
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/conversations/:id/messages —— 追加一条消息；默认截断过长历史
router.post('/conversations/:id/messages', (req, res) => {
  try {
    const { role, content, process, attachments } = req.body;
    if (!role || typeof content !== 'string') return res.status(400).json({ error: '缺少消息内容' });
    // 过程块（步骤 / 思维链 / 耗时）以 JSON 字符串落库
    let processJson = '';
    if (process) { try { processJson = JSON.stringify(process); } catch (_) { processJson = ''; } }
    // 本轮上传的文件（{name, text}）随消息落库，后续轮次仍可读取（完整上下文）
    let attachmentsJson = '';
    if (Array.isArray(attachments) && attachments.length) {
      try { attachmentsJson = JSON.stringify(attachments.filter((a) => a && a.name && a.text)); } catch (_) { attachmentsJson = ''; }
    }
    const info = db.prepare('INSERT INTO ai_messages (conversation_id, role, content, process_json, attachments_json) VALUES (?,?,?,?,?)').run(req.params.id, role, content, processJson, attachmentsJson);
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

// PUT /api/ai/conversations/:id/messages/:mid —— 覆盖更新一条消息的正文与过程块
// 用于「反馈轮次并入原助手消息」：后续轮次的输出继续写回同一条助手消息，时间轴保持连续
router.put('/conversations/:id/messages/:mid', (req, res) => {
  try {
    const { content, process } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: '缺少消息内容' });
    let processJson = '';
    if (process) { try { processJson = JSON.stringify(process); } catch (_) { processJson = ''; } }
    db.prepare('UPDATE ai_messages SET content = ?, process_json = ? WHERE id = ? AND conversation_id = ?')
      .run(content, processJson, req.params.mid, req.params.id);
    db.prepare('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ai/conversations/:id/messages/last-assistant —— 重试前移除最近一条助手回复
router.delete('/conversations/:id/messages/last-assistant', (req, res) => {
  try {
    const row = db.prepare("SELECT id FROM ai_messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1").get(req.params.id);
    if (row) db.prepare('DELETE FROM ai_messages WHERE id = ?').run(row.id);
    res.json({ success: true, removed: !!row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/conversations/:id/messages/delete —— 回退本轮时按消息 id 精确删除（body: { ids }）
router.post('/conversations/:id/messages/delete', (req, res) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (!ids.length) return res.json({ success: true, removed: 0 });
    const info = db.prepare(
      `DELETE FROM ai_messages WHERE conversation_id = ? AND id IN (${ids.map(() => '?').join(',')})`
    ).run(req.params.id, ...ids);
    db.prepare('UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    res.json({ success: true, removed: info.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/ai/chat/stream —— body: { messages, attachments, conversationId }
//   消息落库由前端另行负责；conversationId 存在时，后端按会话从库中重建完整上下文
//   （全量历史消息 + 历史附件），并用已有摘要裁剪较早部分，接近上下文上限时自动压缩。
router.post('/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();
  const send = (obj) => { try { res.write(`data: ${JSON.stringify(encodeStreamEvent(req, obj))}\n\n`); } catch (_) {} };

  // 客户端断开（用户点「中断」或关闭页面）时 res 会触发 close：
  //   - 标记 clientGone，让下方循环及时停止、不再调用模型
  //   - 该信号传给 consumeStream，同步 abort 上游 fetch，避免白跑
  // 断开后写入 res 可能触发 'error'（EPIPE），这里吞掉，避免未捕获异常
  res.on('error', () => {});
  const clientGone = new AbortController();
  res.on('close', () => { if (!res.writableEnded) clientGone.abort(); });

  let s;
  try { s = currentSettings(); } catch (_) {}
  if (!s || !s.enabled || !s.api_key) {
    send({ type: 'err', message: '尚未启用 / 配置 AI，请先在【系统设置 → AI 助手设置】填写并启用' });
    return res.end();
  }

  // 完整上下文：优先按会话从数据库重建（含全量历史消息与历史附件），并用已有摘要裁剪较早部分；
  // 无有效会话 id 时回退到前端本次带来的消息与附件。
  const conversationId = Number(req.body && req.body.conversationId) || 0;
  let convCtx = conversationId ? loadConversationContext(conversationId) : null;
  let messages = convCtx ? convCtx.messages : req.body.messages;
  if (!Array.isArray(messages)) { send({ type: 'err', message: '缺少消息' }); return res.end(); }
  let attachments = convCtx
    ? convCtx.attachments
    : (Array.isArray(req.body.attachments) ? req.body.attachments : []);

  // 安全网：上一轮实际用量已超过阈值时先同步压缩，避免本轮直接撑爆上下文
  if (convCtx && convCtx.lastPromptTokens > CONTEXT_COMPRESS_AT && !compressingConvs.has(conversationId)) {
    compressingConvs.add(conversationId);
    try {
      if (await compressConversation(s, conversationId, convCtx.effectiveRows, convCtx.upto)) {
        convCtx = loadConversationContext(conversationId);
        messages = convCtx.messages;
        attachments = convCtx.attachments;
      }
    } catch (_) { /* 压缩失败不阻塞对话 */ }
    finally { compressingConvs.delete(conversationId); }
  }

  const history = [{ role: 'system', content: buildSystemPrompt(req.user && req.user.dbSlug, attachments, convCtx && convCtx.summary) }, ...messages];
  let proposal = null;
  let ask = null;
  let exportFile = null;
  let exportImage = null;
  let answerText = ''; // 仅最终轮的正文；中间轮（调用工具那几轮）的草稿文本归入过程块
  const blocks = [];   // record 表格 / chart 图表数据块（拼到正文末尾，前端渲染）
  const ctx = { blocks, slug: req.user && req.user.dbSlug, images: tools().latestUserImages(messages), attachments };
  const steps = [];    // 过程块：本轮所有步骤（过程文本 / 工具调用）
  let stepSeq = 0;
  const startedAt = Date.now();
  // 本轮对话累计 token（含工具调用的所有轮次；服务未返回用量时保持 0）
  const tokenTotal = { prompt: 0, completion: 0, total: 0 };
  let maxPromptTokens = 0; // 单次调用最大的 prompt token（判断是否接近上下文上限）
  const donePayload = () => {
    afterRound();
    return {
      reply: tools().appendBlocks(answerText, blocks), steps, ms: Date.now() - startedAt,
      tokens: tokenTotal.total, promptTokens: tokenTotal.prompt, completionTokens: tokenTotal.completion,
    };
  };

  // 每轮结束时：记录本轮实际用量；若已达上下文阈值，后台摘要较早消息并持久化（不阻塞本次响应）
  function afterRound() {
    if (!conversationId || maxPromptTokens <= 0) return;
    try { db.prepare('UPDATE ai_conversations SET last_prompt_tokens = ? WHERE id = ?').run(maxPromptTokens, conversationId); } catch (_) {}
    if (!convCtx || maxPromptTokens <= CONTEXT_COMPRESS_AT || compressingConvs.has(conversationId)) return;
    compressingConvs.add(conversationId);
    const rows = convCtx.effectiveRows;
    const upto = convCtx.upto;
    setImmediate(async () => {
      try { await compressConversation(s, conversationId, rows, upto); }
      catch (_) { /* 后台压缩失败忽略，下次再试 */ }
      finally { compressingConvs.delete(conversationId); }
    });
  }

  // 消息落库统一由前端的 POST /conversations/:id/messages 负责（含图片多模态、错误提示），
  // 这里不再重复写入，否则刷新后同一轮回答会出现两条。

  try {
    // 工具链轮次上限：只要模型持续调用工具就继续，直到模型自己给出最终回答；上限仅作防死循环兜底
    for (let r = 0; r < 12; r++) {
      if (clientGone.signal.aborted) return res.end();
      const { text, toolCalls, reasoning, usage } = await consumeStream(
        s,
        history,
        (d) => send({ type: 'delta', text: d }),
        (d) => send({ type: 'reasoning', text: d }),
        clientGone.signal
      );
      if (usage) {
        maxPromptTokens = Math.max(maxPromptTokens, usage.prompt_tokens || 0);
        tokenTotal.prompt += usage.prompt_tokens || 0;
        tokenTotal.completion += usage.completion_tokens || 0;
        tokenTotal.total += usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
      }

      // 思考（思维链）作为时间轴上的一个步骤：插在本轮的工具/文本步骤之前，
      // 这样前端的过程块里「思考 / 工具」会按时间交替出现，而不是把思维链堆在最上面
      if (reasoning) {
        const reasonStep = { id: 'r' + (++stepSeq), kind: 'reason', text: reasoning, status: 'done' };
        steps.push(reasonStep);
        send({ type: 'step', step: reasonStep });
      }

      if (toolCalls && toolCalls.length) {
        // 中间轮的草稿文本归入过程块：前端收到后清空正文，把它作为一条「过程文本」步骤
        if (text) {
          const textStep = { id: 'p' + (++stepSeq), kind: 'text', text };
          steps.push(textStep);
          send({ type: 'commit_process', text });
        }
        history.push({
          role: 'assistant',
          content: text || '',
          // 带 tools 的思考模式要求把思维链原样回传，否则后续轮次可能报错
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          tool_calls: toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })),
        });
        for (const tc of toolCalls) {
          const info = tools().TOOL_INFO[tc.name] || { running: '正在调用工具…', done: '调用工具' };
          const sid = 's' + (++stepSeq);
          const t0 = Date.now();
          send({ type: 'step', step: { id: sid, kind: 'tool', title: info.running, status: 'running' } });
          let args = {};
          try { args = JSON.parse(tc.arguments || '{}'); } catch (_) {}
          const out = await tools().runTool(tc.name, args, ctx);
          if (out.proposal) proposal = out.proposal;
          if (out.ask) ask = out.ask;
          const result = out.result;
          history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          // 工具执行结束 → 更新同一步骤为 done/error，并附上摘要与耗时
          const step = {
            id: sid,
            kind: 'tool',
            title: info.done,
            status: result && result.error ? 'error' : 'done',
            summary: tools().toolSummary(tc.name, result),
            detail: tools().toolDetailText(result),
            ms: Date.now() - t0,
          };
          steps.push(step);
          send({ type: 'step', step });
          // 导出文件：把规格下发给前端（前端负责生成文件并弹系统保存对话框），本轮继续让模型收尾
          if (out.exportFile) {
            exportFile = out.exportFile;
            send({ type: 'export_file', exportFile });
          }
          // 导出图片：把图片规格下发给前端（前端用 html2canvas 渲染成 PNG 并弹系统保存对话框）
          if (out.exportImage) {
            exportImage = out.exportImage;
            send({ type: 'export_image', exportImage });
          }
          // 若本轮出现写提案，下发提案并停止继续推理
          if (proposal) {
            send({ type: 'proposal', proposal });
            send({ type: 'done', ...donePayload() });
            return res.end();
          }
          // 出现提问：下发问题与选项，停止本轮，等用户点选后作为新一轮消息继续
          if (ask) {
            send({ type: 'ask', ask });
            send({ type: 'done', ...donePayload() });
            return res.end();
          }

        }
        continue;
      }

      // 纯文本轮：本轮文本即为最终正文（已通过 delta 流式发出）
      answerText = text || '';
      send({ type: 'done', ...donePayload() });
      return res.end();
    }
    send({ type: 'done', ...donePayload() });
    return res.end();
  } catch (err) {
    // 客户端已断开（用户中断）：静默结束，不回报错也不写 SSE
    if (clientGone.signal.aborted) return res.end();
    send({ type: 'err', message: err.message || 'AI 请求失败' });
    return res.end();
  }
});


module.exports = router;
