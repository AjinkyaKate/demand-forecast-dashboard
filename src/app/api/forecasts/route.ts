import { type NextRequest, NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { queryForecasts, queryForecastRuns, latestRunId } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return withDb(() => {
    const sp = req.nextUrl.searchParams;
    const storeId = sp.get("storeId");

    if (!storeId) {
      return NextResponse.json({ runs: queryForecastRuns(), latestRunId: latestRunId() });
    }

    const runId = sp.get("runId") ?? undefined;
    return NextResponse.json(queryForecasts(storeId, runId));
  });
}
