import { NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { runSync } from "@/lib/sync/auto";

export const dynamic = "force-dynamic";

/** Per-store weather from Open-Meteo: history, 16-day forecast, normals. Shares the auto-sync lock. */
export async function POST() {
  return withDb(async () => {
    const r = await runSync("open-meteo-weather");
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  });
}
