# Frontend architecture decision

**Superseded 17 August 2026.** The decision below (also 17 Aug, earlier the
same day) chose the inline-script `index.html` as canonical. A Material
Design requirement added later that day reverses it — see "Reversal" below.
The original reasoning is kept intact underneath because it was correct at
the time and explains why the switch wasn't made casually.

---

## Reversal — 17 August 2026 (later same day)

**New decision: `web/src/` (Vite/React/TypeScript + MUI) is now canonical.**
`index.html` is a thin Vite entry point (`<div id="root">` +
`<script type="module" src="/src/main.tsx">`) and carries no application
logic of its own.

**Why the original reasoning stopped applying.** The case for `index.html`
was that it held the working integration and splitting effort across two
half-built frontends is worse than finishing one. That holds only while the
presentation layer is being *kept*. The product owner's requirement —
"modern, polished, responsive, strict compliance with Material Design
guidelines" — rewrites the presentation layer regardless of which file it
lives in. Once that was true, the thing that favoured `index.html` (its
markup) became the thing being replaced, and what actually carried forward
was the *API contract knowledge* the original file documented: the auth
flow, `apiFetch` with refresh-token retry, command dispatch with
server-enforced cooldown, the hierarchy-tree and fault-log renderers. All of
that is now ported into `web/src/api/` and `web/src/views/` — behaviour
preserved, transport and markup rebuilt. Full rationale in
`../docs/Web_App_Pending_Items.md` §8.2 and §11.

**What changed concretely:**

- `web/src/theme/` — an M3-derived theme (color roles incl. container
  pairs, type scale, shape scale, tonal elevation), light and dark from one
  seed. The three decorative presets (Sapphire Dark / Agro Clean Light /
  Cyber Neon) are gone; Cyber Neon specifically could not meet M3 contrast.
- `web/src/api/` — the ported, typed API layer (`client.ts` carries the
  refresh-retry logic verbatim from the old `apiFetch`).
- `web/src/views/` + `web/src/components/` — the five tabs rebuilt as
  MUI components: Telemetry (pump cards bound to real per-phase
  V/I via the W0 backend join, no fabricated fallbacks), Devices (MUI
  `DataGrid` — pagination/sort/filter/CSV export come from the grid, not
  hand-built), Hierarchy, Fault Logs, Map (Leaflet, unchanged library).
- The client-side fault injector (`simulateFault`/`resetFaults`) was not
  ported — a fake fault button in a protection product's console was a W0
  finding, not a feature.
- i18n now ships only locales with a complete dictionary (en, hi) rather
  than offering 9 options backed by 4 partial dictionaries. Structurally
  ready for the full Eighth-Schedule target; see
  `../docs/Web_App_Pending_Items.md` §4.1 for the locale-by-locale plan.

**What this doesn't cover yet**, so it isn't mistaken for done: the 7-tab
device detail view, WebSocket live updates (FR-WEB-005 — the dashboard
currently polls), TOTP MFA, the superadmin/partner portal sections, and
alerts. These are `Web_App_Pending_Items.md` W3 onward.

---

## Original decision (17 August 2026, morning) — kept for context

**Decision:** `index.html` is the canonical frontend. The Vite/React/TypeScript
scaffold under `src/` is legacy and not in active use.

### Why

Two frontends existed side by side with no build wiring between them:

- `web/index.html` — a self-contained ~1,400-line page with inline JS. This
  is the one that actually talks to the backend: auth, pump CRUD, command
  dispatch, fault logs, hierarchy tree. It's what runs when you start
  `backend/server.js` and open `http://localhost:5000`.
- `web/src/App.tsx` + `main.tsx` + `types/` + `i18n/` — a Vite/React/TS
  scaffold. `index.html` has no `<div id="root">` and no `<script
  type="module" src="/src/main.tsx">`, so this code path is never mounted by
  anything. `App.tsx` was a 97-line static shell duplicating `index.html`'s
  tab structure with hard-coded demo values and no API calls at all.

Eight weeks of Stream 1C/1D portal work (`Development_Plan_FINAL.md`) should
not be split across an undecided stack. `index.html` is the one with a real,
tested backend integration as of this pass (auth with token refresh, scoped
pump list, command dispatch with server-enforced cooldown, fault log
read-back, hierarchy tree) — see `../docs/Web_App_Pending_Items.md` for what
still doesn't exist yet even on the canonical path.

### What this meant at the time

- Keep building on `index.html`. Its inline-script structure is not
  pretty, but it is the one with working auth, real API calls, and the
  fixes applied in this pass (SEC-1/SEC-2/SEC-3, command dispatch, real
  fault/hierarchy data). Splitting it into modules/components later is a
  refactor of a working thing, which is a much safer position than finishing
  two half-built things at once.
- The `src/` scaffold, `tsconfig.json`, and `vite.config.ts` are left in
  place rather than deleted — deleting code on someone else's machine
  without being asked felt like the wrong call, and there may be design
  intent in `App.tsx`/`i18n/index.ts` worth salvaging later (its 23-language
  list, for instance, is more complete than what shipped in `index.html`'s
  own translation object before this pass touched it). But nothing should
  be added to `src/` under the assumption it's live — it isn't served by
  anything.
- If a real component-based rewrite happens later, `index.html`'s inline
  JS (auth flow, `apiFetch` with refresh-token retry, command dispatch,
  hierarchy tree renderer, fault log renderer — all added/hardened in this
  pass) is the reference implementation for what the API contract actually
  is. Port from there, not from `App.tsx`.

(The "if you disagree" section that followed asked exactly the question the
Material Design requirement answered a few hours later.)
