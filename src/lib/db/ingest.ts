/**
 * Write-side DB operations for external data ingestion.
 *
 * Uses getWritableDb() so the read-only singleton isn't affected.
 * Each upsert is idempotent — re-running a sync overwrites stale rows.
 */

import { getWritableDb } from "./index";
import type { WeatherDay } from "../external/weather";

export type SyncResult = {
  source: string;
  rows: number;
  dateFrom: string | null;
  dateTo: string | null;
};

function logSync(
  db: ReturnType<typeof getWritableDb>,
  result: SyncResult,
  error?: string,
) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS external_sync_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT NOT NULL,
      synced_at  TEXT NOT NULL DEFAULT (datetime('now')),
      rows       INTEGER NOT NULL DEFAULT 0,
      date_from  TEXT,
      date_to    TEXT,
      status     TEXT NOT NULL DEFAULT 'ok',
      error      TEXT
    )
  `).run();

  db.prepare(`
    INSERT INTO external_sync_log (source, rows, date_from, date_to, status, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    result.source,
    result.rows,
    result.dateFrom,
    result.dateTo,
    error ? "error" : "ok",
    error ?? null,
  );
}

export function upsertWeather(rows: WeatherDay[]): SyncResult {
  const db = getWritableDb();
  const stmt = db.prepare(`
    INSERT INTO daily_weather (date, temp_f, temp_anomaly)
    VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      temp_f       = excluded.temp_f,
      temp_anomaly = excluded.temp_anomaly
  `);

  const batch = db.transaction((items: WeatherDay[]) => {
    let count = 0;
    for (const r of items) {
      stmt.run(r.date, r.tempF, r.tempAnomaly);
      count++;
    }
    return count;
  });

  const count = batch(rows);
  const result: SyncResult = {
    source: "open-meteo-weather",
    rows: count,
    dateFrom: rows.length > 0 ? rows[0].date : null,
    dateTo: rows.length > 0 ? rows[rows.length - 1].date : null,
  };
  logSync(db, result);
  db.close();
  return result;
}
