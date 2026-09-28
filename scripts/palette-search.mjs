/**
 * Snap-to-passing palette search (dataviz skill § Snap-to-passing / Themes).
 *
 * Goal: an OpsLoop-flavoured categorical palette — warm, saturated, indigo and
 * orange leading — that still clears every hard gate the skill defines, in BOTH
 * light and dark mode, against THIS project's surfaces.
 *
 * Method, exactly as the skill prescribes:
 *   1. For each hue family, take a real ramp and keep only the steps that sit
 *      inside the mode's lightness band and clear the chroma floor.
 *   2. Enumerate orderings of the families.
 *   3. For each ordering, choose one step per slot to maximise the minimum
 *      adjacent CVD separation (exact, via DP over the chain).
 *   4. Keep only results that clear every hard gate, then pick the best.
 *
 * Nothing here is eyeballed; the validator decides.
 */
import { validate } from "/private/tmp/claude-501/bundled-skills/2.1.235/32b0bd7d961ea3ade2eb9a1ed0f0466f/dataviz/scripts/validate_palette.js";

const LIGHT_SURFACE = "#ffffff";
const DARK_SURFACE = "#141416";

// Real ramps (Tailwind), so every candidate step is a designed colour.
const RAMPS = {
  indigo: ["#818cf8", "#6366f1", "#4f46e5", "#4338ca"],
  orange: ["#fb923c", "#f97316", "#ea580c", "#c2410c"],
  emerald: ["#34d399", "#10b981", "#059669", "#047857"],
  pink: ["#f472b6", "#ec4899", "#db2777", "#be185d"],
  cyan: ["#22d3ee", "#06b6d4", "#0891b2", "#0e7490"],
  amber: ["#fbbf24", "#f59e0b", "#d97706", "#b45309"],
};
const names = Object.keys(RAMPS);

/** A status is a hard failure only when it is literally false or "fail". */
const isFail = (st) => st === false || String(st).toLowerCase() === "fail";
const hard = (r) => r.report.every(([, st]) => !isFail(st));
const row = (r, re) => r.report.find(([n]) => re.test(n));
const dE = (rw) => Number(rw?.[2]?.match(/ΔE ([\d.]+)/)?.[1] ?? 0);

/** Step 1: which steps are individually legal in this mode? */
function legalSteps(mode, surface) {
  const out = {};
  for (const n of names) {
    out[n] = RAMPS[n].filter((hex) => {
      const r = validate([hex], { mode, surface });
      // A lone colour can only fail band / chroma / contrast here.
      return !isFail(row(r, /Lightness/)[1]) && !isFail(row(r, /Chroma/)[1]);
    });
  }
  return out;
}

/** Pairwise adjacent CVD separation, memoised. */
function pairScorer(mode, surface) {
  const cache = new Map();
  return (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (cache.has(k)) return cache.get(k);
    const r = validate([a, b], { mode, surface });
    const cvdRow = row(r, /CVD/i);
    // A FAIL on the normal-vision floor is disqualifying for the pair.
    const normOk = !isFail(row(r, /Normal-vision/i)[1]);
    const v = normOk ? dE(cvdRow) : -1;
    cache.set(k, v);
    return v;
  };
}

/** Step 3: best min-adjacent score for one ordering, by DP over the chain. */
function bestChain(order, steps, score) {
  let layer = (steps[order[0]] ?? []).map((hex) => ({ hex, path: [hex], min: Infinity }));
  if (layer.length === 0) return null;
  for (let i = 1; i < order.length; i++) {
    const options = steps[order[i]] ?? [];
    if (options.length === 0) return null;
    const next = [];
    for (const opt of options) {
      let best = null;
      for (const prev of layer) {
        const s = score(prev.hex, opt);
        if (s < 0) continue;
        const m = Math.min(prev.min, s);
        if (!best || m > best.min) best = { hex: opt, path: [...prev.path, opt], min: m };
      }
      if (best) next.push(best);
    }
    if (next.length === 0) return null;
    layer = next;
  }
  return layer.reduce((a, b) => (b.min > a.min ? b : a));
}

function* permutations(arr) {
  if (arr.length <= 1) { yield arr; return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

const lightSteps = legalSteps("light", LIGHT_SURFACE);
const darkSteps = legalSteps("dark", DARK_SURFACE);
console.log("legal steps per family");
for (const n of names) {
  console.log(`  ${n.padEnd(8)} light ${(lightSteps[n].join(" ") || "—").padEnd(34)} dark ${darkSteps[n].join(" ") || "—"}`);
}

const scoreL = pairScorer("light", LIGHT_SURFACE);
const scoreD = pairScorer("dark", DARK_SURFACE);

const results = [];
for (const order of permutations(names)) {
  const l = bestChain(order, lightSteps, scoreL);
  if (!l) continue;
  const d = bestChain(order, darkSteps, scoreD);
  if (!d) continue;

  const rl = validate(l.path, { mode: "light", surface: LIGHT_SURFACE });
  const rd = validate(d.path, { mode: "dark", surface: DARK_SURFACE });
  if (!hard(rl) || !hard(rd)) continue;

  results.push({
    order,
    light: l.path,
    dark: d.path,
    score: Math.min(l.min, d.min),
    norm: Math.min(dE(row(rl, /Normal-vision/i)), dE(row(rd, /Normal-vision/i))),
    rl, rd,
  });
}

results.sort((a, b) => b.score - a.score || b.norm - a.norm);
console.log(`\n${results.length} orderings clear every hard gate in both modes`);

const show = (r, tag) => {
  console.log(`\n${tag}  min adjacent CVD ΔE ${r.score.toFixed(1)} · normal-vision ${r.norm.toFixed(1)}`);
  console.log(`  order ${r.order.join(" → ")}`);
  console.log(`  light ${r.light.join(",")}`);
  console.log(`  dark  ${r.dark.join(",")}`);
  for (const [n, st, d] of r.rl.report) console.log(`    L  ${String(st).toUpperCase().padEnd(6)} ${n.padEnd(21)} ${d}`);
  for (const [n, st, d] of r.rd.report) console.log(`    D  ${String(st).toUpperCase().padEnd(6)} ${n.padEnd(21)} ${d}`);
};

if (results[0]) show(results[0], "BEST OVERALL");

// The opening pair carries the most weight: slot 1 is "Actual" / the primary
// accent, slot 2 is "Forecast". Prefer an indigo-led opening to match the
// reference's character, but only among orderings that already pass.
const indigoLed = results.find((r) => r.order[0] === "indigo");
if (indigoLed && indigoLed !== results[0]) show(indigoLed, "BEST INDIGO-LED");
