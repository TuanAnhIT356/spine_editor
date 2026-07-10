"""AI image generation: run a BYOK provider, keep results in a per-user gallery.

The user's provider key is decrypted only here, immediately before the
outbound call, and never returned or logged.
"""

import base64
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import CurrentUser, DbSession
from ..models import ApiKey, GenImage
from ..providers import PROVIDERS, ProviderError
from ..security import decrypt_secret

router = APIRouter(prefix="/api/generate", tags=["generate"])


class GenerateRequest(BaseModel):
    provider: str
    prompt: str = Field(min_length=1, max_length=4000)
    size: str = "1024x1024"
    transparent: bool = True


class GalleryEntry(BaseModel):
    id: int
    provider: str
    prompt: str
    size: str
    transparent: bool
    created_at: datetime


class GalleryImage(GalleryEntry):
    data_url: str


class ProviderInfo(BaseModel):
    name: str
    supports_transparent: bool
    supports_inpaint: bool = False
    supports_edit: bool = False
    approx_cost_usd: float
    has_key: bool


def _entry(img: GenImage) -> GalleryEntry:
    return GalleryEntry(
        id=img.id,
        provider=img.provider,
        prompt=img.prompt,
        size=img.size,
        transparent=bool(img.transparent),
        created_at=img.created_at,
    )


def _full(img: GenImage) -> GalleryImage:
    return GalleryImage(**_entry(img).model_dump(), data_url=img.data_url)


@router.get("/providers", response_model=list[ProviderInfo])
def list_providers(user: CurrentUser, db: DbSession) -> list[ProviderInfo]:
    """Providers with metadata for the dialog: capability, cost estimate, and
    whether this user has stored a key (mock never needs one)."""
    keyed = {k.provider for k in db.scalars(select(ApiKey).where(ApiKey.user_id == user.id))}
    return [
        ProviderInfo(
            name=p.name,
            supports_transparent=p.supports_transparent,
            supports_inpaint=getattr(p, "supports_inpaint", False),
            supports_edit=getattr(p, "supports_edit", False),
            approx_cost_usd=p.approx_cost_usd,
            has_key=p.name in keyed or p.name == "mock",
        )
        for p in PROVIDERS.values()
    ]


@router.post("", response_model=GalleryImage)
async def generate(body: GenerateRequest, user: CurrentUser, db: DbSession) -> GalleryImage:
    provider = PROVIDERS.get(body.provider.lower())
    if provider is None:
        raise HTTPException(status_code=400, detail=f"Unknown provider '{body.provider}'")
    if body.transparent and not provider.supports_transparent:
        raise HTTPException(
            status_code=400,
            detail=f"{provider.name} can't generate transparent backgrounds — "
            "use openai/runware, or disable transparency",
        )
    if provider.name == "mock":
        key = "mock"
    else:
        record = db.scalar(
            select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == provider.name)
        )
        if record is None:
            raise HTTPException(
                status_code=400,
                detail=f"No API key stored for '{provider.name}' — add it in the Server dialog",
            )
        key = decrypt_secret(record.key_encrypted)
    try:
        png = await provider.generate(key, body.prompt, body.size, body.transparent)
    except ProviderError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    img = GenImage(
        user_id=user.id,
        provider=provider.name,
        prompt=body.prompt,
        size=body.size,
        transparent=int(body.transparent),
        data_url="data:image/png;base64," + base64.b64encode(png).decode(),
    )
    db.add(img)
    db.flush()
    return _full(img)


@router.get("", response_model=list[GalleryEntry])
def list_gallery(user: CurrentUser, db: DbSession) -> list[GalleryEntry]:
    rows = db.scalars(
        select(GenImage).where(GenImage.user_id == user.id).order_by(GenImage.created_at.desc())
    )
    return [_entry(i) for i in rows]


@router.get("/{image_id}", response_model=GalleryImage)
def get_image(image_id: int, user: CurrentUser, db: DbSession) -> GalleryImage:
    img = db.get(GenImage, image_id)
    if img is None or img.user_id != user.id:
        raise HTTPException(status_code=404, detail="Image not found")
    return _full(img)


@router.delete("/{image_id}", status_code=204)
def delete_image(image_id: int, user: CurrentUser, db: DbSession) -> None:
    img = db.get(GenImage, image_id)
    if img is None or img.user_id != user.id:
        raise HTTPException(status_code=404, detail="Image not found")
    db.delete(img)
