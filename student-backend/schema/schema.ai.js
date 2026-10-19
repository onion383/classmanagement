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
    -- 将旧的单模型配置迁移为第一条已选模型（仅当旧配置曾填写过模型名/密钥/地址）
    INSERT INTO ai_models (name, provider, base_url, model, api_key, is_active)
    SELECT '主模型', provider, base_url, model, api_key, 1
    FROM ai_settings
    WHERE (COALESCE(model,'') != '' OR COALESCE(api_key,'') != '' OR COALESCE(base_url,'') != '')
      AND NOT EXISTS (SELECT 1 FROM ai_models);

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

  // 存量库迁移：为 AI 模型表补充 reasoning 列（是否开启思考模式，默认开启）
  {
    const aiCols = conn.prepare('PRAGMA table_info(ai_models)').all().map(c => c.name);
    if (!aiCols.includes('reasoning')) {
      conn.exec(`ALTER TABLE ai_models ADD COLUMN reasoning INTEGER DEFAULT 1`);
    }
  }

  // 存量库迁移：为 AI 消息表补充 process_json 列（过程块：步骤 / 思维链 / 耗时）
  {
    const msgCols = conn.prepare('PRAGMA table_info(ai_messages)').all().map(c => c.name);
    if (!msgCols.includes('process_json')) {
      conn.exec(`ALTER TABLE ai_messages ADD COLUMN process_json TEXT DEFAULT ''`);
    }
    // 存量库迁移：附件内容随消息落库，供后续轮次仍能读取历史文件
    if (!msgCols.includes('attachments_json')) {
      conn.exec(`ALTER TABLE ai_messages ADD COLUMN attachments_json TEXT DEFAULT ''`);
    }
  }

  // 存量库迁移：为 AI 会话表补充上下文压缩相关列
  {
    const convCols = conn.prepare('PRAGMA table_info(ai_conversations)').all().map(c => c.name);
    if (!convCols.includes('summary')) {
      conn.exec(`ALTER TABLE ai_conversations ADD COLUMN summary TEXT DEFAULT ''`);
    }
    if (!convCols.includes('summary_upto')) {
      conn.exec(`ALTER TABLE ai_conversations ADD COLUMN summary_upto INTEGER DEFAULT 0`);
    }
    if (!convCols.includes('last_prompt_tokens')) {
      conn.exec(`ALTER TABLE ai_conversations ADD COLUMN last_prompt_tokens INTEGER DEFAULT 0`);
    }
  }
}

module.exports = { migrateAi };
