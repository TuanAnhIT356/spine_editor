---
title: Spine Editor Server
emoji: 🦴
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
---

# Spine Editor Server

Opt-in Python backend for the [Spine Editor](../README.md): accounts
(register/login/logout/forgot password), per-user project storage with
thumbnails, an encrypted BYOK vault for AI provider API keys, and per-user
settings. FastAPI + SQLAlchemy; SQLite by default, any Postgres via
`SPINE_SERVER_DATABASE_URL`.

The YAML block above makes this directory deployable as-is as a
**Hugging Face Docker Space** (see "Deploy" below).

## Run locally

```bash
uv sync
uv run uvicorn app.main:app --port 8100
# tests & lint
uv run pytest
uv run ruff check .
```

Data (SQLite DB, generated secret) lands in `server/data/`. The editor
connects via the Server button in its toolbar (default `http://localhost:8100`).

## Configuration (env vars)

| Variable | Default | Notes |
| --- | --- | --- |
| `SPINE_SERVER_SECRET` | generated into `data/secret.key` | Signs JWTs and encrypts the key vault. **Set it explicitly in production** — on ephemeral hosts a regenerated secret invalidates all sessions and stored keys. |
| `SPINE_SERVER_DATABASE_URL` | `sqlite:///<data>/app.db` | Any SQLAlchemy URL; `postgres://…` from Neon/Supabase is auto-routed through psycopg. |
| `SPINE_SERVER_CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Comma-separated frontend origins, e.g. `https://<user>.github.io`. |
| `SPINE_SERVER_COOKIE_SAMESITE` | `lax` | Set `none` when the frontend is on another origin (GitHub Pages → Space). |
| `SPINE_SERVER_FRONTEND_URL` | `http://localhost:5173` | Used in reset mails and to mark cookies Secure. |
| `SPINE_SERVER_DATA_DIR` | `server/data` | Where SQLite + secret live. |
| `SPINE_SERVER_SMTP_HOST/PORT/USER/PASSWORD`, `SPINE_SERVER_MAIL_FROM` | unset | Without a host, reset mails go to `data/outbox.log` (dev mode). |

## Deploy on Render (free)

The repo root ships a `render.yaml` Blueprint: in the Render dashboard pick
**New → Blueprint**, select this repository (and branch), approve — it builds
`server/Dockerfile` as a free web service with `SPINE_SERVER_SECRET`
auto-generated. Then set the `sync: false` env vars in the service's
**Environment** tab: `SPINE_SERVER_DATABASE_URL` (external Postgres, e.g.
Neon — the free instance has no persistent disk), `SPINE_SERVER_CORS_ORIGINS`
and `SPINE_SERVER_FRONTEND_URL` (your GitHub Pages URLs). The Blueprint
already sets `SPINE_SERVER_COOKIE_SAMESITE=none` for the cross-origin cookie.
Point the editor's Server URL at `https://<service>.onrender.com`.

Free-tier note: the service spins down after ~15 idle minutes; the first
request afterwards takes up to a minute while it wakes.

## Deploy as a Hugging Face Space (requires a PRO plan since 2026)

Docker Spaces are no longer on the HF free tier, but this directory still
works as a Space repo root (this README carries the Space YAML header):
push the `server/` subtree manually or via
`.github/workflows/deploy-space.yml` (needs the `HF_TOKEN` secret and
`HF_SPACE` variable), then set the same env vars in
**Settings → Variables and secrets** — `SPINE_SERVER_SECRET` explicitly,
since Space storage is ephemeral.
