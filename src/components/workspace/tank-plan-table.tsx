"use client";

/**
 * Fuel delivery plan.
 *
 * Inside the store the constraint is shelf space and shelf life; on the
 * forecourt it is tank capacity. So the decision here is a drop schedule:
 * when the tank reaches its reserve, the date to deliver by, and how many
 * gallons will actually fit on that date.
 */

import type { TankPlanRow, TankStatus } from "@/lib/workspace/fuel";
import { currency, dowDate, thousands } from "@/lib/format";
import { Meter } from "@/components/figures/stat-tile";
import { StatusBadge, type StatusTone } from "./shared";

const STATUS_META: Record<TankStatus, { tone: StatusTone; label: string }> = {
  "order-now": { tone: "critical", label: "Order now" },
  schedule: { tone: "warning", label: "Schedule drop" },
  healthy: { tone: "good", label: "Healthy" },
};

export function TankPlanTable({
  rows,
  horizon,
}: {
  rows: TankPlanRow[];
  horizon: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">
          Fuel delivery plan by grade: tank level, forecast daily draw, days
          until reserve, recommended delivery date and load size.
        </caption>
        <thead>
          <tr className="bg-surface-2">
            <th scope="col" className="text-ink-secondary border-b px-3 py-2 text-left font-medium">
              Grade
            </th>
            <th scope="col" className="text-ink-secondary border-b px-3 py-2 text-left font-medium whitespace-nowrap">
              Tank level
            </th>
            <th scope="col" data-numeric className="text-ink-secondary border-b px-3 py-2 text-right font-medium whitespace-nowrap">
              Daily draw
            </th>
            <th scope="col" data-numeric className="text-ink-secondary border-b px-3 py-2 text-right font-medium whitespace-nowrap">
              Days to reserve
            </th>
            <th scope="col" className="text-ink-secondary border-b px-3 py-2 text-left font-medium whitespace-nowrap">
              Deliver by
            </th>
            <th scope="col" data-numeric className="text-ink-secondary border-b px-3 py-2 text-right font-medium whitespace-nowrap">
              Load
            </th>
            <th scope="col" data-numeric className="text-ink-secondary border-b px-3 py-2 text-right font-medium whitespace-nowrap">
              Margin {horizon}d
            </th>
            <th scope="col" className="text-ink-secondary border-b px-3 py-2 text-left font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <tr key={r.grade.id} className="row-hover border-b last:border-0">
                <td className="px-3 py-2.5">
                  <p className="text-ink-primary font-medium">{r.grade.short}</p>
                  <p className="text-ink-muted text-[11px]">
                    {r.grade.octane === "—" ? "Diesel" : `${r.grade.octane} octane`} ·{" "}
                    {thousands(r.capacity)} gal tank · {currency(r.currentPrice, 2)}/gal
                  </p>
                </td>
                <td className="w-40 min-w-36 px-3 py-2.5">
                  <Meter
                    value={r.currentGallons}
                    max={r.capacity}
                    valueLabel={`${thousands(r.currentGallons)} gal · ${(r.fillPct * 100).toFixed(0)}%`}
                    severity={
                      r.status === "order-now"
                        ? "critical"
                        : r.status === "schedule"
                          ? "warning"
                          : "ok"
                    }
                  />
                </td>
                <td data-numeric className="text-ink-primary px-3 py-2.5 text-right">
                  {thousands(Math.round(r.avgDailyDraw))}
                  <span className="text-ink-muted"> gal</span>
                </td>
                <td data-numeric className="px-3 py-2.5 text-right">
                  <span
                    className="font-semibold"
                    style={{
                      color:
                        r.status === "order-now"
                          ? "var(--status-critical)"
                          : r.status === "schedule"
                            ? "var(--status-warning)"
                            : "var(--ink-primary)",
                    }}
                  >
                    {r.daysToReserve >= 30 ? "30+" : r.daysToReserve.toFixed(1)}
                  </span>
                </td>
                <td className="text-ink-primary px-3 py-2.5 whitespace-nowrap">
                  {r.deliverBy ? dowDate(r.deliverBy) : <span className="text-ink-muted">Not needed</span>}
                </td>
                <td data-numeric className="px-3 py-2.5 text-right">
                  {r.recommendedLoad > 0 ? (
                    <>
                      <span className="text-ink-primary font-semibold">
                        {thousands(r.recommendedLoad)}
                      </span>
                      <span className="text-ink-muted"> gal</span>
                    </>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td data-numeric className="text-ink-primary px-3 py-2.5 text-right">
                  {currency(r.marginDollars)}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
