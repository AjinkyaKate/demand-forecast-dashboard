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
  try {
    return NextResponse.json({
      asOf: getAsOf(),
      stores: getStores().map((s) => ({ id: s.id, name: s.name, historyStart: s.historyStart })),
      categories: getCategories(),
      grades: getFuelGrades().map((g) => ({ id: g.id, name: g.name, short: g.short })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("meta API error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
