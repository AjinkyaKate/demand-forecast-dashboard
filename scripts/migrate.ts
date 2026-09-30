/**
 * Upgrade an existing database in place: new tables and columns, plus the
 * demo store locations where a store has none yet. Existing rows are kept.
 *
 * Usage: npx tsx scripts/migrate.ts
 */

import Database from "better-sqlite3";
import path from "node:path";
import { ensureSchema } from "../src/lib/db/migrate";
import { STORES } from "./seed-catalog";

const db = new Database(path.join(process.cwd(), "data", "forecast.db"));
ensureSchema(db);

const set = db.prepare(
  `UPDATE stores SET latitude = ?, longitude = ?, timezone = ?, region = ?
   WHERE id = ? AND (latitude IS NULL OR longitude IS NULL)`,
);
let located = 0;
for (const s of STORES) located += set.run(s.latitude, s.longitude, s.timezone, s.region, s.id).changes;

const rows = db
  .prepare("SELECT id, latitude, longitude, region FROM stores ORDER BY id")
  .all() as { id: string; latitude: number; longitude: number; region: string }[];
db.close();

console.log(`Schema up to date. Located ${located} store(s).`);
for (const r of rows) console.log(`  ${r.id}  ${r.latitude}, ${r.longitude}  ${r.region}`);
