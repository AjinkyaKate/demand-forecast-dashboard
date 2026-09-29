import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type SourceStatus = {
  source: string;
  label: string;
  lastSync: string | null;
  rows: number;
  dateFrom: string | null;
  dateTo: string | null;
  status: string;
};

export function GET() {
  const db = getDb();

  const hasTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='external_sync_log'",
  ).get();

  const sources: SourceStatus[] = [
    {
      source: "open-meteo-weather",
      label: "Weather (Open-Meteo)",
      lastSync: null,
      rows: 0,
      dateFrom: null,
      dateTo: null,
      status: "never",
    },
  ];

  if (hasTable) {
    for (const s of sources) {
      const row = db.prepare(
        `SELECT synced_at, rows, date_from, date_to, status
         FROM external_sync_log
         WHERE source = ? ORDER BY synced_at DESC LIMIT 1`,
      ).get(s.source) as {
        synced_at: string;
        rows: number;
        date_from: string | null;
        date_to: string | null;
        status: string;
      } | undefined;

      if (row) {
        s.lastSync = row.synced_at;
        s.rows = row.rows;
        s.dateFrom = row.date_from;
        s.dateTo = row.date_to;
        s.status = row.status;
      }
    }
  }

  return NextResponse.json({ sources });
}
