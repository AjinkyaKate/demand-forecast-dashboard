"use client";

/**
 * Pieces both workspaces share: status badges, the anomaly feed, the driver
 * card and the accuracy panel.
 */

import type { ReactNode } from "react";
import { ChartFrame, DataTable } from "@/components/chart/chart-frame";
import { DriverBars } from "@/components/chart/driver-bars";
import type { Anomaly } from "@/lib/forecast/anomalies";
import type { DriverModel } from "@/lib/forecast/drivers";
import { BRIDGE_ORDER_LABELS } from "@/lib/forecast/drivers";
import type { Accuracy } from "@/lib/forecast/backtest";
import type { ModelInfo } from "@/lib/workspace/items";
import { dowDate, percent, shortDate, signedPercent, thousands } from "@/lib/format";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

export type StatusTone = "critical" | "serious" | "warning" | "good" | "neutral";

const TONE: Record<StatusTone, { color: string; icon: string }> = {
  critical: { color: "var(--status-critical)", icon: "●" },
  serious: { color: "var(--status-serious)", icon: "▲" },
  warning: { color: "var(--status-warning)", icon: "▲" },
  good: { color: "var(--status-good)", icon: "✓" },
  neutral: { color: "var(--ink-muted)", icon: "–" },
};

/** Status colour never travels alone — every badge ships an icon and a label. */
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        className,
      )}
      style={{
        color: t.color,
        backgroundColor: `color-mix(in oklab, ${t.color} 12%, transparent)`,
      }}
    >
      <span aria-hidden className="text-[9px] leading-none">{t.icon}</span>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Anomaly feed                                                               */
/* -------------------------------------------------------------------------- */

export function AnomalyFeed({
  incidents,
  unit,
  title = "Detected anomalies",
}: {
  incidents: Anomaly[][];
  unit: string;
  title?: string;
}) {
  if (incidents.length === 0) {
    return (
      <section className="surface-card rounded-card p-6">
        <h3 className="text-ink-primary text-[15px] font-medium">{title}</h3>
        <p className="text-ink-muted mt-2 text-xs">
          No days in this window deviate from the model by more than 3 robust
          standard deviations.
        </p>
      </section>
    );
  }

  return (
    <section className="surface-card rounded-card flex flex-col p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-ink-primary text-[15px] font-medium">{title}</h3>
        <p className="text-ink-muted text-[11px]">
          {incidents.length} incident{incidents.length === 1 ? "" : "s"}
        </p>
      </div>
      {/* No scroll container: a clipped half-row reads as a rendering fault,
          not as "there is more below". The feed shows whole incidents and the
          workspace caps how many it passes in. */}
      <ul className="-mx-2 mt-3 divide-y">
        {incidents.map((group) => {
          const head = group.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
          // groupAnomalies reverses the outer list (most recent incident
          // first) but leaves each group ascending, so the earliest day is
          // index 0. Reading it the other way printed "Nov 16 – Nov 15".
          const start = group[0];
          const end = group[group.length - 1];
          const span =
            group.length > 1
              ? `${shortDate(start.date)} – ${shortDate(end.date)}`
              : dowDate(head.date);
          const cause = head.causes[0];
          const context = head.context[0];

          return (
            <li key={head.date} className="row-hover rounded-md px-2 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="flex items-center gap-2">
                  <StatusBadge tone={head.severity}>
                    {head.direction === "spike" ? "Spike" : "Drop"}
                  </StatusBadge>
                  <span className="text-ink-primary text-xs font-medium tabular">
                    {span}
                  </span>
                  {group.length > 1 ? (
                    <span className="text-ink-muted text-[11px]">
                      {group.length} days
                    </span>
                  ) : null}
                </div>
                <span
                  className="tabular text-xs font-semibold"
                  style={{
                    color:
                      head.deviation >= 0 ? "var(--delta-good)" : "var(--delta-bad)",
                  }}
                >
                  {signedPercent(head.deviation, 0)}
                </span>
              </div>

              {/* One line, not three: the actual-vs-expected pair and the
                  cause read as a single sentence. The event's full note lives
                  in the title attribute rather than on screen. */}
              <p className="text-ink-muted mt-1 text-[11px] leading-snug">
                <span className="tabular">
                  {thousands(Math.round(head.actual))} vs{" "}
                  {thousands(Math.round(head.expected))} {unit} expected
                </span>
                {" · "}
                {cause ? (
                  <span className="text-ink-secondary font-medium" title={cause.note}>
                    {cause.label}
                  </span>
                ) : (
                  <span title={context ? `Standing condition: ${context.label}` : undefined}>
                    no logged cause
                  </span>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Drivers                                                                    */
/* -------------------------------------------------------------------------- */

export function DriverCard({
  drivers,
  horizon,
  unitLabel,
}: {
  drivers: DriverModel;
  horizon: number;
  unitLabel: string;
}) {
  const bars = drivers.effects.map((e) => ({
    id: e.id,
    label: e.label,
    value: e.effect,
    hint: e.hint,
    detail: `${e.units >= 0 ? "+" : "−"}${thousands(Math.abs(e.units), 1)} ${unitLabel}/day`,
  }));

  return (
    <ChartFrame
      title="What's driving the forecast"
      subtitle={
        <>
          Next {horizon} days vs an average period · R² {percent(drivers.r2, 0)}
        </>
      }
      table={
        <DataTable
          rows={drivers.effects}
          rowKey={(r) => r.id}
          caption="Driver contributions to the forecast"
          columns={[
            { key: "d", header: "Driver", render: (r) => r.label },
            {
              key: "e",
              header: "Effect",
              numeric: true,
              render: (r) => signedPercent(r.effect),
            },
            {
              key: "u",
              header: `${unitLabel}/day`,
              numeric: true,
              render: (r) =>
                `${r.units >= 0 ? "+" : "−"}${thousands(Math.abs(r.units), 1)}`,
            },
            { key: "h", header: "Meaning", render: (r) => r.hint },
          ]}
        />
      }
      caption={
        <>
          Effects are multiplicative and order-independent. The per-day figures
          in the table are a bridge applied in a fixed order (
          {BRIDGE_ORDER_LABELS.join(" → ")}), so they sum to the forecast but
          depend on that order. A driver reads 0% when the window holds it in
          average measure — a whole number of weeks nets out the day-of-week
          mix.
          {drivers.degenerate
            ? " This series had too little variation to attribute honestly."
            : ""}
        </>
      }
    >
      <DriverBars bars={bars} />
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Accuracy                                                                   */
/* -------------------------------------------------------------------------- */

const MODEL_NAME: Record<ModelInfo["used"], string> = {
  driver: "Driver model",
  "holt-winters": "Holt-Winters",
};

/** Which model forecasts this view, and the backtest that chose it. */
function ModelChoiceNote({ model }: { model: ModelInfo }) {
  const pct = (w: number | null) => (w == null || !Number.isFinite(w) ? "—" : percent(1 - w, 1));
  return (
    <div className="bg-surface-2 rounded-inner mt-4 p-3">
      <p className="text-ink-primary text-xs font-medium">Forecast by {MODEL_NAME[model.used]}</p>
      <p className="text-ink-muted mt-1 text-[11px] leading-relaxed">
        {model.used === "driver"
          ? "Learns promotion, price, holiday, weather and event effects from past sales, and applies them to the planned promos, weather forecast and events ahead."
          : "Sales history only — the driver model didn’t score better on this backtest."}
      </p>
      <dl className="tabular mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <div className="flex gap-1">
          <dt className="text-ink-muted">Driver model</dt>
          <dd className="text-ink-primary font-medium">{pct(model.driverWape)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-ink-muted">Holt-Winters</dt>
          <dd className="text-ink-primary font-medium">{pct(model.hwWape)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-ink-muted">Series on driver model</dt>
          <dd className="text-ink-primary font-medium">
            {model.seriesOnDriver}/{model.seriesTotal}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function AccuracyPanel({ accuracy, model }: { accuracy: Accuracy; model?: ModelInfo }) {
  // A store with too little history has nothing to score. Say so instead of
  // printing a number computed from nothing.
  if (accuracy.points === 0) {
    return (
      <section className="surface-card rounded-card p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-ink-primary text-sm font-semibold">Forecast accuracy</h3>
          <StatusBadge tone="neutral">Not scored yet</StatusBadge>
        </div>
        <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
          This store doesn&apos;t have enough sales history to backtest the forecast. Scoring
          needs about four months of daily sales. Until then, read the forecast as a best guess.
        </p>
      </section>
    );
  }
  const beatsNaive = accuracy.mase < 1;
  // Each metric's gloss lives in its `title`, not on screen — four rows of
  // explanation under four numbers doubles the panel and halves its legibility.
  const rows = [
    {
      k: "Accuracy",
      v: percent(1 - accuracy.wape, 1),
      note: "100% − WAPE. Weighted absolute error over all scored days.",
    },
    {
      k: "MAPE",
      v: percent(accuracy.mape, 1),
      note: "Mean absolute percentage error, excluding zero-demand days.",
    },
    {
      k: "Bias",
      v: signedPercent(accuracy.bias, 1),
      note: accuracy.bias >= 0 ? "Model runs high." : "Model runs low.",
    },
    {
      k: "vs naive",
      v: accuracy.mase.toFixed(2),
      note: beatsNaive
        ? "MASE below 1.0 — beats last-week-same-day."
        : "MASE at or above 1.0 — no better than last-week-same-day.",
    },
  ];

  return (
    <section className="surface-card rounded-card p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-ink-primary text-sm font-semibold">Forecast accuracy</h3>
        <StatusBadge tone={beatsNaive ? "good" : "warning"}>
          {beatsNaive ? "Beats baseline" : "Check model"}
        </StatusBadge>
      </div>
      <p className="text-ink-muted mt-1 text-xs">
        Rolling-origin backtest, {accuracy.points} held-out day-forecasts.
      </p>
      <dl className="mt-4 space-y-3">
        {rows.map((r) => (
          <div
            key={r.k}
            title={r.note}
            className="border-hairline flex items-baseline justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
          >
            <dt className="text-ink-secondary text-xs">{r.k}</dt>
            <dd className="text-ink-primary tabular shrink-0 text-sm font-semibold">
              {r.v}
            </dd>
          </div>
        ))}
      </dl>
      {model ? <ModelChoiceNote model={model} /> : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section heading                                                            */
/* -------------------------------------------------------------------------- */

export function SectionHeading({
  title,
  description,
  aside,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div>
        <h2 className="text-ink-primary text-lg font-semibold tracking-[-0.01em]">{title}</h2>
        {description ? (
          <p className="text-ink-muted mt-0.5 text-xs">{description}</p>
        ) : null}
      </div>
      {aside}
    </div>
  );
}
