import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ensureSchema } from "./migrate";

/**
 * Where the database lives. Locally it is data/forecast.db in the project.
 * On a serverless host the project folder is read-only, so the file goes to
 * the writable temp directory (set DB_PATH to choose). That copy is created
 * with the schema on first use and lasts as long as the instance does.
 */
export const DB_PATH =
  process.env.DB_PATH ??
  (process.env.VERCEL ? "/tmp/forecast.db" : path.join(process.cwd(), "data", "forecast.db"));

let _db: Database.Database | null = null;

function ensureFile() {
  if (fs.existsSync(DB_PATH)) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  db.close();
}

export function getDb(): Database.Database {
  if (!_db) {
    ensureFile();
    _db = new Database(DB_PATH, { readonly: true });
    _db.pragma("journal_mode = WAL");
  }
  return _db;
}

export function getWritableDb(): Database.Database {
  ensureFile();
  return new Database(DB_PATH);
}
