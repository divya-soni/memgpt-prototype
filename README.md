# MemGPT Prototype

A small Node.js CLI prototype inspired by MemGPT, built to explore virtual context management for AI agents.

The agent keeps recent conversation in an active FIFO queue, stores messages in Postgres, can recall older messages by keyword, writes recursive summaries during eviction, and supports heartbeat-style continuation after tool-like model responses.

## Tech Stack

- Node.js
- OpenRouter
- OpenAI SDK
- PostgreSQL
- pgvector
- dotenv

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your environment file

Copy the example file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill in the required values:

```env
OPENROUTER_API_KEY=your_openrouter_key
DATABASE_URL=postgres://your_user:your_password@localhost:5432/your_db
OPENROUTER_MODEL=qwen/qwen3-235b-a22b-2507
OPENROUTER_TEMPERATURE=0.2
APP_URL=http://localhost:3000
APP_NAME=mem-gpt-cli

POSTGRES_USER=your_user
POSTGRES_PASSWORD=your_password
POSTGRES_DB=your_db
```

The `.env` file is ignored by Git.

### 3. Start Postgres with pgvector

```bash
docker compose -f local-postgres/docker-compose.yml up -d
```

### 4. Initialize the database

```bash
node src/init-db.js
```

This creates the `messages` table and enables the `vector` extension.

### 5. Start the CLI

```bash
node index.js
```

You should see:

```text
MemGPT CLI started. Type 'exit' or 'quit' to stop.

>
```

## Useful Scripts

Run the memory and queue demo:

```bash
node src/demo-memory-cases.js
```

Replay a sample conversation:

```bash
node src/replay-conversation.js
```

View the latest messages in the database:

```bash
node src/view-messages.js
```

Check database connectivity:

```bash
node src/test-db.js
```

## Syntax Checks

```bash
node --check index.js
node --check src/agent.js
node --check src/model.js
node --check src/queue-manager.js
node --check src/messages.js
```

## Notes

- The project uses OpenRouter through the OpenAI SDK.
- Recall search is currently keyword-based over the `messages` table.
- `pgvector` is enabled in the schema, but embedding-based recall is not implemented yet.
- The queue manager currently uses message-count thresholds instead of token-count thresholds.
