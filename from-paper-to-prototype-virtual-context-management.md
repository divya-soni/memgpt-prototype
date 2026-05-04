# From Paper to Prototype: Implementing Virtual Context Management

I recently spent some time reading the MemGPT paper and wanted to understand the architecture by building a small prototype.

The part that interested me most was the paper's framing of the context window as a limited memory resource. Instead of treating the prompt as a static blob of text, MemGPT treats context as something that can be managed: messages can be kept in active context, summarized, moved into memory, or searched later from external storage.

This post is a walkthrough of the prototype I built while exploring that idea. It is not a full MemGPT implementation, but it helped me understand the core mechanics much better.

The prototype is a Node.js CLI agent with:

- a FIFO queue for active conversation context
- working memory updates
- Postgres-backed recall storage
- keyword search over past messages
- recursive summaries for evicted messages
- heartbeat-style continuation after tool calls

## Why Virtual Memory Is a Useful Analogy

The operating systems analogy is what made the paper interesting to me in the first place.

In an OS, a program behaves as if it has access to a large, continuous memory space. In reality, physical memory is limited. The OS creates the illusion of more memory by keeping active pages in RAM and moving less active pages to disk. When something is needed again, it can be paged back in.

MemGPT applies a similar idea to an LLM's context window.

The model's context window is like physical memory: fast, active, and limited. External storage is like disk: larger, slower, and not directly visible to the model unless the system retrieves from it. The queue manager is the part that decides what stays in active context, what gets summarized, and what can be searched later.

That gave me a useful way to reason about the prototype:

- FIFO queue: the model's active working set
- working memory: small durable context that should stay visible
- recall storage: messages that are outside active context but still recoverable
- recursive summary: compressed state for evicted context
- recall search: a way to page older information back into the prompt

The goal is not truly infinite memory. The model still has a finite context window. But the system can create the illusion of a much larger memory by managing what is visible at each step.

That was the reasoning I wanted to test in code: can I build a small runtime where the model does not need every old message in prompt, but can still recover useful context when needed?

## Starting Point

The agent runs as a simple CLI. The user types a message, the model responds, and a queue manager handles the memory-related work around the model call.

The agent state is intentionally small:

```js
{
  userId,
  agentId,
  sessionId,
  systemPrompt,
  workingMemory: [],
  messages: []
}
```

The two most important fields are:

- `messages`: the active FIFO queue that gets sent back to the model
- `workingMemory`: a small list of durable facts the model can use across turns

The rest of the conversation history is stored in Postgres as recall storage.

## Queue Manager

The queue manager is where most of the prototype lives. On each turn, it:

1. adds the user message to the FIFO queue
2. saves the user message to Postgres
3. checks queue pressure
4. calls the model
5. handles any tool-style response from the model
6. saves the final assistant response

The model always returns JSON. A normal response looks like:

```json
{
  "type": "message",
  "content": "pgvector is a PostgreSQL extension for storing embeddings and running vector similarity search."
}
```

But the model can also request an operation:

```json
{
  "type": "recall_search",
  "query": "name",
  "request_heartbeat": true
}
```

That response is not shown directly to the user. The queue manager executes the search, adds the result to the context, and calls the model again so it can produce a final answer.

This gave me a clearer sense of why MemGPT separates the LLM from the memory-management machinery. The model decides what it needs; the queue manager decides how that request is executed.

## Active Context as a FIFO Queue

The active conversation is stored in `agentState.messages`.

For now, I used message-count thresholds instead of token-count thresholds:

```js
const WARNING_QUEUE_LENGTH = 7;
const MAX_QUEUE_LENGTH = 10;
const EVICT_COUNT = 5;
```

When the queue reaches the warning length, the queue manager injects a system warning. That warning tells the model that older context may soon be evicted and gives it a chance to store important information in working memory.

One thing I changed while building this: working memory should not be updated just because the user says something interesting. In this prototype, working memory updates are only allowed after a memory-pressure warning.

That made the behavior feel more intentional. Memory writes happen because the active context is under pressure, not because every fact automatically deserves permanent storage.

## Working Memory

Working memory is a small in-memory list:

```js
workingMemory: []
```

The model can request:

```json
{
  "type": "working_memory_append",
  "content": "User is building a MemGPT-style CLI agent in Node.js.",
  "request_heartbeat": true
}
```

or:

```json
{
  "type": "working_memory_replace",
  "old_content": "User prefers concise answers.",
  "content": "User prefers detailed answers for technical topics.",
  "request_heartbeat": true
}
```

The queue manager validates whether memory writes are allowed on that turn. If they are allowed, it updates the working memory and heartbeats back into the model for a final response.

The logs make this easy to inspect:

```text
[working-memory] append duration=0ms memory=["User is building a MemGPT-style CLI agent in Node.js."]
[heartbeat] type=working_memory_append hop=1 requested=true
```

## Recursive Summaries

When the FIFO queue reaches the max length, older messages are evicted.

Before removing them, the queue manager makes a separate LLM call to summarize the messages being evicted. That summary is inserted as the first message in the queue:

```js
{
  role: "system",
  content: "Recursive summary of evicted conversation messages:\n...",
  metadata: {
    type: "recursive_summary"
  }
}
```

On later evictions, the existing recursive summary is included in the summarization prompt along with the new messages being evicted.

This was one of the most useful parts of the exercise. It showed me how context can be compressed progressively instead of simply truncated. The model loses the exact old messages from active context, but it keeps a summary of what mattered.

## Recall Storage

Every user and assistant message is saved to Postgres.

The table looks like this:

```sql
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  agent_id TEXT,
  session_id TEXT,
  role TEXT CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  metadata_json JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536)
);
```

I added `embedding vector(1536)` because I expect semantic search to be useful later, but the current prototype uses keyword search.

The search function is simple:

```js
searchMessages({ sessionId, query, limit: 5 })
```

It searches the current session using `ILIKE`, returns matching messages, and sends them back to the model as a system message:

```text
Recall search results for "name":
1. [user at ...] Hi, my name is Divya.
```

This helped separate two ideas:

- active context is what the model currently sees
- recall storage is what the system can retrieve when needed

A message can leave the FIFO queue but still be recoverable from the database.

## Heartbeat

Heartbeat is the mechanism that lets the model continue after a tool-style operation.

For example:

```json
{
  "type": "recall_search",
  "query": "project",
  "request_heartbeat": true
}
```

The queue manager runs the search, adds the results to the queue, and immediately calls the model again. The model can then answer the user using the returned results.

I added a maximum number of tool calls per turn:

```js
const MAX_TOOL_CALLS = 4;
```

This was necessary because the model can sometimes keep asking for the same tool. The runtime needs to support multi-step behavior, but it also needs a limit.

The logs show the flow:

```text
[recall-search] query="name" results=3 duration=9ms
[heartbeat] type=recall_search hop=1 requested=true
```

## Debugging the Loop

I added logs around the main moving parts:

- queue pressure
- working memory updates
- FIFO eviction
- recursive summaries
- recall search
- heartbeat hops
- DB and LLM timings

Example:

```text
[queue-manager] Warning: FIFO queue length is 7, approaching the maximum of 10
[working-memory] append duration=0ms memory=["User is building a MemGPT-style CLI agent in Node.js."]
[heartbeat] type=working_memory_append hop=1 requested=true
[queue-manager] FIFO queue length reached 10. Evicting 5 messages.
[recall-search] query="name" results=3 duration=9ms
[timing] total=8577ms [db=10ms llm=8565ms]
```

These logs were useful because the agent's behavior is not always obvious from the final assistant response. Seeing the internal state change made it much easier to understand where memory was being written, when context was being compressed, and when recall was being used.

## What I Learned

The main thing I learned is that memory in an agent is not just one feature.

In this prototype:

- the FIFO queue handles active context
- working memory stores compact durable facts
- recall storage stores full conversation history
- recursive summaries compress evicted messages
- heartbeat lets the model continue after memory operations

Each piece solves a different problem.

I also learned that the queue manager is as important as the memory stores themselves. The interesting behavior comes from the policy: when to warn, when to summarize, when to allow memory writes, when to search, and when to force the model to stop using tools and answer.

The prototype also made the paper easier to reason about. Instead of thinking about "long-term memory" as a single vague capability, I could see the system as a set of smaller mechanisms interacting with each other.

## Closing Thoughts

This was a useful paper-to-code exercise. The implementation is small, but it includes the pieces I wanted to understand:

- finite active context
- queue pressure
- working memory
- recall storage
- recall search
- recursive summarization
- heartbeat continuation

Building it made the MemGPT architecture feel much more concrete. I came away with a better intuition for virtual context management: not as a trick for stuffing more text into a prompt, but as a runtime strategy for deciding what the model should see, what should be compressed, and what can be retrieved later.
