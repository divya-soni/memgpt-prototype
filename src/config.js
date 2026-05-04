const path = require("node:path");

require("dotenv").config({
    path: [
        path.join(__dirname, "..", ".env"),
        path.join(__dirname, ".env"),
    ],
    quiet: true,
});

const config = {
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    databaseUrl: process.env.DATABASE_URL,
    model: process.env.OPENROUTER_MODEL || "qwen/qwen3-235b-a22b-2507",
    temperature: Number(process.env.OPENROUTER_TEMPERATURE || 0.2),
    appUrl: process.env.APP_URL || "http://localhost:3000",
    appName: process.env.APP_NAME || "mem-gpt-cli",
};

function assertConfig() {
    if (!config.openRouterApiKey) {
        throw new Error("OPENROUTER_API_KEY is not set in the environment.");
    }
}

function assertDatabaseConfig() {
    if (!config.databaseUrl) {
        throw new Error("DATABASE_URL is not set in the environment.");
    }
}

module.exports = {
    config,
    assertConfig,
    assertDatabaseConfig,
};
