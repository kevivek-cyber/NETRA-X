# NETRA-X — single-service image.
#
# One container serves both halves: the Next.js console is exported to static
# files by the node stage, and FastAPI serves those alongside the API (see the
# static mount at the bottom of apps/api/main.py). The browser then calls
# /api/v1/... on its own origin, so there is no CORS to configure and no API
# URL to bake in at build time.
#
# Docker rather than Render's native Python runtime, because the build needs
# both toolchains: `pip install` for the backend and `npm` for the frontend
# export. A native Python service is not guaranteed to have Node on PATH, and
# that failure would only show up as a broken deploy.

# ---------------------------------------------------------------------------
# Stage 1 — build the frontend
# ---------------------------------------------------------------------------
FROM node:20-slim AS web

WORKDIR /build

# Manifests first: this layer is cached unless the dependencies themselves
# change, so editing a component does not reinstall node_modules.
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web/ ./

# NETRA_DESKTOP_BUILD switches next.config.js to `output: 'export'`, which
# emits a fully static ./out with no Node server required at runtime. The name
# is historical -- it was added for the desktop build -- but the artifact is
# exactly what the API needs to serve.
ENV NETRA_DESKTOP_BUILD=1
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — the API, plus the exported console
# ---------------------------------------------------------------------------
FROM python:3.11-slim

WORKDIR /app

# build-essential and libpq-dev are needed to compile the C extensions behind
# psycopg2 and parts of the scientific stack; they stay in this layer and the
# apt lists are removed to keep the image smaller.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Dependency metadata before source, so a code change does not trigger a full
# reinstall of the scientific stack, which dominates build time.
COPY pyproject.toml README.md ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY workers ./workers
COPY seed ./seed
# bench/ is listed in pyproject's package discovery; copied so `pip install -e .`
# sees the same layout the project declares.
COPY bench ./bench

RUN pip install --upgrade pip && pip install --no-cache-dir -e .

# The exported console. main.py resolves this as <repo>/apps/web/out, so the
# path has to match that layout rather than being flattened.
COPY --from=web /build/out ./apps/web/out

ENV PYTHONPATH=/app
ENV PORT=8000
EXPOSE 8000

# Render supplies $PORT; the default keeps `docker run` working locally.
CMD ["sh", "-c", "uvicorn apps.api.main:app --host 0.0.0.0 --port ${PORT}"]
