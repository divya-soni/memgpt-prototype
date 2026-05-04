const { endPool, getPool } = require("./db");

async function testDb() {
  try {
    const result = await getPool().query("SELECT NOW()");
    console.log("Connected to Postgres:", result.rows[0]);
  } catch (err) {
    console.error("Postgres connection failed:", err);
  } finally {
    await endPool();
  }
}

testDb();
