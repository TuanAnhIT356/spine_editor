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
from ..segment.parts import DEFAULT_PART_NAMES
from ._images import decode_image

router = APIRouter(prefix="/api/generate", tags=["generate"])

REFERENCE_TEMPLATE = (
    "full body 2D game character sprite of {subject}, T-pose with arms straight out, "
    "front view, flat cel shading, clean bold outlines, no background, no text, "
    "no watermark, centered, whole body visible"
)

MAX_SET_PARTS = 20


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


class PartSetRequest(BaseModel):
    provider: str
    subject: str | None = Field(default=None, max_length=1000)
    reference: str | None = None
    parts: list[str] | None = None
    size: str = "1024x1024"


class PartSetEntry(BaseModel):
    name: str
    image: str


class PartSetResponse(BaseModel):
    reference: str
    parts: list[PartSetEntry]
    warnings: list[str] = []


@router.post("/part-set", response_model=PartSetResponse)
async def part_set(body: PartSetRequest, user: CurrentUser, db: DbSession) -> PartSetResponse:
    provider = PROVIDERS.get(body.provider.lower())
    if provider is None or not getattr(provider, "supports_edit", False):
        raise HTTPException(
            status_code=400, detail=f"Provider '{body.provider}' does not support part editing"
        )
    if (body.subject is None) == (body.reference is None):
        raise HTTPException(status_code=400, detail="Provide exactly one of subject or reference")
    part_names = body.parts if body.parts is not None else DEFAULT_PART_NAMES
    if len(part_names) > MAX_SET_PARTS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_SET_PARTS} parts per set")

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

    if body.subject is not None:
        prompt = REFERENCE_TEMPLATE.format(subject=body.subject.strip())
        try:
            reference_png = await provider.generate(key, prompt, body.size, True)
        except ProviderError as err:
            raise HTTPException(status_code=502, detail=str(err)) from err
        img = GenImage(
            user_id=user.id,
            provider=provider.name,
            prompt=prompt,
            size=body.size,
            transparent=1,
            data_url="data:image/png;base64," + base64.b64encode(reference_png).decode(),
        )
        db.add(img)
        db.flush()
    else:
        reference_png = decode_image(body.reference or "")

    warnings: list[str] = []
    parts: list[PartSetEntry] = []
    for name in part_names:
        try:
            part_png = await provider.edit(
                key,
                reference_png,
                f"isolate only the {name}, transparent background, same character, same art style",
                body.size,
                True,
            )
            parts.append(
                PartSetEntry(
                    name=name,
                    image="data:image/png;base64," + base64.b64encode(part_png).decode(),
                )
            )
        except ProviderError as err:
            warnings.append(f"{name}: {err}")
    return PartSetResponse(
        reference="data:image/png;base64," + base64.b64encode(reference_png).decode(),
        parts=parts,
        warnings=warnings,
    )


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
