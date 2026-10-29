"use client";

/**
 * Reference data for the page chrome — stores, categories, fuel grades and
 * the data's as-of date — loaded once from /api/meta. Nothing in the client
 * carries its own copy of these lists.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Meta = {
  asOf: string;
  stores: { id: string; name: string; historyStart: string }[];
  categories: { id: string; name: string; short: string }[];
  grades: { id: string; name: string; short: string }[];
};

type MetaState = {
  meta: Meta | null;
  error: string | null;
  /** Re-read the reference data, e.g. after the user imports sales. */
  refresh: () => void;
};

const MetaContext = createContext<MetaState>({ meta: null, error: null, refresh: () => {} });

export function MetaProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<MetaState, "refresh">>({ meta: null, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/meta", { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<Meta>;
      })
      .then((meta) => setState({ meta, error: null }))
      .catch((err: Error) => {
        if (!ac.signal.aborted) setState({ meta: null, error: err.message });
      });
    return () => ac.abort();
  }, [nonce]);

  const value = useMemo<MetaState>(
    () => ({ ...state, refresh: () => setNonce((n) => n + 1) }),
    [state],
  );

  return <MetaContext value={value}>{children}</MetaContext>;
}

export function useMeta(): MetaState {
  return useContext(MetaContext);
}
