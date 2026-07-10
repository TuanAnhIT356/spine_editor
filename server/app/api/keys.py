"""BYOK key vault. Keys are AES-256-GCM encrypted at rest and never returned in
full to any client; list/read expose only the provider and last four characters.
Phase 12+ provider adapters decrypt server-side right before calling out."""

from fastapi import APIRouter
from sqlalchemy import select

from ..deps import CurrentUser, DbSession
from ..models import ApiKey
from ..schemas import ApiKeyIn, ApiKeyOut
from ..security import encrypt_secret

router = APIRouter(prefix="/api/keys", tags=["keys"])

KNOWN_PROVIDERS = {"openai", "stability", "runware", "fal", "anthropic"}


def _out(k: ApiKey) -> ApiKeyOut:
    return ApiKeyOut(provider=k.provider, last4=k.last4, created_at=k.created_at)


@router.get("", response_model=list[ApiKeyOut])
def list_keys(user: CurrentUser, db: DbSession) -> list[ApiKeyOut]:
    rows = db.scalars(select(ApiKey).where(ApiKey.user_id == user.id).order_by(ApiKey.provider))
    return [_out(k) for k in rows]


@router.put("/{provider}", response_model=ApiKeyOut)
def set_key(provider: str, body: ApiKeyIn, user: CurrentUser, db: DbSession) -> ApiKeyOut:
    provider = provider.lower()
    key = body.key.strip()
    record = db.scalar(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == provider))
    if record is None:
        record = ApiKey(user_id=user.id, provider=provider)
        db.add(record)
    record.key_encrypted = encrypt_secret(key)
    record.last4 = key[-4:]
    db.flush()
    return _out(record)


@router.delete("/{provider}", status_code=204)
def delete_key(provider: str, user: CurrentUser, db: DbSession) -> None:
    record = db.scalar(
        select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == provider.lower())
    )
    if record is not None:
        db.delete(record)
