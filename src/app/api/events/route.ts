import { type NextRequest, NextResponse } from "next/server";
import { queryEvents } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  return NextResponse.json(queryEvents(from, to));
}
