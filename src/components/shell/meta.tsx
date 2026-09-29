"use client";

/**
 * Reference data for the page chrome — stores, categories, fuel grades and
 * the data's as-of date — loaded once from /api/meta. Nothing in the client
 * carries its own copy of these lists.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Meta = {
  asOf: string;
  stores: { id: string; name: string; historyStart: string }[];
  categories: { id: string; name: string; short: string }[];
  grades: { id: string; name: string; short: string }[];
};

type MetaState = { meta: Meta | null; error: string | null };

const MetaContext = createContext<MetaState>({ meta: null, error: null });

export function MetaProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MetaState>({ meta: null, error: null });

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
  }, []);

  return <MetaContext value={state}>{children}</MetaContext>;
}

export function useMeta(): MetaState {
  return useContext(MetaContext);
}
