"""Segmentation pipeline (Phase 13 strategy B): remove-bg, pose landmarks,
per-part SAM masks. The fal key is decrypted only here, right before the
call, mirroring generate.py."""

import base64
import io

from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import CurrentUser, DbSession
from ..models import ApiKey
from ..providers import ProviderError
from ..security import decrypt_secret
from ..segment.backends import BACKENDS, FalSam2Backend
from ..segment.cutout import cut_part, png_data_url
from ..segment.engines import (
    PoseNotFoundError,
    SegmentUnavailableError,
    detect_pose,
    remove_background,
)
from ..segment.parts import build_prompts
from ..segment.schemas import PartCut, PartPrompt

router = APIRouter(prefix="/api/segment", tags=["segment"])

MAX_SIDE = 4096
MAX_PARTS = 20


class ImageRequest(BaseModel):
    image: str = Field(min_length=32)


class PartsRequest(ImageRequest):
    backend: str = "mock"
    parts: list[PartPrompt] | None = None


class BackendInfo(BaseModel):
    name: str
    has_key: bool
    approx_cost_usd: float


def _decode(image: str) -> bytes:
    try:
        b64 = image.split(",", 1)[1] if image.startswith("data:") else image
        raw = base64.b64decode(b64)
        with Image.open(io.BytesIO(raw)) as im:
            if max(im.size) > MAX_SIDE:
                raise HTTPException(
                    status_code=400, detail=f"Image larger than {MAX_SIDE}px on a side"
                )
        return raw
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=400, detail="Could not decode image") from err


def _guarded_pose(png: bytes):
    try:
        return detect_pose(png)
    except PoseNotFoundError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except SegmentUnavailableError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


@router.post("/remove-bg", response_model=ImageRequest)
def remove_bg(body: ImageRequest, user: CurrentUser) -> ImageRequest:
    png = _decode(body.image)
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
    png = _decode(body.image)
    result = _guarded_pose(png)
    return PoseResponse(
        landmarks=result.landmarks,
        width=result.width,
        height=result.height,
        parts=build_prompts(result),
    )


class PartsResponse(BaseModel):
    parts: list[PartCut]


@router.post("/parts", response_model=PartsResponse)
async def parts(body: PartsRequest, user: CurrentUser, db: DbSession) -> PartsResponse:
    png = _decode(body.image)
    backend = BACKENDS.get(body.backend)
    if backend is None:
        raise HTTPException(status_code=400, detail=f"Unknown backend '{body.backend}'")
    prompts = body.parts if body.parts is not None else build_prompts(_guarded_pose(png))
    if len(prompts) > MAX_PARTS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_PARTS} parts per request")
    if isinstance(backend, FalSam2Backend):
        record = db.scalar(
            select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.provider == "fal")
        )
        if record is None:
            raise HTTPException(
                status_code=400,
                detail="No API key stored for 'fal' — add it in the Server dialog",
            )
        backend = backend.with_key(decrypt_secret(record.key_encrypted))
    cuts: list[PartCut] = []
    try:
        for prompt in prompts:
            mask = await backend.mask(png, prompt)
            cut = cut_part(png, mask, prompt.name)
            if cut is not None:
                cuts.append(cut)
    except ProviderError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    return PartsResponse(parts=cuts)


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
