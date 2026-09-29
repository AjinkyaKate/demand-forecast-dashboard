/**
 * Automatic external-data sync.
 *
 * Each source refreshes on its own schedule, matched to how fast its data
 * changes. A scheduler checks every few minutes which sources are due (from
 * the last attempt in external_sync_log), so a server restart picks up where
 * it left off instead of re-syncing everything. A failed sync is retried
 * sooner than a normal refresh. Manual "Sync now" goes through the same lock,
 * so a source never syncs twice at once.
 *
 * Runs inside the long-lived Node server (`next dev` / `next start`), started
 * from src/instrumentation.ts. Set AUTO_SYNC=off to disable it.
 */

import { getWritableDb } from "../db";
import { ensureSchema } from "../db/migrate";
import {
  syncAlerts,
  syncEvents,
  syncHolidays,
  syncWeather,
  type SyncResult,
} from "../db/ingest";
import { predictHqToken } from "../external/predicthq";

const MIN = 60_000;
const HOUR = 60 * MIN;

export type SourceId = "open-meteo-weather" | "nager-holidays" | "nws-alerts" | "predicthq-events";

type Job = {
  source: SourceId;
  /** How often to refresh after a successful sync. */
  every: number;
  /** Plain-language schedule for the UI. */
  label: string;
  run: () => Promise<SyncResult>;
  /** False when the source can't run (missing key). */
  enabled: () => boolean;
};

export const JOBS: Job[] = [
  { source: "nws-alerts", every: 30 * MIN, label: "every 30 min", run: syncAlerts, enabled: () => true },
  { source: "open-meteo-weather", every: 3 * HOUR, label: "every 3 hours", run: syncWeather, enabled: () => true },
  {
    source: "predicthq-events",
    every: 12 * HOUR,
    label: "every 12 hours",
    run: syncEvents,
    enabled: () => predictHqToken() != null,
  },
  { source: "nager-holidays", every: 7 * 24 * HOUR, label: "weekly", run: syncHolidays, enabled: () => true },
];

/** After a failed attempt, try again this soon. */
const RETRY = 15 * MIN;
/** How often the scheduler looks for due sources. */
const TICK = 5 * MIN;
/** Gap between sources started in the same tick, to spread the load. */
const STAGGER = 5_000;

// The scheduler state lives on globalThis so a dev-server hot reload of this
// module doesn't start a second scheduler or forget which syncs are running.
type State = { started: boolean; running: Set<SourceId>; timer: ReturnType<typeof setInterval> | null };
const g = globalThis as unknown as { __autoSync?: State };
const state: State = (g.__autoSync ??= { started: false, running: new Set(), timer: null });

export function autoSyncEnabled(): boolean {
  return (process.env.AUTO_SYNC ?? "on").toLowerCase() !== "off";
}

export function isRunning(source: SourceId): boolean {
  return state.running.has(source);
}

/** Last attempt per source, successful or not. */
function lastAttempts(): Map<string, { at: number; ok: boolean }> {
  const db = getWritableDb();
  try {
    ensureSchema(db);
    const rows = db
      .prepare(
        `SELECT source, MAX(synced_at) AS at,
                (SELECT status FROM external_sync_log l2 WHERE l2.source = l.source
                 ORDER BY synced_at DESC, id DESC LIMIT 1) AS status
         FROM external_sync_log l GROUP BY source`,
      )
      .all() as { source: string; at: string; status: string }[];
    return new Map(
      rows.map((r) => [r.source, { at: Date.parse(r.at.replace(" ", "T") + "Z"), ok: r.status === "ok" }]),
    );
  } finally {
    db.close();
  }
}

/** When each source is next due (ms epoch); now or earlier means due. */
export function nextDue(): Map<SourceId, number> {
  const last = lastAttempts();
  const out = new Map<SourceId, number>();
  for (const j of JOBS) {
    const l = last.get(j.source);
    out.set(j.source, l ? l.at + (l.ok ? j.every : RETRY) : 0);
  }
  return out;
}

/** Run one source now, unless it is already running. */
export async function runSync(source: SourceId): Promise<SyncResult | { ok: false; source: SourceId; message: string }> {
  const job = JOBS.find((j) => j.source === source);
  if (!job) return { ok: false, source, message: "Unknown source" };
  if (state.running.has(source)) return { ok: false, source, message: "Already syncing" };
  state.running.add(source);
  try {
    return await job.run();
  } finally {
    state.running.delete(source);
  }
}

async function tick() {
  let due: Map<SourceId, number>;
  try {
    due = nextDue();
  } catch {
    return; // database not ready yet; try next tick
  }
  const now = Date.now();
  let delay = 0;
  for (const j of JOBS) {
    if (!j.enabled() || state.running.has(j.source)) continue;
    if ((due.get(j.source) ?? 0) > now) continue;
    setTimeout(() => {
      runSync(j.source).then((r) => {
        const rows = "rows" in r ? ` · ${r.rows} rows` : "";
        console.log(`[auto-sync] ${j.source} ${r.ok ? "ok" : "failed"}${rows}${r.ok ? "" : ` · ${r.message}`}`);
      });
    }, delay);
    delay += STAGGER;
  }
}

/** Start the scheduler once per server process. Returns immediately. */
export function startAutoSync() {
  if (!autoSyncEnabled() || state.started) return;
  state.started = true;
  // First check shortly after boot, so startup itself isn't slowed.
  setTimeout(tick, 10_000);
  state.timer = setInterval(tick, TICK);
  console.log("[auto-sync] scheduler started");
}
