// schema 拆分子文件：AI 助手相关表（模型配置 / 模型管理 / 会话 / 消息）+ 各列历史迁移。
function migrateAi(conn) {
  conn.exec(`
    -- AI 助手：模型接入配置（密钥存在已加密的教师库内，仅后端使用）
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER DEFAULT 0,
      provider TEXT DEFAULT 'deepseek',
      base_url TEXT DEFAULT '',
      model TEXT DEFAULT '',
      api_key TEXT DEFAULT ''
    );
    INSERT OR IGNORE INTO ai_settings (id) VALUES (1);

    -- AI 助手：模型管理（多模型列表，is_active 标记当前选中，密钥仅存本机）
    CREATE TABLE IF NOT EXISTS ai_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT '',
      provider TEXT DEFAULT 'deepseek',
      base_url TEXT DEFAULT '',
      model TEXT DEFAULT '',
      api_key TEXT DEFAULT '',
      is_active INTEGER DEFAULT 0,
      reasoning INTEGER DEFAULT 1
    );

    -- AI 助手：对话记录（会话 + 消息）
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT '新对话',
      -- 上下文压缩：summary 为较早消息的摘要，summary_upto 为已摘要到的消息 id（含）；
      -- last_prompt_tokens 记录最近一轮模型实际返回的 prompt token 用量，用于触发压缩
      summary TEXT DEFAULT '',
      summary_upto INTEGER DEFAULT 0,
      last_prompt_tokens INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT DEFAULT '',
      process_json TEXT DEFAULT '',
      -- 该条消息附带的文件（[{name, text}]，JSON 字符串），供后续轮次仍能读取
      attachments_json TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages (conversation_id, id);
  `);
}

module.exports = { migrateAi };
