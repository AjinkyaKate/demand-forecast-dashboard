import { NextResponse } from "next/server";
import { getDb, withDb } from "@/lib/db";
import { predictHqToken } from "@/lib/external/predicthq";
import { JOBS, autoSyncEnabled, isRunning, nextDue, type SourceId } from "@/lib/sync/auto";

export const dynamic = "force-dynamic";

type SourceStatus = {
  source: string;
  label: string;
  description: string;
  /** Sync endpoint to POST to. */
  endpoint: string;
  /** False when the source needs credentials that aren't configured. */
  configured: boolean;
  lastSync: string | null;
  rows: number;
  dateFrom: string | null;
  dateTo: string | null;
  /** "ok" | "error" | "never" | "needs-key". */
  status: string;
  error: string | null;
  /** Automatic refresh schedule, e.g. "every 30 min"; null when auto-sync is off. */
  schedule: string | null;
  /** When the next automatic sync is due (ISO), if scheduled. */
  nextSync: string | null;
  /** A sync of this source is in progress right now. */
  running: boolean;
};

export function GET() {
  return withDb(() => {
    const db = getDb();
    const hasLog = !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='external_sync_log'")
      .get();

    const sources: SourceStatus[] = [
      {
        source: "open-meteo-weather",
        label: "Weather · Open-Meteo",
        description: "Per-store temperature and rain: history, 16-day forecast, 10-year normals",
        endpoint: "/api/sync/weather",
        configured: true,
      },
      {
        source: "nager-holidays",
        label: "Public holidays · Nager.Date",
        description: "US national and state holidays",
        endpoint: "/api/sync/holidays",
        configured: true,
      },
      {
        source: "nws-alerts",
        label: "Weather alerts · National Weather Service",
        description: "Winter storm, heat and severe-storm warnings at each store",
        endpoint: "/api/sync/alerts",
        configured: true,
      },
      {
        source: "predicthq-events",
        label: "Local events · PredictHQ",
        description: "Concerts, sports, festivals and more within 10 km of each store",
        endpoint: "/api/sync/events",
        configured: predictHqToken() != null,
      },
    ].map((s) => ({
      ...s,
      lastSync: null,
      rows: 0,
      dateFrom: null,
      dateTo: null,
      status: s.configured ? "never" : "needs-key",
      error: null,
      schedule: null as string | null,
      nextSync: null as string | null,
      running: isRunning(s.source as SourceId),
    }));

    if (autoSyncEnabled()) {
      const due = nextDue();
      for (const s of sources) {
        const job = JOBS.find((j) => j.source === s.source);
        if (!job || !s.configured) continue;
        s.schedule = job.label;
        s.nextSync = new Date(Math.max(Date.now(), due.get(job.source) ?? 0)).toISOString();
      }
    }

    if (hasLog) {
      const latest = db.prepare(
        `SELECT synced_at, rows, date_from, date_to, status, error
         FROM external_sync_log WHERE source = ? ORDER BY synced_at DESC, id DESC LIMIT 1`,
      );
      for (const s of sources) {
        const row = latest.get(s.source) as
          | { synced_at: string; rows: number; date_from: string | null; date_to: string | null; status: string; error: string | null }
          | undefined;
        if (!row) continue;
        s.lastSync = row.synced_at;
        s.rows = row.rows;
        s.dateFrom = row.date_from;
        s.dateTo = row.date_to;
        s.status = s.configured ? row.status : "needs-key";
        s.error = row.error;
      }
    }

    return NextResponse.json({ sources, autoSync: autoSyncEnabled() });
  });
}
