/**
 * Bring an existing database up to the current schema without touching its
 * data: create missing tables, add missing columns.
 */

import type Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";

const STORE_COLUMNS: [string, string][] = [
  ["latitude", "REAL"],
  ["longitude", "REAL"],
  ["timezone", "TEXT NOT NULL DEFAULT 'America/New_York'"],
  ["region", "TEXT"],
];

export function ensureSchema(db: Database.Database) {
  const have = new Set(
    (db.prepare("PRAGMA table_info(stores)").all() as { name: string }[]).map((c) => c.name),
  );
  // Columns first: SCHEMA_SQL's indexes and new tables don't depend on them,
  // but CREATE TABLE IF NOT EXISTS never alters a table that already exists.
  if (have.size) {
    for (const [name, type] of STORE_COLUMNS) {
      if (!have.has(name)) db.exec(`ALTER TABLE stores ADD COLUMN ${name} ${type}`);
    }
  }
  db.exec(SCHEMA_SQL);
}
