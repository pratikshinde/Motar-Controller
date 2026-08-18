# Android App — Development Plan

**Date:** 18 August 2026
**Scope:** `android/` against SRS v7.0 §9 (FR-APP-001…042), against the
backend + web portal completed in this same effort, and against product
direction given 18 Aug 2026 (§0).
**Supersedes:** `Development_Plan_FINAL.md` Stream 2's 11-week estimate,
with a source-verified one (§8) — the same way that document superseded
`SRS_Compliance_Roadmap.md`'s phase ordering.

---

## Implementation status (18 Aug 2026)

Phase D + Phase 0 + Phase 1 implementation started same day, per "implement
plan, keep Partner Console for later development." Phase 4 (Partner
Console) is explicitly deferred (A-1, below) — no work started on it.

**Done:** backend `/api/v1` versioning shim (URL-rewrite middleware, `/api`
kept as a working deprecated alias). Android: AWS IoT SDK + Firebase Auth
removed from `build.gradle.kts`; `aws/AwsConfig.kt`/`aws/IotMqttClient.kt`/
`data/BackendApi.kt` deleted outright (git history has them, not archived
to `docs/superseded/` as A-7 suggested — they had zero endpoint overlap
with anything worth keeping, so there is nothing an archive would
preserve beyond `git log`). New: `data/AppConfig.kt`, `data/Models.kt`
(rewritten against actual `server.js` response bodies, not assumed
shapes — see gap below), `data/auth/TokenStore.kt`
(EncryptedSharedPreferences), `data/net/ApiClient.kt`+`AuthApi.kt`+
`PumpApi.kt` (Retrofit, single-flight refresh-on-401 via an
`Authenticator`), `data/auth/AuthRepository.kt` (real send-otp/verify-otp/
mfa-verify, replacing Firebase Phone Auth entirely), `data/ws/
WebSocketClient.kt` (capped-backoff reconnect), `data/PumpRepository.kt`+
`AlertRepository.kt`. Rewritten: `PumpApp.kt` DI wiring, `Theme.kt`
(+`PhaseColors`/`StatusColors` tokens), `AuthViewModel.kt`+`LoginScreen.kt`
(OTP+MFA, no demo-mode bypass), `PumpViewModel.kt`, `DashboardScreen.kt`
(the redesigned Pump screen — command bar pinned outside the scroll
container, per §3.3/§3.4), `PumpsScreen.kt`/`HistoryScreen.kt`/
`AlertsScreen.kt`, `MainActivity.kt` (session-aware start destination,
1-5-pump auto-select, >5-pump list). `strings.xml`+`values-hi` updated;
debug-only cleartext network security config added for the emulator's
`10.0.2.2` host (release builds get no such exception).

**Gap found during implementation, not anticipated in §1's audit:** the
real `agripump.telemetry_history` table (schema.sql §5) has no phase-
sequence-correctness flag and no runtime-accumulator columns at all —
only `v_ry/v_yb/v_br/i_r/i_y/i_b/gsm_rssi/pump_on/fault_active/seq/
ts_approx/buffered`. `seq` is a bare `BIGINT` of undocumented semantics,
not a `seqReverse` boolean. The §3.3 wireframe's "R→Y→B ✓" chip and
"Σ23h32m" runtime figure are therefore **not implemented** — showing them
would mean fabricating exactly the kind of value this rewrite exists to
stop faking (§3.1 principle 4). If phase-sequence and runtime tracking
are wanted, they need new backend columns/computation first; this is a
real, source-verified gap, not a shortcut taken during the app build.

**Also not implemented this pass, deliberately out of scope:** "Call my
dealer" (FR-APP-018 — no dealer-contact data source is wired yet), the
`>5`-pump searchable list's actual search/filter UI (the route exists and
is reachable, but is not yet filterable), horizontal swipe-between-pumps
(the in-dashboard switcher dialog covers 2-5 pumps for now, no
`HorizontalPager`), BLE/offline queue/commissioning (Phase 3), FCM
push/alerts backend sender (Phase 2), i18n beyond en/hi for the strings
introduced in this pass (Phase 5 territory — kn/mr/ta/te fall back to
English for new keys, existing keys stay translated).

**Not verified live** — no Android build toolchain (no `java`/JDK, no
Android SDK) is available in this environment, so nothing here has been
compiled or run. Every file was written directly against source-verified
backend contracts (endpoint paths, request/response JSON down to
node-postgres's NUMERIC/BIGINT-as-string serialization quirk — see
`data/Models.kt`'s header comment), not assumption, but "compiles" and
"runs correctly on a device" are unconfirmed. Building and testing in
Android Studio is the next real step before this is field-ready.

---

## 0. Product direction (18 Aug 2026)

1. Check the existing code first — done, §1.
2. A mockup was supplied and reviewed — §2.
3. **Primary users are end customers and dealer/service technicians.**
4. **Manufacturers, distributors and dealers will prefer the app over the web portal.** The SRS scopes the app's partner surface to three thin items (FR-APP-040/041/042); that is now too thin — see Phase 4.
5. Everything else is in the SRS — confirmed, §7.
6. **UI should be *like* the mockup, not a copy of it.** Specifically: the mockup puts the pump ON/OFF control below the fold on a small screen. Goal is **simple, intuitive, minimal navigation, maximum information.** This drives §3, the centre of this plan.

---

## 1. Where the app actually is (source-verified)

15 Kotlin files, ~1,400 LOC, no tests, compiles to a working debug APK.
A real UI skeleton — but wired to infrastructure that has nothing to do
with this repo's backend, and with several correctness bugs on the one
screen that matters most.

**The networking/auth/realtime stack targets a different system
entirely**: AWS IoT Core (MQTT/WebSockets) + Cognito Identity Pool +
Firebase phone-auth + a separate API-Gateway/Lambda/DynamoDB/Timestream
stack (`android/aws-setup/*`), all still `REPLACE-ME`-configured and
never provisioned. Zero endpoint overlap with `backend/server.js`. This
confirms decision **D-2** ("app moves to backend API, Cognito
retired") — what wasn't clear before is the size: it means replacing
essentially all of `aws/IotMqttClient.kt`, `data/BackendApi.kt` and
`ui/login/AuthViewModel.kt`, and adding JWT storage/refresh, a
WebSocket client and an MFA step that exist in no form today.

**Verified bugs in `ui/dashboard/DashboardScreen.kt`** — all read
directly from source, all fixed as part of the Phase 1 rebuild:

| # | Finding | Evidence |
|---|---|---|
| B-1 | **Fabricated telemetry.** When live data is null the screen shows plausible fake numbers indistinguishable from real ones. | `t?.vRY ?: 418f`, `t?.vYB ?: 422f`, `t?.vBR ?: 415f`, `t?.iR ?: 14.2f`, `t?.iY ?: 14.5f`, `t?.iB ?: 14.1f` (lines 121-123, 144-148) |
| B-2 | **9 of 16 telemetry fields are never displayed** — `timestamp`, `pRY/pYB/pBR` (phase presence), `seqReverse`, `totalRunSec`, `lastCycleRunSec`, `gsmRssi`, `faults`. The data arrives and is discarded. | grep of `DashboardScreen.kt`: zero real usages (the only apparent hits are `CardDefaults` matching "faults") |
| B-3 | **Control is below the fold** — exactly the reported problem. Card order is header → voltages → currents → control, inside a `verticalScroll`. The control's lower edge lands at ≈590dp on a ~568dp usable small screen. | lines 54-60 (scroll container), 153-226 (control card last) |
| B-4 | **Cooldown is a local guess, not the server's.** `cooldownSec = 45` is set client-side on tap; the backend's authoritative `remainingSec` (returned on `REJECTED / COOLDOWN_ACTIVE`) is ignored. Restart the app and the interlock vanishes; a command from the web portal is invisible. | line 196 |
| B-5 | **Connection state collected, never rendered.** A stalled connection is invisible — directly contradicts FR-APP-005's "offline badge". | line 48 assigns `conn`; no further reference in the file |
| B-6 | **Voltage ring encodes the wrong thing.** `sweep = (voltage / 500f) * 270f` — a healthy 415V and a dangerous 480V look nearly identical (224° vs 259°). It answers "what fraction of 500V is this?", not "is this safe?" | line 232 |
| B-7 | **Current bar is hardcoded to 25A full-scale** regardless of motor size. A 50HP motor pegs the bar at 100% permanently. | line 292, `(amps / 25f)` |
| B-8 | **Phase colours contradict convention.** Currents render blue/green/purple for R/Y/B; the electrical standard (and the mockup) is R=red, Y=yellow, B=blue. Confusing to any electrician. | lines 144-148 |
| B-9 | **Zero `stringResource()` calls** — every label hardcoded English, so ~48% of the 6-locale string catalog (29 of 61 keys) is dead and switching language does nothing on the main screen. | grep: 0 matches in `ui/dashboard/` |
| B-10 | Login and Pump-list are unreachable (`startDestination = "pump"`, commit `cce5f57` — a deliberate demo shortcut) and back is a no-op. | `MainActivity.kt` |
| B-11 | Alerts screen is never populated — FCM only raises an OS notification, nothing feeds the in-app list. | `fcm/PumpMessagingService.kt` |

B-2 is the important one for §0.6's "maximum information" goal: **the
data is already arriving and being thrown away.** Showing it needs no
backend work at all.

---

## 2. The mockup — what to keep, what to change

**Keep** (these are good and correct):
- Per-phase semantic colour coding, R=red / Y=yellow / B=blue.
- Phase-presence indication distinct from a zero reading.
- Phase-sequence display with an explicit reverse warning.
- Both runtime counters (total and last-cycle).
- GSM signal strength, visible at a glance.
- Fault list with severity styling.
- Dark, high-contrast theme.

**Change**:
- **Layout is desktop-first** — a 1400px three-column grid. Stacked on a
  phone it pushes the control off-screen (B-3). §3 re-flows it.
- **Decorative type** (Orbitron) for numbers. Swap for a highly legible
  face with **tabular figures** so digits don't jitter as values update.
- **Thin glowing rings and 8-11px labels.** The operating environment is
  farmers on low-end phones outdoors in sunlight (FR-APP-001,
  NFR-U-001/002). Larger numerals, filled shapes, WCAG-AA contrast.
- **Rings that encode fraction-of-500V** rather than position in the
  safe band (same flaw as B-6). Replace with a band showing the
  acceptable window and where the reading sits in it.

---

## 3. UI/UX design — the centre of this plan

### 3.1 Principles

1. **The primary job never scrolls.** For an end customer that job is:
   *is it running, and can I change that.* Both must be on screen at
   launch, always.
2. **One screen, everything on it.** All 16 telemetry fields visible
   without navigation when healthy (§3.3 proves the budget).
3. **Progressive disclosure for depth, not for basics.** Tap a fault for
   cause/action/dealer-call; never make someone tap to learn the pump is
   off.
4. **Never fabricate.** Missing data renders as an explicit unknown
   state with a timestamp — fixes B-1, satisfies FR-APP-005.
5. **Colour is never alone** (NFR-U-001) — every state carries icon +
   text + colour.
6. **Role adapts the shell, not just the buttons** (FR-APP-004) — a
   farmer and a dealer get different navigation, not the same nav with
   greyed-out items.

### 3.2 Navigation model — minimal by construction

**Adaptive home.** The app opens on what the user actually needs:

| Situation | Home |
|---|---|
| End customer, 1 pump | **The pump screen itself** — no list, no picking |
| End customer, 2–5 pumps | Pump screen + **horizontal swipe** between pumps, dots indicator, name dropdown in the top bar |
| End customer, >5 pumps | Searchable list first; swipe still works after selecting |
| Dealer / technician | Fleet list, filterable (offline / faulted today / lockout — FR-APP-033) |
| Distributor / manufacturer | Partner Console home (Phase 4) |

**Bottom navigation, role-scoped, 3–4 items max:**

- End customer: **Pump · History · Alerts** (+ profile in top bar)
- Technician/dealer: **Fleet · Service · Alerts · More**
- Partner: **Console · Fleet · Alerts · More**

That's one tap to anything. Cyclic timer, dealer contact, language and
sign-out live behind the top-bar profile/overflow — secondary by
frequency, not buried.

### 3.3 The Pump screen (the 90% screen)

Designed against the **FR-APP-001 floor**: 360×640dp logical, ~568dp
usable after status and navigation bars.

```
┌────────────────────────────────┐
│ ☰  Borewell Pump #1        ⋮  │  56dp   name = switcher when multi-pump
│    ● Live · updated 3s ago     │         or "⚠ Offline · last seen 12m ago"
├────────────────────────────────┤
│ ⚠  DRY RUN                     │  0dp healthy
│    Borewell may have no water  │  76dp when faulted
│    Tap for what to do        › │
├────────────────────────────────┤
│                                │
│          RUNNING               │  132dp  hero — state is the loudest
│          ⏱ 2h 14m              │         thing on screen. Background
│                                │         tint encodes state, readable
├────────────────────────────────┤         peripherally / in sunlight.
│   R-Y      Y-B      B-R        │
│   418 V    422 V    415 V      │  116dp  electrical grid, 2×3.
│   ▬▬▬|▬▬   ▬▬▬|▬▬   ▬▬|▬▬▬     │         band = safe window, marker
│                                │         = reading. Absent phase goes
│   R        Y        B          │         grey + "ABSENT", never "0 V".
│   14.2 A   14.5 A   14.1 A     │
│   ▬▬|▬▬▬   ▬▬|▬▬▬   ▬▬|▬▬▬     │
├────────────────────────────────┤
│ R→Y→B ✓  📶 ▂▄▆  Σ23h32m  ⟳off │  44dp   status strip (chips, scrollable)
├────────────────────────────────┤
│  ╔══════════════════════════╗  │
│  ║    ⏻   TAP TO STOP       ║  │  120dp  ★ PINNED — outside the scroll
│  ╚══════════════════════════╝  │         container. Never moves.
├────────────────────────────────┤
│   Pump      History     Alerts │  56dp
└────────────────────────────────┘
```

**Budget:** 56+132+116+44+120+56 = **524dp** healthy — fits 568dp with
room to spare. Faulted adds 76dp → 600dp, so the middle scrolls
slightly **while the command bar stays pinned**. That pinning is the
architectural fix for B-3: the control is structurally incapable of
going off-screen, at any screen size, in any state.

**All 16 telemetry fields are on this one screen**: 6 voltages/currents
+ 3 presence (cell state) + sequence + GSM + 2 runtimes + pumpOn (hero)
+ faults (banner) + timestamp (top bar). Fixes B-2 — "maximum
information" with zero navigation and zero backend work.

### 3.4 The Command Bar — a named component

The pinned zone is one state machine, and it is where FR-APP-011's
progress states, the cooldown and AC-06's offline rule all live:

| State | Presentation |
|---|---|
| Idle, off | `⏻ TAP TO START` (green) |
| Idle, on | `⏻ TAP TO STOP` (red) |
| Confirming | Inline: *"Start Borewell Pump #1?"* [Cancel] [Start] — NFR-U-003 names the device |
| Sending | `Sending…` indeterminate |
| Delivered | `Delivered to pump…` |
| Acknowledged | `✓ Pump started` briefly, then idle |
| Cooldown | `Wait 32s` + determinate progress, **driven by the server's `remainingSec`** — fixes B-4 |
| Offline | `Pump offline — will apply when back online (expires in N min)`, or an explicit rejection. Never silently lost (AC-06) |
| No permission | Bar hidden entirely, not greyed (FR-APP-004) |

Behind a narrow `CommandDispatcher` interface, so the deferred D-1
migration to Device Shadow (Stream 3, after this stream) touches one
file rather than the app.

### 3.5 Faults — plain language (FR-APP-013)

Banner: icon + fault name + one-line consequence. Tap → bottom sheet
with what happened, probable cause, what to do, **Call my dealer**
(FR-APP-018), and **Reset fault** where the role permits (FR-APP-014).
Fault text comes from the backend's `fault_code_catalog`, so
firmware/portal/app stay in lockstep — no per-client copy to drift.

### 3.6 Visual system

Material 3, **dark-first**, reusing the exact
`@material/material-color-utilities` seed→tonal-palette machinery
already built for the web portal's white-labelling, so a partner's
brand colour resolves identically on web and phone. Per-phase colours
(R/Y/B) are **semantic tokens outside** the branding palette — they
must not change with a partner's brand, and they fix B-8. Numerals use
tabular figures at a large size; minimum 48dp touch targets; 4.5:1
contrast floor.

---

## 4. Screen inventory

| Screen | Phase | Notes |
|---|---|---|
| Login (phone + OTP, MFA step for privileged roles) | 1 | Backend OTP, not Firebase |
| Pump (§3.3) | 1 | The 90% screen |
| Fault detail sheet | 1 | FR-APP-013/014/018 |
| Pump list / switcher | 1 | Only when >5 pumps |
| History | 2 | Runtime + fault history (FR-APP-017) |
| Alerts inbox | 2 | Wire to `/api/alerts` — fixes B-11 |
| Cyclic timer editor | 2 | FR-APP-015 — **no clock-time framing, device has no RTC** |
| Settings / profile | 2 | Language, dealer contact, sign out |
| Fleet list + filters | 3 | FR-APP-033 |
| Commissioning flow | 3 | FR-APP-030/031/034 |
| BLE commissioning | 3 | FR-APP-032 |
| Partner Console | 4 | §6 |

---

## 5. Backend: what exists, what's missing

Nearly everything is already built and live-verified — the payoff of
having built the web portal against the same API first.

✅ Auth (`/api/auth/send-otp`, `verify-otp`, `refresh`, `logout`), MFA
(`/api/auth/mfa/*`), pumps (`GET /api/pumps`, scoped by
`hierarchy_path` — no phone-number lookup needed), telemetry
(`/api/pumps/:id/telemetry`), live push (`/ws` — same `pump_update` /
`fault` / `config_update` / `alert` / `alert_digest` contract the web
portal already consumes), control (`POST /api/pumps/:id/command`,
server-enforced 45s cooldown returning `remainingSec`), faults, alerts
+ ack/assign/resolve, fleet dashboard, hierarchy, bulk allocation,
config templates, service reports, factory/IMEI claim.

❌ **Two gaps, both already flagged in `Backend_Pending_Items.md`:**

1. **API versioning** — routes are `/api/…`, not `/api/v1/…`
   (FR-CLD-040). **Do this before Phase 0**, not during: it's a
   route-mount change plus a deprecated alias, well under a day, and
   the cost only rises once a shipped app is pinned to paths.
2. **No FCM push sender.** `notificationService.js` has real
   SMS/WhatsApp; nothing sends push. This is the direct continuation of
   this session's own decision to defer real push to Android. Needs:
   a device-token registration endpoint, an `alertEngine.js` delivery
   path that sends via FCM when the recipient isn't WS-connected, and
   Android-side registration + deep-link handling. Scheduled in Phase 2.

---

## 6. Phased plan

### Phase D — Design system + screen specs (~1 week, overlaps Phase 0)
M3 dark theme wired to the shared seed-palette generator; semantic
phase-colour tokens; the reusable pieces §3 depends on — `CommandBar`
state machine, phase cell with safe-band encoding, hero status block,
status chips, fault sheet. High-fidelity specs for the Pump screen at
360dp and 411dp widths. Deliverable: a Compose preview catalogue,
reviewable before feature work commits to it.

### Phase 0 — Architecture reset (~2.5 weeks)
Backend: API versioning first (§5). App: Retrofit client on `/api/v1`
mirroring `web/src/api/client.ts` (access token in memory, refresh
token in `EncryptedSharedPreferences` per FR-APP-002, refresh-and-retry
on 401); WebSocket client replacing `IotMqttClient`; `CommandDispatcher`;
MFA-verify step; restore `startDestination = "login"` behind a session
gate (fixes B-10); delete the AWS/Cognito/Firebase-auth stack (archive
`android/aws-setup/*` to `docs/superseded/`, don't discard).
**Exit:** a session survives restart, refreshes silently, and a `/ws`
`pump_update` reaches a placeholder screen.

### Phase 1 — End-user core (~3 weeks)
Login (+MFA), Pump screen exactly per §3.3, Command Bar per §3.4, fault
sheet per §3.5, pump switcher/pager. Fixes B-1 through B-9 as part of
the build, not as follow-up. Full `stringResource()` coverage across all
6 locales.
**Exit:** a farmer signs in, sees their real pump live, starts/stops it
with correct server-driven cooldown, and reads a real fault in plain
language — with no fabricated value anywhere and no scrolling to reach
the control on a 360×640 screen.

### Phase 2 — Alerts, push, history, settings (~2.5 weeks)
Backend FCM sender + token endpoint (§5). App: alerts inbox wired to
`/api/alerts` (fixes B-11), FCM registration, push → deep link
(FR-APP-016), history (FR-APP-017), cyclic timer editor (FR-APP-015),
settings.
**Exit:** a fault on a test pump reaches a backgrounded phone as a real
push within 30s and deep-links to that device — verified live end to
end, same rigour used on the web alert engine.

### Phase 3 — Technician / commissioning (~3.5 weeks)
FR-APP-030…035: scan → verify ownership → site + GPS → motor rating →
apply config template → self-test (phase presence, sequence, CT sanity,
connectivity) → pass/fail report → handover by phone. BLE local
commissioning for no-signal sites. Offline action queue reconciled on
reconnect with conflicts surfaced. Fleet list with filters. Install
photos.
**Exit:** AC-13 — commissioning end to end in ≤5 min on a mid-range
phone over 3G-class connectivity, and the same flow works with cellular
off, via BLE.

### Phase 4 — Partner Console (~3.5 weeks) — *new, per §0.4*
Beyond the SRS's three items, all on endpoints already live: fleet
dashboard; hierarchy view + allocate-by-scan (FR-APP-041 folded in);
alert inbox with ack/assign/resolve; **config templates apply-to-many**
(likely the highest-value screen for a dealer standing in front of
several devices); service reports (fault frequency / MTBF / runtime /
uptime). RMA approve/reject (FR-APP-042) is the one item needing a
small new endpoint, mirroring the existing warranty/bridge-swap
pattern.
**Exit:** a dealer runs their day — fleet health, reassign a device,
push a template to three pumps, clear a service backlog — without
opening the web portal.

### Phase 5 — i18n expansion (~0.75 week engineering; content parallel)
Generalise the string pattern so B-9 can't recur; add the
completeness gate the web portal already uses (never offer a
half-translated locale). Translation content is a procurement track,
non-blocking, sequenced Hindi/Marathi/Telugu/Kannada/Tamil/Gujarati
first per `Web_App_Pending_Items.md` §4.1.

### Phase 6 — Hardening (~2.5 weeks)
Accessibility pass (NFR-U-001…4). Offline degraded mode app-wide
(FR-APP-005). Performance against NFR-P-005 (cold start ≤3s, home
≤2s post-auth) **on a real low-end device, not an emulator**. Test
suite from zero — unit tests for the Command Bar state machine, the
cooldown, and the offline-queue reconciliation (the three places a
silent bug is genuinely dangerous), plus a smoke instrumented test for
auth→pump→control.

---

## 7. Requirements coverage (SRS §9)

FR-APP-001 Phase 6 · 002 Phase 0 · 003 Phase 1/5 · 004 Phase 1 (§3.2
role-adaptive shell) · 005 Phase 6 · 010–012 Phase 1 · 013/014 Phase 1
· 015 Phase 2 · 016 Phase 2 · 017 Phase 2 · 018 Phase 1 · 019 Phase 1 ·
030/031 Phase 3 · 032 Phase 3 · 033 Phase 3 · 034 Phase 3 · 035 Phase 3
· 040–042 Phase 4. NFR-P-005 and NFR-U-001…4 Phase 6; AC-06 Phase 1
(§3.4); AC-13 Phase 3.

**FR-APP-003 needs a formal amendment** — it says "English and Hindi at
launch"; the app already ships six (en/hi/kn/mr/ta/te). Six is the
floor, not the target. `Reconciliation_Report.md` §9 already proposes
this; this plan assumes it.

---

## 8. Effort

| Phase | Weeks |
|---|---|
| D — Design system + specs *(overlaps Phase 0)* | 1 |
| 0 — Architecture reset | 2.5 |
| 1 — End-user core | 3 |
| 2 — Alerts, push, history, settings | 2.5 |
| 3 — Technician / commissioning | 3.5 |
| 4 — Partner Console *(new)* | 3.5 |
| 5 — i18n engineering | 0.75 |
| 6 — Hardening + tests | 2.5 |
| **Total effort** | **~19.25 person-weeks** |
| **Calendar, with D overlapping 0** | **~18.25 weeks** |

**Higher than `Development_Plan_FINAL.md`'s 11 weeks — deliberately,
and that document predicted it**: §10 there warned *"a source-verified
pass on the Android app may find the Cognito migration (D-2) costs more
than the 2 weeks allowed."* It does. Three concrete reasons: (1) the
migration is a rebuild of the networking/auth/realtime layer, not an
endpoint swap; (2) eleven verified defects (§1) need fixing inside the
rebuild; (3) Phase 4 is new scope from §0.4 and was never in the 11
weeks.

**Levers if the number needs to come down:** Phase 4 back to the SRS's
three items saves ~2.5 weeks. Deferring BLE commissioning (FR-APP-032)
to a later release saves ~2. Neither touches the end-user experience,
which is the point of the app.

---

## 9. Decisions

| # | Decision | Recommendation |
|---|---|---|
| **A-1** | Partner Console scope | **Deferred, not now** (product owner, 18 Aug 2026) — "implement plan, keep Partner Console for later development." Phase 4 stays specced here for when that changes, but implementation started 18 Aug 2026 explicitly excludes it. |
| **A-2** | Visual language | **M3 dark-first, mockup's information architecture, not its CSS** (§2, §3.6). Keeps the good parts; drops the thin type and glow that fail in sunlight on a low-end phone. |
| **A-3** | Control placement | **Pinned command bar outside the scroll container** (§3.3/§3.4). Structurally cannot go off-screen — the direct fix for the reported problem. |
| **A-4** | Multi-pump navigation | **Swipe + top-bar switcher**, list only above 5 pumps. Zero taps to switch in the common case. |
| **A-5** | Push timing | **Phase 2, not later.** It's the deferred half of this session's alert-engine decision, and field technicians are the primary audience. |
| **A-6** | D-1 (Device Shadow, Stream 3) | No action now — `CommandDispatcher` is built to absorb it later without an app-wide change. |
| **A-7** | Legacy AWS code | **Archive** to `docs/superseded/`, don't delete — same treatment as `android-app-design.md`. |

---

## 10. Out of scope

Firmware/bridge changes (Streams 3–4) · OTA delivery (blocked on
Stream 4, same as FR-WEB-015) · SMS/email as app-triggered channels
(still the deferred paid tier; FCM push is the one channel added here) ·
the remaining locales toward F-2's 20-locale target (content track,
non-blocking).
