"""Password hashing, JWT access tokens, opaque refresh/reset tokens, AES-GCM
key-vault encryption, and a small in-memory rate limiter."""

import base64
import hashlib
import secrets
import time
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException, Request

from .config import config

_hasher = PasswordHasher()


def _jwt_key() -> bytes:
    """Derived signing key — always 32 bytes regardless of the configured secret."""
    return hashlib.sha256((config.secret + ":jwt").encode()).digest()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def create_access_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(UTC) + timedelta(minutes=config.access_token_minutes),
        "type": "access",
    }
    return jwt.encode(payload, _jwt_key(), algorithm="HS256")


def decode_access_token(token: str) -> int:
    """Returns the user id or raises 401."""
    try:
        payload = jwt.decode(token, _jwt_key(), algorithms=["HS256"])
        if payload.get("type") != "access":
            raise jwt.InvalidTokenError("wrong token type")
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as err:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from err


def new_opaque_token() -> tuple[str, str]:
    """Returns (token for the client, sha256 hex stored server-side)."""
    token = secrets.token_urlsafe(48)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _vault_key() -> bytes:
    return hashlib.sha256((config.secret + ":keyvault").encode()).digest()


def encrypt_secret(plaintext: str) -> str:
    nonce = secrets.token_bytes(12)
    ct = AESGCM(_vault_key()).encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt_secret(stored: str) -> str:
    raw = base64.b64decode(stored)
    return AESGCM(_vault_key()).decrypt(raw[:12], raw[12:], None).decode()


class RateLimiter:
    """Fixed-window in-memory limiter, keyed by (client ip, bucket name)."""

    def __init__(self, limit: int = 10, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[tuple[str, str], list[float]] = {}

    def check(self, request: Request, bucket: str) -> None:
        ip = request.client.host if request.client else "unknown"
        key = (ip, bucket)
        now = time.monotonic()
        hits = [t for t in self._hits.get(key, []) if now - t < self.window]
        if len(hits) >= self.limit:
            raise HTTPException(status_code=429, detail="Too many attempts, try again later")
        hits.append(now)
        self._hits[key] = hits


auth_rate_limiter = RateLimiter()
