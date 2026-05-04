const { performance } = require("node:perf_hooks");

function elapsedMs(startTime) {
    return Math.round(performance.now() - startTime);
}

function logTurnTiming({ totalMs, dbMs, llmMs, status = "ok" }) {
    const statusText = status === "error" ? " status=error" : "";
    console.log(`[timing] total=${totalMs}ms [db=${dbMs}ms llm=${llmMs}ms]${statusText}`);
}

module.exports = {
    elapsedMs,
    logTurnTiming,
    performance,
};
