import { NextResponse } from "next/server";
import { getDataSummary } from "@/lib/import/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What sales history is on file, per store, and the import history. */
export function GET() {
  return NextResponse.json(getDataSummary());
}
