# Spine Editor backend — built for Hugging Face Docker Spaces (port 7860,
# runs as uid 1000) but works on any Docker host:
#   docker build -t spine-server . && docker run -p 7860:7860 spine-server
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

RUN useradd -m -u 1000 user
WORKDIR /app

COPY --chown=user pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY --chown=user app ./app

# Writable data dir for SQLite/secret file. On HF Spaces this is EPHEMERAL —
# set SPINE_SERVER_SECRET and SPINE_SERVER_DATABASE_URL (external Postgres)
# in the Space settings so accounts survive restarts.
RUN mkdir -p /data && chown user /data
ENV PATH="/app/.venv/bin:$PATH" \
    SPINE_SERVER_DATA_DIR=/data

USER user
EXPOSE 7860
# --proxy-headers: trust X-Forwarded-* from the platform proxy so the auth
# rate limiter sees real client IPs instead of the proxy's.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers", "--forwarded-allow-ips", "*"]
