"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Measure a container so charts can render text at real pixel sizes.
 *
 * A viewBox + preserveAspectRatio="none" would be simpler but distorts every
 * label and stroke, so charts are laid out at the measured width instead.
 */
export function useChartWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? fallback;
      setWidth(Math.max(240, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);

  return [ref, width] as const;
}
