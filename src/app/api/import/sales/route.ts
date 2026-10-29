import { type NextRequest, NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { importSales, type SalesMapping } from "@/lib/import/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;

/** Write a sales export into the database under the given mapping. */
export async function POST(req: NextRequest) {
  const fd = await req.formData();
  const file = fd.get("file");
  const mappingRaw = fd.get("mapping");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is over 30 MB" }, { status: 413 });
  if (typeof mappingRaw !== "string") return NextResponse.json({ error: "No mapping" }, { status: 400 });
  const text = await file.text();
  return withDb(() => {
    try {
      const result = importSales(text, file.name, JSON.parse(mappingRaw) as SalesMapping);
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 422 });
    }
  });
}
