import { NextResponse } from "next/server";
import {
  getAsOf,
  getCategories,
  getFuelGrades,
  getStores,
} from "@/lib/db/repository";

export const dynamic = "force-dynamic";

/** Everything the page chrome and filter menus need, from the database. */
export function GET() {
  return NextResponse.json({
    asOf: getAsOf(),
    stores: getStores().map((s) => ({ id: s.id, name: s.name, historyStart: s.historyStart })),
    categories: getCategories(),
    grades: getFuelGrades().map((g) => ({ id: g.id, name: g.name, short: g.short })),
  });
}
