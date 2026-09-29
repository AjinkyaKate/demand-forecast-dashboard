"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Filters } from "../workspace/types";
import type { ItemWorkspace } from "../workspace/items";
import type { FuelWorkspace } from "../workspace/fuel";

type WorkspaceState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

function buildUrl(base: string, filters: Filters, extra?: Record<string, string>) {
  const params = new URLSearchParams({
    storeId: filters.storeId,
    horizon: String(filters.horizon),
    ...extra,
  });
  return `${base}?${params}`;
}

function useWorkspaceFetch<T>(url: string): WorkspaceState<T> {
  const [state, setState] = useState<WorkspaceState<T>>({
    data: null,
    loading: true,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetch(url, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data: T) => {
        if (!ac.signal.aborted) setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        if (!ac.signal.aborted) {
          setState({ data: null, loading: false, error: err.message });
        }
      });

    return () => ac.abort();
  }, [url]);

  return state;
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
  lastSync: string | null;
  rows: number;
  dateFrom: string | null;
  dateTo: string | null;
  status: string;
};

export function useExternalStatus() {
  return useWorkspaceFetch<{ sources: ExternalSource[] }>("/api/sync/status");
}
