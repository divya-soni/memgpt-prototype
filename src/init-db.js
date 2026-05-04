const { endPool, getPool } = require("./db");

async function initDb() {
  try {
    const pool = getPool();

    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,

        user_id TEXT,
        agent_id TEXT,
        session_id TEXT,

        role TEXT CHECK (
          role IN ('system', 'user', 'assistant', 'tool')
        ),

        content TEXT,

        timestamp TIMESTAMPTZ DEFAULT NOW(),

        metadata_json JSONB DEFAULT '{}'::jsonb,

        embedding vector(1536)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_user_id
      ON messages(user_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_agent_id
      ON messages(agent_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_session_id
      ON messages(session_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp
      ON messages(timestamp);
    `);

    console.log("Messages table initialized successfully.");
  } catch (err) {
    console.error("Database initialization failed:", err);
  } finally {
    await endPool();
  }
}

initDb();
