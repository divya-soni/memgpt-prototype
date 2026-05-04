const OpenAI = require("openai");
const { assertConfig, config } = require("./config");
const { elapsedMs, performance } = require("./timing");

let client;

function getClient() {
    assertConfig();

    if (!client) {
        client = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: config.openRouterApiKey,
            defaultHeaders: {
                "HTTP-Referer": config.appUrl,
                "X-OpenRouter-Title": config.appName,
            },
        });
    }

    return client;
}

async function callChatCompletion(messages) {
    const startTime = performance.now();
    let response;

    try {
        response = await getClient().chat.completions.create({
            model: config.model,
            temperature: config.temperature,
            messages,
        });

        response.durationMs = elapsedMs(startTime);
    } catch (error) {
        error.durationMs = elapsedMs(startTime);
        error.timingCategory = "llm";
        throw error;
    }

    const content = response.choices?.[0]?.message?.content;
    const message = Array.isArray(content)
        ? content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("")
        : content;

    if (!message) {
        const error = new Error("Model response did not include any assistant content.");
        error.durationMs = response.durationMs;
        error.timingCategory = "llm";
        throw error;
    }

    return {
        message,
        durationMs: response.durationMs,
    };
}

async function callModel(agentState) {
    const messages = [
        {
            role: "system",
            content: agentState.systemPrompt,
        },
        {
            role: "system",
            content: `Here is some working context that you can use while responding to the user: ${JSON.stringify(agentState.workingMemory)}`,
        },
        ...agentState.messages,
    ];

    return callChatCompletion(messages);
}

module.exports = {
    callChatCompletion,
    callModel,
};
