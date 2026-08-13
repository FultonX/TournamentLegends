const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const databasePath = process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "tournament-legends.sqlite");

if (databasePath !== ":memory:") {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
}

const database = new Database(databasePath);
database.pragma("foreign_keys = ON");
database.pragma("journal_mode = WAL");
database.pragma("busy_timeout = 5000");

function get(sql, params = []) {
  return database.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return database.prepare(sql).all(...params);
}

function run(sql, params = []) {
  const result = database.prepare(sql).run(...params);
  return { lastID: Number(result.lastInsertRowid), changes: result.changes };
}

function transaction(callback) {
  return database.transaction(callback)();
}

function runMigrations() {
  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applyMigration = database.transaction((filename, sql) => {
    database.exec(sql);
    database.prepare("INSERT INTO schema_migrations (filename) VALUES (?)").run(filename);
  });

  for (const filename of files) {
    const applied = get("SELECT filename FROM schema_migrations WHERE filename = ?", [filename]);
    if (!applied) {
      applyMigration(filename, fs.readFileSync(path.join(migrationsDir, filename), "utf8"));
    }
  }
}

function close() {
  database.close();
}

module.exports = { get, all, run, transaction, runMigrations, close, raw: database, databasePath };
