"use client";

import { useEffect, useState } from "react";
import type { Filters } from "../workspace/types";
import type { ItemWorkspace } from "../workspace/items";
import type { FuelWorkspace } from "../workspace/fuel";
import type { LabWorkspace } from "../workspace/lab";

type WorkspaceState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

function buildUrl(base: string, filters: Filters, extra?: Record<string, string>) {
  // No store yet means the store list is still loading; wait rather than
  // fetch a default and then fetch again.
  if (!filters.storeId) return null;
  const params = new URLSearchParams({
    storeId: filters.storeId,
    horizon: String(filters.horizon),
    ...extra,
  });
  return `${base}?${params}`;
}

/**
 * Fetch JSON for `url`. Loading is derived from which URL the held result
 * belongs to, so a new URL reads as loading without a synchronous setState in
 * the effect — and the previous data stays on screen until the new one lands.
 */
function useWorkspaceFetch<T>(url: string | null): WorkspaceState<T> {
  const [result, setResult] = useState<{ url: string; data: T | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    fetch(url, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<T>;
      })
      .then((data) => setResult({ url, data, error: null }))
      .catch((err: Error) => {
        if (!ac.signal.aborted) setResult({ url, data: null, error: err.message });
      });
    return () => ac.abort();
  }, [url]);

  const current = result?.url === url;
  return {
    data: result?.data ?? null,
    loading: !current,
    error: current ? (result?.error ?? null) : null,
  };
}

export function useItemWorkspace(filters: Filters) {
  const url = buildUrl("/api/workspace/items", filters, {
    categoryId: filters.categoryId,
  });
  return useWorkspaceFetch<ItemWorkspace>(url);
}

export function useFuelWorkspace(filters: Filters) {
  const url = buildUrl("/api/workspace/fuel", filters, {
    gradeId: filters.gradeId,
  });
  return useWorkspaceFetch<FuelWorkspace>(url);
}

export function useForecasts(storeId: string) {
  const url = `/api/forecasts?storeId=${storeId}`;
  return useWorkspaceFetch<
    {
      date: string;
      forecast: number;
      q10: number | null;
      q20: number | null;
      q30: number | null;
      q40: number | null;
      q50: number | null;
      q60: number | null;
      q70: number | null;
      q80: number | null;
      q90: number | null;
    }[]
  >(url);
}

export function useForecastAccuracy() {
  return useWorkspaceFetch<
    {
      storeId: string;
      storeName: string;
      horizonDays: number;
      mae: number;
      mape: number;
      wape: number;
      rmse: number;
    }[]
  >("/api/forecasts/accuracy");
}

export type ExternalSource = {
  source: string;
  label: string;
  description: string;
  endpoint: string;
  configured: boolean;
  lastSync: string | null;
  rows: number;
  dateFrom: string | null;
  dateTo: string | null;
  /** "ok" | "error" | "never" | "needs-key". */
  status: string;
  error: string | null;
};

/** Sync status of every external source. Bump `nonce` to re-read it. */
export function useExternalStatus(nonce = 0) {
  return useWorkspaceFetch<{ sources: ExternalSource[] }>(`/api/sync/status?n=${nonce}`);
}

export function useModelLab(storeId: string, stream: string) {
  const url = storeId ? `/api/model-lab?${new URLSearchParams({ storeId, stream })}` : null;
  return useWorkspaceFetch<LabWorkspace>(url);
}
