# Dockerfile for NETRA-X FastAPI Backend Service
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies needed for C extension builds (psycopg2, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy project specification files
COPY pyproject.toml README.md ./
COPY packages ./packages
COPY apps ./apps
COPY workers ./workers
COPY seed ./seed
COPY bench ./bench

# Install Python packages and editable NETRA-X project
RUN pip install --upgrade pip && pip install --no-cache-dir -e .

# Environment variables
ENV PYTHONPATH=/app
ENV PORT=8000
EXPOSE 8000

# Run FastAPI backend with Uvicorn
CMD ["sh", "-c", "uvicorn apps.api.main:app --host 0.0.0.0 --port ${PORT}"]
