import { NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { queryCategories } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET() {
  return withDb(() => NextResponse.json(queryCategories()));
}
