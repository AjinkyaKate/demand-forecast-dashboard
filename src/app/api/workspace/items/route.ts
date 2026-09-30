import { type NextRequest, NextResponse } from "next/server";
import { buildItemWorkspace } from "@/lib/workspace/items";
import { DEFAULT_FILTERS } from "@/lib/workspace/types";
import { getStore, getStores } from "@/lib/db/repository";
import type { StoreId, CategoryId } from "@/lib/data/types";

export const dynamic = "force-dynamic";

/** A missing or unknown store falls back to the first store in the database. */
function resolveStore(id: string | null): StoreId {
  return (id && getStore(id) ? id : getStores()[0]?.id) ?? "";
}

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters = {
    ...DEFAULT_FILTERS,
    storeId: resolveStore(sp.get("storeId")),
    horizon: Number(sp.get("horizon") ?? DEFAULT_FILTERS.horizon),
    categoryId: (sp.get("categoryId") ?? DEFAULT_FILTERS.categoryId) as
      | CategoryId
      | "all",
  };
  const workspace = buildItemWorkspace(filters);
  return NextResponse.json(workspace);
}
