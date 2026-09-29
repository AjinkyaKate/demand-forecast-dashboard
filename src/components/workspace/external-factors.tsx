"use client";

/**
 * External data sources: what feeds the forecast, when it last synced, and a
 * way to pull fresh data. Rows come from /api/sync/status — the panel carries
 * no list of its own.
 */

import { useState } from "react";
import { useExternalStatus, type ExternalSource } from "@/lib/hooks/use-workspace";
import { SectionHeading, StatusBadge, type StatusTone } from "./shared";
import { cn } from "@/lib/utils";

function timeSince(isoUtc: string): string {
  const ms = Date.now() - new Date(isoUtc.replace(" ", "T") + "Z").getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATE: Record<string, { tone: StatusTone; label: string }> = {
  ok: { tone: "good", label: "Connected" },
  error: { tone: "critical", label: "Sync failed" },
  never: { tone: "neutral", label: "Not synced" },
  "needs-key": { tone: "warning", label: "Needs API key" },
};

function SourceRow({
  s,
  busy,
  onSync,
}: {
  s: ExternalSource;
  busy: boolean;
  onSync: (s: ExternalSource) => void;
}) {
  const st = STATE[s.status] ?? STATE.never;
  const detail =
    s.status === "needs-key"
      ? "Add PREDICTHQ_API_TOKEN to .env.local, restart the server, then sync."
      : s.status === "ok"
        ? `${s.rows.toLocaleString("en-US")} rows · ${s.dateFrom} → ${s.dateTo} · synced ${s.lastSync ? timeSince(s.lastSync) : ""}`
        : s.status === "error"
          ? (s.error ?? "Last sync failed")
          : s.description;

  return (
    <li className="border-hairline flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-ink-primary flex flex-wrap items-center gap-2 text-[13px] font-medium">
          {s.label}
          <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        </p>
        <p className="text-ink-muted mt-0.5 text-xs">{detail}</p>
      </div>
      <button
        type="button"
        disabled={!s.configured || busy}
        onClick={() => onSync(s)}
        className={cn(
          "press rounded-control bg-surface-2 text-ink-primary shrink-0 px-3 py-1.5 text-xs font-medium",
          "focus-visible:ring-ring transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {busy ? "Syncing…" : s.status === "ok" ? "Re-sync" : "Sync"}
      </button>
    </li>
  );
}

export function ExternalFactorsPanel() {
  const [nonce, setNonce] = useState(0);
  const { data, loading } = useExternalStatus(nonce);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync(s: ExternalSource) {
    setSyncing(s.source);
    setMessage(null);
    try {
      const res = await fetch(s.endpoint, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; rows?: number; message?: string };
      setMessage(
        json.ok
          ? `${s.label}: synced ${json.rows?.toLocaleString("en-US")} rows. Forecasts refit on the next load.`
          : `${s.label}: ${json.message ?? "sync failed"}`,
      );
    } catch (err) {
      setMessage(`${s.label}: ${String(err)}`);
    } finally {
      setSyncing(null);
      setNonce((n) => n + 1);
    }
  }

  const sources = data?.sources ?? [];
  const connected = sources.filter((s) => s.status === "ok").length;

  return (
    <section className="surface-card rounded-card flex flex-col gap-3 p-5 sm:p-6">
      <SectionHeading
        title="External data sources"
        description="APIs whose data the forecast learns from and applies to the days ahead."
        aside={
          sources.length ? (
            <StatusBadge tone={connected === sources.length ? "good" : "warning"}>
              {connected} of {sources.length} connected
            </StatusBadge>
          ) : null
        }
      />
      {loading && !data ? (
        <div className="bg-surface-2 h-16 animate-pulse rounded-lg" />
      ) : (
        <ul>
          {sources.map((s) => (
            <SourceRow key={s.source} s={s} busy={syncing === s.source} onSync={handleSync} />
          ))}
        </ul>
      )}
      {message ? (
        <p role="status" className="text-ink-secondary text-xs">
          {message}
        </p>
      ) : null}
    </section>
  );
}
