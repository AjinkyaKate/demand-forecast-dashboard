import { NextResponse } from "next/server";
import { syncEvents } from "@/lib/db/ingest";
import { predictHqToken } from "@/lib/external/predicthq";

export const dynamic = "force-dynamic";

/** Events near each store from PredictHQ. Needs PREDICTHQ_API_TOKEN. */
export async function POST() {
  if (!predictHqToken()) {
    return NextResponse.json(
      { ok: false, source: "predicthq-events", message: "PREDICTHQ_API_TOKEN is not set in .env.local" },
      { status: 400 },
    );
  }
  const r = await syncEvents();
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
