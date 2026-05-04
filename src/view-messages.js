const { endPool, getPool } = require("./db");

function truncate(value, maxLength = 80) {
    if (!value || value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, maxLength - 3)}...`;
}

async function viewMessages() {
    try {
        const result = await getPool().query(`
            SELECT
                id,
                user_id,
                agent_id,
                session_id,
                role,
                content,
                timestamp,
                metadata_json
            FROM messages
            ORDER BY timestamp DESC
            LIMIT 10
        `);

        const rows = result.rows.map((row) => ({
            id: row.id,
            role: row.role,
            user_id: row.user_id,
            agent_id: row.agent_id,
            session_id: row.session_id,
            timestamp: row.timestamp,
            content: truncate(row.content),
            metadata_json: row.metadata_json,
        }));

        console.table(rows);
    } catch (err) {
        console.error("Failed to load messages:", err.message);
    } finally {
        await endPool();
    }
}

viewMessages();
