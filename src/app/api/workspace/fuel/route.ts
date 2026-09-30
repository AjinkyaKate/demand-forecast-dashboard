import { type NextRequest, NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { buildFuelWorkspace } from "@/lib/workspace/fuel";
import { DEFAULT_FILTERS } from "@/lib/workspace/types";
import { getStore, getStores } from "@/lib/db/repository";
import type { StoreId, FuelGradeId } from "@/lib/data/types";

export const dynamic = "force-dynamic";

/** A missing or unknown store falls back to the first store in the database. */
function resolveStore(id: string | null): StoreId {
  return (id && getStore(id) ? id : getStores()[0]?.id) ?? "";
}

export function GET(req: NextRequest) {
  return withDb(() => {
    const sp = req.nextUrl.searchParams;
    const filters = {
      ...DEFAULT_FILTERS,
      storeId: resolveStore(sp.get("storeId")),
      horizon: Number(sp.get("horizon") ?? DEFAULT_FILTERS.horizon),
      gradeId: (sp.get("gradeId") ?? DEFAULT_FILTERS.gradeId) as
        | FuelGradeId
        | "all",
    };
    const workspace = buildFuelWorkspace(filters);
    return NextResponse.json(workspace);
  });
}
