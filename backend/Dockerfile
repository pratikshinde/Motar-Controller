# Multi-stage production Dockerfile for AgriPump Backend (FastAPI)
# Target: Production AWS ECS Fargate / ECR (P1.9 / P6.1)

FROM python:3.12-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Final runtime image
FROM python:3.12-slim AS runtime

WORKDIR /app

# Install runtime libpq
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create unprivileged application user
RUN groupadd -g 1001 agripump && \
    useradd -u 1001 -g agripump -s /bin/bash -m agripump

# Copy installed Python packages from builder
COPY --from=builder /root/.local /home/agripump/.local
ENV PATH=/home/agripump/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Copy application source and migrations
COPY --chown=agripump:agripump alembic.ini .
COPY --chown=agripump:agripump alembic/ alembic/
COPY --chown=agripump:agripump app/ app/
# Operator scripts that run on the server (create the admin accounts, and so on): docker compose exec api python scripts/create_portal_accounts.py ...
COPY --chown=agripump:agripump scripts/ scripts/

USER agripump

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5000/api/v1/system/health || exit 1

# --proxy-headers: the API sits behind the web container (Caddy). Without it every visitor looks like Caddy's address, and the per-address rate limit
# on sign-in would be shared by all farmers. The API port is never published, so only the web container can reach it and the forwarded address can be trusted.
# The same image also runs the workers: `python -m app.workers.ingest` (readings from AWS) and `python -m app.workers.jobs` (nightly jobs).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "4", "--proxy-headers", "--forwarded-allow-ips", "*"]
