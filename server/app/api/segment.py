"""Segmentation pipeline (Phase 13 strategy B): remove-bg, pose landmarks,
per-part SAM masks, optional occlusion inpainting. BYOK keys are decrypted
only here, right before the outbound call, mirroring generate.py."""

import base64

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import CurrentUser, DbSession
from ..models import ApiKey
from ..providers import PROVIDERS, ProviderError
from ..security import decrypt_secret
from ..segment.backends import BACKENDS, FalSam2Backend
from ..segment.cutout import cut_part, hole_mask, png_data_url
from ..segment.engines import (
    PoseNotFoundError,
    SegmentUnavailableError,
    detect_pose,
    remove_background,
)
from ..segment.parts import build_prompts
from ..segment.schemas import PartCut, PartPrompt
from ._images import decode_image

router = APIRouter(prefix="/api/segment", tags=["segment"])

MAX_PARTS = 20


class ImageRequest(BaseModel):
    image: str = Field(min_length=32)


class PartsRequest(ImageRequest):
    backend: str = "mock"
    parts: list[PartPrompt] | None = None
    inpaint: bool = False
    inpaint_provider: str = "mock"


class BackendInfo(BaseModel):
    name: str
    has_key: bool
    approx_cost_usd: float


def _guarded_pose(png: bytes):
    try:
        return detect_pose(png)
    except PoseNotFoundError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except SegmentUnavailableError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


def _byok_key(db: DbSession, user, provider_name: str) -> str:
    if provider_name == "mock":
        return "mock"
    record = db.scalar(
        select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == provider_name)
    )
    if record is None:
        raise HTTPException(
            status_code=400,
            detail=f"No API key stored for '{provider_name}' — add it in the Server dialog",
        )
    return decrypt_secret(record.key_encrypted)


@router.post("/remove-bg", response_model=ImageRequest)
def remove_bg(body: ImageRequest, user: CurrentUser) -> ImageRequest:
    png = decode_image(body.image)
    try:
        return ImageRequest(image=png_data_url(remove_background(png)))
    except SegmentUnavailableError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


class PoseResponse(BaseModel):
    landmarks: dict[str, tuple[float, float, float]]
    width: int
    height: int
    parts: list[PartPrompt]


@router.post("/pose", response_model=PoseResponse)
def pose(body: ImageRequest, user: CurrentUser) -> PoseResponse:
    png = decode_image(body.image)
    result = _guarded_pose(png)
    return PoseResponse(
        landmarks=result.landmarks,
        width=result.width,
        height=result.height,
        parts=build_prompts(result),
    )


class PartsResponse(BaseModel):
    parts: list[PartCut]
    warnings: list[str] = []


@router.post("/parts", response_model=PartsResponse)
async def parts(body: PartsRequest, user: CurrentUser, db: DbSession) -> PartsResponse:
    png = decode_image(body.image)
    backend = BACKENDS.get(body.backend)
    if backend is None:
        raise HTTPException(status_code=400, detail=f"Unknown backend '{body.backend}'")
    prompts = body.parts if body.parts is not None else build_prompts(_guarded_pose(png))
    if len(prompts) > MAX_PARTS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_PARTS} parts per request")
    if isinstance(backend, FalSam2Backend):
        backend = backend.with_key(_byok_key(db, user, "fal"))

    inpaint_provider = None
    inpaint_key = ""
    if body.inpaint:
        candidate = PROVIDERS.get(body.inpaint_provider)
        if candidate is None or not getattr(candidate, "supports_inpaint", False):
            raise HTTPException(
                status_code=400,
                detail=f"Provider '{body.inpaint_provider}' does not support inpainting",
            )
        inpaint_key = _byok_key(db, user, candidate.name)
        inpaint_provider = candidate

    warnings: list[str] = []
    masks: list[tuple[PartPrompt, bytes]] = []
    try:
        for prompt in prompts:
            masks.append((prompt, await backend.mask(png, prompt)))
    except ProviderError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err

    cuts: list[PartCut] = []
    for i, (prompt, mask) in enumerate(masks):
        cut = cut_part(png, mask, prompt.name)
        if cut is None:
            continue
        if inpaint_provider is not None:
            bbox = (cut.x, cut.y, cut.x + cut.width, cut.y + cut.height)
            others = [m for j, (_, m) in enumerate(masks) if j != i]
            hole = hole_mask(mask, others, bbox)
            if hole is not None:
                try:
                    patched = await inpaint_provider.inpaint(
                        inpaint_key,
                        base64.b64decode(cut.image.split(",", 1)[1]),
                        hole,
                        f"seamlessly continue the {prompt.name} texture, same art style, "
                        "2D game sprite",
                    )
                    cut = cut.model_copy(update={"image": png_data_url(patched), "inpainted": True})
                except ProviderError as err:
                    warnings.append(f"{prompt.name}: inpaint failed — {err}")
        cuts.append(cut)
    return PartsResponse(parts=cuts, warnings=warnings)


@router.get("/backends", response_model=list[BackendInfo])
def backends(user: CurrentUser, db: DbSession) -> list[BackendInfo]:
    keyed = {k.provider for k in db.scalars(select(ApiKey).where(ApiKey.user_id == user.id))}
    return [
        BackendInfo(
            name=b.name,
            has_key=(b.name == "mock" or b.name in keyed),
            approx_cost_usd=b.approx_cost_usd,
        )
        for b in BACKENDS.values()
    ]
