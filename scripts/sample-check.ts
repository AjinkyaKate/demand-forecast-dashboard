/** Sanity check for the sample-data generator. Run: npx tsx scripts/sample-check.ts */
import { buildSampleCsv, SAMPLE_MONTHS, SAMPLE_MAPPING } from "../src/lib/import/sample";
import { assessFile } from "../src/lib/import/sales";
for (const m of SAMPLE_MONTHS) {
  const s = buildSampleCsv(m);
  const a = assessFile(s.text, { ...SAMPLE_MAPPING, mode: "replace" });
  const lines = s.text.trim().split("\n");
  const promoRows = lines.filter((l) => l.includes(",Yes,")).length;
  console.log(m, "months:", s.dateFrom, "->", s.dateTo, s.days, "days;", lines.length - 1, "rows;", (s.text.length / 1024).toFixed(0), "KB; kept", a.rowsKept, "items", a.items, "stores", a.stores.map((x) => x.name).join("/"), "promoRows", promoRows, "warnings", a.warnings);
}
console.log(buildSampleCsv(6).text.split("\n").slice(0, 3).join("\n"));
