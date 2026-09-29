/**
 * Pull every external source into SQLite: per-store weather (Open-Meteo),
 * public holidays (Nager.Date) and nearby events (PredictHQ, when
 * PREDICTHQ_API_TOKEN is set in .env.local).
 *
 * Usage: npm run sync            (all sources)
 *        npm run sync -- weather  (one of: weather, holidays, events)
 */

import fs from "node:fs";
import { syncEvents, syncHolidays, syncWeather, type SyncResult } from "../src/lib/db/ingest";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const jobs: Record<string, () => Promise<SyncResult>> = {
  weather: syncWeather,
  holidays: syncHolidays,
  events: syncEvents,
};
const pick = process.argv.slice(2).filter((a) => a in jobs);

async function main() {
  let failed = false;
  for (const name of pick.length ? pick : Object.keys(jobs)) {
    const t0 = Date.now();
    const r = await jobs[name]();
    const span = r.dateFrom ? ` · ${r.dateFrom} → ${r.dateTo}` : "";
    console.log(`${r.ok ? "✓" : "✗"} ${r.source.padEnd(20)} ${String(r.rows).padStart(6)} rows${span} · ${Date.now() - t0}ms`);
    if (r.message) console.log(`    ${r.message}`);
    if (!r.ok && name !== "events") failed = true;
  }
  if (failed) process.exit(1);
}

main();
