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

## Deploy as a Hugging Face Space (free)

1. Create a Space (SDK: **Docker**, blank template). The Space serves this
   directory as its repo root — `Dockerfile` and this README (with the YAML
   header) are already in place.
2. Push the contents of `server/` to the Space, either manually:

   ```bash
   git subtree split --prefix server -b hf-space
   git push https://huggingface.co/spaces/<user>/<space> hf-space:main --force
   ```

   or automatically on every push to `main` via
   `.github/workflows/deploy-space.yml` (set the `HF_TOKEN` secret and the
   `HF_SPACE` variable, e.g. `user/spine-editor-server`, in the GitHub repo).
3. In the Space **Settings → Variables and secrets** set at least:
   `SPINE_SERVER_SECRET` (secret, long random string),
   `SPINE_SERVER_DATABASE_URL` (secret, external Postgres — the Space disk is
   ephemeral), `SPINE_SERVER_CORS_ORIGINS`, `SPINE_SERVER_FRONTEND_URL`
   (your GitHub Pages URL) and `SPINE_SERVER_COOKIE_SAMESITE=none`.
4. Point the editor's Server URL at `https://<user>-<space>.hf.space`.
