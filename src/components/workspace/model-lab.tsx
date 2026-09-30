"use client";

/**
 * Model Lab — the forecast's working, in numbers.
 *
 * Reads top to bottom as an argument: here is the model in production, here
 * is what each extra input does to its error, here is what the full model
 * learned, and here is where the production model misses and why.
 */

import { useMemo, useState } from "react";
import { ChartFrame, DataTable } from "@/components/chart/chart-frame";
import { MultiLine, gutterFor } from "@/components/chart/multi-line";
import { StatTile } from "@/components/figures/stat-tile";
import { useMeta } from "@/components/shell/meta";
import type { StepId, StepResult } from "@/lib/forecast/ablation";
import { compact, dowDate, percent, shortDate, signedPercent, thousands } from "@/lib/format";
import { useModelLab } from "@/lib/hooks/use-workspace";
import type { LabStream, LabWorkspace } from "@/lib/workspace/lab";
import { cn } from "@/lib/utils";
import { Field, FilterGroup } from "./filters";
import { StatusBadge, WorkspaceHeader } from "./shared";

/** Error change in percentage points, with the sign that reads naturally. */
function pts(delta: number, digits = 1): string {
  const v = Math.abs(delta * 100).toFixed(digits);
  return `${delta <= 0 ? "−" : "+"}${v} pts`;
}

function DeltaPill({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-ink-muted text-xs">baseline</span>;
  // Under a tenth of a point is noise at this sample size; say so.
  if (Math.abs(delta) < 0.001) {
    return <span className="text-ink-muted tabular text-xs">≈ no change</span>;
  }
  const better = delta < 0;
  const color = better ? "var(--delta-good)" : "var(--delta-bad)";
  return (
    <span className="tabular inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      <span aria-hidden>{better ? "▼" : "▲"}</span>
      {pts(delta)} error
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* The ladder                                                                 */
/* -------------------------------------------------------------------------- */

function Ladder({
  steps,
  selected,
  onSelect,
  inProduction,
  productionAdds,
}: {
  steps: StepResult[];
  selected: StepId;
  onSelect: (id: StepId) => void;
  inProduction: StepId;
  /** What the production row actually uses on this series. */
  productionAdds: string;
}) {
  const max = Math.max(...steps.map((s) => s.metrics.wape));
  const baselines = steps.filter((s) => s.id === "naive" || s.id === "hw");
  const rungs = steps.filter((s) => s.id !== "naive" && s.id !== "hw");

  const Row = ({ s }: { s: StepResult }) => {
    const active = s.id === selected;
    return (
      <li>
        <button
          type="button"
          onClick={() => onSelect(s.id)}
          aria-pressed={active}
          className={cn(
            "press rounded-inner grid w-full grid-cols-1 items-center gap-x-4 gap-y-2 px-3 py-2.5 text-left sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_9.5rem]",
            "focus-visible:ring-ring transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:outline-none",
            active ? "bg-surface-2 shadow-[var(--shadow-border)]" : "hover:bg-surface-2",
          )}
        >
          <span className="min-w-0">
            <span className="text-ink-primary flex items-center gap-2 text-[13px] font-medium">
              {s.label}
              {s.id === inProduction ? <StatusBadge tone="good">In production</StatusBadge> : null}
            </span>
            <span className="text-ink-muted block truncate text-[11px]">
              {s.id === "production" ? productionAdds : s.adds}
            </span>
          </span>

          <span className="flex items-center gap-3">
            <span className="bg-surface-3 relative h-2 min-w-0 flex-1 overflow-hidden rounded-full" aria-hidden>
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${(s.metrics.wape / max) * 100}%`,
                  backgroundColor: active ? "var(--series-1)" : "var(--series-other)",
                  transition: "width 300ms var(--ease-out), background-color 150ms",
                }}
              />
            </span>
            <span className="text-ink-primary tabular w-14 shrink-0 text-right text-[13px] font-semibold">
              {percent(s.metrics.wape, 1)}
            </span>
          </span>

          <span className="flex flex-col items-start sm:items-end">
            <DeltaPill delta={s.deltaWape} />
            <span className="text-ink-muted tabular text-[11px]">
              accuracy {percent(1 - s.metrics.wape, 1)}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-ink-muted hidden grid-cols-[minmax(0,15rem)_minmax(0,1fr)_9.5rem] gap-x-4 px-3 text-[11px] font-medium sm:grid">
        <span>Model</span>
        <span>Forecast error (WAPE) — shorter is better</span>
        <span className="text-right">Change vs the row above</span>
      </div>
      <div>
        <p className="text-ink-muted px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">Baselines</p>
        <ul className="flex flex-col gap-0.5">{baselines.map((s) => <Row key={s.id} s={s} />)}</ul>
      </div>
      <div>
        <p className="text-ink-muted px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
          Adding one input at a time
        </p>
        <ul className="flex flex-col gap-0.5">{rungs.map((s) => <Row key={s.id} s={s} />)}</ul>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* What the numbers are built from                                            */
/* -------------------------------------------------------------------------- */

function DataCard({ w }: { w: LabWorkspace }) {
  const d = w.data;
  const wd = d.weatherDays;
  const rows = [
    {
      k: "Sales history",
      v: `${thousands(d.salesDays)} days`,
      note: d.firstSale && d.lastSale ? `${shortDate(d.firstSale)} – ${shortDate(d.lastSale)}` : undefined,
    },
    {
      k: "Weather at the store",
      v: `${thousands(wd.observed + wd.forecast)} days`,
      note: `Open-Meteo · ${wd.forecast} forecast${wd.none ? ` · ${wd.none} without` : ""}`,
    },
    { k: "Public holidays", v: thousands(d.holidays), note: "Nager.Date, national + state" },
    { k: "Weather alerts", v: thousands(d.alerts), note: "National Weather Service" },
    {
      k: "Events nearby",
      v: thousands(d.localEvents),
      note: d.localEvents ? "PredictHQ, within 10 km" : "PredictHQ — needs API key",
    },
    ...(w.stream === "items"
      ? [{ k: "Planned promotions", v: thousands(d.promotions), note: "promotions table" }]
      : []),
  ];

  return (
    <section className="surface-card rounded-card flex flex-col gap-4 p-5 sm:p-6">
      <div>
        <h3 className="text-ink-primary text-[15px] font-medium">Data behind these numbers</h3>
        <p className="text-ink-muted mt-1 text-[13px]">Read from the database for this store.</p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {rows.map((r) => (
          <div key={r.k} className="bg-surface-2 rounded-inner p-3">
            <dt className="text-ink-muted text-[11px] leading-snug">{r.k}</dt>
            <dd className="text-ink-primary tabular mt-1 text-lg font-semibold">{r.v}</dd>
            {r.note ? <dd className="text-ink-muted text-[11px]">{r.note}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="text-ink-secondary text-[13px] leading-relaxed">
        The sales and promotions are demo data, generated before any real weather or events were
        connected, so real temperatures and nearby events explain little of them yet. Connected to
        real POS sales, the same model learns what each input is actually worth at each store.
        {d.localEvents === 0 ? " Nearby events appear once a PredictHQ key is added and synced." : ""}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

const STREAM_OPTIONS = [
  { value: "items", label: "Inside items" },
  { value: "fuel", label: "Fuel" },
];

export function ModelLab() {
  const { meta } = useMeta();
  const [chosenStore, setStoreId] = useState<string>("");
  const [stream, setStream] = useState<LabStream>("items");
  const [selected, setSelected] = useState<StepId>("production");
  const stores = meta?.stores ?? [];
  const storeId = stores.some((s) => s.id === chosenStore) ? chosenStore : (stores[0]?.id ?? "");
  const { data: w, loading, error } = useModelLab(storeId, stream);

  const lab = w?.lab ?? null;
  const byId = useMemo(() => new Map(lab?.steps.map((s) => [s.id, s]) ?? []), [lab]);
  const fmt = (n: number) => compact(n);
  const whole = (n: number) => thousands(Math.round(n));

  const filters = (
    <FilterGroup busy={loading && !!w}>
      <Field label="Store" value={storeId} onChange={setStoreId}
        options={stores.map((s) => ({ value: s.id, label: s.name }))} widthClass="w-[248px]" />
      <Field label="Demand" value={stream} onChange={(v) => setStream(v as LabStream)}
        options={STREAM_OPTIONS} widthClass="w-[140px]" />
    </FilterGroup>
  );

  const header = (
    <WorkspaceHeader
      title="Model Lab"
      description={
        w && lab
          ? `${w.storeName} · ${w.stream === "items" ? "inside items" : "fuel"} · ${lab.windows.length} two-week backtests, ${shortDate(lab.windows[0].start)} – ${shortDate(lab.windows[lab.windows.length - 1].end)}`
          : "What each input adds to forecast accuracy, measured on the same backtest"
      }
      filters={filters}
    />
  );

  // The header and filters stay on screen in every state; only the first
  // load, with nothing to show yet, gets a skeleton.
  if (error && !w) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="surface-card rounded-card text-ink-secondary p-6 text-center">
          Couldn&apos;t load the Model Lab: {error}
        </div>
      </div>
    );
  }
  if (!w) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="flex animate-pulse flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => <div key={i} className="surface-card rounded-card h-28" />)}
          </div>
          <div className="surface-card rounded-card h-96" />
        </div>
      </div>
    );
  }
  if (!lab) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className={cn("surface-card rounded-card text-ink-secondary p-6 text-center", loading && "is-refetching")}>
          Not enough sales history at this store to backtest honestly ({w.historyDays} days;
          the ladder needs at least {120 + 2 * 14}).
        </div>
      </div>
    );
  }

  const hw = byId.get("hw")!;
  const naive = byId.get("naive")!;
  const full = byId.get("production")!;
  const live = byId.get(lab.inProduction)!;
  const pick = byId.get(selected) ?? full;
  const rungs = lab.steps.filter((s) => s.deltaWape != null && s.id !== "calendar" && s.id !== "production");
  const pi = lab.productionInputs;
  const kept = pi
    ? [
        "promotions",
        "holidays",
        ...(pi.weather ? ["weather"] : []),
        ...(pi.alerts ? ["weather alerts"] : []),
        ...(pi.events ? ["local events"] : []),
      ]
    : [];
  const dropped = pi
    ? [
        ...(pi.weather ? [] : ["weather"]),
        ...(pi.alerts ? [] : ["alerts"]),
        ...(pi.events ? [] : ["local events"]),
      ]
    : [];
  const productionAdds = pi
    ? `Uses ${kept.join(", ")}${dropped.length ? ` · ${dropped.join(", ")} left out (didn't help here)` : ""} · level correction`
    : "Inputs that improve the backtest, plus a recent-level correction";
  const biggest = [...rungs].sort((a, b) => (a.deltaWape ?? 0) - (b.deltaWape ?? 0))[0];
  const unit = w.unit;

  const lines = [
    { id: "actual", label: "Actual", color: "var(--series-1)", values: lab.backtest.actual },
    { id: "hw", label: "Holt-Winters", color: "var(--series-2)", values: hw.predictions },
    ...(pick.id !== "hw"
      ? [{ id: pick.id, label: pick.label.replace(/^\+ /, "+"), color: "var(--series-3)", values: pick.predictions }]
      : []),
  ];

  const windowDates = lab.windows.map((x) => x.start);
  const windowLines = [
    { id: "hw", label: "Holt-Winters", color: "var(--series-2)", values: hw.windowWape },
    ...(pick.id !== "hw"
      ? [{ id: pick.id, label: pick.label.replace(/^\+ /, "+"), color: "var(--series-3)", values: pick.windowWape }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="chunk-in chunk-in-1">{header}</div>
      <div className={cn("flex flex-col gap-4", loading && "is-refetching")}>

      <section className="chunk-in chunk-in-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Forecast in use"
          value={percent(1 - live.metrics.wape, 1)}
          caption={live.id === "hw" ? "Holt-Winters · sales history only" : `Driver model · ${kept.length ? kept.join(", ") : "selected inputs"}`}
          captionRight={`bias ${signedPercent(live.metrics.bias, 1)}`}
        />
        <StatTile
          label="Sales history alone"
          value={percent(1 - hw.metrics.wape, 1)}
          caption={
            live.id === "hw"
              ? "Holt-Winters beats the driver model here"
              : `Inputs cut error by ${pts(hw.metrics.wape - full.metrics.wape).replace("−", "")}`
          }
          captionRight={`bias ${signedPercent(hw.metrics.bias, 1)}`}
        />
        <StatTile
          label="Biggest single gain"
          value={biggest.label.replace(/^\+ /, "")}
          caption={biggest.adds}
          captionRight={pts(biggest.deltaWape ?? 0)}
        />
        <StatTile
          label="Bar to beat"
          value={percent(1 - naive.metrics.wape, 1)}
          caption="Seasonal naive · repeat last week"
          captionRight={`${lab.backtest.dates.length} days scored`}
        />
      </section>

      <div className="chunk-in chunk-in-3 grid grid-cols-1 items-start gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <ChartFrame
            title="Accuracy ladder"
            subtitle="Each row adds one input to the row above it. Pick a row to see it in the charts."
            table={
              <DataTable
                rows={lab.steps}
                rowKey={(r) => r.id}
                caption="Backtest error by model"
                columns={[
                  { key: "m", header: "Model", render: (r) => r.label },
                  { key: "w", header: "Error (WAPE)", numeric: true, render: (r) => percent(r.metrics.wape, 2) },
                  { key: "d", header: "Change", numeric: true, render: (r) => (r.deltaWape == null ? "—" : pts(r.deltaWape, 2)) },
                  { key: "a", header: "Accuracy", numeric: true, render: (r) => percent(1 - r.metrics.wape, 1) },
                  { key: "mp", header: "MAPE", numeric: true, render: (r) => percent(r.metrics.mape, 1) },
                  { key: "b", header: "Bias", numeric: true, render: (r) => signedPercent(r.metrics.bias, 1) },
                  { key: "x", header: "Worst day", numeric: true, render: (r) => percent(r.metrics.worstDay, 0) },
                  { key: "i", header: "Inputs", numeric: true, render: (r) => (r.inputs == null ? "—" : String(r.inputs)) },
                ]}
              />
            }
            caption={
              <>
                Every model forecasts the same {lab.windows.length} back-to-back two-week windows,
                trained only on the days before each window, the same backtest as the Items and
                Fuel pages. Error is WAPE (total absolute miss ÷ total actual), and accuracy is 1 − WAPE.
                The regression rows are a ridge regression on log demand, refitted for every
                window. Two rows get more foresight than a live forecast would have. Weather uses
                the temperature that actually happened, and alerts use every alert that was
                issued (live, the forecast has Open-Meteo&apos;s forecast and only the alerts
                issued so far). Treat those two gains as upper bounds.
              </>
            }
          >
            <Ladder
              steps={lab.steps}
              selected={pick.id}
              onSelect={setSelected}
              inProduction={lab.inProduction}
              productionAdds={productionAdds}
            />
          </ChartFrame>
        </div>

        <div className="flex flex-col gap-4 xl:col-span-2">
          <ChartFrame
            title="What the full model learned"
            subtitle="Fitted on all history, with every input."
            table={
              <DataTable
                rows={lab.learned}
                rowKey={(r) => r.id}
                caption="Learned effects"
                columns={[
                  { key: "l", header: "Input", render: (r) => r.label },
                  { key: "v", header: "Effect", numeric: true, render: (r) => r.value },
                  { key: "m", header: "Meaning", render: (r) => r.meaning },
                ]}
              />
            }
          >
            <dl className="divide-hairline flex flex-col divide-y">
              {lab.learned.map((r) => (
                <div key={r.id} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <dt className="text-ink-primary text-[13px] font-medium">{r.label}</dt>
                    <dd className="text-ink-muted text-[11px] leading-snug">{r.meaning}</dd>
                  </div>
                  <dd className="text-ink-primary tabular shrink-0 text-right text-[13px] font-semibold">{r.value}</dd>
                </div>
              ))}
            </dl>
          </ChartFrame>
        </div>
      </div>

      <div className="chunk-in chunk-in-4">
        <ChartFrame
          title={`Backtest — actual vs ${pick.id === "hw" ? "Holt-Winters" : `Holt-Winters and ${pick.label.replace(/^\+ /, "+")}`}`}
          subtitle={`Daily ${unit}. Every point was forecast 1–14 days ahead, before that day happened.`}
          legend={lines.map((l) => ({ label: l.label, color: l.color, shape: "line" as const }))}
          table={
            <DataTable
              rows={lab.backtest.dates.map((d, i) => ({ d, i }))}
              rowKey={(r) => r.d}
              caption="Backtest actuals and forecasts"
              columns={[
                { key: "d", header: "Date", render: (r) => dowDate(r.d) },
                ...lines.map((l) => ({
                  key: l.id, header: l.label, numeric: true,
                  render: (r: { i: number }) => whole(l.values[r.i]),
                })),
              ]}
            />
          }
        >
          <MultiLine
            dates={lab.backtest.dates}
            series={lines}
            height={300}
            format={fmt}
            labelGutter={gutterFor(lines.map((l) => l.label))}
          />
        </ChartFrame>
      </div>

      <div className="chunk-in chunk-in-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <ChartFrame
            title="Where the production model misses most"
            subtitle="The eight worst backtest days for Holt-Winters, what was going on, and how the driver model did."
            table={
              <DataTable
                rows={lab.misses}
                rowKey={(r) => r.date}
                caption="Largest production-model misses"
                columns={[
                  { key: "d", header: "Date", render: (r) => dowDate(r.date) },
                  { key: "c", header: "Context", render: (r) => r.context.join("; ") || "—" },
                  { key: "a", header: "Actual", numeric: true, render: (r) => whole(r.actual) },
                  { key: "h", header: "Holt-Winters", numeric: true, render: (r) => whole(r.hw) },
                  { key: "f", header: "Driver model", numeric: true, render: (r) => whole(r.full) },
                ]}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-xs">
                <thead>
                  <tr className="text-ink-muted border-hairline border-b text-left">
                    <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                    <th scope="col" className="py-2 pr-3 font-medium">What was going on</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Actual</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Holt-Winters</th>
                    <th scope="col" className="py-2 text-right font-medium">Driver model</th>
                  </tr>
                </thead>
                <tbody>
                  {lab.misses.map((m) => {
                    const e = (p: number) => (m.actual > 0 ? (p - m.actual) / m.actual : 0);
                    return (
                      <tr key={m.date} className="border-hairline border-b last:border-0">
                        <td className="text-ink-primary py-2 pr-3 whitespace-nowrap">{dowDate(m.date)}</td>
                        <td className="text-ink-secondary py-2 pr-3">
                          {m.context.length ? m.context.join("; ") : <span className="text-ink-muted">Nothing logged</span>}
                        </td>
                        <td className="text-ink-primary tabular py-2 pr-3 text-right">{whole(m.actual)}</td>
                        <td className="tabular py-2 pr-3 text-right">
                          <span className="text-ink-primary">{whole(m.hw)}</span>{" "}
                          <span className="text-ink-muted">{signedPercent(e(m.hw), 0)}</span>
                        </td>
                        <td className="tabular py-2 text-right">
                          <span className="text-ink-primary">{whole(m.full)}</span>{" "}
                          <span className="text-ink-muted">{signedPercent(e(m.full), 0)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartFrame>
        </div>

        <div className="flex flex-col gap-4 xl:col-span-2">
          <ChartFrame
            title="Error in each two-week window"
            subtitle="WAPE per backtest window. Spikes line up with events."
            legend={windowLines.map((l) => ({ label: l.label, color: l.color, shape: "line" as const }))}
            table={
              <DataTable
                rows={lab.windows.map((x, i) => ({ ...x, i }))}
                rowKey={(r) => r.start}
                caption="Error per backtest window"
                columns={[
                  { key: "w", header: "Window", render: (r) => `${shortDate(r.start)} – ${shortDate(r.end)}` },
                  ...windowLines.map((l) => ({
                    key: l.id, header: l.label, numeric: true,
                    render: (r: { i: number }) => percent(l.values[r.i], 1),
                  })),
                ]}
              />
            }
          >
            <MultiLine
              dates={windowDates}
              series={windowLines}
              height={220}
              format={(n) => percent(n, 0)}
              labelGutter={gutterFor(windowLines.map((l) => l.label))}
            />
          </ChartFrame>
          <DataCard w={w} />
        </div>
      </div>

      <p className="text-ink-muted border-hairline border-t pt-4 text-xs leading-relaxed">
        <strong className="text-ink-secondary font-medium">What this means for the dashboard:</strong>{" "}
        the Items and Fuel pages forecast every SKU and fuel grade with the driver model: effects of
        promotions, price, holidays, weather and events are learned from past sales, then applied to
        what&apos;s known about the days ahead — planned promotions, Open-Meteo&apos;s forecast for the
        store, upcoming holidays and events. Each series falls back to Holt-Winters when that scores
        better on its own backtest, or when there isn&apos;t enough history to test.
      </p>
      </div>
    </div>
  );
}
