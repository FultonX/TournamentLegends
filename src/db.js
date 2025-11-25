// src/db.js
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigrations() {
  const migrationsDir = path.join(__dirname, "migrations");

  if (!fs.existsSync(migrationsDir)) {
    console.warn("No migrations directory found at", migrationsDir);
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.warn("No migration files found in", migrationsDir);
    return;
  }

  console.log("Running migrations:", files);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      await client.query(sql);
    }
    await client.query("COMMIT");
    console.log("Migrations applied successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}

function convertPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function get(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  const result = await pool.query(pgSql, params);
  return result.rows[0];
}

async function all(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  const result = await pool.query(pgSql, params);
  return result.rows;
}

async function run(sql, params = []) {
  let pgSql = convertPlaceholders(sql);
  
  const isInsert = pgSql.trim().toUpperCase().startsWith("INSERT");
  if (isInsert && !pgSql.toUpperCase().includes("RETURNING")) {
    pgSql = pgSql.replace(/;?\s*$/, " RETURNING id;");
  }
  
  const result = await pool.query(pgSql, params);
  return {
    lastID: result.rows[0]?.id,
    changes: result.rowCount,
  };
}

module.exports = {
  get,
  all,
  run,
  runMigrations,
  raw: pool,
};
