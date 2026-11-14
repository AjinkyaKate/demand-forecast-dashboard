import { type NextRequest, NextResponse } from "next/server";
import { withDb } from "@/lib/db";
import { importSales, type SalesMapping } from "@/lib/import/sales";
import { buildSampleCsv, isSampleMonths, SAMPLE_MAPPING, SAMPLE_MONTHS, type SampleMonths } from "@/lib/import/sample";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function monthsFrom(raw: unknown): SampleMonths | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return isSampleMonths(n) ? n : null;
}

const badMonths = () =>
  NextResponse.json({ error: `months must be one of ${SAMPLE_MONTHS.join(", ")}` }, { status: 400 });

/** Download the sample as a CSV: `GET /api/import/sample?months=6`. */
export function GET(req: NextRequest) {
  const months = monthsFrom(req.nextUrl.searchParams.get("months") ?? "6");
  if (months === null) return badMonths();
  const sample = buildSampleCsv(months);
  return new NextResponse(sample.text, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${sample.fileName}"`,
    },
  });
}

/**
 * Generate the sample and load it through the ordinary importer:
 * `POST /api/import/sample` with `{ months: 6 | 7 | 8 | 10, mode?: "replace" | "merge" }`.
 */
export async function POST(req: NextRequest) {
  let body: { months?: unknown; mode?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const months = monthsFrom(body.months);
  if (months === null) return badMonths();
  const mode: SalesMapping["mode"] = body.mode === "merge" ? "merge" : "replace";
  const sample = buildSampleCsv(months);
  return withDb(() => {
    try {
      const result = importSales(sample.text, `Sample data (${months} months)`, { ...SAMPLE_MAPPING, mode });
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 422 });
    }
  });
}
