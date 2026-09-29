import { NextResponse } from "next/server";
import { queryCategories } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(queryCategories());
}
