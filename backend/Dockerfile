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

USER agripump

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5000/api/v1/system/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "4"]
