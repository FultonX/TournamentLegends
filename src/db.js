// src/db.js
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Where to store the DB file (root folder)
const dbPath = path.join(__dirname, "..", "tournament.db");

// Open the database
const db = new Database(dbPath);

// Recommended pragmas
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// Run all .sql files in src/migrations in alphabetical order
function runMigrations() {
  const migrationsDir = path.join(__dirname, "migrations");

  if (!fs.existsSync(migrationsDir)) {
    console.warn("No migrations directory found at", migrationsDir);
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 001_..., 002_..., etc.

  if (files.length === 0) {
    console.warn("No migration files found in", migrationsDir);
    return;
  }

  console.log("Running migrations:", files);

  db.exec("BEGIN");
  try {
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      db.exec(sql);
    }
    db.exec("COMMIT");
    console.log("Migrations applied successfully.");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Migration failed:", err);
    throw err;
  }
}

// Run at module load
runMigrations();

/**
 * Small helper API with get/all/run, shaped to work with `await`.
 * These are synchronous under the hood, but wrapping in async is fine
 * and plays nicely with `await db.get(...)` in your routers.
 */

async function get(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

async function all(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

async function run(sql, params = []) {
  const stmt = db.prepare(sql);
  const info = stmt.run(...params);
  return info; // includes lastInsertRowid, changes
}

module.exports = {
  get,
  all,
  run,
  raw: db, // raw access if you ever need it
};
