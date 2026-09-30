# Dashboard API (Phase 3)

The contract for the frontend. Machine-readable schemas: `GET /docs` (Swagger) or `GET /openapi.json`, tag **Dashboard**.
Every response shape below is a Pydantic model in `app/schemas/dashboard.py`.

## Endpoints

All under `/api/v1/dashboard`, Bearer JWT. Scope always comes from the token; there is no organisation parameter
except on the Super Admin route.

| Endpoint | Who | Returns |
|---|---|---|
| `GET /global` | SUPER_ADMIN | fleet-wide: devices by state, connectivity, active faults by type, top faulting devices, firmware distribution, map cells |
| `GET /subtree` | manufacturer, distributor, dealer, support | the caller's own subtree: the above **plus** faults today, runtime hours, warranty and subscription expiring soon |
| `GET /organisations/{id}` | SUPER_ADMIN | the `/subtree` shape for one organisation (404 `ORGANISATION_NOT_FOUND` if unknown) |
| `GET /connectivity` | partners | `{online, offline, unknown, not_in_service}` |
| `GET /faults` | partners | active-fault summary, faults today, paginated recent faults |
| `GET /firmware-distribution` | partners | `[{version, device_count, percentage}]` |
| `GET /top-faulting-devices` | partners | paginated |
| `GET /offline-devices` | partners | paginated, longest-silent first |
| `GET /warranty-expiring`, `GET /subscription-expiring` | partners | paginated, soonest first |

`END_USER` (farmers) get 403 on every one of these. Use the main dashboard call where possible; the single-metric
endpoints exist for lists and refreshes.

**Filters** (applied in SQL, never in the client): `state` (one of the 8 lifecycle states), `firmware_version`,
`fault_code` (`/faults`), `window_days` (top-faulting window, default 30). **Pagination**: `limit`/`offset`, `total` in
every list. Unknown filter values are 422, not silently ignored.

## Scope and security

| Caller | Sees |
|---|---|
| SUPER_ADMIN | everything |
| manufacturer / distributor / dealer / support | devices whose `org_id` is in the caller's organisation subtree **or** whose legacy `hierarchy_path` is at/below the caller's path |
| END_USER | nothing (403) |

The two-part rule is deliberately the same one the database's row-level security applies to `pumps`, because both
account models exist today (organisation tree and legacy `hierarchy_path`). The path match is boundary-exact
(`/SA/D1` covers `/SA/D1/...`, never `/SA/D10`) and a partner whose path is just the root `/SA` gets nothing. An empty
scope returns empty structures, never the whole fleet.

Defence in depth: the explicit predicate is tested **with RLS bypassed** (`test_05`), so it holds on its own, and RLS
remains a second boundary underneath. Support engineers get their organisation subtree (their RLS scope); there is no
separate support-grant table yet.

`org_id`, `hierarchy_path` or any other parameter a client adds is ignored (`test_13`).

## Response notes

* `devices.by_state` always has all 8 states, zero-filled.
* `connectivity`: only **in-service** devices (COMMISSIONED, ACTIVE) are online/offline/unknown; the rest are
  `not_in_service` (expected to be quiet). Same rule as the pump badges and the OFFLINE alert sweep
  (`OFFLINE_AFTER_SECONDS`, one definition in `DeviceConnectivityService`).
* `faults.active_total`: open hardware-fault alerts only. Connectivity outages are counted under `connectivity`.
* `connectivity_map`: devices grouped into ~1 km cells (coordinates rounded to 2 decimals), so a farm's exact position
  is never sent. Devices without coordinates are simply absent; nothing is invented.
* `runtime.today_hours` counts a "motor on" reading as one minute (same estimate as the pump screen).
  `today_source` is `rollup` (background figure, see `today_as_of`) or `live` (computed directly because the
  refresher has no current row for the caller).
* `freshness`: `generated_at` = when the numbers were computed; `last_data_update` = newest device report in scope;
  `stale` is true when that is older than `stale_after_seconds` (900) or nothing has reported. `cache.hit` says whether
  this response was served from the 30 s cache.

## Time

"Today" is a calendar day in `DASHBOARD_TIMEZONE` (default `Asia/Kolkata`, the clock the farmer app already uses),
converted to UTC instants in `app/core/dashboard_time.py`. Never the browser's or the server's local date. The nightly
`daily_summary` rollup buckets by **UTC** date, so a multi-day figure can differ at the edges by up to the timezone
offset; "today" itself is exact.

## Caching and rollups (decision record)

No new infrastructure. Three layers, cheapest first:

1. `dashboard_runtime` (one row per device: minutes run today + over the window), refreshed every
   `DASHBOARD_RUNTIME_REFRESH_SECONDS` (300) by a background loop with a Postgres advisory lock (one worker at a time).
   Replaces scanning raw telemetry / summing per-device rollups on each refresh.
2. The three assembled dashboards are cached `DASHBOARD_CACHE_TTL_SECONDS` (30) in the existing `cache_service`
   (Redis if configured, in-process otherwise), keyed by a hash of scope + filters, so callers with different scope
   never share an entry. Ownership changes can therefore show up to 30 s late.
3. Indexes (below).

Settings: `DASHBOARD_TIMEZONE`, `DASHBOARD_CACHE_TTL_SECONDS`, `DASHBOARD_TOP_DEVICES_LIMIT`,
`DASHBOARD_FAULT_WINDOW_DAYS`, `DASHBOARD_RUNTIME_PERIOD_DAYS` (7), `DASHBOARD_RUNTIME_REFRESH_SECONDS`,
`DASHBOARD_STALE_AFTER_SECONDS`.

## Errors, limits

Project envelope `{"error": {"code", "message_key", "params"}, "detail"}`: `DASHBOARD_ACCESS_DENIED` 403,
`ORGANISATION_NOT_FOUND` 404, `RATE_LIMIT_EXCEEDED` 429 (with `Retry-After`; 120 requests/min per user, the global
middleware), `DASHBOARD_QUERY_FAILED` 500 (never SQL or a stack trace).

## Live updates: `WS /ws/dashboard`

Authenticate with `?token=<jwt>` (query strings reach access logs; prefer) or a first frame
`{"type":"auth","token":"<jwt>"}`; unauthenticated sockets close after 10 s; END_USER cannot connect. Sessions are
re-validated every 60 s, so logout-everywhere / suspension drops the socket however it authenticated.

Events (JSON): `auth_ok`, `DEVICE_STATUS_UPDATED {device_id, status: ONLINE|OFFLINE, timestamp}`,
`FAULT_CREATED {device_id, fault}`, `FAULT_RESOLVED {device_id, fault_id}`, `pong` (reply to `{"type":"ping"}`).
Scope is decided server-side per event with the same rule as the REST dashboards. Events originate from
`WebSocketHub.broadcast_fault`, which ingest, the alert engine and the connectivity sweep already call. Per-reading
telemetry is not on this channel (use `/ws`).

## Observability

One structured log line per request (`dashboard.<name> user_id role elapsed_ms`; no tokens or OTPs). In
`/system/metrics` (`counters`, `timings_ms`): `dashboard.requests.*`, `dashboard.errors.*`, `dashboard.request_ms.*`,
`dashboard.cache.hit|miss.*`, `dashboard.query_ms.*`, `dashboard.runtime_refresh_ms`, `dashboard.ws.opened|closed|
auth_failed|errors|send_errors`.

## Database changes (`phase3_dashboard_indexes`, revises `c3d4e5f6a7b8`)

* Read-only RLS policy so **partners can read `daily_summary`** (they previously could not at all, so partner runtime
  history was always 0).
* Table `dashboard_runtime` (RLS: server/super admin write, everyone reads only devices they can see).
* Indexes, built `CONCURRENTLY`: `pumps(org_id, lifecycle_state)`, `fault_logs(occurred_at DESC) INCLUDE (pump_id)
  WHERE fault_code > 0`, `daily_summary(day) INCLUDE (device_id, runtime_min)`, `telemetry_history(recorded_at DESC)
  INCLUDE (pump_id, pump_on)` (skipped on a TimescaleDB hypertable). Nothing on `pumps.last_seen_at`: ingest rewrites it on
  every frame. Reversible (`alembic downgrade c3d4e5f6a7b8`).
* Repository scope predicate uses the `~>=~`/`~<~` pattern-ops range operators instead of `LIKE`: on this Postgres
  build `LIKE 'prefix%'` would not use the `text_pattern_ops` index at all (30 ms vs 0.2 ms).

## Performance (measured, not assumed)

`python scripts/bench_dashboard.py --devices 100000` builds a throwaway `bench` schema (100,000 devices, 1M fault logs,
3M daily rollups, 720k readings today, 280 organisations, real RLS policies copied), times every aggregate as a
partner and as super admin, and drops it. Raw output: `scripts/bench_results/`.

Uncached whole-dashboard time, p50 / p95, ms. **Before** = the original queries and existing indexes.

| Caller (share of fleet) | Before | After |
|---|---|---|
| Dealer (0.25%) | 1,860 / 2,120 | 182 / 326 |
| Legacy dealer, path only | 1,538 / 1,690 | 84 / 105 |
| Distributor (5%) | 3,820 / 4,022 | 1,369 / 2,224 |
| Manufacturer (25%) | 5,233 / 5,746 | 4,198 / 5,491 (best of three runs: 2,735 / 2,799) |
| Super admin (100%) | timed out (>10 s limit) | 2,414 / 3,447 (best: 2,651 / 2,722) |

Read these with the caveats: one Windows dev machine, Postgres 18 with default (128 MB) memory settings and **no
TimescaleDB**; run-to-run variance is large (the manufacturer figure ranged 2.7-4.2 s across identical builds); the
data is synthetic. It shows relative gains and scaling, not a production SLA.

* Met: dealers and small partners are well under the API's 400 ms and the portal's 2.5 s budgets.
* **Not met on this machine**: the largest partners and the super admin, when the 30 s cache is cold, take 2.4-4 s.
  Warm requests are served from cache. The remaining cost is the fault-log ranking (global top-faulting 0.5-1.5 s) and
  the per-row RLS evaluation on `pumps` for big scopes.

## Tests

`tests/test_phase3_dashboard.py` (31, mocked: role checks, formatting) and `tests/test_phase3_dashboard_integration.py`
(29, real database): the spec's organisation tree with exact numbers, sibling isolation, IDOR, legacy paths and
adversarial neighbours (`/SA/LEGX`, `/SA/LEG_x0`), predicate-without-RLS, empty structures, filters, pagination,
IST midnight boundary, rollup and fallback, RLS read/write on the rollup tables, cache isolation, 429, safe 500,
WebSocket auth and scoping, and the `broadcast_fault` fan-out. Mutation-checked: deleting the tenant predicate fails 4 of them, including the one that runs with RLS bypassed.

## Known limitations

* Manufacturer/global cold-cache latency above (recommended next: pre-computed per-scope snapshots refreshed in the
  background, or TimescaleDB continuous aggregates for fault and runtime rollups).
* No 30-day runtime window at fleet scale without an org-level rollup (default is 7 days; configurable).
* `today_hours` is an estimate (one "on" reading = one minute).
* Fault-derived numbers are only as fresh as ingest; nothing here re-derives them.
* No separate support-engineer grant model; support = their organisation subtree.
* `dashboard_ws` keeps per-connection scope in process memory: with several API workers each worker only pushes to its
  own sockets (add a Redis pub/sub relay before running more than one).
