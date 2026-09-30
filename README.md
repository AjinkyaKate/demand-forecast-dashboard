# Demand Forecast — C-store & Retail

Forecasting workspaces for convenience-store and retail operators:

- **Item Forecasting** (`/items`) — demand for products and SKUs sold in the store
- **Fuel Forecasting** (`/fuel`) — demand by fuel grade
- **Model Lab** (`/lab`) — what each input (promotions, holidays, weather, events) adds to accuracy

Each workspace answers the same four questions in the same order — what happened,
what's coming, why, and what to do about it — and ends in a table an operator can
act on today.

## Data

Everything the app shows is read from SQLite (`data/forecast.db`, not committed).

```bash
npm run seed       # fresh database: demo stores, SKUs, sales, promo plan, stock
npm run migrate    # upgrade an existing database in place (keeps its data)
npm run sync       # pull every source now (or one: npm run sync -- alerts)
```

| Source | What it adds | Key | Auto-sync |
|---|---|---|---|
| Open-Meteo | Weather at each store's coordinates: history, 16-day forecast, 10-year normals | none | every 3 hours |
| Nager.Date | US national and state public holidays | none | weekly |
| National Weather Service | Winter, heat and severe-storm warnings at each store (via the Iowa Environmental Mesonet archive) | none | every 30 min |
| PredictHQ | Crowd events and school breaks within 10 km of each store, past and next 90 days | `PREDICTHQ_API_TOKEN` | every 12 hours |

**Syncing is automatic.** While `npm run dev` or `npm start` is running, the
server refreshes each source on the schedule above (`src/lib/sync/auto.ts`,
started from `src/instrumentation.ts`), catches up on anything overdue at
startup, and retries a failed source after 15 minutes. Forecasts refit on their
own when new data lands. "Sync now" in the data-sources panel pulls one source
immediately. Set `AUTO_SYNC=off` to disable the scheduler. On a serverless host
there is no long-running process to hold the schedule, so trigger the
`POST /api/sync/*` routes from a cron job instead.

Each series' backtest decides whether weather, weather alerts and local events
go into its forecast: an input is kept only where it lowers the error.

For PredictHQ, create an access token in the PredictHQ control center, put it in
`.env.local` (git-ignored) and restart `npm run dev` — events then sync
automatically:

```bash
PREDICTHQ_API_TOKEN=your-token
```

Sales, promotions, inventory and tank levels are demo data; store coordinates
are demo locations in central New Jersey.

## Commands

```bash
npm run dev        # http://localhost:3000
npm run build
npm run smoke      # model sanity checks (accuracy, bands, anomalies, drivers)
npm run shots      # render both routes, both themes, check for console errors
npm run interact   # hover, keyboard, table view, filters, sorting
npm run palette    # re-derive + re-validate the categorical palette
```

---

## What the numbers are

Nothing here is a faked chart line. Every figure is computed, and the model is
honest about where it is weak.

**Forecast model** — every SKU, fuel grade and store total is forecast by
whichever of two models scores better on its own rolling-origin backtest:

- *Driver model* (`src/lib/forecast/driver-forecast.ts`): a ridge regression of
  `log1p(demand)` on calendar shape, the promo plan, price, public holidays, the
  store's weather and events. Effects are learned from history and applied to the
  known future — planned promotions, the weather forecast, upcoming holidays and
  events — plus a decaying correction for level shifts the inputs don't explain.
- *Holt-Winters*, the fallback, described below.

**Holt-Winters** — exponential smoothing with a damped trend and
weekly seasonality, fitted on `log1p(y)`. Log space because C-store demand is
count data with multiplicative seasonality: a Saturday is +40% of whatever the
level is, not +40 units. It also guarantees a non-negative forecast and produces
the asymmetric prediction intervals that count data actually has.

Parameters come from a deterministic grid search on one-step SSE, so the same
series always yields the same fit and the dashboard never shifts under a user.

Two things the UI states plainly rather than glossing over:

- The forecast is a **median**, not a mean. `exp(mean of logs)` is the median;
  for right-skewed demand that is the better number to stock against, but it is
  a median.
- Prediction intervals are **not** from a closed-form variance formula. They are
  the empirical h-step errors from the rolling-origin backtest, so they reflect
  how this model actually missed on this series.

**Accuracy** — rolling-origin backtest, 8 origins × 14-day horizon. Parameters
are fitted once on the earliest training window and held fixed as the origin
walks forward, so no score uses information from its own future. Reported as
WAPE (the headline, robust to zero-demand days), MAPE (labelled as excluding
zeros, which MAPE cannot score), bias, and MASE against a seasonal-naive
baseline. Current: **MASE 0.94 items / 0.89 fuel** — it beats last-week-same-day,
but not by a landslide, and the panel says so.

**Anomalies** — robust z-scores of the model's own one-step residuals, scaled by
MAD rather than standard deviation (a plain SD is inflated by the very outliers
you are hunting). The detector is deliberately blind to the operations log; the
UI *joins* a flagged date against that log afterwards to suggest a cause. An
anomaly with no matching event is reported as a genuine "we don't know why yet",
not quietly attributed to something nearby.

**Drivers** — ridge regression of `log1p(demand)` on features an operator
actually observes: trend, annual harmonics, weekday dummies, promo calendar and
depth, holiday weight, temperature departure, and price index. Effects are
multiplicative and order-independent; the per-day units column is a bridge in a
fixed, disclosed sequence. The latent parameters used to synthesise the data are
never visible to any model.

**Replenishment** — order-up-to policy. Safety stock is derived from the model's
own interval width (`hi80 − mean` is 1.2816σ), with variances added across the
lead time via root-sum-of-squares. Flags spoilage risk when a perishable SKU's
suggested cover exceeds its shelf life.

**Fuel delivery** — walks the forecast draw down from the current tank level to
the reserve, backs off two days, and sizes the load to the headroom that will
exist on that date, quantised to 500-gallon tanker compartments.

## Data

Synthetic, seeded, and reproducible — two years of daily history for 43 SKUs and
4 fuel grades across 4 stores, built from annual seasonality, weekday shape,
trend, promotions, weather, holidays, street price elasticity, and a log of ten
dated operational events (a cooler failure, a POS outage, a lane closure, a
price war, a storm, a competitor opening).

The dataset is anchored to a fixed `AS_OF` date rather than `new Date()`, so the
server render and client hydration agree and every figure is reproducible.

To plug in real data, replace `src/lib/data/generate.ts` with something that
returns the same `ItemSeries` / `FuelSeries` shapes. Nothing downstream knows
where the numbers came from.

## Design

Three installed skills, applied throughout:

**dataviz** — the chart palette is *derived*, not picked. `npm run palette`
runs the skill's snap-to-passing procedure: real hue ramps, every ordering of
the six families enumerated, one step chosen per slot by DP to maximise the
minimum adjacent CVD separation, and only orderings clearing every hard gate in
both modes kept. 336 orderings survive; the indigo-led one is used because
slot 1 and 2 carry "Actual" and "Forecast".

| Mode | Surface | CVD ΔE | Normal-vision ΔE | Result |
| --- | --- | --- | --- | --- |
| light | `#ffffff` | 20.3 | 31.6 | all checks pass |
| dark | `#141416` | 11.0 | 21.9 | all checks pass |

(The skill's own reference instance scores 9.1 / 19.6, so this palette clears
the gates by a wider margin.) Light mode warns sub-3:1 on cyan and amber, which
obligates a relief channel — every chart ships a table-view twin. Also: one
axis, never two
(street price is its own chart, not a second y-scale on volume); categorical
hues assigned in fixed order and never reassigned by rank or filter; nominal
category bars all wear slot 1; drivers use a diverging pair with a neutral
midpoint; status colour never travels without an icon and a label.

**Visual language** — near-white plane, large-radius white cards, hairline
borders doing the separating, big light-weight numerals in the system sans
(SF Pro on Apple platforms), tick-stripe meters for ratios, pill axis labels,
dark pill tooltips, and gradient bar fills that run pale at the baseline and
saturated at the data end. Colour is reserved almost entirely for data — the
chrome is neutral.

**emil-design-eng** and **better-ui** — concentric radii, shadows for depth and
borders only for structure, interruptible CSS transitions over keyframes,
`scale(0.96)` press feedback, staged entrance at ~100ms per semantic chunk,
transition suppression on theme switch, `transition-property` always named,
hover gated behind `(hover: hover)`, and reduced-motion that drops movement
while keeping opacity.

Where the two skills prescribe different exact values, the resolution is noted
in code: press scale uses better-ui's `0.96`; `--ease-out` is emil's
`cubic-bezier(0.23, 1, 0.32, 1)` for UI motion, while `cubic-bezier(0.2, 0, 0, 1)`
is used exactly where better-ui prescribes it, for icon cross-fades.

## Layout

```
src/
  app/                      routes, tokens.css (palette + elevation + motion)
  components/
    chart/                  hand-rolled SVG — chart-frame (+ table twin),
                            forecast-chart, multi-line, small-multiples,
                            bar-chart, stacked-bar, driver-bars, parts
    figures/                stat tile, tick meter, hero figure, sparkline
    shell/                  app shell, theme
    workspace/              the two workspaces, filters, decision tables
  lib/
    data/                   catalog, generator
    forecast/               holt-winters, anomalies, drivers
    workspace/              per-module assembly (memoised per store)
    chart/                  scales, bar geometry
```

**Text density.** Method notes — the median-vs-mean caveat, the bridge
ordering, why each panel has its own scale — sit behind an ⓘ toggle on each
chart rather than under it. They carry real caveats, so they are one click away
and announced to screen readers, not deleted; but a paragraph under each of
nine cards buries the data it is meant to qualify. Per-metric glosses moved to
`title` attributes, the anomaly feed reads two lines per incident instead of
four, and grid rows use `items-start` so a short card is short rather than
inflating to match its neighbour.

Charts are hand-rolled SVG rather than a charting library because the mark specs
are exact — 2px surface gaps, 4px rounded data-ends square at the baseline, 2px
surface rings on overlapping markers, solid hairline gridlines — and fighting a
library's defaults costs more than drawing the paths.

## Known limits

- Per-store model fits take ~300ms on first load, then memoise. Filter changes
  re-slice a cached result and hold the previous render at reduced opacity.
- Store-level prediction bands come from a fresh fit on the aggregate series,
  not from summing per-SKU interval endpoints — summing them would assume every
  SKU misses in lockstep.
- Fuel WAPE (~16%) is materially worse than items (~11%). That is real: fuel
  volume is genuinely noisier, and the price-war week sits inside the backtest
  window. The accuracy panel surfaces it rather than hiding it.
- No persistence, auth, or real data source. Filters are in-memory and reset on
  reload.
