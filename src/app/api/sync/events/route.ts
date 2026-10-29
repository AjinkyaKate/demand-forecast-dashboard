import { NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { predictHqToken } from "@/lib/external/predicthq";
import { runSync } from "@/lib/sync/auto";

export const dynamic = "force-dynamic";

/** Events near each store from PredictHQ. Needs PREDICTHQ_API_TOKEN. Shares the auto-sync lock. */
export async function POST() {
  return withDb(async () => {
    if (!predictHqToken()) {
      return NextResponse.json(
        { ok: false, source: "predicthq-events", message: "PREDICTHQ_API_TOKEN is not set in .env.local" },
        { status: 400 },
      );
    }
    const r = await runSync("predicthq-events");
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  });
}
