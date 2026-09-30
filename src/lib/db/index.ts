import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

function resolveDbPath(): string {
  const candidates = [
    path.join(process.cwd(), "data", "forecast.db"),
    path.resolve(__dirname, "..", "..", "..", "..", "data", "forecast.db"),
    path.resolve(__dirname, "..", "..", "data", "forecast.db"),
    path.resolve(__dirname, "..", "data", "forecast.db"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`forecast.db not found. cwd=${process.cwd()}, __dirname=${__dirname}, tried: ${candidates.join(", ")}`);
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(resolveDbPath(), { readonly: true });
    try { _db.pragma("journal_mode = WAL"); } catch {}
  }
  return _db;
}

export function getWritableDb(): Database.Database {
  return new Database(DB_PATH);
}
