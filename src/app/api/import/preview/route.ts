import { type NextRequest, NextResponse } from "next/server";
import { assessFile, previewFile, type SalesMapping } from "@/lib/import/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;

/**
 * Read a sales export: its columns, a sample, a guessed mapping and the date
 * format. With a `mapping` field, also dry-run that mapping and report what
 * would land, without writing anything.
 */
export async function POST(req: NextRequest) {
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is over 30 MB" }, { status: 413 });
  const text = await file.text();
  const preview = previewFile(text, file.name);
  const mappingRaw = fd.get("mapping");
  let assessment = null;
  if (typeof mappingRaw === "string") {
    try {
      assessment = assessFile(text, JSON.parse(mappingRaw) as SalesMapping);
    } catch (err) {
      return NextResponse.json({ ...preview, assessment: null, error: (err as Error).message });
    }
  }
  return NextResponse.json({ ...preview, assessment });
}
