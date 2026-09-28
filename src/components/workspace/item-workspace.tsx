"use client";

import { useMemo } from "react";
import { ChartFrame, DataTable } from "@/components/chart/chart-frame";
import { BarChart } from "@/components/chart/bar-chart";
import { ForecastChart } from "@/components/chart/forecast-chart";
import { HeroFigure, StatTile } from "@/components/figures/stat-tile";
import { buildItemWorkspace, CATEGORY_OPTIONS } from "@/lib/workspace/items";
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
import { SkuPlanTable } from "./sku-plan-table";
import { AccuracyPanel, AnomalyFeed, DriverCard, SectionHeading, StatusBadge } from "./shared";
import { cn } from "@/lib/utils";

export function ItemWorkspace() {
  const { filters, update, pending } = useFilters();
  const w = useMemo(() => buildItemWorkspace(filters), [filters]);

  const units = (n: number) => thousands(Math.round(n));

  return (
    <div className="flex flex-col gap-4">
      {/* --- Chunk 1: heading + filters ---------------------------------- */}
      <div className="chunk-in chunk-in-1 flex flex-col gap-4">
        <SectionHeading
          title="Item Demand Forecasting"
          description={`${w.scopeLabel} · ${w.skuCount} SKUs · forecast horizon ${filters.horizon} days`}
          aside={
            w.counts.orderNow > 0 ? (
              <StatusBadge tone="critical">
                {w.counts.orderNow} SKU{w.counts.orderNow === 1 ? "" : "s"} need ordering today
              </StatusBadge>
            ) : (
              <StatusBadge tone="good">No SKUs below reorder point</StatusBadge>
            )
          }
        />
        <FilterBar
          scope={{
            label: "Category",
            value: filters.categoryId,
            onChange: (v) => update({ categoryId: v as Filters["categoryId"] }),
            options: CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
          }}
        />
      </div>

      {/* Everything below re-renders against the same slice. While a new
          slice computes, the previous render is held at reduced opacity —
          no skeleton, no layout jump. */}
      <div className={cn("flex flex-col gap-4", pending && "is-refetching")}>
        {/* --- Chunk 2: hero + KPIs -------------------------------------- */}
        {/* --- Chunk 2: hero + KPIs -------------------------------------- */}
        <section className="chunk-in chunk-in-2 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="surface-card rounded-card p-5 lg:col-span-1">
            <HeroFigure
              label={`Forecast demand · next ${filters.horizon} days`}
              value={compact(w.horizonTotal)}
              unit="units"
              delta={w.deltaVsPrior}
              deltaLabel={`vs prior ${filters.horizon} days`}
              range={`${compact(w.horizonLo)} – ${compact(w.horizonHi)}`}
            />
          </div>

          <StatTile
            label="Weekly demand"
            value={units(w.sparkline[w.sparkline.length - 1])}
            delta={
              w.sparkline[w.sparkline.length - 2] > 0
                ? (w.sparkline[w.sparkline.length - 1] - w.sparkline[w.sparkline.length - 2]) /
                  w.sparkline[w.sparkline.length - 2]
                : null
            }
            deltaLabel="vs prior week"
            trend={w.sparkline}
            trendAccentFrom={w.sparkline.length - 4}
            footnote="Units sold, last 12 completed weeks"
          />

          <StatTile
            label="Forecast accuracy"
            value={percent(1 - w.accuracy.wape, 1)}
            caption={`${w.accuracy.points} backtested days`}
            captionRight={`bias ${signedPercent(w.accuracy.bias, 1)}`}
          />

          <StatTile
            label="Needs ordering today"
            value={String(w.counts.orderNow)}
            caption={`Of ${w.skuCount} SKUs · ${currency(w.orderValue)} suggested`}
            captionRight={`${w.counts.orderNow}/${w.skuCount}`}
          />
        </section>

        {/* --- Chunk 3: the headline chart -------------------------------- */}
        <div className="chunk-in chunk-in-3">
          <ChartFrame
            title={`Demand — actual vs forecast · ${w.scopeLabel}`}
            subtitle="Daily units, with the 80% and 95% prediction interval."
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
                caption="Daily actual and forecast units with prediction intervals"
                columns={[
                  { key: "d", header: "Date", render: (r) => dowDate(r.date) },
                  {
                    key: "a", header: "Actual", numeric: true,
                    render: (r) => (r.actual == null ? "—" : units(r.actual)),
                  },
                  {
                    key: "f", header: "Forecast", numeric: true,
                    render: (r) => (r.mean == null ? "—" : units(r.mean)),
                  },
                  {
                    key: "b", header: "80% interval", numeric: true,
                    render: (r) =>
                      r.lo80 == null ? "—" : `${units(r.lo80)} – ${units(r.hi80!)}`,
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
            caption={
              <>
                The forecast is a median, not a mean — the better number to
                stock against for right-skewed demand. Anomaly markers flag days
                more than 3 robust standard deviations from expectation. Hover
                or focus the chart and use ← → to read any day.
              </>
            }
          >
            <ForecastChart
              rows={w.chartRows}
              format={(n) => compact(n)}
              unit="units"
              height={320}
            />
          </ChartFrame>
        </div>

        {/* --- Chunk 4: drivers, accuracy, category mix -------------------- */}
        <div className="chunk-in chunk-in-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <DriverCard drivers={w.drivers} horizon={filters.horizon} unitLabel="units" />
          </div>
          <AccuracyPanel accuracy={w.accuracy} />

          <div className="xl:col-span-2">
            <ChartFrame
              title="Forecast by category"
              subtitle={`Next ${filters.horizon} days vs the prior ${filters.horizon}.`}
              table={
                <DataTable
                  rows={w.categories}
                  rowKey={(r) => r.id}
                  caption="Forecast units by category"
                  columns={[
                    { key: "c", header: "Category", render: (r) => r.label },
                    { key: "f", header: "Forecast", numeric: true, render: (r) => units(r.horizonUnits) },
                    { key: "p", header: "Prior period", numeric: true, render: (r) => units(r.priorUnits) },
                    { key: "d", header: "Change", numeric: true, render: (r) => signedPercent(r.delta, 1) },
                    { key: "r", header: "Retail value", numeric: true, render: (r) => currency(r.revenue) },
                  ]}
                />
              }
              caption="Every bar wears the same hue — these categories have no natural order, and bar length already carries the magnitude."
            >
              <BarChart
                data={w.categories.map((c) => ({
                  id: c.id,
                  label: c.label,
                  value: c.horizonUnits,
                  delta: c.delta,
                  detail: `${units(c.horizonUnits)} units · ${currency(c.revenue)} at retail`,
                }))}
                format={(n) => compact(n)}
                highlightId={filters.categoryId === "all" ? undefined : filters.categoryId}
              />
            </ChartFrame>
          </div>

          <AnomalyFeed incidents={w.incidents} unit="units" />
        </div>

        {/* --- Chunk 5: the decision table -------------------------------- */}
        <section className="chunk-in chunk-in-5 surface-card rounded-card flex flex-col gap-5 p-5 sm:p-6">
          <SectionHeading
            title="Replenishment plan"
            description="Order-up-to levels at a 90% service level. Any column header sorts."
            aside={
              // "Below order-up-to", not "needs an order": under this policy a
              // SKU can sit above its reorder point (so, Healthy) and still be
              // below the target level, which is the normal case.
              <p className="text-ink-muted text-xs">
                {w.plan.filter((p) => p.suggestedCases > 0).length} of {w.plan.length} SKUs
                below their order-up-to level
              </p>
            }
          />
          <SkuPlanTable rows={w.plan} horizon={filters.horizon} />
        </section>
      </div>
    </div>
  );
}
