# Backend — Pending Items & Rescope

**Date:** 17 August 2026
**Scope:** `backend/` against `Development_Plan_FINAL.md` Stream 1A (Backend foundation, 10 wk) + 1B (Platform services, 8 wk), and SRS v7.0 §10 (FR-CLD-040…048).
**Companion to:** `Web_App_Pending_Items.md`, which does the same for Stream 1C+1D.
**Method:** source-verified against `schema.sql` (385 lines), `server.js` (1,140 lines), `middleware/`, `services/`, `setup-db.js` — not estimated from the plan.

---

## 1. Headline

**1A + 1B were scoped at 18 weeks. Roughly 7 are already banked; ~11 remain.**

The schema in particular has run far ahead of what the plan assumed — the 1A table still lists "schema completion: lifecycle states, allocation history, audit log, config, certificate identity" as two weeks of pending work, and almost all of it exists, with a v1→v2 migration path and an append-only audit rule that the plan never asked for.

What has *not* moved is the part that was always the hard part: **ingestion, the mandatory tenant predicate, and observability.** Those are 4 of the remaining 11 weeks and none of them are partially done.

One architectural gap (§3.1) is worth more attention than its week-count suggests.

---

## 2. 1A — Backend foundation · 10 wk scoped → **6 wk remaining**

| Item | Scoped | Status | Remaining |
|---|---|---|---|
| Schema completion | 2 | **Largely done** — §2.1 | 0.5 |
| Tenancy and RBAC | 3 | **Largely done**, one real gap — §3 | 1 |
| Ingestion | 2 | **Not started** — §4 | 2 |
| Versioned API | 2 | Auth done; versioning, rate limits, idempotency not — §5 | 1.5 |
| Observability | 1 | **Not started** — §6 | 1 |
| | **10** | | **6** |

### 2.1 Schema — what actually exists

Verified present in `schema.sql`, all of it listed as pending in the 1A table:

| Entity | Evidence |
|---|---|
| Device lifecycle state | `pumps.lifecycle_state`, all 8 SRS §7.3 states under a CHECK constraint |
| Allocation history (FR-SEC-003) | `allocation_log` with from/to/actor/note and a `(pump_id, occurred_at DESC)` index |
| Audit log (FR-CLD-062) | `audit_log` — **and append-only enforced in the database**, via `CREATE RULE … DO INSTEAD NOTHING` on UPDATE and DELETE. Stronger than the requirement asked for. |
| Configuration, desired vs reported (§6.4) | `device_config` with `desired_json`, `reported_json`, `status ∈ {PENDING, APPLIED, FAILED}` |
| Command dispatch | `commands` with `cid`, `expires_at`, `status`, `reject_reason`, `acked_at` |
| Fault codes, one source of truth (FR-CON-033) | `fault_code_catalog`, numeric 0–10 per SRS §6.2, seeded, FK'd from `fault_logs` — with a v1 free-text migration that **keeps** the legacy column so a bad guess is recoverable |
| Refresh tokens | `refresh_tokens` with `token_hash`, `revoked_at`, `replaced_by` |
| Fabricated defaults dropped | `power_factor` and `frequency` removed outright; `gsm_rssi` and `firmware_version` nullable with no default |
| Dealer hierarchy | single `dealer` role + `dealer_depth ≤ 6` CHECK, with a `dealer1..dealer5` → `dealer` migration |

**Still missing** — but most of these attach to features scheduled in the portal plan and should be built *with* them rather than as a schema phase:

| Missing | Needed by | Counted in |
|---|---|---|
| Partitioning on `telemetry_history` | Retention (§7.5) | **Here — 0.5 wk, and time-critical (§7.5)** |
| Certificate / batch identity columns | W3 factory console | Here, in the 0.5 |
| `org_node_id`, `org_role` (P-1) | W3 partner accounts | `Web_App_Pending_Items.md` §8.1.2 |
| Panel records, config templates, subscriptions, RMA, branding, alert rules | W3–W5 | Portal plan W3/W4/W5 |

Only the first two are 1A work. The rest are counted in the portal plan — **do not double-count them.**

---

## 3. Tenancy and RBAC — 1 week remaining

Working and verified: single `dealer` role with computed depth, materialised `hierarchy_path` with a `text_pattern_ops` index, `ASSIGNABLE_ROLES` fixing the v1 role-list bug, strict scoping where a non-superadmin **cannot** override `hierarchy_path` via query string (`server.js:453`), a `getPumpInScope` helper that also enforces customer-level ownership, and `sanitizePump` stripping `device_key_hash` from responses.

### 3.1 The one real gap — FR-CLD-042 is not satisfied

> "the data-access layer **shall** apply a mandatory tenant predicate so that a missing filter cannot leak cross-tenant data"

Today the predicate is a helper each route must remember to call:

```js
const pump = await getPumpInScope(pool, req.params.id, req.user);   // server.js:101
if (!pump) return res.status(404).json({ error: 'Pump device not found' });
```

It is correctly written and correctly used at every current call site. But the requirement is specifically about what happens when someone *forgets* — and today, a new route that queries `agripump.pumps` directly returns every tenant's rows with no error, no warning and no test failure. The control is discipline, not architecture, and the plan adds ~30 endpoints across W3–W5.

**Recommendation: Postgres Row-Level Security.** A policy on `pumps`, `telemetry_history`, `fault_logs`, `commands`, `device_config` and `allocation_log` keyed to a session variable set per request from the JWT. A forgotten filter then returns *nothing* instead of *everything* — the failure mode inverts from silent breach to visible bug.

**Do it before W3**, not after. Retrofitting RLS under ~30 existing endpoints means re-testing all of them; doing it now means the new endpoints are born inside it. **1 week.**

---

## 4. Ingestion — 2 weeks, not started

`POST /api/telemetry` exists and is device-authenticated (`X-Device-Key` against `pumps.device_key_hash`), which closed SEC-1. But it is an interim HTTP path, and the SRS end state — IoT Rule → Lambda → Postgres — does not exist. Neither do three things that are cheap now and expensive later:

**No dedup by `seq`.** The only UNIQUE constraint in the entire schema is `users.phone_number`. `telemetry_history` has `seq`, `ts_approx` and `buffered` columns but nothing enforcing uniqueness, and the insert at `server.js:854` is a plain `INSERT`. The bridge is specified to buffer offline and **replay with `buf: true`** (SRS §6.3) — so duplicates are not a hypothetical, they are the designed behaviour of the device. Add a partial unique index now:

```sql
CREATE UNIQUE INDEX idx_telemetry_dedup
  ON agripump.telemetry_history (pump_id, seq) WHERE seq IS NOT NULL;
```

Then make the insert `ON CONFLICT DO NOTHING`. Ten minutes today; a deduplication exercise over millions of rows later.

**No idempotent writes** (FR-CLD-046) — see §5.

**No offline sweep.** Offline is computed inline in the fleet-stats query (`last_seen_at < now - 15 min`) but nothing *transitions* a device to offline, so nothing can fire an alert on it. The alert engine (1B) needs a real sweep job.

---

## 5. Versioned API — 1.5 weeks remaining

**Auth is done and better than the line item implies.** `services/jwtAuth.js` is a hand-rolled HS256 implementation with 15-minute access tokens (FR-CLD-041), opaque rotating refresh tokens stored only as SHA-256 hashes, `crypto.timingSafeEqual` on the signature, and a `JWT_SECRET` that persists to a gitignored file rather than dying with the process. It ignores the JWT header entirely and always verifies as HS256, so the classic `alg: none` confusion attack does not apply.

Three things remain:

**No versioning.** Routes mount at `/api/…`, not `/api/v1/…` — FR-CLD-040 requires versioned. Cheap now; awkward once the Android app ships against unversioned paths in Stream 2 (month 9–12). Mount the router at `/api/v1` and keep `/api/*` as a deprecated alias.

**Rate limiting is partial.** `middleware/rateLimiter.js` is a dependency-free fixed-window counter applied to three auth endpoints — send-otp, verify-otp, login-password. That is the right *first* place to put it, and the file documents its own limits honestly. But FR-CLD-043 wants per-user and per-API-key limits across the surface, and the in-memory `Map` is per-process, so a second instance doubles every limit. Needs a shared store (Redis) and API-key identity.

**No idempotency keys.** Zero occurrences in the codebase. FR-CLD-046 requires them "where a client retry is plausible — command dispatch, allocation". `commands.cid` is server-generated, so it does not serve this purpose: a farmer double-tapping START on a flaky rural connection currently issues two commands. The 45-second cooldown masks this today, which is luck rather than design — allocation has no equivalent guard.

> **Note on hand-rolled crypto.** The JWT and rate-limit implementations are both competent and clearly documented. They are also both things a Phase 4 penetration test will examine closely, and a maintainer without the original author's context may not spot a subtle regression. Not a defect and not urgent — but revisit the build-vs-library call when the API-key work forces changes to both.

---

## 6. Observability — 1 week, not started

`console.log` throughout; no structured logger, no metrics, no traces, no request IDs. FR-CLD-047 requires structured logs, metrics and traces "for every request and every device message path", and FR-WEB-017's system health view (portal W3) has **no data source without this** — ingestion lag, message error rate and notification delivery rates are all metrics this layer would emit.

**Sequencing consequence: observability must land before W3**, or the system health view ships as a page of empty panels.

---

## 7. 1B — Platform services · 8 wk scoped → **5 wk remaining**

| Item | Scoped | Status | Remaining |
|---|---|---|---|
| Configuration service | 2 | Table + endpoints + desired/reported/status done; templates not | 0.5 |
| Command dispatch | 1 | **Essentially done** — §7.2 | 0.25 |
| Alert engine | 2 | **Not started** | 2 |
| Notifications | 2 | SMS + WhatsApp real; push, email, delivery tracking absent — §7.4 | 1 |
| Retention | 1 | Not started, and blocked on partitioning — §7.5 | 1 |
| | **8** | | **~4.75** |

### 7.2 Command dispatch — done, one gap

`POST /api/pumps/:id/command` enforces the 45-second cooldown server-side and returns `REJECTED / COOLDOWN_ACTIVE` with `remainingSec` — exactly the contract `telemetry-and-fault-spec.md` specified and the SRS omitted. `cid`, `expires_at` and ack correlation all exist, with device-facing poll/ack endpoints.

**Missing:** nothing expires anything. Commands past `expires_at` sit at `PENDING` forever, because the `EXPIRED` status is only ever written by code that does not exist. A sweep job — **~2 days**, folds into the offline sweep from §4.

### 7.4 Notifications — further along than scoped

`services/notificationService.js` implements DLT-templated SMS (Fast2SMS / MSG91) and WhatsApp (Meta / Twilio) with three registered templates and per-language message bodies. Real, working, and it means **DLT registration is already underway** — the external lead time the roadmap warned about is in hand.

Missing: push (FCM), email, delivery-status tracking and retry. The alert engine above it is what turns these senders into a notification *system* — dedup windows, storm digests, per-user channel preferences.

### 7.5 Retention — do the partitioning now

1B budgets "retention — partition drops, daily compaction, exports" at one week, which presumes `telemetry_history` is partitioned. **It is not** — it is a plain table with a single BTREE index, and the schema contains no `PARTITION` anywhere.

Converting a populated table to a partitioned one is materially harder than creating it partitioned: it means a new table, a backfill, a cutover and a window where writes must go somewhere. The table is nearly empty today.

**Do the partitioning migration during W0–W1, before the pilot fleet fills it.** Half a week now against an unpleasant migration later — and the 30-day retention window (SRS §12.7) is only enforceable by partition drop once it exists.

---

## 8. Revised totals

| Stream | Scoped | Remaining | Banked |
|---|---|---|---|
| 1A — Backend foundation | 10 | 6 | 4 |
| 1B — Platform services | 8 | 5 | 3 |
| **Backend total** | **18** | **11** | **7** |
| 1C+1D — Web portal (`Web_App_Pending_Items.md`) | 19 | 17.5 | 1.5 |
| **Stream 1 total** | **37** | **~28.5** | **~8.5** |

**M1 moves from month 9 to roughly month 7.5** at the same run rate — though see §9 before banking that.

---

## 9. Sequencing — four items that must precede portal W3

The portal plan assumes a backend that does not fully exist yet. Four backend items gate portal work, and three of them get more expensive with delay:

| Backend item | Gates | Why it cannot follow |
|---|---|---|
| **Telemetry dedup index** (§4) | Nothing — but the bridge replays by design | Ten minutes now; a data-cleanup exercise once the pilot has run |
| **Partitioning** (§7.5) | Retention, 30-day window | Trivial on an empty table, a migration on a full one |
| **RLS / mandatory tenant predicate** (§3.1) | Portal W3–W5 (~30 new endpoints) | Retrofitting under 30 endpoints means re-testing 30 endpoints |
| **Observability** (§6) | FR-WEB-017 system health (W3) | The view has no data source without it; it would ship as empty panels |

The first two are ~half a week combined and should happen alongside the portal's W0. The other two — **2 weeks** — should sit between portal W2 and W3.

**Practical ordering:** portal W0–W2 (5 weeks) can proceed against the backend as-built. Insert the 2-week backend block (RLS + observability) before portal W3. The remaining ~9 weeks of backend work — ingestion, alert engine, notifications, versioning, idempotency — runs in parallel with or after portal W3, since W3–W5 consume those services rather than being blocked on them. The exception is the alert engine, which gates portal W5 and should therefore start no later than portal W4.

---

## 10. Summary of what is genuinely pending

**Not started at all:** ingestion pipeline (IoT Rule → Lambda), telemetry dedup, offline sweep, command expiry sweep, alert engine, push and email channels, retention and compaction, API versioning, idempotency keys, structured logging, metrics, traces, RLS.

**Partially done:** rate limiting (3 auth endpoints, single-process), notifications (SMS + WhatsApp yes, push/email/delivery-tracking no), configuration service (no templates).

**Done and verified:** the entire core schema with migrations, append-only audit, the dealer hierarchy with computed depth, JWT auth with rotating hashed refresh tokens, device authentication, command dispatch with server-side cooldown, and the fault-code single source of truth.

**The single highest-value item is RLS** (§3.1). It is one week, it is the difference between a tenancy control that is enforced and one that is merely followed, and its cost scales with every endpoint added after it.
