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
6. **First admin**: `docker compose exec -e PORTAL_PASSWORD='...' api python scripts/create_portal_accounts.py --role ajanta-admin --name "..." --email you@company.com`
7. **Point AWS at it**: run `backend/scripts/deploy_claim_provisioning.py --update` with the real `https://` address so the provisioning function reaches `/api/v1/batches/provisioning/pre-hook`.
8. **Phone app**: build the production APK with the real API address (`EXPO_PUBLIC_API_URL`) and give it to the farmers' phones.

## Checks after it starts

- `https://your-domain/api/v1/system/health` answers `{"status":"OK"}`
- The website opens and the admin can sign in
- `docker compose ps`: `api` is healthy, `migrate` has exited with code 0, `ingest` is **running** (it keeps restarting if `SQS_INGEST_URL` is empty)
- Power one starter on the bench: it appears on the Factory Station page as "Has its own AWS certificate", then "Reporting to the cloud"

## A forgotten password
Admins and the super admin sign in with an email, so there is no code to send. Whoever runs the server sets a new password (and, if they lost the
authenticator app too, removes it so they set it up again at the next sign-in):

```bash
docker compose exec api python scripts/reset_portal_password.py --email admin@ajanta.example
docker compose exec api python scripts/reset_portal_password.py --email admin@ajanta.example --reset-authenticator
```

A distributor or a dealer who forgot theirs does not need this: the person above them clicks **New QR** on their card.

## Upgrades

```bash
git pull
docker compose --profile db up -d --build
```

`migrate` runs first and brings the tables up to date; the API starts only after it succeeds.

## Backups

Back up the `db_data` volume (or turn on RDS automated backups) and the `.env` file. Certificates in `caddy_data` can be re-issued.
