# PRD — Fuel Forecasting Module

| | |
|---|---|
| **Status** | Draft — initial requirements for review |
| **Date** | 2026-09-30 |
| **Audience** | Backend / data engineering (primary), frontend, fuel operations, product |
| **Scope** | Everything on the Fuel Forecasting page (`/fuel`): volume forecasts by grade, the drivers behind them, anomalies, grade mix, street price, and the tank delivery plan — plus every data source and job behind it |
| **Companion doc** | [PRD — Demand Forecast Chart with External Factors](./prd-demand-forecast-chart.md) specifies the shared forecasting engine (features, model, backtest, attribution, API conventions). This doc covers what is **specific to fuel** and restates the shared parts briefly |
| **Reference implementation** | This repository's prototype (`src/lib/workspace/fuel.ts`, `src/components/workspace/fuel-workspace.tsx`) |
| **Target scale** | Up to ~500 stores, 3–6 fuel products per store, forecasts rebuilt nightly; tank levels refreshed intraday |

---

## 1. Summary

Fuel is the highest-volume, lowest-margin, most operationally risky line in a c-store. Running a tank dry loses sales at every pump for that grade and pushes customers to competitors; over-ordering ties up cash and wastes a delivery slot.

The Fuel Forecasting module answers four questions per store:

1. **How many gallons of each grade will we pump each day for the next 7–30 days?**
2. **Why** — which factors (price vs recent levels and competitors, weather, holidays, weather alerts, local events, day of week, season) are moving it?
3. **What happened** — which recent days were unusual, and what likely caused it?
4. **When does each tank need a delivery, and how much will fit?**

The forecast learns each factor's effect from the store's own history and applies it to what's already known about the coming days. The delivery plan turns the forecast into a schedule of drops per tank that avoids runouts, respects safe fill limits and truck compartments, and minimises the number of deliveries.

---

## 2. What the prototype proved (demo data)

Rolling backtest, 8 two-week windows (112 days), store total fuel:

| Store | Holt-Winters (sales history only) | Driver model (with factors) |
|---|---|---|
| 101 — Route 9 Travel Center | 87.2% | **91.1%** |
| 204 — Midtown & 5th | 86.9% | **89.3%** |
| 318 — Lakeside Commons | 86.3% | **89.0%** |
| 442 — County Road 12 | 84.2% | **88.6%** |

What each input contributed at Store 101 (error, WAPE, lower is better):

| Model | Error | Change |
|---|---|---|
| Seasonal naive (same weekday last week) | 15.1% | |
| Holt-Winters | 12.8% | baseline |
| Calendar (trend, season, weekday) | 9.0% | −3.8 |
| + Price | 9.0% | ≈ 0 |
| + Holidays | 8.9% | −0.1 |
| + Weather | 8.9% | ≈ 0 |
| + Weather alerts | 8.9% | −0.1 |
| + Local events | 10.5% | **+1.6** (worse — excluded by selection) |
| Production model (selected inputs + level correction) | **8.9%** | |

Learned at Store 101: Friday +21% vs Sunday; **price −2.2% gallons per 1% price increase**; public holiday +4%; school breaks −4%.

> Prototype fuel sales are synthetic and were not generated from real weather or events, so those inputs show little value here. On real data, weather, alerts and competitor price are expected to matter more for fuel than for inside sales. The per-series selection (§8.5) finds that automatically.

**Gaps the prototype exposed** (addressed in this PRD): single-delivery planning, filling to 100% of capacity, no in-transit loads, no competitor prices, static margin, midgrade modelled as its own tank, runout judged on the mean forecast instead of a risk percentile.

---

## 3. Goals and non-goals

### Goals

1. Daily gallons forecast per store × product (grade) and per store total, 1–30 days ahead, with 80% and 95% intervals, refreshed nightly.
2. Tank-level draw forecast, including blended products.
3. A delivery plan per tank: runout date, deliver-by date, recommended load, and a multi-drop schedule over the horizon.
4. Explain every forecast day with a per-factor breakdown (baseline + effects).
5. All external data automatic, from APIs or system feeds. No manual entry.
6. Measurable efficiency gains: fewer runouts, fewer emergency deliveries, fuller loads (§14).

### Non-goals (this release)

- Setting pump prices (price optimisation). The model's elasticity supports it later.
- Dispatch and routing of carriers across stores.
- Intraday (hourly) volume forecasts — daily only, though tank levels are read intraday.
- Wetstock loss / leak detection (reconciliation data is collected, analytics are a later phase).
- EV charging demand.

---

## 4. Users

| User | Needs |
|---|---|
| Store manager | Tomorrow's and next week's volume; which tank is running low |
| Fuel / wetstock analyst | Delivery schedule for all tanks; runout risk; order quantities |
| Pricing analyst | How price vs competitors moves volume by grade |
| Regional ops | Margin forecast; unusual days across stores |
| Carrier / dispatcher (via export) | Drop date, product, gallons per store |

---

## 5. Dashboard requirements (what must be built for `/fuel`)

Every element below exists in the prototype. Each row lists the data it needs.

### 5.1 Header card

| Element | Rule | Data |
|---|---|---|
| Title | "Fuel Demand Forecasting" | — |
| Summary line | `{scope} · forecast horizon {H} days` | scope label |
| Filters (right side, no labels) | Horizon: Next 7 / 14 / 30 days (default 14) · Store · Grade: All grades or one product | store master, product master |
| Status badge | Critical: `{grades} at reserve within 2 days`; Warning: `{n} grades need a drop this week`; else Good: `All tanks above reserve` | delivery plan |

Changing a filter keeps the page visible and dimmed, with "Updating…", until new data arrives.

### 5.2 KPI tiles

| Tile | Value | Secondary |
|---|---|---|
| Forecast volume · next H days | Σ forecast mean over H (gallons) | Change vs the prior H days of actuals; 80% range (Σ lo80 – Σ hi80) |
| Weekly volume | Last completed week's gallons | Change vs prior week; 12-week sparkline |
| Forecast accuracy | 1 − WAPE of the model in use | Backtested days; bias. "—" and "Not enough history to score yet" when unscored |
| Tanks needing a drop | Count of tanks with status Order now or Schedule drop | "Of N tanks · $X margin" (forecast margin over H) |

### 5.3 Fuel volume — actual vs forecast (main chart)

Same chart as the companion PRD, with gallons:

- Actual (last H days), forecast (next H days), 80% / 95% bands, join point, anomaly markers.
- Hover card: baseline + effect rows — **price**, weather (temperature vs normal, rain/snow), holiday, weather alert, local events, school break, recent-level adjustment — in gallons and %.
- Table view: date, actual, forecast, 80% interval, anomaly.

### 5.4 Volume by grade

Small multiples, one panel per product, each on its own scale with its peak labelled; the same window as the main chart. Needs daily gallons per product.

### 5.5 Street price per gallon

One line per product over the visible window (max 180 days), on its own axis — never overlaid on volume. **New in production:** optional overlay of the local competitor average (§6.3) as a dashed line, since the price *gap* is what drives volume.

### 5.6 What's driving the forecast

Per-group effect over the forecast window vs an average period: trend, season, weekday mix, price, holidays, weather, weather alerts, local events. Units column via a fixed, disclosed bridge order. R² shown.

### 5.7 Forecast accuracy panel

Accuracy, MAPE, bias, MASE vs seasonal naive; model in use; driver vs Holt-Winters backtest scores; which optional inputs are in use; series on the driver model.

### 5.8 Detected anomalies

Latest incidents: dates, spike/drop, % vs expected, gallons actual vs expected, severity, likely cause (NWS alert, PredictHQ event, **price change**, **delivery/runout**, or "no logged cause").

### 5.9 Forecast grade mix

Stacked bar: each product's share of forecast gallons over H.

### 5.10 Delivery plan table

One row per **tank** (not per grade — see §6.1):

| Column | Definition |
|---|---|
| Grade / tank | Product, tank id, octane, capacity, current street price |
| Tank level | Latest ATG net volume and % of capacity, with a meter |
| Daily draw | Average forecast draw per day over H |
| Days to reserve | Fractional days until volume reaches the reserve level |
| Deliver by | Latest safe delivery date (§9) |
| Load | Recommended gallons, in compartment multiples |
| Margin (H) | Forecast gallons × forecast margin per gallon |
| Status | Order now / Schedule drop / Healthy (§9.4) |

Header note: compartment size and lead time in use (e.g., "500-gal compartments · ordered 2 days early"). **New in production:** expandable row showing the full drop schedule over the horizon, and in-transit / scheduled loads.

### 5.11 Data sources panel

Same as the companion PRD: per source status, last sync, rows, schedule, next run, "Sync now". Fuel adds the ATG, delivery, pricing and competitor feeds (§6).

---

## 6. Data requirements

### 6.1 Forecourt and wetstock (internal — required)

| Data | Grain | Fields | Source | Freshness |
|---|---|---|---|---|
| Fuel sales | store × product × day (hourly preferred) | gallons, transactions, revenue | POS / forecourt controller | Nightly by 02:00; hourly later |
| Pump price changes | store × product × timestamp | new price | Price-management system / POS | As changed |
| Tank master | tank | tank id, store, product(s), capacity, **safe fill** (gal or %), **reserve / minimum** level, manifolded group | Wetstock system | On change |
| Blend definition | store × blended product | component tanks and ratios (e.g., Midgrade = 60% Regular + 40% Premium) | Dispenser config | On change |
| Tank readings (ATG) | tank × timestamp | gross volume, **net (temp-corrected) volume**, water height, product temperature | Automatic tank gauge (e.g., Veeder-Root) | At least daily at a fixed hour; hourly preferred |
| Deliveries (BOL) | tank × delivery | datetime, product, gross/net gallons, carrier, BOL number | Carrier / back office | Within 24 h |
| Scheduled & in-transit loads | store × product × delivery | ETA, gallons | Supply / carrier system | Intraday |
| Carrier constraints | store (or carrier) | lead time (days), delivery windows, compartment sizes, max truck gallons, minimum drop | Supply contracts | On change |
| Cost / margin | store × product × day | rack price, freight, taxes → cost per gallon; margin = price − cost | Supplier / OPIS rack feed | Daily |
| Store attributes | store | lat/lon, timezone, region, format (highway / urban / suburban / rural), pump count, open hours, car wash | Store master | On change |

Rules:

- **Sales by day** = sum of the store-local calendar day.
- **Daily price** for modelling = gallon-weighted average price over the day (price changes intraday).
- **Tank draw** per day = Σ sales of products drawn from that tank × blend ratio. A tank's draw is what the delivery plan needs; a product's sales is what the chart shows.
- **Reconciliation**: opening volume − sales + deliveries − closing volume = variance. Store it; flag |variance| > 0.5% of throughput (wetstock analytics later, but data quality now).
- **Stockout days** (a tank at or below its minimum during trading hours, or dispensers marked out of service) are **censored**: excluded from training or corrected, because zero sales ≠ zero demand.

### 6.2 External — already built in the prototype

| Source | Used for fuel | Key | Cadence |
|---|---|---|---|
| **Open-Meteo** | Temperature vs the store's 10-year normal; rain. **Add `snowfall_sum`** for fuel (snow suppresses driving) | none | 3 h |
| **Nager.Date** | Public holidays (travel days) and the day before | none | weekly |
| **NWS alerts** (via IEM) | Winter storm, heat, severe storm/flood/hurricane — **plus lead/lag features** (§7.2): the day before an alert (fill-up spike) and the day after | none | 30 min |
| **PredictHQ** | Crowd events within 10 km; school breaks (travel); severe weather | `PREDICTHQ_API_TOKEN` | 12 h |

Full connector specs are in the companion PRD §7.

### 6.3 External — new for fuel

| Source | Why | Options | Key |
|---|---|---|---|
| **Competitor pump prices** | Volume responds to the price **gap** with nearby stations more than to own price level | OPIS retail, GasBuddy Business, Kalibrate (paid); or a store-level survey feed | paid |
| **Regional market price** | Reference price and trend when competitor data is missing | EIA Open Data API: weekly retail gasoline & diesel by PADD/state (`api.eia.gov/v2/petroleum/pri/gnd/data/`) | free key |
| **Rack / wholesale price** | Cost and margin forecast | OPIS rack, supplier feed | paid |
| **Traffic volumes** (optional, phase 2) | Highway sites track traffic directly | State DOT continuous count stations, HERE/INRIX | varies |
| **Road closures / construction** (optional, phase 2) | Detours cut or add traffic for weeks | State 511 feeds | varies |

Competitor data model: `competitor_stations (id, brand, lat, lon)`, `competitor_prices (station_id, product, observed_at, price)`, and per store a competitor set = stations within N km (default 3 km highway, 1.5 km urban — open question).

---

## 7. Features for the fuel model

Shared definitions are in the companion PRD §9. Fuel-specific additions and changes:

### 7.1 Price

| Column | Definition | Future values |
|---|---|---|
| `log_price_index` | log(own price ÷ own trailing 90-day mean) — reaction to a change | held at the latest price |
| `log_price_gap` *(new)* | log(own price ÷ competitor average price that day) | latest gap held (or scheduled price changes, if the pricing system publishes them) |
| `price_change_7d` *(new, optional)* | own price change over the last 7 days | computed |

All price coefficients are **constrained ≤ 0** (drop and refit if positive) — a higher price never raises volume.

### 7.2 Weather and alerts

| Column | Definition |
|---|---|
| `temp_anom`, `rain` | as companion PRD |
| `snow` *(new)* | log1p(cm snowfall) |
| `alert_winter`, `alert_heat`, `alert_storm` | 1 while in force at the store |
| `alert_storm_eve` *(new)* | 1 on the day before a winter-storm or hurricane alert starts — captures pre-storm fill-ups |
| `alert_after` *(new)* | 1 on the day after a winter-storm alert ends — pent-up demand |

### 7.3 Calendar and events

| Column | Notes for fuel |
|---|---|
| Weekday dummies | Diesel is weekday-heavy (freight), gasoline Friday-heavy |
| Season harmonics | Summer driving peak for gasoline; diesel peaks differ |
| `holiday`, `pre_holiday` | Travel holidays raise gasoline at highway sites; **diesel falls** on holidays |
| `school_break` | Summer and holiday breaks shift commuting and travel |
| `local_attendance` | Crowd events within 10 km |
| `payday` *(optional)* | 1st and 15th of the month — test by selection |

### 7.4 Series

- **Product series**: store × product (Regular, Midgrade, Premium, Diesel, E85, DEF, etc.). Forecast target = daily gallons, stockout days censored.
- **Store total fuel**: fitted as its own series (not a sum of product bands).
- **Tank draw**: derived, not separately fitted: `draw_tank(d) = Σ_products forecast_product(d) × blend_share(product, tank)`. Intervals: combine product quantiles assuming positive correlation (conservative: sum the quantiles).

---

## 8. Forecasting model

The engine is the one specified in the companion PRD §10. Summary with fuel settings:

### 8.1 Driver model

- Ridge regression on `log1p(gallons)`, standardised columns, λ = 2.5, sign constraints on price.
- Inputs: trend, season, weekday, price (index, gap), holidays, and the optional groups below.
- Recent-level correction: exponentially smoothed residual carried forward, decaying ×0.9/day — follows step changes such as a new competitor or a road detour.

### 8.2 Fallback

Damped Holt-Winters with weekly seasonality on `log1p(gallons)`.

### 8.3 Backtest

Rolling origin, 8 origins × 14 days, H = max(horizon, 14), identical origins for every candidate, ≥ 42 training days before the first origin; fewer origins for short histories (minimum 2). Metrics: WAPE (headline), MAPE, bias, MASE.

### 8.4 Why this model for fuel

- Fuel volume is smooth, high-count and strongly weekly — log-linear regression fits it well and the effects are interpretable (an elasticity reads as "−2.2% per 1% price").
- Every effect is a coefficient an analyst can see and challenge.
- It is fast enough to refit every store × product nightly.
- Holt-Winters stays as the fallback and the benchmark every series must beat.
- Extension point: gradient-boosted trees can be added as a third candidate in model selection if the pilot shows non-linear effects (e.g., price-gap thresholds). Not in this release.

### 8.5 Input and model selection per series

- Core inputs always: trend, season, weekday, price, holidays.
- Optional groups, added only if they lower backtest WAPE by ≥ 0.1 point (forward selection): **weather** (temp, rain, snow), **alerts** (incl. eve/after), **events** (attendance, school breaks), **competition** (price gap) *(new group)*.
- Driver model used only if it beats Holt-Winters on the backtest.
- Selection weekly; coefficients and forecasts nightly.

### 8.6 Intervals

Per horizon step, from the chosen model's backtest log errors; variance fitted linearly in h; 80% (z = 1.2816) and 95% (z = 1.96).

### 8.7 Known future

| Input | Future values |
|---|---|
| Own price | Latest price, or scheduled price changes if available |
| Competitor gap | Latest gap |
| Weather | Open-Meteo forecast (16 days); normal beyond |
| Alerts | Only issued alerts |
| Holidays, school breaks, events | Calendars |

---

## 9. Delivery planning

### 9.1 Inputs per tank

Current net volume (latest ATG reading, rolled forward to the planning time using the forecast draw since the reading), capacity, **safe fill** (default 95% of capacity if not configured), reserve / minimum level, forecast daily draw with its quantiles, scheduled and in-transit loads, carrier lead time, delivery windows, compartment size, minimum drop, maximum truck volume.

### 9.2 Runout and deliver-by

1. Project the level day by day: `level(d) = level(d−1) − draw(d) + scheduled_delivery(d)`.
2. Use the **P80 draw** (upper 80% quantile) for risk decisions, and the mean for expected-level display. (The prototype uses the mean; production must not, or it will under-protect busy days.)
3. `days_to_reserve` = first (fractional) day where level ≤ reserve, interpolated within the day.
4. `deliver_by` = runout date − safety days (default 2), no earlier than today + lead time; flag when impossible.

### 9.3 Recommended load

- Headroom at delivery = safe fill − projected level on the delivery date (using the **mean** draw, so the load fits).
- Round **down** to the compartment size (default 500 gal); respect minimum drop.
- **Multi-drop schedule**: repeat 9.2–9.3 across the horizon until the projected level stays above reserve through day H. The prototype plans only the next delivery.
- **Consolidation**: where products share a truck, combine drops for the same store and day into one order within the truck's maximum volume, preferring days that fill the truck (fewer deliveries = efficiency goal).

### 9.4 Status

| Status | Rule |
|---|---|
| Order now | days to reserve ≤ safety days (default 2), or deliver-by ≤ today + lead time |
| Schedule drop | days to reserve ≤ 6 |
| Healthy | otherwise |
| Capacity warning *(new)* | the tank needs more than one drop per day on average — tank is undersized for throughput (e.g., prototype Store 101 Regular: 5,280 gal/day from a 12,000-gal tank) |

### 9.5 Margin

`margin(H) = Σ forecast gallons × forecast margin per gallon`. Margin per gallon comes from the daily cost feed (§6.1) held at the latest value; the prototype uses a fixed margin per grade.

---

## 10. Anomalies (fuel)

Detection as the companion PRD §12 (robust z of Holt-Winters residuals, |z| ≥ 3). Fuel-specific causes to join, in order:

1. **Stockout / out-of-service dispensers** (from ATG and forecourt data) — a drop explained by supply, not demand.
2. **Price change** ≥ 3% in the prior 3 days, own or competitor.
3. NWS alert in force or starting the next day.
4. PredictHQ event with attendance ≥ 1,000 or severe weather.
5. Otherwise "no logged cause".

---

## 11. Data model (fuel additions)

Shared tables (stores, holidays, store_weather, external_events, sync_log, forecast_runs, series, series_model, forecast_points, daily_effects, anomalies) are in the companion PRD §8. Fuel adds:

```sql
fuel_products        (id PK, name, short_name, octane, is_blend, sort_order)
tanks                (tank_id PK, store_id, product_id NULL for blend-only, capacity_gal,
                      safe_fill_gal, reserve_gal, manifold_group NULL)
blend_components     (store_id, product_id, tank_id, share)                        PK (store_id, product_id, tank_id)
fuel_sales           (store_id, product_id, date, gallons, transactions, revenue,
                      avg_price, stockout_minutes)                                   PK (store_id, product_id, date)
price_changes        (store_id, product_id, changed_at, price)                      PK (store_id, product_id, changed_at)
tank_readings        (tank_id, read_at, gross_gal, net_gal, water_in, temp_f)      PK (tank_id, read_at)
deliveries           (delivery_id PK, tank_id, delivered_at, gross_gal, net_gal, carrier, bol_number)
scheduled_deliveries (id PK, store_id, product_id, eta, gallons, status)          -- planned | dispatched | delivered | cancelled
carrier_terms        (store_id, lead_time_days, compartment_gal, min_drop_gal, max_truck_gal, windows JSON)
fuel_costs           (store_id, product_id, date, cost_per_gal)                     PK (store_id, product_id, date)
competitor_stations  (station_id PK, brand, latitude, longitude)
competitor_prices    (station_id, product_id, observed_at, price, source)          PK (station_id, product_id, observed_at)
store_competitors    (store_id, station_id, distance_km)                            PK (store_id, station_id)
reconciliation       (tank_id, date, opening_gal, sales_gal, deliveries_gal, closing_gal, variance_gal)

-- outputs
tank_plans           (run_id, tank_id, as_of, level_now, draw_mean_per_day, days_to_reserve,
                      runout_date, deliver_by, status, capacity_warning)            PK (run_id, tank_id)
planned_drops        (run_id, tank_id, drop_date, gallons, truck_group)            PK (run_id, tank_id, drop_date)
```

---

## 12. API

Conventions (run ids, caching, errors) as the companion PRD §13. All endpoints take `store_id`; `product` = `all` or a product id; `horizon` ∈ 7, 14, 30.

| Endpoint | Returns | Feeds |
|---|---|---|
| `GET /v1/forecast-chart?stream=fuel&scope={product}` | Chart rows with factors (companion PRD §13.1), gallons | §5.3 |
| `GET /v1/fuel/summary` | horizon total, 80% range, prior total & delta; weekly volume (12 weeks); accuracy + model info; tanks needing a drop; margin; status badge | §5.1, 5.2, 5.7 |
| `GET /v1/fuel/volume-by-product` | dates + one series per product over the visible window | §5.4 |
| `GET /v1/fuel/prices?days=` | dates + price per product; competitor average per product (when available) | §5.5 |
| `GET /v1/fuel/drivers` | per-group effect, units, R², bridge order | §5.6 |
| `GET /v1/fuel/anomalies?limit=6` | incidents with cause | §5.8 |
| `GET /v1/fuel/mix` | forecast gallons per product over H | §5.9 |
| `GET /v1/fuel/delivery-plan` | per tank: level, draw, days to reserve, runout, deliver-by, load, margin, status, capacity warning, planned drops, in-transit loads | §5.10 |
| `GET /v1/fuel/delivery-plan/export?format=csv` | carrier-ready drop list for a date range | dispatch |

A single aggregate endpoint (as in the prototype) is acceptable if it meets p95 < 300 ms; the split above allows independent caching.

---

## 13. Pipeline and freshness

| When | Step |
|---|---|
| Every 30 min | ATG readings ingested; tank plans recomputed from the latest level and the nightly forecast (no refit) |
| Intraday | Price changes, scheduled/in-transit loads; competitor prices as the provider publishes |
| 02:00 | Yesterday's sales, deliveries, costs landed; reconciliation computed; stockout days flagged |
| 02:15 | Features, fit, forecast, backtest (weekly: selection) for every store × product and store total |
| 04:30 | Attribution, anomalies, drivers, plans |
| 05:00 | Publish run |
| **06:00** | **SLA: fuel page shows today's forecast and plan** |

Tank plans must never wait for the nightly run: a new ATG reading updates `days_to_reserve` within 30 minutes.

---

## 14. Success metrics (how "efficiency" is measured)

| Metric | Definition | Target (pilot, to confirm) |
|---|---|---|
| Forecast accuracy | 1 − WAPE, store × product, daily, 7-day horizon | ≥ 90% store total; ≥ 85% per product |
| Bias | signed error ÷ actual | within ±2% |
| Runouts | tank below minimum during trading hours | −50% vs baseline period |
| Emergency deliveries | deliveries ordered with < lead time | −50% |
| Load efficiency | delivered gallons ÷ truck capacity | +10% |
| Deliveries per 100k gallons | | −10% |
| Retains / refused drops | loads that didn't fit | 0 |

Baseline = the 8 weeks before the pilot at the same stores.

---

## 15. Non-functional requirements

As companion PRD §15, plus:

- Tank data is operationally critical: ATG ingestion must alert within 30 minutes of a missing reading for any tank.
- The delivery plan must degrade safely: missing forecast → use the last good forecast; missing tank reading → last reading rolled forward, flagged "stale level".
- All volumes in US gallons, net (temperature-corrected) where available; state which in the API.
- Audit: every recommended load keeps the inputs used (level, draw, terms) for later review.

---

## 16. Edge cases

| # | Case | Rule |
|---|---|---|
| 1 | Midgrade blended at the dispenser | Forecast Midgrade sales as a product; allocate its draw to component tanks by blend ratio |
| 2 | Two tanks manifolded for one product | Plan them as one tank group; readings summed |
| 3 | Stockout day | Censor from training; name it as the anomaly cause |
| 4 | Tank undersized for throughput | Capacity warning; plan multiple drops |
| 5 | Delivery day in the history | Doesn't affect sales; used only for reconciliation and level |
| 6 | Price war (sharp temporary cut) | Price-gap feature explains the volume jump; after it ends, level correction decays |
| 7 | New competitor opens | Price gap (if priced) + recent-level correction; a persistent drop is followed within ~2 weeks |
| 8 | Holiday: gasoline up, diesel down | Per-product coefficients; never share holiday effects across products |
| 9 | Hurricane / winter storm warning | Eve-of-alert spike, in-alert drop, after-alert rebound (§7.2) |
| 10 | Price positive coefficient | Sign constraint: drop and refit |
| 11 | New store, < 42 days | Holt-Winters; accuracy "not scored yet"; plan still runs |
| 12 | Product added (e.g., E15) | New series; Holt-Winters until history allows the driver model |
| 13 | Weather beyond 16 days | Treated as normal |
| 14 | ATG reading older than 24 h | Plan flagged "stale level"; status never downgraded below the last known risk |

---

## 17. Acceptance criteria

1. Forecast, intervals and hover card follow the companion PRD §17 criteria for every fuel series.
2. For every tank, `days_to_reserve` recomputes within 30 minutes of a new ATG reading.
3. No recommended load exceeds `safe_fill − projected level at delivery`; every load is a compartment multiple ≥ minimum drop.
4. For a tank whose P80 projection crosses reserve within the horizon, at least one planned drop lands on or before `deliver_by`.
5. Blended product draw allocated to component tanks sums to the product forecast × 1.0.
6. Stockout days are excluded from training and flagged in anomalies.
7. Price coefficients are ≤ 0 in every stored fuel model.
8. The summary tile values equal the aggregates of the chart and plan endpoints for the same run.
9. Golden test: reproduces the prototype's Store 101 fuel backtest (Holt-Winters 87.2%, driver 91.1%) on the prototype dataset.

---

## 18. Rollout

| Phase | Scope |
|---|---|
| 0 — Spike | Port engine; reproduce §17.9; confirm ATG, BOL and price feeds for 10 pilot stores |
| 1 — Data | Forecourt sales, price changes, tank master + ATG, deliveries, carrier terms, costs; external connectors (shared) + snowfall + EIA |
| 2 — Forecast | Product and store-total forecasts; tank draw with blends; nightly job |
| 3 — Plan | Runout, deliver-by, loads, multi-drop schedule, consolidation, 30-min recompute |
| 4 — Pilot | 10 stores, 6 weeks; measure §14 against baseline |
| 5 — Competitor prices | Add price-gap group once a provider is contracted |
| 6 — Scale | All stores; dispatch export; monitoring |

---

## 19. Open questions

| # | Question | Owner |
|---|---|---|
| 1 | ATG vendor(s) and access: direct polling, a wetstock platform, or a cloud API? Reading frequency? | Fuel ops / IT |
| 2 | Which stores blend Midgrade (and at what ratio)? Any manifolded tanks? | Fuel ops |
| 3 | Carrier terms per store: lead time, windows, compartment sizes, minimum drop, who places orders? | Supply |
| 4 | Competitor price provider and budget (OPIS / GasBuddy / Kalibrate)? Competitor radius by store format? | Pricing |
| 5 | Do we receive scheduled pump price changes in advance? | Pricing |
| 6 | Safe fill and reserve per tank — configured values, or a chain default (95% / 8–10%)? | Fuel ops |
| 7 | Loyalty fuel discounts (cents-off days): are they a promo calendar the model should use? | Marketing |
| 8 | Is net (temperature-corrected) volume available for sales and deliveries? | Fuel ops |
| 9 | Diesel: separate truck-stop lanes / DEF — in scope? | Product |
| 10 | Traffic and road-closure feeds for highway sites — worth the cost in phase 2? | Product |

---

## Appendix — prototype behaviour to keep, and to change

| Area | Prototype | Production |
|---|---|---|
| Series | store × grade, store total | store × product, store total, **tank draw with blends** |
| Price | own price ÷ trailing 90-day mean | + **competitor price gap**; sign-constrained |
| Weather | temp anomaly, rain | + **snowfall** |
| Alerts | in-force flags | + **eve and after** flags |
| Tank level | one static reading per tank | **ATG every 30 min**, net volume |
| Fill limit | 100% of capacity | **safe fill** (default 95%) |
| Runout risk | mean draw | **P80 draw** |
| Plan | next delivery only | **multi-drop schedule + consolidation** |
| Incoming loads | ignored | scheduled / in-transit included |
| Margin | fixed per grade | **daily cost feed** |
| Stockouts | not handled | **censored** in training, named in anomalies |
| Grade master `price_elasticity` | seeded, unused by the model | drop — elasticity is learned per store × product |
