import { NextResponse } from "next/server";
import {
  getAsOf,
  getCategories,
  getFuelGrades,
  getStores,
} from "@/lib/db/repository";
import { withDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  return withDb(() =>
    NextResponse.json({
      asOf: getAsOf(),
      stores: getStores().map((s) => ({ id: s.id, name: s.name, historyStart: s.historyStart })),
      categories: getCategories(),
      grades: getFuelGrades().map((g) => ({ id: g.id, name: g.name, short: g.short })),
    }),
  );
}
