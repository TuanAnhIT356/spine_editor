"""Server configuration from environment variables (SPINE_SERVER_* prefix)."""

import os
import secrets
from pathlib import Path


def _data_dir() -> Path:
    default = Path(__file__).resolve().parent.parent / "data"
    d = Path(os.environ.get("SPINE_SERVER_DATA_DIR", default))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _secret(data_dir: Path) -> str:
    """Signing/encryption secret: env var wins; otherwise generated once and kept on disk."""
    env = os.environ.get("SPINE_SERVER_SECRET")
    if env:
        return env
    f = data_dir / "secret.key"
    if f.exists():
        return f.read_text().strip()
    value = secrets.token_urlsafe(48)
    f.write_text(value)
    f.chmod(0o600)
    return value


class Config:
    def __init__(self) -> None:
        self.data_dir = _data_dir()
        self.secret = _secret(self.data_dir)
        self.database_url = os.environ.get(
            "SPINE_SERVER_DATABASE_URL", f"sqlite:///{self.data_dir / 'app.db'}"
        )
        self.cors_origins = os.environ.get(
            "SPINE_SERVER_CORS_ORIGINS", "http://localhost:5173,http://localhost:4173"
        ).split(",")
        self.access_token_minutes = int(os.environ.get("SPINE_SERVER_ACCESS_MINUTES", "15"))
        self.refresh_token_days = int(os.environ.get("SPINE_SERVER_REFRESH_DAYS", "30"))
        self.reset_token_minutes = int(os.environ.get("SPINE_SERVER_RESET_MINUTES", "30"))
        # SMTP for password-reset mail; without a host, mails are logged (dev mode).
        self.smtp_host = os.environ.get("SPINE_SERVER_SMTP_HOST", "")
        self.smtp_port = int(os.environ.get("SPINE_SERVER_SMTP_PORT", "587"))
        self.smtp_user = os.environ.get("SPINE_SERVER_SMTP_USER", "")
        self.smtp_password = os.environ.get("SPINE_SERVER_SMTP_PASSWORD", "")
        self.mail_from = os.environ.get("SPINE_SERVER_MAIL_FROM", "spine-editor@localhost")
        self.frontend_url = os.environ.get("SPINE_SERVER_FRONTEND_URL", "http://localhost:5173")
        # "lax" works when frontend and API share a site (localhost dev). When the
        # frontend lives on another origin (e.g. GitHub Pages → Hugging Face Space),
        # set SPINE_SERVER_COOKIE_SAMESITE=none so browsers send the refresh cookie
        # on cross-site fetches; "none" requires Secure, so HTTPS on the API host.
        self.cookie_samesite = os.environ.get("SPINE_SERVER_COOKIE_SAMESITE", "lax").lower()
        self.cookie_secure = self.cookie_samesite == "none" or self.frontend_url.startswith(
            "https://"
        )


config = Config()
