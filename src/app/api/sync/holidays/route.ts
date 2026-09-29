import { NextResponse } from "next/server";
import { syncHolidays } from "@/lib/db/ingest";

export const dynamic = "force-dynamic";

/** National and state public holidays from Nager.Date. */
export async function POST() {
  const r = await syncHolidays();
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
