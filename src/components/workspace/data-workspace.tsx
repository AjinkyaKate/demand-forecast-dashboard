"use client";

/**
 * Your data: what sales history is on file, and the way to add more.
 *
 * Three steps, all on one card: pick a file, map its columns (we guess
 * first), import. The dry run after every mapping change says exactly what
 * would land, so nothing is a surprise after the import button.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useMeta } from "@/components/shell/meta";
import type {
  Assessment,
  DataSummary,
  ImportResult,
  Preview,
  SalesMapping,
} from "@/lib/import/types";
import { SALES_FIELDS } from "@/lib/import/types";
import { longDate, shortDate, thousands } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Field } from "./filters";
import { SectionHeading, StatusBadge, WorkspaceHeader } from "./shared";

const NONE = "__none__";

const DATE_FORMATS = [
  { value: "auto", label: "Detect from the file" },
  { value: "ymd", label: "YYYY-MM-DD" },
  { value: "dmy", label: "DD/MM/YYYY" },
  { value: "mdy", label: "MM/DD/YYYY" },
];

type Step = "pick" | "map" | "done";

function fmtBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z")).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

/* -------------------------------------------------------------------------- */
/* What is on file                                                            */
/* -------------------------------------------------------------------------- */

function OnFile({ summary }: { summary: DataSummary | null }) {
  return (
    <section className="surface-card rounded-card flex flex-col gap-4 p-5 sm:p-6">
      <SectionHeading
        title="Sales history on file"
        description="Every forecast, driver and order suggestion is computed from these rows."
        aside={
          summary ? (
            summary.stores.length === 0 ? (
              <StatusBadge tone="neutral">Nothing on file</StatusBadge>
            ) : summary.isDemo ? (
              <StatusBadge tone="warning">Demo data</StatusBadge>
            ) : (
              <StatusBadge tone="good">Your data</StatusBadge>
            )
          ) : null
        }
      />
      {!summary ? (
        <div className="bg-surface-2 h-20 animate-pulse rounded-lg" />
      ) : summary.stores.length === 0 ? (
        <p className="text-ink-muted text-sm">
          No sales history yet. Upload a file above and the forecasting pages fill in.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-ink-secondary border-hairline border-b text-left">
                <th scope="col" className="py-2 pr-3">Store</th>
                <th scope="col" className="py-2 pr-3">History</th>
                <th scope="col" data-numeric className="py-2 pr-3 text-right">Days</th>
                <th scope="col" data-numeric className="py-2 pr-3 text-right">Items</th>
                <th scope="col" data-numeric className="py-2 pr-3 text-right">Rows</th>
                <th scope="col" className="py-2">Fuel</th>
              </tr>
            </thead>
            <tbody>
              {summary.stores.map((s) => (
                <tr key={s.id} className="border-hairline border-b last:border-0">
                  <td className="text-ink-primary py-2 pr-3">{s.name}</td>
                  <td className="text-ink-secondary py-2 pr-3 whitespace-nowrap">
                    {s.dateFrom && s.dateTo ? `${shortDate(s.dateFrom)} – ${longDate(s.dateTo)}` : "No sales yet"}
                  </td>
                  <td data-numeric className="text-ink-primary py-2 pr-3 text-right">{thousands(s.days)}</td>
                  <td data-numeric className="text-ink-primary py-2 pr-3 text-right">{thousands(s.items)}</td>
                  <td data-numeric className="text-ink-primary py-2 pr-3 text-right">{thousands(s.rows)}</td>
                  <td className="text-ink-muted py-2">{s.fuelRows > 0 ? `${thousands(s.fuelRows)} rows` : "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {summary?.imports.length ? (
        <ul className="text-ink-muted flex flex-col gap-1 text-[11px]">
          {summary.imports.slice(0, 3).map((i) => (
            <li key={i.id}>
              {timeSince(i.importedAt)}: {i.fileName}, {thousands(i.rows)} rows across {i.stores} store
              {i.stores === 1 ? "" : "s"} and {thousands(i.items)} items ({i.mode === "replace" ? "replaced what was on file" : "merged"}).
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

function defaultMapping(p: Preview, isDemo: boolean, empty: boolean): SalesMapping {
  const g = p.guess;
  return {
    date: g.date ?? "",
    item: g.item ?? "",
    units: g.units ?? "",
    store: g.store ?? null,
    itemName: g.itemName ?? null,
    category: g.category ?? null,
    price: g.price ?? null,
    promo: g.promo ?? null,
    discount: g.discount ?? null,
    dateFormat: "auto",
    storeName: "",
    mode: isDemo || empty ? "replace" : "merge",
  };
}

function Importer({ summary, onImported }: { summary: DataSummary | null; onImported: () => void }) {
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<SalesMapping | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const read = async (f: File) => {
    setError(null);
    setFile(f);
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/import/preview", { method: "POST", body: fd });
      const json = (await res.json()) as Preview & { error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setPreview(json);
      setMapping(defaultMapping(json, summary?.isDemo ?? false, (summary?.stores.length ?? 0) === 0));
      setAssessment(null);
      setStep("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const complete = !!mapping && !!mapping.date && !!mapping.item && !!mapping.units;

  // Dry-run the mapping whenever it settles. An incomplete mapping keeps the
  // last assessment in state but the page hides it (see `complete`).
  useEffect(() => {
    if (!file || !mapping || step !== "map" || !complete) return;
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setAssessing(true);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mapping", JSON.stringify(mapping));
      try {
        const res = await fetch("/api/import/preview", { method: "POST", body: fd, signal: ac.signal });
        const json = (await res.json()) as { assessment: Assessment | null; error?: string };
        setAssessment(json.assessment);
        setError(json.error ?? null);
      } catch (err) {
        if (!ac.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!ac.signal.aborted) setAssessing(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [file, mapping, step, complete]);

  const set = (patch: Partial<SalesMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));
  const columnOptions = (p: Preview) => [
    { value: NONE, label: "Not in file" },
    ...p.columns.map((c) => ({ value: c, label: c })),
  ];

  const doImport = async () => {
    if (!file || !mapping) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mapping", JSON.stringify(mapping));
    const res = await fetch("/api/import/sales", { method: "POST", body: fd });
    const json = (await res.json()) as ImportResult & { error?: string };
    if (!res.ok) {
      setError(json.error ?? res.statusText);
      throw new Error(json.error ?? res.statusText);
    }
    setResult(json);
    setStep("done");
    onImported();
  };

  const reset = () => {
    setStep("pick");
    setFile(null);
    setPreview(null);
    setMapping(null);
    setAssessment(null);
    setResult(null);
    setError(null);
  };

  const shown = complete ? assessment : null;
  const ready = !!shown && shown.rowsKept > 0 && !assessing;
  const mappedIndex = (p: Preview, col: string | null | undefined) =>
    col ? p.columns.indexOf(col) : -1;

  return (
    <section className="surface-card rounded-card flex flex-col gap-5 p-5 sm:p-6">
      <SectionHeading
        title="Add sales history"
        description="A CSV export from your POS or back office. One row per day or per receipt; we sum receipts to days."
        aside={
          <Button asChild variant="outline" size="sm">
            <a href="/sample-sales.csv" download>Download a sample file</a>
          </Button>
        }
      />

      {step === "pick" ? (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void read(f);
          }}
          className={cn(
            "border-hairline flex cursor-pointer flex-col items-center justify-center gap-2 rounded-inner border border-dashed px-6 py-10 text-center transition-colors duration-(--motion-dur-fast)",
            dragging ? "bg-surface-2 border-(--color-accent)" : "hover:bg-surface-2",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
            }}
          />
          <span className="text-ink-primary text-sm">Drop a CSV here, or click to choose</span>
          <span className="text-ink-muted text-xs">
            Needs a date, an item code and units sold. Store, category, price and promo columns help.
          </span>
        </label>
      ) : null}

      {step === "map" && preview && mapping ? (
        <div className="flex flex-col gap-5">
          <div className="bg-surface-2 rounded-inner flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs">
            <span className="text-ink-primary">
              {preview.fileName}
              <span className="text-ink-muted">
                {" "}· {fmtBytes(file?.size ?? 0)} · {thousands(preview.rowCount)} rows · {preview.columns.length} columns
                {preview.dateDetect ? ` · dates look like ${preview.dateDetect.label}` : ""}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={reset}>Choose another file</Button>
          </div>

          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
            {SALES_FIELDS.map((f) => {
              const current = (mapping[f.key] as string | null | undefined) ?? null;
              return (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <span className="text-ink-primary text-[13px]">
                    {f.label}
                    {f.required ? <span className="text-ink-muted"> · required</span> : null}
                  </span>
                  <Field
                    label={f.label}
                    value={current || NONE}
                    onChange={(v) => set({ [f.key]: v === NONE ? (f.required ? "" : null) : v } as Partial<SalesMapping>)}
                    options={columnOptions(preview)}
                    className="w-full"
                  />
                  <span className="text-ink-muted text-[11px] leading-snug">{f.hint}</span>
                </div>
              );
            })}
            <div className="flex flex-col gap-1.5">
              <span className="text-ink-primary text-[13px]">Date format</span>
              <Field
                label="Date format"
                value={mapping.dateFormat}
                onChange={(v) => set({ dateFormat: v as SalesMapping["dateFormat"] })}
                options={DATE_FORMATS}
                className="w-full"
              />
              <span className="text-ink-muted text-[11px] leading-snug">
                {preview.dateDetect?.ambiguous
                  ? "Day and month could be either way round in this file. Pick the right one."
                  : "Change only if the preview dates look wrong."}
              </span>
            </div>
            {!mapping.store ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-ink-primary text-[13px]" htmlFor="store-name">Store name</label>
                <input
                  id="store-name"
                  value={mapping.storeName ?? ""}
                  onChange={(e) => set({ storeName: e.target.value })}
                  placeholder="My store"
                  className="border-hairline bg-surface-1 text-ink-primary min-h-8 rounded-md border px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
                />
                <span className="text-ink-muted text-[11px] leading-snug">No store column, so every row goes to this one store.</span>
              </div>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <caption className="text-ink-muted pb-2 text-left text-[11px]">
                First rows as they will be read
              </caption>
              <thead>
                <tr className="text-ink-secondary border-hairline border-b text-left">
                  {SALES_FIELDS.filter((f) => f.required || mapping[f.key]).map((f) => (
                    <th key={f.key} scope="col" className="py-1.5 pr-3 whitespace-nowrap">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((row, i) => (
                  <tr key={i} className="border-hairline border-b last:border-0">
                    {SALES_FIELDS.filter((f) => f.required || mapping[f.key]).map((f) => {
                      const idx = mappedIndex(preview, mapping[f.key] as string | null | undefined);
                      return (
                        <td key={f.key} className={cn("py-1.5 pr-3 whitespace-nowrap", idx < 0 ? "text-ink-muted" : "text-ink-primary")}>
                          {idx < 0 ? (f.key === "store" ? mapping.storeName || "My store" : "—") : row[idx]}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {summary && summary.stores.length === 0 ? null : (
          <div className="border-hairline flex flex-col gap-3 border-t pt-4">
            <Switch
              checked={mapping.mode === "replace"}
              onCheckedChange={(v) => set({ mode: v ? "replace" : "merge" })}
              label={
                summary?.isDemo
                  ? "Replace the demo data with this file"
                  : "Replace everything on file with this file"
              }
              labelClassName="text-[13px]"
            />
            <p className="text-ink-muted text-[11px] leading-snug">
              {mapping.mode === "replace"
                ? "Stores, items, sales, promotions and stock counts on file are removed first. Fuel data is removed too."
                : "Rows for the same store, item and day are updated; everything else is kept."}
            </p>
          </div>
          )}

          <div className={cn("flex flex-col gap-2", assessing && "is-refetching")}>
            {shown ? (
              <>
                <p className="text-ink-primary text-sm">
                  {thousands(shown.rowsKept)} store-item-days from {thousands(shown.rowsRead)} rows:{" "}
                  {shown.stores.length} store{shown.stores.length === 1 ? "" : "s"}, {thousands(shown.items)} items
                  {shown.dateFrom && shown.dateTo
                    ? `, ${shortDate(shown.dateFrom)} to ${longDate(shown.dateTo)} (${shown.days} days)`
                    : ""}
                  .
                </p>
                {shown.warnings.length ? (
                  <ul className="flex flex-col gap-1">
                    {shown.warnings.map((w) => (
                      <li key={w} className="flex items-start gap-2 text-xs">
                        <StatusBadge tone="warning" className="mt-px shrink-0">Check</StatusBadge>
                        <span className="text-ink-secondary leading-snug">{w}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-ink-muted text-xs">Map the date, item code and units columns to see what would be imported.</p>
            )}
            {error ? <p role="alert" className="text-xs" style={{ color: "var(--status-critical)" }}>{error}</p> : null}
          </div>

          <div className="flex items-center gap-3">
            <ActionButton
              disabled={!ready}
              idleLabel={shown ? `Import ${thousands(shown.rowsKept)} rows` : "Import"}
              pendingLabel="Importing…"
              successLabel="Imported"
              errorLabel="Import failed"
              minPendingMs={600}
              onAction={doImport}
              announcements={{ pending: "Importing", success: "Import complete", error: "Import failed" }}
            />
            <span className="text-ink-muted text-xs">The forecast refits on the next page load.</span>
          </div>
        </div>
      ) : null}

      {step === "done" && result ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <StatusBadge tone="good" className="mt-0.5">Imported</StatusBadge>
            <p className="text-ink-primary text-sm leading-relaxed">
              {thousands(result.rowsKept)} store-item-days for {result.stores.map((s) => s.name).join(", ")}:{" "}
              {thousands(result.items)} items,{" "}
              {result.dateFrom && result.dateTo ? `${shortDate(result.dateFrom)} to ${longDate(result.dateTo)} (${result.days} days)` : ""}
              . {result.mode === "replace" ? "The data that was on file has been replaced." : "Merged into what was on file."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <Link href="/items">See the forecast</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>Add another file</Button>
          </div>
        </div>
      ) : null}

      {step === "pick" && error ? (
        <p role="alert" className="text-xs" style={{ color: "var(--status-critical)" }}>{error}</p>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function DataWorkspace() {
  const { refresh } = useMeta();
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/import/status", { signal: ac.signal })
      .then((r) => r.json() as Promise<DataSummary>)
      .then(setSummary)
      .catch(() => {});
    return () => ac.abort();
  }, [nonce]);

  const onImported = () => {
    setNonce((n) => n + 1);
    refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="chunk-in chunk-in-1">
        <WorkspaceHeader
          title="Your data"
          description="What the forecast is built from, and how to bring your own."
          filters={null}
        />
      </div>
      <div className="chunk-in chunk-in-2">
        <Importer summary={summary} onImported={onImported} />
      </div>
      <div className="chunk-in chunk-in-3">
        <OnFile summary={summary} />
      </div>
      <p className="chunk-in chunk-in-4 text-ink-muted text-xs leading-relaxed">
        Next up for real data: stock on hand per item (unlocks the order suggestions), a cost per item
        (real order costs), and a nightly pull from your POS instead of a file.
      </p>
    </div>
  );
}
