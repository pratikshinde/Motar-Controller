#!/bin/sh
# Runs once, the first time the bundled PostgreSQL container starts. The app must NOT connect as a superuser: PostgreSQL superusers skip row-level
# security, which is what keeps one farmer's data from another's. So the app gets its own plain role that owns its own database.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE agripump LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
CREATE DATABASE agripump OWNER agripump;
SQL
