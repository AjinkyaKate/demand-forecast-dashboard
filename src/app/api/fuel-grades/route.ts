import { NextResponse } from "next/server";
import { queryFuelGrades } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(queryFuelGrades());
}
