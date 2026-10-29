import { NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { queryStores } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET() {
  return withDb(() => NextResponse.json(queryStores()));
}
