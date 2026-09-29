"use client";

import { ChartFrame, DataTable } from "@/components/chart/chart-frame";
import { ForecastChart } from "@/components/chart/forecast-chart";
import { MultiLine, gutterFor } from "@/components/chart/multi-line";
import { SmallMultiples } from "@/components/chart/small-multiples";
import { StackedBar } from "@/components/chart/stacked-bar";
import { HeroFigure, StatTile } from "@/components/figures/stat-tile";
import { useMeta } from "@/components/shell/meta";
import { useFuelWorkspace } from "@/lib/hooks/use-workspace";
import type { Filters } from "@/lib/workspace/types";
import {
  compact,
  currency,
  dowDate,
  percent,
  signedPercent,
  thousands,
} from "@/lib/format";
import { FilterBar, useFilters } from "./filters";
import { TankPlanTable } from "./tank-plan-table";
import { AccuracyPanel, AnomalyFeed, DriverCard, SectionHeading, StatusBadge } from "./shared";
import { cn } from "@/lib/utils";

export function FuelWorkspace() {
  const { filters, update, pending } = useFilters();
  const { meta } = useMeta();
  const gradeOptions = [
    { value: "all", label: "All grades" },
    ...(meta?.grades ?? []).map((g) => ({ value: g.id, label: g.name })),
  ];
  const { data: w, loading, error } = useFuelWorkspace(filters);

  const gal = (n: number) => thousands(Math.round(n));

  if (error) {
    return <div className="surface-card rounded-card p-6 text-center text-red-500">Failed to load workspace: {error}</div>;
  }
  if (loading || !w) {
    return (
      <div className="flex flex-col gap-4 animate-pulse">
        <div className="surface-card rounded-card h-12" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="surface-card rounded-card h-28" />)}
        </div>
        <div className="surface-card rounded-card h-80" />
      </div>
    );
  }

  const urgent = w.plan.filter((p) => p.status === "order-now");

  return (
    <div className="flex flex-col gap-4">
      <div className="chunk-in chunk-in-1 flex flex-col gap-4">
        <SectionHeading
          title="Fuel Demand Forecasting"
          description={`${w.scopeLabel} · forecast horizon ${filters.horizon} days`}
          aside={
            urgent.length > 0 ? (
              <StatusBadge tone="critical">
                {urgent.map((p) => p.grade.short).join(", ")} at reserve within 2 days
              </StatusBadge>
            ) : w.counts.schedule > 0 ? (
              <StatusBadge tone="warning">
                {w.counts.schedule} grade{w.counts.schedule === 1 ? "" : "s"} need a drop this week
              </StatusBadge>
            ) : (
              <StatusBadge tone="good">All tanks above reserve</StatusBadge>
            )
          }
        />
        <FilterBar
          scope={{
            label: "Grade",
            value: filters.gradeId,
            onChange: (v) => update({ gradeId: v as Filters["gradeId"] }),
            options: gradeOptions,
          }}
        />
      </div>

      <div className={cn("flex flex-col gap-4", pending && "is-refetching")}>
        <section className="chunk-in chunk-in-2 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="surface-card rounded-card p-5">
            <HeroFigure
              label={`Forecast volume · next ${filters.horizon} days`}
              value={compact(w.horizonTotal)}
              unit="gallons"
              delta={w.deltaVsPrior}
              deltaLabel={`vs prior ${filters.horizon} days`}
              range={`${compact(w.horizonLo)} – ${compact(w.horizonHi)}`}
            />
          </div>

          <StatTile
            label="Weekly volume"
            value={compact(w.sparkline[w.sparkline.length - 1])}
            delta={
              w.sparkline[w.sparkline.length - 2] > 0
                ? (w.sparkline[w.sparkline.length - 1] - w.sparkline[w.sparkline.length - 2]) /
                  w.sparkline[w.sparkline.length - 2]
                : null
            }
            deltaLabel="vs prior week"
            trend={w.sparkline}
            trendAccentFrom={w.sparkline.length - 4}
            footnote="Gallons pumped, last 12 completed weeks"
          />

          <StatTile
            label="Forecast accuracy"
            value={w.accuracy.points > 0 ? percent(1 - w.accuracy.wape, 1) : "—"}
            caption={
              w.accuracy.points > 0
                ? `${w.accuracy.points} backtested days`
                : "Not enough history to score yet"
            }
            captionRight={w.accuracy.points > 0 ? `bias ${signedPercent(w.accuracy.bias, 1)}` : undefined}
          />

          {/* Counted as "needs a drop" rather than "healthy": when every tank
              is scheduled, the healthy framing shows a 0 against an empty
              meter, which reads as a broken tile instead of the urgent state
              it actually is. Same actionable shape as the item module. */}
          <StatTile
            label="Tanks needing a drop"
            value={String(w.counts.orderNow + w.counts.schedule)}
            caption={`Of ${w.plan.length} grades · ${currency(w.marginTotal)} margin`}
            captionRight={`${w.counts.orderNow + w.counts.schedule}/${w.plan.length}`}
          />
        </section>

        <div className="chunk-in chunk-in-3">
          <ChartFrame
            title={`Fuel volume — actual vs forecast · ${w.scopeLabel}`}
            subtitle="Daily gallons, with the 80% and 95% prediction interval."
            legend={[
              { label: "Actual", color: "var(--series-1)", shape: "line" },
              { label: "Forecast", color: "var(--series-2)", shape: "line" },
              { label: "80% / 95% interval", color: "var(--series-2)", shape: "band" },
              { label: "Anomaly", color: "var(--status-critical)", shape: "ring" },
            ]}
            table={
              <DataTable
                rows={w.chartRows}
                rowKey={(r) => r.date}
                caption="Daily actual and forecast gallons with prediction intervals"
                columns={[
                  { key: "d", header: "Date", render: (r) => dowDate(r.date) },
                  { key: "a", header: "Actual", numeric: true, render: (r) => (r.actual == null ? "—" : gal(r.actual)) },
                  { key: "f", header: "Forecast", numeric: true, render: (r) => (r.mean == null ? "—" : gal(r.mean)) },
                  {
                    key: "b", header: "80% interval", numeric: true,
                    render: (r) => (r.lo80 == null ? "—" : `${gal(r.lo80)} – ${gal(r.hi80!)}`),
                  },
                  {
                    key: "an", header: "Anomaly",
                    render: (r) =>
                      r.anomaly
                        ? `${r.anomaly.direction === "spike" ? "Spike" : "Drop"} ${signedPercent(r.anomaly.deviation, 0)}${r.anomaly.cause ? ` · ${r.anomaly.cause}` : ""}`
                        : "—",
                  },
                ]}
              />
            }
          >
            <ForecastChart
              rows={w.chartRows}
              format={(n) => compact(n)}
              unit="gallons"
              height={320}
            />
          </ChartFrame>
        </div>

        {/* Volume by grade and street price are two charts, not one chart with
            two y-scales. Their units and magnitudes have nothing in common —
            sharing a plot would invent a correlation. */}
        <div className="chunk-in chunk-in-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <ChartFrame
            title="Volume by grade"
            subtitle="One panel per grade, each on its own scale."
            legend={w.gradeSeries.map((s) => ({
              label: s.label,
              color: s.color,
              shape: "line" as const,
            }))}
            table={
              <DataTable
                rows={w.gradeDates.map((d, i) => ({ date: d, i }))}
                rowKey={(r) => r.date}
                caption="Daily gallons by grade"
                columns={[
                  { key: "d", header: "Date", render: (r) => dowDate(r.date) },
                  ...w.gradeSeries.map((s) => ({
                    key: s.id,
                    header: s.label,
                    numeric: true,
                    render: (r: { i: number }) => {
                      const v = s.values[r.i];
                      return v == null ? "—" : gal(v);
                    },
                  })),
                ]}
              />
            }
            caption="Each panel has its own scale, so heights are not comparable — each states its peak. Regular outsells Midgrade about ten to one; on a shared axis the smaller grades flatten onto the baseline. Faceted, the shapes read: diesel peaks midweek on freight, the unleaded grades Friday to Sunday."
          >
            <SmallMultiples
              dates={w.gradeDates}
              series={w.gradeSeries}
              format={(n) => compact(n)}
            />
          </ChartFrame>

          <ChartFrame
            title="Street price per gallon"
            subtitle="Its own axis — never shared with volume."
            legend={w.priceSeries.map((s) => ({
              label: s.label,
              color: s.color,
              shape: "line" as const,
            }))}
            table={
              <DataTable
                rows={w.priceDates.map((d, i) => ({ date: d, i }))}
                rowKey={(r) => r.date}
                caption="Street price per gallon by grade"
                columns={[
                  { key: "d", header: "Date", render: (r) => dowDate(r.date) },
                  ...w.priceSeries.map((s) => ({
                    key: s.id,
                    header: s.label,
                    numeric: true,
                    render: (r: { i: number }) => {
                      const v = s.values[r.i];
                      return v == null ? "—" : currency(v, 3);
                    },
                  })),
                ]}
              />
            }
            caption="Price enters the forecast as an elasticity term — see the price driver in the panel below."
          >
            <MultiLine
              dates={w.priceDates}
              series={w.priceSeries}
              format={(n) => currency(n, 2)}
              height={280}
              labelGutter={gutterFor(w.priceSeries.map((s) => s.label))}
            />
          </ChartFrame>
        </div>

        <div className="chunk-in chunk-in-5 grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <DriverCard drivers={w.drivers} horizon={filters.horizon} unitLabel="gal" />
          </div>
          <AccuracyPanel accuracy={w.accuracy} model={w.model} />

          <div className="xl:col-span-2">
            <AnomalyFeed incidents={w.incidents} unit="gallons" />
          </div>

          <ChartFrame
            title="Forecast grade mix"
            subtitle={`Share of gallons, next ${filters.horizon} days.`}
            legend={w.mix.map((m) => ({ label: m.label, color: m.color, shape: "rect" as const }))}
            table={
              <DataTable
                rows={w.mix}
                rowKey={(r) => r.id}
                caption="Forecast gallons and share by grade"
                columns={[
                  { key: "g", header: "Grade", render: (r) => r.label },
                  { key: "v", header: "Gallons", numeric: true, render: (r) => gal(r.value) },
                  {
                    key: "s", header: "Share", numeric: true,
                    render: (r) =>
                      percent(r.value / w.mix.reduce((a, m) => a + m.value, 0), 1),
                  },
                ]}
              />
            }
            caption="Segments are separated by a 2px gap in the surface colour rather than an outline."
          >
            <StackedBar segments={w.mix} format={(n) => `${gal(n)} gal`} />
          </ChartFrame>
        </div>

        <section className="chunk-in chunk-in-5 surface-card rounded-card flex flex-col gap-5 p-5 sm:p-6">
          <SectionHeading
            title="Delivery plan"
            description="When each tank reaches reserve, and the load that will fit."
            aside={
              <p className="text-ink-muted text-xs">
                500-gal compartments · ordered 2 days early
              </p>
            }
          />
          <TankPlanTable rows={w.plan} horizon={filters.horizon} />
        </section>
      </div>
    </div>
  );
}
