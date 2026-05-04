const { createAgentState, runAgent } = require("./agent");
const { endPool } = require("./db");

const turns = [
    {
        label: "normal turn",
        message: "Hi, my name is Divya.",
    },
    {
        label: "normal turn",
        message: "I prefer concise answers unless the topic is deeply technical.",
    },
    {
        label: "normal turn",
        message: "I am building a small MemGPT-style CLI in Node.js.",
    },
    {
        label: "warning threshold",
        message: "We are near memory pressure. Answer briefly: what is pgvector?",
    },
    {
        label: "working memory heartbeat",
        message: "For technical topics, I prefer detailed explanations with implementation notes. If the system asks you to store this in working memory, request a heartbeat and then answer me normally.",
    },
    {
        label: "max queue eviction",
        message: "What does the queue manager do in MemGPT?",
    },
    {
        label: "post-eviction continuation",
        message: "What do you remember about my project and preferences?",
    },
    {
        label: "continued conversation",
        message: "Who is Zhang et al. in the context of long-context model papers?",
    },
    {
        label: "recall search for evicted detail",
        message: "Search recall if needed and request a heartbeat: what did I say my name was near the start of this conversation?",
    },
    {
        label: "recall search for project detail",
        message: "Search recall if needed and request a heartbeat: what kind of project did I say I am building?",
    },
];

function getRecursiveSummary(agentState) {
    const firstMessage = agentState.messages[0];

    if (firstMessage?.metadata?.type !== "recursive_summary") {
        return "";
    }

    return firstMessage.content;
}

function buildStateSnapshot(agentState) {
    const recallMessages = agentState.messages.filter((message) =>
        typeof message.content === "string"
        && message.content.startsWith("Recall search results for ")
    );

    return {
        workingMemory: [...agentState.workingMemory],
        recursiveSummary: getRecursiveSummary(agentState),
        recallSearchCount: recallMessages.length,
        lastRecallSearch: recallMessages.at(-1)?.content || "",
        systemMessages: agentState.messages
            .filter((message) => message.role === "system")
            .map((message) => message.content),
        queueLength: agentState.messages.length,
        queueRoles: agentState.messages.map((message) => message.role),
    };
}

function printStateSnapshot(title, snapshot) {
    console.log(`\n[state] ${title}`);
    console.log(`[state] queueLength=${snapshot.queueLength} queueRoles=${snapshot.queueRoles.join(",")}`);
    console.log(`[state] workingMemory=${JSON.stringify(snapshot.workingMemory)}`);

    if (snapshot.recursiveSummary) {
        console.log(`[state] recursiveSummary=${snapshot.recursiveSummary}`);
    } else {
        console.log("[state] recursiveSummary=(none)");
    }

    if (snapshot.lastRecallSearch) {
        console.log(`[state] lastRecallSearch=${snapshot.lastRecallSearch}`);
    } else {
        console.log("[state] lastRecallSearch=(none)");
    }

    console.log("");
}

function printStateChanges(before, after) {
    const memoryChanged = JSON.stringify(before.workingMemory) !== JSON.stringify(after.workingMemory);
    const summaryChanged = before.recursiveSummary !== after.recursiveSummary;
    const recallWritten = after.recallSearchCount > before.recallSearchCount;
    const recallEvicted = after.recallSearchCount < before.recallSearchCount;
    const queueChanged = before.queueLength !== after.queueLength;

    if (memoryChanged) {
        printStateSnapshot("working memory updated", after);
    }

    if (summaryChanged) {
        printStateSnapshot("recursive FIFO summary written", after);
    }

    if (recallWritten) {
        printStateSnapshot("recall search results written", after);
    }

    if (recallEvicted) {
        printStateSnapshot("recall search results evicted from FIFO", after);
    }

    if (!memoryChanged && !summaryChanged && !recallWritten && !recallEvicted && queueChanged) {
        console.log(`[state] queueLength=${after.queueLength} queueRoles=${after.queueRoles.join(",")}\n`);
    }
}

async function runDemoConversation() {
    const agentState = createAgentState({
        userId: "demo-user",
        agentId: "demo-agent",
        sessionId: `demo-${Date.now()}`,
    });

    console.log("Running memory/queue demo conversation.");
    console.log("Watch for [heartbeat] logs after tool-style responses.\n");
    printStateSnapshot("initial", buildStateSnapshot(agentState));

    for (const turn of turns) {
        const before = buildStateSnapshot(agentState);

        console.log(`[case] ${turn.label}`);
        console.log(`> ${turn.message}`);

        try {
            const response = await runAgent(agentState, turn.message);
            const after = buildStateSnapshot(agentState);

            if (response.type === "message") {
                console.log(`\nAssistant: ${response.content}\n`);
            } else {
                console.log(`\nAssistant response of type "${response.type}" is not supported in this demo.\n`);
                console.log(`Assistant: ${response.content}\n`);
            }

            printStateChanges(before, after);
        } catch (error) {
            const after = buildStateSnapshot(agentState);
            console.error(`\nError: ${error.message}\n`);
            printStateSnapshot("state after error", after);
            break;
        }
    }

    printStateSnapshot("final", buildStateSnapshot(agentState));
}

if (require.main === module) {
    runDemoConversation()
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(async () => {
            await endPool();
        });
}

module.exports = {
    runDemoConversation,
};
