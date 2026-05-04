const { getPool } = require("./db");
const { elapsedMs, performance } = require("./timing");

async function insertMessage({
    userId,
    agentId,
    sessionId,
    role,
    content,
    metadata = {},
}) {
    const startTime = performance.now();

    try {
        const result = await getPool().query(
            `
            INSERT INTO messages (
                user_id,
                agent_id,
                session_id,
                role,
                content,
                metadata_json
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            `,
            [userId, agentId, sessionId, role, content, metadata]
        );

        return {
            message: result.rows[0],
            durationMs: elapsedMs(startTime),
        };
    } catch (error) {
        error.durationMs = elapsedMs(startTime);
        error.timingCategory = "db";
        throw error;
    }
}

async function searchMessages({ sessionId, query, limit = 5 }) {
    const startTime = performance.now();

    try {
        const result = await getPool().query(
            `
            SELECT
                id,
                role,
                content,
                timestamp
            FROM messages
            WHERE session_id = $1
              AND content IS NOT NULL
              AND content <> ''
              AND content ILIKE '%' || $2 || '%'
            ORDER BY timestamp DESC
            LIMIT $3
            `,
            [sessionId, query, limit]
        );

        return {
            messages: result.rows,
            durationMs: elapsedMs(startTime),
        };
    } catch (error) {
        error.durationMs = elapsedMs(startTime);
        error.timingCategory = "db";
        throw error;
    }
}

module.exports = {
    insertMessage,
    searchMessages,
};
