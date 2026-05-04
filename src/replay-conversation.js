const { createAgentState, runAgent } = require("./agent");
const { endPool } = require("./db");

const turns = [
    "hi, my name is Divya",
    "what is MemGPT",
    "who invented MemGPT",
    "what is the world like before MemGPT",
    "who is zhang et al",
];

async function replayConversation() {
    const agentState = createAgentState({
        userId: "replay-user",
        agentId: "replay-agent",
        sessionId: `replay-${Date.now()}`,
    });

    console.log("Replaying conversation.\n");

    for (const turn of turns) {
        console.log(`> ${turn}`);

        try {
            const response = await runAgent(agentState, turn);

            if (response.type === "message") {
                console.log(`\nAssistant: ${response.content}\n`);
            } else {
                console.log(`\nAssistant response of type "${response.type}" is not supported in this replay.\n`);
                console.log(`\nAssistant: ${response.content}\n`);
            }
        } catch (error) {
            console.error(`\nError: ${error.message}\n`);
            break;
        }
    }
}

if (require.main === module) {
    replayConversation()
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(async () => {
            await endPool();
        });
}

module.exports = {
    replayConversation,
};
