const { callChatCompletion, callModel } = require("./model");
const { insertMessage, searchMessages } = require("./messages");
const { elapsedMs, logTurnTiming, performance } = require("./timing");
const {
    appendWorkingMemoryItem,
    replaceWorkingMemoryItem,
} = require("./working-memory");
const { parseJsonResponse } = require("./json-response");


const WARNING_QUEUE_LENGTH = 7;
const MAX_QUEUE_LENGTH = 10;
const EVICT_COUNT = 5;
const MAX_TOOL_CALLS = 4;
const MEMORY_FOLLOWUP_PROMPT = "Working memory was updated. Answer the user's latest message now. Return only a normal JSON message response with type \"message\" and content as a string.";
const RECALL_SEARCH_FOLLOWUP_PROMPT = `Recall search completed. You are now in final-answer mode.
You must not call recall_search again for this user request.
Allowed response type now: "message" only.
Answer the user's latest message using the recall results already provided.
Return only a normal JSON message response with type "message" and content as a string.`;

function parseModelResponse(llmResponse, stage) {
    try {
        return parseJsonResponse(llmResponse);
    } catch (error) {
        console.error(`[queue-manager] Failed to parse model JSON during ${stage}.`);
        console.error(`[queue-manager] Raw model response: ${llmResponse}`);
        throw error;
    }
}

function formatRecallSearchResults(query, messages) {
    if (messages.length === 0) {
        return `Recall search results for "${query}": no matching messages found.`;
    }

    const formattedMessages = messages
        .map((message, index) => {
            const timestamp = message.timestamp instanceof Date
                ? message.timestamp.toISOString()
                : message.timestamp;

            return `${index + 1}. [${message.role} at ${timestamp}] ${message.content}`;
        })
        .join("\n");

    return `Recall search results for "${query}":\n${formattedMessages}`;
}

function shouldHeartbeat(parsedResponse) {
    return parsedResponse.request_heartbeat !== false;
}

async function continueModel(agentState, llmMsRef, stage) {
    const llmResult = await callModel(agentState);
    llmMsRef.value += llmResult.durationMs;

    return {
        llmResponse: llmResult.message,
        parsedResponse: parseModelResponse(llmResult.message, stage),
    };
}

async function processQueue(agentState) {
    const queueLength = agentState.messages.length;
    agentState.memoryWriteAllowed = false;

    if(queueLength < WARNING_QUEUE_LENGTH) {
        console.log(`[queue-manager] FIFO queue length is ${queueLength}, below warning threshold of ${WARNING_QUEUE_LENGTH}`);
        return;
    }

    if(queueLength >= WARNING_QUEUE_LENGTH && queueLength < MAX_QUEUE_LENGTH) {
        console.warn(`[queue-manager] Warning: FIFO queue length is ${queueLength}, approaching the maximum of ${MAX_QUEUE_LENGTH}`);
        agentState.memoryWriteAllowed = true;

        agentState.messages.push({
            role: "system",
            content: `
            Warning: conversation FIFO queue length is approaching the maximum. Store one concise summary or important item in working memory using working_memory_append or working_memory_replace, then continue the conversation. The system will delete old messages from the queue once the maximum length is reached, so if you want to keep important information, store it in working memory.`
        });

        return;

    }
}

async function summarizeWorkingMemory(workingMemory) {
    return workingMemory.join("\n");
}

async function evictAndSummarizeFIFO(agentState) {
    const existingSummary = agentState.messages[0]?.metadata?.type === "recursive_summary"
        ? agentState.messages[0].content
        : "";
    const startIndex = existingSummary ? 1 : 0;
    const evictedMessages = agentState.messages.slice(startIndex, startIndex + EVICT_COUNT);

    if (evictedMessages.length === 0) {
        return {
            durationMs: 0,
            evictedCount: 0,
        };
    }

    console.warn(`[queue-manager] FIFO queue length reached ${agentState.messages.length}. Evicting ${evictedMessages.length} messages.`);

    const summaryInput = evictedMessages
        .map((message, index) => `${index + 1}. ${message.role}: ${message.content}`)
        .join("\n");

    const summaryResult = await callChatCompletion([
        {
            role: "system",
            content: "Summarize conversation messages for recursive FIFO memory. Return plain text only, not JSON. Preserve durable facts, user preferences, unresolved questions, and important context. Be concise.",
        },
        {
            role: "user",
            content: `Existing recursive summary:\n${existingSummary || "(none)"}\n\nMessages being evicted:\n${summaryInput}`,
        },
    ]);

    const summaryMessage = {
        role: "system",
        content: `Recursive summary of evicted conversation messages:\n${summaryResult.message}`,
        metadata: {
            type: "recursive_summary",
        },
    };

    agentState.messages.splice(startIndex, evictedMessages.length);

    if (existingSummary) {
        agentState.messages[0] = summaryMessage;
    } else {
        agentState.messages.unshift(summaryMessage);
    }

    console.warn(`[queue-manager] FIFO queue length after eviction is ${agentState.messages.length}.`);

    return {
        durationMs: summaryResult.durationMs,
        evictedCount: evictedMessages.length,
    };

}

async function handleMessage(message, agentState) {
    const startTime = performance.now();
    let dbMs = 0;
    let llmMs = 0;

    try {
        agentState.messages.push({
            role: "user",
            content: message,
        });
        
        const userInsert = await insertMessage({
            userId: agentState.userId,
            agentId: agentState.agentId,
            sessionId: agentState.sessionId,
            role: "user",
            content: message,
        });
        dbMs += userInsert.durationMs;

        await processQueue(agentState);

        if (agentState.messages.length >= MAX_QUEUE_LENGTH) {
            const evictionResult = await evictAndSummarizeFIFO(agentState);
            llmMs += evictionResult.durationMs;
            agentState.memoryWriteAllowed = false;
        }

        let llmMsRef = { value: llmMs };
        let llmResult = await callModel(agentState);
        llmMsRef.value += llmResult.durationMs;
        let llmResponse = llmResult.message;
        let parsedResponse = parseModelResponse(llmResponse, "initial_response");
        const recallQueriesThisTurn = new Set();

        for (let toolCallCount = 0; parsedResponse.type !== "message" && toolCallCount < MAX_TOOL_CALLS; toolCallCount += 1) {
            const heartbeatRequested = shouldHeartbeat(parsedResponse);

            if (
                (parsedResponse.type === "working_memory_append" || parsedResponse.type === "working_memory_replace")
                && !agentState.memoryWriteAllowed
            ) {
                agentState.messages.push({
                    role: "system",
                    content: "Working memory updates are not allowed on this turn because there is no memory pressure warning. Answer the user's latest message with a normal JSON message response.",
                });

                console.log(`[heartbeat] type=${parsedResponse.type} hop=${toolCallCount + 1} requested=true reason=blocked_memory_write`);
                ({ llmResponse, parsedResponse } = await continueModel(agentState, llmMsRef, "memory_write_blocked_followup"));
            } else if (parsedResponse.type === "working_memory_append") {
                appendWorkingMemoryItem(agentState.workingMemory, parsedResponse.content);
                agentState.memoryWriteAllowed = false;
                agentState.messages.push({
                    role: "system",
                    content: MEMORY_FOLLOWUP_PROMPT,
                });

                if (!heartbeatRequested) {
                    throw new Error("Tool response working_memory_append must request heartbeat so the agent can produce a user-facing message.");
                }

                console.log(`[heartbeat] type=${parsedResponse.type} hop=${toolCallCount + 1} requested=true`);
                ({ llmResponse, parsedResponse } = await continueModel(agentState, llmMsRef, "working_memory_append_followup"));
            } else if (parsedResponse.type === "working_memory_replace") {
                const replaced = replaceWorkingMemoryItem(
                    agentState.workingMemory,
                    parsedResponse.old_content,
                    parsedResponse.content
                );
                agentState.memoryWriteAllowed = false;
                agentState.messages.push({
                    role: "system",
                    content: replaced
                        ? MEMORY_FOLLOWUP_PROMPT
                        : "The requested working memory item was not found, so memory was not changed. Answer the user's latest message now. Return only a normal JSON message response with type \"message\" and content as a string.",
                });

                if (!heartbeatRequested) {
                    throw new Error("Tool response working_memory_replace must request heartbeat so the agent can produce a user-facing message.");
                }

                console.log(`[heartbeat] type=${parsedResponse.type} hop=${toolCallCount + 1} requested=true`);
                ({ llmResponse, parsedResponse } = await continueModel(agentState, llmMsRef, "working_memory_replace_followup"));
            } else if (parsedResponse.type === "recall_search") {
                const recallQuery = parsedResponse.query || "";

                if (recallQueriesThisTurn.has(recallQuery.toLowerCase())) {
                    agentState.messages.push({
                        role: "system",
                        content: `You already searched recall for "${recallQuery}" during this turn. Do not call recall_search again for the same query. Use the recall results already provided and answer the user's latest message with a normal JSON message response.`,
                    });

                    console.log(`[heartbeat] type=${parsedResponse.type} hop=${toolCallCount + 1} requested=true reason=duplicate_recall_search`);
                    ({ llmResponse, parsedResponse } = await continueModel(agentState, llmMsRef, "duplicate_recall_search_followup"));
                    continue;
                }

                recallQueriesThisTurn.add(recallQuery.toLowerCase());

                const recallResult = await searchMessages({
                    sessionId: agentState.sessionId,
                    query: recallQuery,
                    limit: 5,
                });
                dbMs += recallResult.durationMs;

                console.log(`[recall-search] query="${recallQuery}" results=${recallResult.messages.length} duration=${recallResult.durationMs}ms`);

                agentState.messages.push({
                    role: "system",
                    content: formatRecallSearchResults(recallQuery, recallResult.messages),
                });
                agentState.messages.push({
                    role: "system",
                    content: RECALL_SEARCH_FOLLOWUP_PROMPT,
                });

                if (!heartbeatRequested) {
                    throw new Error("Tool response recall_search must request heartbeat so the agent can produce a user-facing message.");
                }

                console.log(`[heartbeat] type=${parsedResponse.type} hop=${toolCallCount + 1} requested=true`);
                ({ llmResponse, parsedResponse } = await continueModel(agentState, llmMsRef, "recall_search_followup"));
            } else {
                agentState.messages.push({
                    role: "system",
                    content: `Unsupported response type "${parsedResponse.type}". Answer the user's latest message with a normal JSON message response.`,
                });

                console.log(`[heartbeat] type=${parsedResponse.type} hop=${toolCallCount + 1} requested=true reason=unsupported_type`);
                ({ llmResponse, parsedResponse } = await continueModel(agentState, llmMsRef, "unsupported_type_followup"));
            }
        }

        llmMs = llmMsRef.value;

        if (parsedResponse.type !== "message") {
            throw new Error(`Model did not produce a final message response after ${MAX_TOOL_CALLS} tool calls.`);
        }

        agentState.messages.push({
            role: "assistant",
            content: llmResponse,
        });

        const assistantInsert = await insertMessage({
            userId: agentState.userId,
            agentId: agentState.agentId,
            sessionId: agentState.sessionId,
            role: "assistant",
            content: parsedResponse.content,
            metadata: {
                responseType: parsedResponse.type,
                rawResponse: llmResponse,
            },
        });
        dbMs += assistantInsert.durationMs;

        logTurnTiming({
            totalMs: elapsedMs(startTime),
            dbMs,
            llmMs,
        });

        return parsedResponse;
    } catch (error) {
        if (error.durationMs) {
            if (error.timingCategory === "db") {
                dbMs += error.durationMs;
            } else if (error.timingCategory === "llm") {
                llmMs += error.durationMs;
            }
        }

        logTurnTiming({
            totalMs: elapsedMs(startTime),
            dbMs,
            llmMs,
            status: "error",
        });
        throw error;
    }
}

module.exports = {
    evictAndSummarizeFIFO,
    handleMessage,
    summarizeWorkingMemory,
}
