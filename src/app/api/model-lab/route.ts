import { type NextRequest, NextResponse } from "next/server";
import { getStore, getStores } from "@/lib/db/repository";
import { buildLabWorkspace, type LabStream } from "@/lib/workspace/lab";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const requested = sp.get("storeId");
  const storeId = (requested && getStore(requested) ? requested : getStores()[0]?.id) ?? "";
  const stream: LabStream = sp.get("stream") === "fuel" ? "fuel" : "items";
  return NextResponse.json(buildLabWorkspace(storeId, stream));
}
