# AgriPump farmer app (one codebase, one app per manufacturer)

The farmer's app for the AgriPump controller, built once per manufacturer (Ajanta, Swati, ...) - see
[Brands](#brands): see whether each pump is running, start and stop it, set a run
timer, read what is wrong and what to do, and call the dealer. Expo SDK 54, React Native 0.81, TypeScript, Expo Router.

## Run it

```bash
cd mobile
npm ci
npm run web        # browser preview (uses http://localhost:5000, so start the backend first)
npm start          # Expo Go / emulator (uses the live server unless EXPO_PUBLIC_API_URL is set)
```

`EXPO_PUBLIC_API_URL` (for example `https://api.example.com`) points a build at another server.
`EXPO_PUBLIC_PSEUDO_LOCALE=1` shows every string accented and stretched, which exposes untranslated or clipped text.

## Checks (all run in CI)

| Command                                 | What it guards                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run typecheck`                     | TypeScript                                                                       |
| `npm run lint` / `npm run format:check` | ESLint (zero warnings) and Prettier                                              |
| `npm run i18n:check`                    | every language has every string, with the same `{{placeholders}}`                |
| `npm run a11y:contrast`                 | WCAG AA contrast for every text/background pair in `src/shared/theme`            |
| `npm test`                              | unit and component tests (Jest, Testing Library)                                 |
| `npm run api:generate`                  | regenerates the typed API client; CI fails if `src/api/generated` is out of date |
| `npm run check`                         | all of the above except `api:generate` and `format:check`                        |

## How it is put together

- `app/` Expo Router routes only (splash, language, login, tabs, pump, manage). Deep links: `agripump://pump/<id>?tab=faults`, `agripump://alerts`.
- `src/api/` the API layer. `farmer.json` in `openapi/` is exported from the backend by
  `python backend/scripts/export_farmer_openapi.py`; `orval` turns it into TanStack Query hooks and zod schemas in
  `src/api/generated/` (never edit by hand). `http.ts` adds the token, refreshes it once for all parallel requests
  and **checks every response against the generated schema**, so a backend change the app has not caught up with
  fails loudly instead of showing a blank value.
- `src/realtime/` the WebSocket client (auth-first, one subscription per pump, backoff with jitter, heartbeat,
  pauses in the background) and the code that folds live events into the query cache.
- `src/features/` one folder per feature (pumps, pump, commands, timer, history, faults, alerts, manage, settings,
  support). Pure rules (what state a pump is in, when a command counts as done, timer limits) live in plain
  `.ts` files with tests, apart from the screens.
- `src/shared/` design tokens, UI components, i18n.
- Offline: the query cache is saved to the phone for 24 hours and shown with an offline banner; commands are never
  queued while offline (a start must not fire minutes later).

## Rules the app keeps

- **Nothing is invented.** A reading the pump did not send is a dash, never 0. A pump that has not reported for
  10 minutes is _Offline_, never _Stopped_ or _Healthy_. There is no default HP, frequency or signal.
- **Commands say exactly how far they got** (Sent, Reached the pump, Pump confirmed, Done). "Done" is shown only
  when the pump itself reports the new state. No answer in 60 s reads "Not confirmed yet", not "failed".
- **The panel resets faults, not the app.** The app shows why a fault happens and what to do; it never sends a reset.
- The pump ON/OFF power button keeps its look. `src/shared/theme` documents the colours farmers already know.

## Translations

14 languages, listed in `src/shared/i18n/languages.ts`. English is the source (`locales/en.json`). All non-English
text still needs a native-speaker review before release (planner P3.6); `confidence` in `languages.ts` says where to
look first (Konkani, Maithili and Kashmiri are the weakest).

## Building for phones

`eas.json` has `development`, `preview` (APK for field testing) and `production` profiles. Preview builds may talk to
the plain-HTTP server; a **production** build must use an HTTPS `EXPO_PUBLIC_API_URL`, because Android blocks
cleartext traffic in release builds.

## Brands

Every manufacturer that sells controllers has its own app in the store, built from this code with `BRAND=<key>`
(default `ajanta`). A brand decides the app's name, store identity, icon and colours; the manufacturer's name is never
hard-coded in a screen or a translation (`{{appName}}` / `src/config/brand.ts`). Each request carries `X-App-Brand`
so the one server answers with that manufacturer's data. How to add one: [`brands/README.md`](brands/README.md).

Build profiles are named `<brand>-preview` and `<brand>-production` (`eas build --profile ajanta-production`).
