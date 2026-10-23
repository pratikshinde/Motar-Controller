# Brands (one app per manufacturer, one codebase)

Each manufacturer that sells controllers gets its own app in the store. They are all built from this one codebase and
talk to the one server. A folder here is one manufacturer's app:

```
brands/
  load.js              reads and validates a brand (used by app.config.js and the scripts)
  ajanta/
    brand.json         name, colours, store identity
    icon.png           (optional) 1024x1024 app icon
    adaptive-fg.png    (optional) Android adaptive-icon foreground, 1024x1024, transparent
    splash.png         (optional) splash image
```

## brand.json

| Field | What it is |
|---|---|
| `key` | Short machine name; equals the folder name. Sent to the server on every request as `X-App-Brand`. |
| `appName` | The product name users see: the store title, the home-screen label, "Registration successful - you can now use *appName*". |
| `shortName`, `titleLine1`, `titleLine2` | The marks in the sign-in header and on the splash screen. |
| `colors` | Overrides for the design tokens in `src/shared/theme` (`primary`, `primaryDark`, `primarySoft`, ...), `#RRGGBB`. Leave `{}` to use the base palette. |
| `build.slug`, `build.scheme` | Expo project slug and the deep-link scheme (`<scheme>://pump/<id>`). |
| `build.androidPackage`, `build.iosBundleId` | The store identity. **Never change it after the app is published**: the store treats a new id as a different app. |
| `build.easProjectId` | The Expo (EAS) project id of this app, once `eas init` has created it. |
| `build.icon`, `adaptiveIconForeground`, `adaptiveIconBackground`, `splashImage` | Image files in this folder (or a colour for the background). `null` = Expo's default. |

Only the part above `build` is shipped inside the app; `build` is read by the build tooling alone.

## Add a manufacturer

1. `npm run brand:new -- swati "Swati Pump Controller" com.swati.pump`
2. Fill in `brands/swati/brand.json` (colours) and add the image files.
3. `npm run a11y:contrast` - it audits every brand's palette against WCAG AA; fix any pair it rejects.
4. Try it: `BRAND=swati npx expo start --web --clear` (PowerShell: `$env:BRAND="swati"; npx expo start --web --clear`).
   `--clear` matters whenever you switch brand: Metro caches the brand it saw first.
5. On the server, create the manufacturer and its brand record (so the app's `X-App-Brand: swati` maps to it).
6. Store build: `eas init` once for the new app, put the project id in `build.easProjectId`, then
   `eas build --profile swati-production --platform android`.

If the manufacturer wants something small to behave differently, add a setting that the server returns for that brand
(`GET /app/config`) rather than copying code; the apps must stay one codebase.
