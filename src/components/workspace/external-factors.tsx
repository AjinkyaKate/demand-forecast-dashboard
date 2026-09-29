"use client";

import { useState } from "react";
import { useExternalStatus, type ExternalSource } from "@/lib/hooks/use-workspace";
import { SectionHeading, StatusBadge } from "./shared";

function SourceRow({ s, onSync }: { s: ExternalSource; onSync: (source: string) => void }) {
  const connected = s.status === "ok";
  const ago = s.lastSync ? timeSince(s.lastSync) : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3">
      <div
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: connected ? "var(--status-good)" : "var(--ink-muted)" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink">{s.label}</p>
        <p className="text-xs text-ink-muted">
          {connected
            ? `${s.rows} rows · ${s.dateFrom} → ${s.dateTo} · synced ${ago}`
            : "Not synced yet"}
        </p>
      </div>
      <button
        className="shrink-0 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/10 transition-colors"
        onClick={() => onSync(s.source)}
      >
        {connected ? "Re-sync" : "Connect"}
      </button>
    </div>
  );
}

const PLANNED_SOURCES = [
  { label: "Events & Attendance", description: "Local events, concerts, sports games" },
  { label: "Holidays (US Federal + State)", description: "Public holidays with traffic weights" },
  { label: "Economic Indicators", description: "Gas prices, CPI, consumer confidence" },
];

function timeSince(isoUtc: string): string {
  const ms = Date.now() - new Date(isoUtc + "Z").getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ExternalFactorsPanel() {
  const { data, loading } = useExternalStatus();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function handleSync(source: string) {
    const endpoint = source === "open-meteo-weather" ? "/api/sync/weather" : null;
    if (!endpoint) return;

    setSyncing(source);
    setSyncMsg(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        setSyncMsg(`Synced ${json.rows} rows (${json.dateFrom} → ${json.dateTo})`);
      } else {
        setSyncMsg(`Error: ${json.error}`);
      }
    } catch (err) {
      setSyncMsg(`Failed: ${err}`);
    } finally {
      setSyncing(null);
    }
  }

  const sources = data?.sources ?? [];
  const connectedCount = sources.filter((s) => s.status === "ok").length;

  return (
    <section className="surface-card rounded-card flex flex-col gap-4 p-5 sm:p-6">
      <SectionHeading
        title="External data sources"
        description="Live API integrations that feed the forecast model and driver decomposition."
        aside={
          <StatusBadge tone={connectedCount > 0 ? "good" : "neutral"}>
            {connectedCount} of {sources.length + PLANNED_SOURCES.length} connected
          </StatusBadge>
        }
      />

      {loading ? (
        <div className="animate-pulse h-16 rounded-lg bg-white/5" />
      ) : (
        <div className="flex flex-col gap-2">
          {sources.map((s) => (
            <SourceRow key={s.source} s={s} onSync={handleSync} />
          ))}

          {PLANNED_SOURCES.map((p) => (
            <div
              key={p.label}
              className="flex items-center gap-3 rounded-lg border border-dashed border-white/10 px-4 py-3 opacity-50"
            >
              <div className="h-2 w-2 shrink-0 rounded-full bg-white/20" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink">{p.label}</p>
                <p className="text-xs text-ink-muted">{p.description}</p>
              </div>
              <span className="shrink-0 text-xs text-ink-muted">Planned</span>
            </div>
          ))}
        </div>
      )}

      {syncing && (
        <p className="text-xs text-ink-muted animate-pulse">Syncing {syncing}...</p>
      )}
      {syncMsg && (
        <p className="text-xs text-ink-muted">{syncMsg}</p>
      )}
    </section>
  );
}
