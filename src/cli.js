const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { createAgentState, runAgent } = require("./agent");

const EXIT_COMMANDS = new Set(["exit", "quit"]);

async function startCli() {
    const rl = readline.createInterface({
        input,
        output,
        prompt: "> ",
    });
    const agentState = createAgentState();

    console.log("MemGPT CLI started. Type 'exit' or 'quit' to stop.\n");

    while (true) {
        const userMessage = (await rl.question(rl.getPrompt())).trim();

        if (!userMessage) {
            continue;
        }

        if (EXIT_COMMANDS.has(userMessage.toLowerCase())) {
            break;
        }

        try {
            const llmResponse = await runAgent(agentState, userMessage);
            
            if(llmResponse.type === "message") {
                console.log(`\nAssistant: ${llmResponse.content}\n`);
            } else {
                console.log(`\nAssistant response of type "${llmResponse.type}" is not supported in this CLI.\n`);
                console.log(`\nAssistant: ${llmResponse.content}\n`);
            }

        } catch (error) {
            console.error(`\nError: ${error.message}\n`);
        }
    }

    rl.close();
    console.log("\nGoodbye.");
}

module.exports = {
    startCli,
};
