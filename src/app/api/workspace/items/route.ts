import { type NextRequest, NextResponse } from "next/server";
import { buildItemWorkspace } from "@/lib/workspace/items";
import { DEFAULT_FILTERS } from "@/lib/workspace/types";
import type { StoreId, CategoryId } from "@/lib/data/catalog";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters = {
    ...DEFAULT_FILTERS,
    storeId: (sp.get("storeId") ?? DEFAULT_FILTERS.storeId) as StoreId,
    horizon: Number(sp.get("horizon") ?? DEFAULT_FILTERS.horizon),
    categoryId: (sp.get("categoryId") ?? DEFAULT_FILTERS.categoryId) as
      | CategoryId
      | "all",
  };
  const workspace = buildItemWorkspace(filters);
  return NextResponse.json(workspace);
}
