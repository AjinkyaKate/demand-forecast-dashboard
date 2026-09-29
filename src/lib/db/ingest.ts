/**
 * External data sync: fetch from each API and write it into SQLite.
 *
 *   open-meteo-weather   per-store observed weather, 16-day forecast, normals
 *   nager-holidays       national + state public holidays
 *   predicthq-events     events near each store (needs PREDICTHQ_API_TOKEN)
 *
 * Every run is idempotent (upserts) and logged in external_sync_log, which is
 * what the dashboard's data-sources panel and cache versioning read.
 */

import type Database from "better-sqlite3";
import { addDays } from "../format";
import { dayOfYear, fetchForecast, fetchNormals, fetchObserved, type RawDay } from "../external/weather";
import { fetchHolidays } from "../external/holidays";
import { fetchEventsNear, predictHqToken, PredictHQError } from "../external/predicthq";
import { getWritableDb } from "./index";
import { ensureSchema } from "./migrate";

export type SyncResult = {
  source: string;
  ok: boolean;
  rows: number;
  dateFrom: string | null;
  dateTo: string | null;
  message?: string;
};

/** Events are searched within this distance of a store. */
export const EVENT_RADIUS_KM = 10;
/** How far ahead to pull known upcoming events. */
const EVENT_LOOKAHEAD_DAYS = 90;

type StoreLoc = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  region: string | null;
  historyStart: string;
};

function logSync(db: Database.Database, r: SyncResult) {
  db.prepare(
    `INSERT INTO external_sync_log (source, rows, date_from, date_to, status, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(r.source, r.rows, r.dateFrom, r.dateTo, r.ok ? "ok" : "error", r.ok ? null : (r.message ?? null));
}

function withDb<T>(fn: (db: Database.Database) => Promise<T>): Promise<T> {
  const db = getWritableDb();
  ensureSchema(db);
  return fn(db).finally(() => db.close());
}

function stores(db: Database.Database): StoreLoc[] {
  return db
    .prepare(
      `SELECT id, latitude, longitude, timezone, region, history_start AS historyStart
       FROM stores ORDER BY id`,
    )
    .all() as StoreLoc[];
}

const today = () => new Date().toISOString().slice(0, 10);

/* -------------------------------------------------------------------------- */
/* Weather                                                                    */
/* -------------------------------------------------------------------------- */

export function syncWeather(): Promise<SyncResult> {
  return withDb(async (db) => {
    const source = "open-meteo-weather";
    let rows = 0;
    let from = null as string | null;
    let to = null as string | null;
    const skipped: string[] = [];
    try {
      const up = db.prepare(
        `INSERT INTO store_weather (store_id, date, temp_f, temp_anomaly, precip_mm, kind, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(store_id, date) DO UPDATE SET
           temp_f = excluded.temp_f, temp_anomaly = excluded.temp_anomaly,
           precip_mm = excluded.precip_mm, kind = excluded.kind, fetched_at = excluded.fetched_at`,
      );
      const upNormal = db.prepare(
        `INSERT OR REPLACE INTO store_weather_normals (store_id, doy, temp_f, precip_mm, years)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const s of stores(db)) {
        if (s.latitude == null || s.longitude == null) {
          skipped.push(s.id);
          continue;
        }
        const loc = { latitude: s.latitude, longitude: s.longitude, timezone: s.timezone };

        // Normals are stable; fetch them once per store.
        let normals = db
          .prepare("SELECT doy, temp_f AS t FROM store_weather_normals WHERE store_id = ?")
          .all(s.id) as { doy: number; t: number }[];
        if (normals.length < 366) {
          const n = await fetchNormals(loc, new Date().getUTCFullYear());
          db.transaction(() => {
            for (let k = 1; k <= 366; k++) upNormal.run(s.id, k, n.tempF[k], n.precipMm[k], n.years);
          })();
          normals = Array.from({ length: 366 }, (_, i) => ({ doy: i + 1, t: n.tempF[i + 1] }));
        }
        const normalF = new Map(normals.map((r) => [r.doy, r.t]));

        const start = addDays(s.historyStart, -2);
        const [observed, ahead] = await Promise.all([
          fetchObserved(loc, start, today()),
          fetchForecast(loc),
        ]);
        // Observed wins where both exist; forecast fills the archive's lag and the future.
        const byDate = new Map<string, { d: RawDay; kind: "observed" | "forecast" }>();
        const t = today();
        for (const d of ahead) byDate.set(d.date, { d, kind: d.date < t ? "observed" : "forecast" });
        for (const d of observed) byDate.set(d.date, { d, kind: "observed" });

        db.transaction(() => {
          for (const { d, kind } of byDate.values()) {
            const normal = normalF.get(dayOfYear(d.date)) ?? d.tempF;
            up.run(s.id, d.date, d.tempF, Math.round((d.tempF - normal) * 10) / 10, d.precipMm, kind);
            rows++;
          }
        })();
        const dates = [...byDate.keys()].sort();
        if (dates.length) {
          from = from == null || dates[0] < from ? dates[0] : from;
          to = to == null || dates[dates.length - 1] > to ? dates[dates.length - 1] : to;
        }
      }
      const r: SyncResult = {
        source, ok: true, rows, dateFrom: from, dateTo: to,
        message: skipped.length ? `No location for ${skipped.join(", ")}` : undefined,
      };
      logSync(db, r);
      return r;
    } catch (err) {
      const r: SyncResult = { source, ok: false, rows, dateFrom: from, dateTo: to, message: String(err) };
      logSync(db, r);
      return r;
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Holidays                                                                   */
/* -------------------------------------------------------------------------- */

export function syncHolidays(): Promise<SyncResult> {
  return withDb(async (db) => {
    const source = "nager-holidays";
    try {
      const st = stores(db);
      const firstYear = Math.min(...st.map((s) => Number(s.historyStart.slice(0, 4))));
      const lastYear = new Date().getUTCFullYear() + 1;
      const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
      const regions = [...new Set(st.map((s) => s.region).filter((r): r is string => !!r))];
      const list = await fetchHolidays("US", years, regions);

      db.transaction(() => {
        db.prepare("DELETE FROM holidays WHERE source = 'nager-date'").run();
        const ins = db.prepare(
          "INSERT OR REPLACE INTO holidays (date, name, region, kind, source) VALUES (?, ?, ?, ?, 'nager-date')",
        );
        for (const h of list) ins.run(h.date, h.name, h.region, h.kind);
      })();
      const dates = list.map((h) => h.date).sort();
      const r: SyncResult = {
        source, ok: true, rows: list.length,
        dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null,
      };
      logSync(db, r);
      return r;
    } catch (err) {
      const r: SyncResult = { source, ok: false, rows: 0, dateFrom: null, dateTo: null, message: String(err) };
      logSync(db, r);
      return r;
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export function syncEvents(): Promise<SyncResult> {
  return withDb(async (db) => {
    const source = "predicthq-events";
    const token = predictHqToken();
    if (!token) {
      // Not an error in the data — the source simply isn't connected yet.
      return {
        source, ok: false, rows: 0, dateFrom: null, dateTo: null,
        message: "PREDICTHQ_API_TOKEN is not set in .env.local",
      };
    }
    let rows = 0;
    try {
      const up = db.prepare(
        `INSERT INTO external_events
           (source, id, store_id, title, category, start_date, end_date, attendance, rank, local_rank, distance_km, fetched_at)
         VALUES ('predicthq', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(source, id, store_id) DO UPDATE SET
           title = excluded.title, category = excluded.category,
           start_date = excluded.start_date, end_date = excluded.end_date,
           attendance = excluded.attendance, rank = excluded.rank,
           local_rank = excluded.local_rank, distance_km = excluded.distance_km,
           fetched_at = excluded.fetched_at`,
      );
      const to = addDays(today(), EVENT_LOOKAHEAD_DAYS);
      let first = null as string | null;
      for (const s of stores(db)) {
        if (s.latitude == null || s.longitude == null) continue;
        const from = s.historyStart;
        first = first == null || from < first ? from : first;
        const events = await fetchEventsNear({
          token,
          latitude: s.latitude,
          longitude: s.longitude,
          timezone: s.timezone,
          radiusKm: EVENT_RADIUS_KM,
          from,
          to,
        });
        db.transaction(() => {
          for (const e of events) {
            up.run(e.id, s.id, e.title, e.category, e.start, e.end, e.attendance, e.rank, e.localRank, e.distanceKm);
            rows++;
          }
        })();
      }
      const r: SyncResult = { source, ok: true, rows, dateFrom: first, dateTo: to };
      logSync(db, r);
      return r;
    } catch (err) {
      const message = err instanceof PredictHQError ? err.message : String(err);
      const r: SyncResult = { source, ok: false, rows, dateFrom: null, dateTo: null, message };
      logSync(db, r);
      return r;
    }
  });
}
