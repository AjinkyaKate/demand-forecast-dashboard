import { NextResponse } from "next/server";
import { queryStores } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(queryStores());
}
