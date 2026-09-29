import { type NextRequest, NextResponse } from "next/server";
import { buildFuelWorkspace } from "@/lib/workspace/fuel";
import { DEFAULT_FILTERS } from "@/lib/workspace/types";
import type { StoreId, FuelGradeId } from "@/lib/data/catalog";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters = {
    ...DEFAULT_FILTERS,
    storeId: (sp.get("storeId") ?? DEFAULT_FILTERS.storeId) as StoreId,
    horizon: Number(sp.get("horizon") ?? DEFAULT_FILTERS.horizon),
    gradeId: (sp.get("gradeId") ?? DEFAULT_FILTERS.gradeId) as
      | FuelGradeId
      | "all",
  };
  const workspace = buildFuelWorkspace(filters);
  return NextResponse.json(workspace);
}
