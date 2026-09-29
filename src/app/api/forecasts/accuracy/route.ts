import { type NextRequest, NextResponse } from "next/server";
import { queryForecastAccuracy } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId") ?? undefined;
  return NextResponse.json(queryForecastAccuracy(runId));
}
