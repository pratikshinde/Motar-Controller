# Deploying the pump platform

One server runs five containers from `docker-compose.yml`:

| Container | What it does |
|---|---|
| `db` | PostgreSQL (skip it and use AWS RDS if you prefer: see `env.example`) |
| `migrate` | Builds / upgrades the database tables, then exits |
| `api` | The backend: website, phone app and factory station all talk to it |
| `ingest` | Reads pump readings from the AWS queue (SQS) and saves them |
| `jobs` | Nightly work: reports, schedules, offline checks |
| `web` | The website, with automatic HTTPS (Caddy), forwarding `/api` and `/ws` to the backend |

## What you deploy, in order

1. **A server** (Ubuntu, 2 vCPU / 4 GB is enough for a pilot) with Docker and a public IP.
2. **A domain** pointing at it (for example `app.yourcompany.com`); ports 80 and 443 open.
3. **Secrets**: copy `deploy/env.example` to `.env`, fill it in (`JWT_SECRET`, passwords, `PROVISIONING_HOOK_SECRET`, `SITE_ADDRESS`, `CORS_ORIGINS`). Put the Firebase service-account file in `./secrets/`.
4. **AWS access for the server**: attach an IAM role using `aws/policies/backend-iam-policy.json` (no access keys on the server). Fill `IOT_DATA_ENDPOINT` and `SQS_INGEST_URL`.
5. **Start it**: `docker compose --profile db up -d --build` (without `--profile db` when using RDS).
6. **Email for the codes**: the super admin signs in with a code emailed to them, and an admin gets a code the first time (and if they forget their password) to confirm their email and choose a password. Quickest: `EMAIL_BACKEND=smtp` with a Gmail address and a Google app password (see `deploy/env.example`). Proper for a company: Amazon SES, as follows. In the AWS console open **Amazon SES** (region ap-south-1), verify the sender address you put in `EMAIL_FROM`, and ask AWS for production access (until then SES only sends to addresses you have verified too). The server's IAM role needs `ses:SendEmail`.
7. **First accounts**: `docker compose exec api python scripts/create_portal_accounts.py --role superadmin --name "..." --email owner@company.com`, and the same with `--role ajanta-admin` for the Ajanta admin. No password is asked: the super admin signs in with the emailed code and then sets up the authenticator app; the admin opens the website, chooses Login > Admin > "First time here", confirms the code and chooses their own password.
8. **Point AWS at it**: run `backend/scripts/deploy_claim_provisioning.py --update` with the real `https://` address so the provisioning function reaches `/api/v1/batches/provisioning/pre-hook`.
9. **Phone app**: build the production APK with the real API address (`EXPO_PUBLIC_API_URL`) and give it to the farmers' phones.

## Checks after it starts

- `https://your-domain/api/v1/system/health` answers `{"status":"OK"}`
- The website opens and the admin can sign in
- `docker compose ps`: `api` is healthy, `migrate` has exited with code 0, `ingest` is **running** (it keeps restarting if `SQS_INGEST_URL` is empty)
- Power one starter on the bench: it appears on the Factory Station page as "Has its own AWS certificate", then "Reporting to the cloud"

## A lost email or authenticator
Admins and the super admin have no password to forget: the code is emailed. If the super admin lost the authenticator app, whoever runs the server removes it
so it is set up again at the next sign-in:

```bash
docker compose exec api python scripts/reset_portal_password.py --email owner@company.com --reset-authenticator
```

(The same script can still set a password for an account that has one.)

A distributor or a dealer who forgot theirs does not need this: the person above them clicks **New QR** on their card.

## Upgrades

```bash
git pull
docker compose --profile db up -d --build
```

`migrate` runs first and brings the tables up to date; the API starts only after it succeeds.

## Backups

Back up the `db_data` volume (or turn on RDS automated backups) and the `.env` file. Certificates in `caddy_data` can be re-issued.
