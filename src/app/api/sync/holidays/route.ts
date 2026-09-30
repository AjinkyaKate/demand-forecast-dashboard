import { NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { runSync } from "@/lib/sync/auto";

export const dynamic = "force-dynamic";

/** National and state public holidays from Nager.Date. Shares the auto-sync lock. */
export async function POST() {
  return withDb(async () => {
    const r = await runSync("nager-holidays");
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  });
}
