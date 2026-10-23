# Manufacturers on one server

One server and one web portal serve many pump manufacturers (Ajanta, Swati, ...). Each manufacturer has its own
farmers' mobile app and its own dashboard. Nothing of one manufacturer is ever shown to another.

```
Super admin (platform owner)          the web portal: "Manufacturers" page, can open any manufacturer's dashboard
 ├─ Manufacturer: Ajanta              its own web login and dashboard; its own farmers' app "Ajanta Pump Controller"
 │   └─ distributors → dealers → farmers → pumps
 └─ Manufacturer: Swati               its own web login and dashboard; its own farmers' app "Swati Pump Controller"
     └─ distributors → dealers → farmers → pumps
```

The farmer is the lowest level. The app has no control over the website: a farmer switches their pump on and off, sees the
pump's status, usage history and problems, in their language, and nothing else.

## Who sees what

| Who | Where | Sees |
|---|---|---|
| Super admin | web portal | The **Manufacturers** page (every manufacturer with its farmers, pumps, faults, offline, open alerts). Opening a manufacturer shows that manufacturer's dashboard exactly as the manufacturer sees it, **read-only**. Also the platform-only screens (factory console, system health, support console). |
| Manufacturer | web portal | Only its own tree: its distributors, dealers, farmers and pumps; its dashboard, alerts, fault logs, devices, map, audit log. |
| Distributor / dealer | web portal | Only their own part of the manufacturer's tree. |
| Farmer | the manufacturer's mobile app | Their own pumps **of that manufacturer's brand**: on/off, status, history, problems. |

## How the wall between manufacturers is built

1. **Database row-level security** limits every query to the caller's own tree (hierarchy path / organisation). A
   manufacturer cannot read another manufacturer's rows even if a route forgot to filter.
2. **Brand** (`X-App-Brand`, sent by each manufacturer's app): the app lists only pumps of its brand. A farmer who owns
   pumps of two manufacturers sees each manufacturer's pumps in that manufacturer's app only.
3. **Sign-in**: a manufacturer's distributors/dealers cannot sign in to another manufacturer's app (`WRONG_BRAND_APP`).
   Farmers and the super admin may sign in to any brand's app.
4. **Switching a manufacturer's app off** (`Manufacturers` page → *Switch app off*, or `PUT /brands/<key>` with
   `{"status":"SUSPENDED"}`) stops that app for everyone at once (`BRAND_DISABLED`); other manufacturers are unaffected.
5. **Super admin looking at a manufacturer** sends `X-View-Manufacturer: <key>`; the server then answers as that
   manufacturer's own account (`brands.owner_user_id`). It is read-only (writes get `VIEW_ONLY`), only the super admin can
   use it (for everyone else the header is ignored), and the live-update socket is scoped the same way (`/ws?view=<key>`).

`backend/tests/test_brands.py` (class `TestManufacturerPortals`) proves the wall in both directions across ~20 endpoints.

## Add a manufacturer

**Web portal → Manufacturers → Add manufacturer.** Fill in:

- the manufacturer (name, short key, brand colour, support phone/email). The key is what its app sends; it cannot be changed;
- the manufacturer's own login (name, mobile number verified with a WhatsApp code, password).

This creates the brand and the manufacturer's account in one go; the first manufacturer account of a brand becomes its
owner (`brands.owner_user_id`), and its tree is the manufacturer's dashboard. From then on the manufacturer creates its own
distributors, dealers and farmers from the web portal.

By API: `POST /api/v1/brands` then `POST /api/v1/users` with `role: "manufacturer"` and `brand: "<key>"` (a manufacturer
account must name its brand). To point a brand at a different owner: `PUT /api/v1/brands/<key>` with `owner_user_id`.

Then, for the farmers' app:

1. Create the app's brand folder and build it. See `mobile/brands/README.md` (`npm run brand:new -- <key>`, logo, colours,
   `eas build --profile <key>-production`). The **store identity (Android package, iOS bundle id) can never change after
   publishing**, so confirm it with the manufacturer first.
2. Put the manufacturer's secrets in the server environment, never in the database or the app:

   | Variable | Used for |
   |---|---|
   | `BRAND_<KEY>_WHATSAPP_API_TOKEN` | WhatsApp Cloud API token for that manufacturer's OTP sender |
   | `BRAND_<KEY>_TWILIO_ACCOUNT_SID`, `..._TWILIO_AUTH_TOKEN`, `..._TWILIO_PHONE_NUMBER` | Twilio SMS |
   | `BRAND_<KEY>_FAST2SMS_API_KEY`, `..._MSG91_AUTH_KEY` | other SMS providers |

   `<KEY>` is the brand key in capitals with dashes as underscores (`swati` → `BRAND_SWATI_...`). Non-secret identifiers
   (WhatsApp phone id, template, language, SMS sender id, MSG91 flow id) are fields of the brand (`PUT /brands/<key>`).
   Anything not set falls back to the platform's own setting, so a new manufacturer works on day one.
3. Factory batches and imported devices are filed under a brand (`brand` on batch/pump creation; a partner's devices are
   their own brand's). The super admin names the brand when creating devices for a manufacturer.

## Checklist after adding a manufacturer

- `GET /api/v1/app/config` with `X-App-Brand: <key>` returns its name, colour and support contact.
- Manufacturers page shows it with its login; *Open dashboard* shows an empty dashboard, not another manufacturer's.
- Sign in to its web login: only its own tree, no *Manufacturers* page.
- A farmer created by one of its dealers sees only its pumps in its app.
- `python -m pytest backend/tests/test_brands.py` is green.

## Known limits

- **Not yet built**: per-manufacturer web addresses (everyone uses the same portal URL and signs in); push notifications
  per app; the mobile app does not yet read `GET /app/config` (support number, minimum version, switch-off message).
- Live events for a **farmer's** socket are not filtered by brand (the farmer's own pumps only); the apps list by brand.
- A farmer account is one phone number. A farmer who buys from two manufacturers uses the same login in both apps.
- Devices created by the super admin without naming a brand fall back to the default brand (`DEFAULT_BRAND_KEY`); name the
  brand (`brand` field) when creating devices on a manufacturer's behalf.
- Placeholders to replace with the manufacturer's real data before store submission (Swati today): logo and colours
  (`mobile/brands/swati/brand.json`), Android package `com.swati.pumpcontroller`, support contacts, WhatsApp/SMS sender.
