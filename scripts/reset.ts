/**
 * Empty the database of everything store-specific so the app starts clean
 * and the first forecast is built from the user's own upload.
 *
 * Kept: the fuel grade reference table, public holidays, and the external
 * sync log (both are re-synced on their own anyway).
 *
 * Usage: npm run reset        (npm run seed brings the demo data back)
 */

import Database from "better-sqlite3";
import path from "node:path";
import { ensureSchema } from "../src/lib/db/migrate";

const DB_PATH = path.join(process.cwd(), "data", "forecast.db");
const db = new Database(DB_PATH);
ensureSchema(db);

const WIPE = [
  "daily_item_sales",
  "daily_fuel_sales",
  "promotions",
  "inventory_on_hand",
  "tank_levels",
  "forecasts",
  "forecast_runs",
  "forecast_accuracy",
  "store_weather",
  "store_weather_normals",
  "external_events",
  "skus",
  "categories",
  "stores",
  "import_log",
];

const tables = new Set(
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name),
);

db.transaction(() => {
  for (const t of WIPE) {
    if (!tables.has(t)) continue;
    const n = db.prepare(`DELETE FROM ${t}`).run().changes;
    console.log(`${t.padEnd(22)} ${n} rows removed`);
  }
})();
db.exec("VACUUM");
db.close();
console.log("\nDatabase is empty. Open /data and upload a sales CSV to start forecasting.");
