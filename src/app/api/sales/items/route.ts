import { type NextRequest, NextResponse } from "next/server";
import { queryItemSales, queryItemSalesAggregated } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const storeId = sp.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "storeId is required" }, { status: 400 });
  }
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  const aggregate = sp.get("aggregate") === "true";

  if (aggregate) {
    return NextResponse.json(queryItemSalesAggregated(storeId, from, to));
  }
  return NextResponse.json(queryItemSales(storeId, from, to));
}
