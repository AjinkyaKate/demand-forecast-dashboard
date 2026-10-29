import { NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { getDataSummary } from "@/lib/import/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What sales history is on file, per store, and the import history. */
export function GET() {
  return withDb(() => NextResponse.json(getDataSummary()));
}
