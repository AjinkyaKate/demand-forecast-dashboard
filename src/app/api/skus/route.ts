import { type NextRequest, NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { querySkus } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return withDb(() => {
    const categoryId = req.nextUrl.searchParams.get("categoryId") ?? undefined;
    return NextResponse.json(querySkus(categoryId));
  });
}
