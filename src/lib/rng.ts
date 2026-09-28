/**
 * Deterministic PRNG.
 *
 * Every number in this dashboard derives from a fixed seed, so the server
 * render and the client hydration produce byte-identical output and the
 * numbers are reproducible across reloads and machines.
 */

/** mulberry32 — small, fast, good enough distribution for synthetic demand. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string -> 32-bit seed, so an id always maps to the same series. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Box–Muller standard normal. */
export function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Knuth Poisson sampler — demand for slow-moving SKUs is count data. */
export function poisson(rand: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 60) {
    // Normal approximation keeps the loop bounded for fast movers.
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gaussian(rand)));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}
