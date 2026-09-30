import { NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { runSync } from "@/lib/sync/auto";

export const dynamic = "force-dynamic";

/** NWS winter, heat and severe-storm alerts at each store's location. Shares the auto-sync lock. */
export async function POST() {
  return withDb(async () => {
    const r = await runSync("nws-alerts");
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  });
}
