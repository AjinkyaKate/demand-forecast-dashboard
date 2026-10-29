import { type NextRequest, NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { queryFuelSales } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return withDb(() => {
    const sp = req.nextUrl.searchParams;
    const storeId = sp.get("storeId");
    if (!storeId) {
      return NextResponse.json({ error: "storeId is required" }, { status: 400 });
    }
    const from = sp.get("from") ?? undefined;
    const to = sp.get("to") ?? undefined;
    return NextResponse.json(queryFuelSales(storeId, from, to));
  });
}
