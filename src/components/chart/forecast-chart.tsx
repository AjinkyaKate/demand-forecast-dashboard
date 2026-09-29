"use client";

/**
 * The workspace's headline chart: observed demand, the forecast, its
 * prediction band, and detected anomalies on one axis.
 *
 * One axis, always. Plotting price or margin on a second y-scale here would
 * invent a correlation the data does not contain — those live in their own
 * charts.
 */

import { useCallback, useMemo, useState } from "react";
import { bandPath, linePath, linearScale, niceTicks, tickIndices } from "@/lib/chart/scales";
import { dowDate, shortDate } from "@/lib/format";
import { AreaGradient, ChartTooltip, PillLabel, TooltipHeading, TooltipNote, TooltipRow } from "./parts";
import { useChartWidth } from "./use-chart-width";
import type { ChartRowFactors, FactorRow } from "@/lib/workspace/factors";

export type ForecastRow = {
  date: string;
  actual: number | null;
  mean: number | null;
  lo80: number | null;
  hi80: number | null;
  lo95: number | null;
  hi95: number | null;
  anomaly?: {
    direction: "spike" | "drop";
    severity: "critical" | "serious" | "warning";
    deviation: number;
    cause: string | null;
  } | null;
  factors?: ChartRowFactors | null;
};

const SEVERITY_VAR: Record<string, string> = {
  critical: "var(--status-critical)",
  serious: "var(--status-serious)",
  warning: "var(--status-warning)",
};

const FACTOR_DOT: Record<Exclude<FactorRow["type"], "event">, { dot: string; badge: string; badgeBg: string }> = {
  weather: { dot: "#F59E0B", badge: "#FBBF24", badgeBg: "rgba(245,158,11,0.15)" },
  promo:   { dot: "#2DD4BF", badge: "#2DD4BF", badgeBg: "rgba(45,212,191,0.15)" },
  holiday: { dot: "#22C55E", badge: "#4ADE80", badgeBg: "rgba(34,197,94,0.15)" },
  price:   { dot: "#A78BFA", badge: "#C4B5FD", badgeBg: "rgba(167,139,250,0.15)" },
  local:   { dot: "#3B82F6", badge: "#60A5FA", badgeBg: "rgba(59,130,246,0.15)" },
  level:   { dot: "#64748B", badge: "#94A3B8", badgeBg: "rgba(148,163,184,0.15)" },
};

const WEATHER_SOURCE: Record<ChartRowFactors["weatherSource"], string> = {
  observed: "Open-Meteo",
  forecast: "Open-Meteo forecast",
  none: "no reading",
};

const EVENT_DOT: Record<string, { dot: string; badge: string; badgeBg: string }> = {
  local:       { dot: "#3B82F6", badge: "#60A5FA", badgeBg: "rgba(59,130,246,0.15)" },
  traffic:     { dot: "#3B82F6", badge: "#60A5FA", badgeBg: "rgba(59,130,246,0.15)" },
  weather:     { dot: "#F59E0B", badge: "#FBBF24", badgeBg: "rgba(245,158,11,0.15)" },
  competition: { dot: "#A855F7", badge: "#C084FC", badgeBg: "rgba(168,85,247,0.15)" },
  equipment:   { dot: "#EF4444", badge: "#F87171", badgeBg: "rgba(239,68,68,0.15)" },
  supply:      { dot: "#EF4444", badge: "#F87171", badgeBg: "rgba(239,68,68,0.15)" },
};

const PAD = { top: 10, right: 14, bottom: 34, left: 54 };

export function ForecastChart({
  rows,
  height = 300,
  format,
  unit,
  actualLabel = "Actual",
  forecastLabel = "Forecast",
}: {
  rows: ForecastRow[];
  height?: number;
  format: (n: number) => string;
  unit: string;
  actualLabel?: string;
  forecastLabel?: string;
}) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [cursor, setCursor] = useState<number | null>(null);

  const plotW = Math.max(80, width - PAD.left - PAD.right);
  const plotH = Math.max(80, height - PAD.top - PAD.bottom);

  const geom = useMemo(() => {
    const values: number[] = [];
    for (const r of rows) {
      for (const v of [r.actual, r.mean, r.lo95, r.hi95]) {
        if (v != null && Number.isFinite(v)) values.push(v);
      }
    }
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;

    // Include zero when the data naturally approaches it; otherwise pad. A
    // truncated axis is disclosed in the footnote rather than left implicit.
    const zeroBased = min <= 0.4 * max;
    const lo = zeroBased ? 0 : min - (max - min) * 0.12;
    const { ticks, domain } = niceTicks(lo, max, 5);

    const x = linearScale([0, Math.max(1, rows.length - 1)], [PAD.left, PAD.left + plotW]);
    const y = linearScale(domain, [PAD.top + plotH, PAD.top]);

    const pt = (i: number, v: number | null | undefined) =>
      v == null || !Number.isFinite(v) ? null : { x: x(i), y: y(v) };

    const actualPts = rows.map((r, i) => pt(i, r.actual));
    const meanPts = rows.map((r, i) => pt(i, r.mean));
    const hi80 = rows.map((r, i) => pt(i, r.hi80));
    const lo80 = rows.map((r, i) => pt(i, r.lo80));
    const hi95 = rows.map((r, i) => pt(i, r.hi95));
    const lo95 = rows.map((r, i) => pt(i, r.lo95));

    const originIdx = rows.findIndex((r) => r.mean != null);

    // Closed area under the observed line, down to the baseline.
    const solid = actualPts.filter(Boolean) as { x: number; y: number }[];
    const baseY = PAD.top + plotH;
    const actualArea =
      solid.length > 1
        ? `${linePath(solid)}L${solid[solid.length - 1].x} ${baseY}L${solid[0].x} ${baseY}Z`
        : "";

    return {
      x, y, ticks, domain, zeroBased,
      actualPts, meanPts, hi80, lo80, hi95, lo95, originIdx, actualArea,
    };
  }, [rows, plotW, plotH]);

  const idxFromClientX = useCallback(
    (clientX: number, rect: DOMRect) => {
      const rel = clientX - rect.left - PAD.left;
      const i = Math.round((rel / plotW) * (rows.length - 1));
      return Math.min(rows.length - 1, Math.max(0, i));
    },
    [plotW, rows.length],
  );

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    setCursor(idxFromClientX(e.clientX, e.currentTarget.getBoundingClientRect()));
  };

  // Keyboard gets exactly what hover gets — the tooltip never gates a value.
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.shiftKey ? 7 : 1;
      setCursor((c) => {
        const base = c ?? rows.length - 1;
        const next = e.key === "ArrowRight" ? base + step : base - step;
        return Math.min(rows.length - 1, Math.max(0, next));
      });
    } else if (e.key === "Home") {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setCursor(rows.length - 1);
    } else if (e.key === "Escape") {
      setCursor(null);
    }
  };

  const active = cursor != null ? rows[cursor] : null;
  const ff = active?.factors;
  const hasFactors = ff != null && ff.rows.length > 0;
  const fmtPct = (pct: number) => {
    const v = (pct * 100).toFixed(1);
    return pct >= 0 ? `+${v}%` : `${v}%`;
  };
  const fmtSigned = (n: number) => (n > 0 ? "+" : "") + format(n);
  const xTicks = tickIndices(rows.length, width < 520 ? 4 : 7);

  const tooltipLeft = cursor != null ? geom.x(cursor) : 0;
  const flip = tooltipLeft > PAD.left + plotW * 0.62;

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`${actualLabel} and ${forecastLabel} ${unit} over time. Use arrow keys to step through days; the data table view lists every value.`}
        onKeyDown={onKeyDown}
        onBlur={() => setCursor(null)}
        className="focus-visible:ring-ring touch-none rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <defs>
          {/* The forecast band is clipped to the plot so a wide interval at the
              far horizon can never bleed over the axis labels. */}
          <clipPath id="fc-plot">
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
          <AreaGradient id="fc-actual-wash" color="var(--series-1)" top={0.16} />
        </defs>

        {/* Gridlines: solid hairlines, one step off the surface, recessive. */}
        {geom.ticks.map((t) => (
          <line
            key={t}
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={geom.y(t)}
            y2={geom.y(t)}
            stroke="var(--grid)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        ))}

        {geom.ticks.map((t) => (
          <text
            key={`l-${t}`}
            x={PAD.left - 8}
            y={geom.y(t)}
            textAnchor="end"
            dominantBaseline="middle"
            className="tabular"
            fontSize={11}
            fill="var(--ink-muted)"
          >
            {format(t)}
          </text>
        ))}

        <g clipPath="url(#fc-plot)">
          {/* 95 % then 80 %: nested washes of the forecast hue, never blocks. */}
          <path d={bandPath(geom.hi95, geom.lo95)} fill="var(--series-2)" opacity={0.1} />
          <path d={bandPath(geom.hi80, geom.lo80)} fill="var(--series-2)" opacity={0.18} />

          {geom.actualArea ? (
            <path d={geom.actualArea} fill="url(#fc-actual-wash)" />
          ) : null}
          <path
            d={linePath(geom.actualPts)}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={linePath(geom.meanPts)}
            fill="none"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Anomaly markers: r=4 (8px) with a 2px surface ring so they stay
              legible where they sit on the line. Status colour is never the
              only signal — the tooltip and table name each one. */}
          {rows.map((r, i) =>
            r.anomaly && r.actual != null ? (
              <circle
                key={`an-${r.date}`}
                cx={geom.x(i)}
                cy={geom.y(r.actual)}
                r={4}
                fill={SEVERITY_VAR[r.anomaly.severity]}
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
            ) : null,
          )}
        </g>

        {/* Where history ends and the forecast begins. */}
        {geom.originIdx > 0 ? (
          <>
            <line
              x1={geom.x(geom.originIdx)}
              x2={geom.x(geom.originIdx)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--axis)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={geom.x(geom.originIdx) + 5}
              y={PAD.top + 9}
              fontSize={10}
              fill="var(--ink-muted)"
            >
              Forecast
            </text>
          </>
        ) : null}

        {/* Baseline / axis rule */}
        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="var(--axis)"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />

        {xTicks.map((i) => (
          <PillLabel
            key={`x-${i}`}
            x={geom.x(i)}
            y={height - 12}
            text={shortDate(rows[i].date)}
            anchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}
          />
        ))}

        {/* Crosshair — readers aim at a date, never at a 2px line. */}
        {cursor != null && active ? (
          <g pointerEvents="none">
            <line
              x1={geom.x(cursor)}
              x2={geom.x(cursor)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--ink-muted)"
              strokeWidth={1}
            />
            {active.actual != null ? (
              <circle
                cx={geom.x(cursor)}
                cy={geom.y(active.actual)}
                r={4}
                fill="var(--series-1)"
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
            ) : null}
            {active.mean != null ? (
              <circle
                cx={geom.x(cursor)}
                cy={geom.y(active.mean)}
                r={4}
                fill="var(--series-2)"
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
            ) : null}
          </g>
        ) : null}

        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setCursor(null)}
        />
      </svg>

      {cursor != null && active ? (
        <ChartTooltip
          left={flip ? undefined : Math.max(PAD.left, tooltipLeft + 12)}
          right={flip ? Math.max(8, width - tooltipLeft + 12) : undefined}
        >
          <div className="flex items-center justify-between gap-3">
            <TooltipHeading>{dowDate(active.date)}</TooltipHeading>
            {ff && ff.tempF != null ? (
              <span className="tabular shrink-0 text-[10px]" style={{ color: "var(--tooltip-ink-dim)" }}>
                {Math.round(ff.tempF)}°F · {WEATHER_SOURCE[ff.weatherSource]}
              </span>
            ) : null}
          </div>
          <dl className="mt-1.5 space-y-1">
            {hasFactors && ff ? (
              <>
                {/* baseline → each effect → the day's value */}
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--tooltip-ink-dim)" }}>
                    <span aria-hidden className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: "#94A3B8" }} />
                    Baseline
                  </dt>
                  <dd className="tabular text-xs" style={{ color: "var(--tooltip-ink)" }}>
                    {format(ff.baseline)}
                  </dd>
                </div>
                {ff.rows.map((r) => {
                  const c = r.type === "event" ? (EVENT_DOT[r.kind ?? "local"] ?? EVENT_DOT.local) : FACTOR_DOT[r.type];
                  return (
                    <div key={r.id} className="flex items-baseline justify-between gap-3">
                      <dt className="flex min-w-0 items-center gap-1.5 text-[11px]" style={{ color: "var(--tooltip-ink-dim)" }}>
                        <span aria-hidden className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: c.dot }} />
                        <span className="truncate">{r.label}</span>
                      </dt>
                      <dd className="flex shrink-0 items-center gap-1.5">
                        <span className="tabular text-xs" style={{ color: "var(--tooltip-ink)" }}>{fmtSigned(r.units)}</span>
                        <span className="tabular rounded px-1 text-[10px]" style={{ background: c.badgeBg, color: c.badge }}>{fmtPct(r.pct)}</span>
                      </dd>
                    </div>
                  );
                })}
                <div className="my-0.5" style={{ borderTop: "1px solid var(--tooltip-rule)" }} />
              </>
            ) : null}
            {active.actual != null ? (
              <TooltipRow color="var(--series-1)" label={actualLabel} value={format(active.actual)} />
            ) : (
              <>
                {active.mean != null ? (
                  <TooltipRow color="var(--series-2)" label={forecastLabel} value={format(active.mean)} />
                ) : null}
                {active.lo80 != null && active.hi80 != null ? (
                  <div className="pl-[18px] text-[11px]" style={{ color: "var(--tooltip-ink-dim)" }}>
                    80% range {format(active.lo80)} – {format(active.hi80)}
                  </div>
                ) : null}
              </>
            )}
          </dl>
          {hasFactors ? (
            <p className="mt-1.5 text-[10px] leading-snug" style={{ color: "var(--tooltip-ink-dim)" }}>
              {ff?.mode === "model"
                ? "Effects the forecast applies, learned from this store’s sales"
                : "Effects estimated from this store’s sales (explanation only)"}
            </p>
          ) : null}
          {active.anomaly ? (
            <TooltipNote>
              <span className="font-medium" style={{ color: SEVERITY_VAR[active.anomaly.severity] }}>
                {active.anomaly.direction === "spike" ? "▲ Spike" : "▼ Drop"}
              </span>{" "}
              {(active.anomaly.deviation * 100).toFixed(0)}% vs expected
              {active.anomaly.cause ? ` · ${active.anomaly.cause}` : ""}
            </TooltipNote>
          ) : null}
        </ChartTooltip>
      ) : null}

      {!geom.zeroBased ? (
        <p className="text-ink-muted mt-1 text-[11px]">
          Axis starts at {format(geom.domain[0])}, not zero.
        </p>
      ) : null}
    </div>
  );
}
