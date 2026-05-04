const { Pool } = require("pg");
const { assertDatabaseConfig, config } = require("./config");

let pool;

function getPool() {
    assertDatabaseConfig();

    if (!pool) {
        pool = new Pool({
            connectionString: config.databaseUrl,
        });
    }

    return pool;
}

async function endPool() {
    if (pool) {
        await pool.end();
        pool = undefined;
    }
}

module.exports = {
    getPool,
    endPool,
};
