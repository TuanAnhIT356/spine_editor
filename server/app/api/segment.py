"""Segmentation API: remove background, split an image into parts, estimate
pose landmarks, SAM 2 prompted masks. Images travel as data URLs both ways."""

import base64

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import CurrentUser, DbSession
from ..models import ApiKey
from ..providers.base import ProviderError
from ..security import decrypt_secret
from ..segment import HAS_REMBG, fal, local, rembg_remove

router = APIRouter(prefix="/api/segment", tags=["segment"])

MAX_IMAGE_BYTES = 24 * 1024 * 1024


def _decode(data_url: str) -> bytes:
    if not data_url.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Expected a data:image/... URL")
    try:
        raw = base64.b64decode(data_url.split(",", 1)[1])
    except (IndexError, ValueError) as err:
        raise HTTPException(status_code=400, detail="Malformed data URL") from err
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (24MB max)")
    return raw


def _encode(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode()


def _fal_key(user_id: int, db: DbSession) -> str:
    record = db.scalar(select(ApiKey).where(ApiKey.user_id == user_id, ApiKey.provider == "fal"))
    if record is None:
        raise HTTPException(
            status_code=400, detail="No API key stored for 'fal' — add it in the Server dialog"
        )
    return decrypt_secret(record.key_encrypted)


class RemoveBgRequest(BaseModel):
    image: str
    provider: str = "local"  # local | rembg | fal
    tolerance: int = Field(default=24, ge=0, le=128)


@router.post("/remove-bg")
async def remove_bg(body: RemoveBgRequest, user: CurrentUser, db: DbSession) -> dict[str, str]:
    png = _decode(body.image)
    provider = body.provider.lower()
    try:
        if provider == "local":
            out = local.remove_background(png, body.tolerance)
        elif provider == "rembg":
            if not HAS_REMBG:
                raise HTTPException(
                    status_code=400,
                    detail="rembg is not installed on this server — use 'local' or 'fal'",
                )
            out = rembg_remove(png)
        elif provider == "fal":
            out = await fal.remove_background(_fal_key(user.id, db), png)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown provider '{body.provider}'")
    except ProviderError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    return {"data_url": _encode(out)}


class SplitRequest(BaseModel):
    image: str
    min_area: int = Field(default=64, ge=1)
    crop: bool = True


@router.post("/parts")
def split(body: SplitRequest, user: CurrentUser) -> dict[str, object]:
    parts, width, height = local.split_parts(_decode(body.image), body.min_area, body.crop)
    return {
        "width": width,
        "height": height,
        "parts": [
            {
                "name": p.name,
                "data_url": _encode(p.png),
                "x": p.x,
                "y": p.y,
                "width": p.width,
                "height": p.height,
            }
            for p in parts
        ],
    }


class PoseRequest(BaseModel):
    image: str


@router.post("/pose")
def pose(body: PoseRequest, user: CurrentUser) -> dict[str, object]:
    return local.estimate_pose(_decode(body.image))


class SamPoint(BaseModel):
    x: float
    y: float
    label: int = 1


class SamBox(BaseModel):
    x_min: float
    y_min: float
    x_max: float
    y_max: float


class SamRequest(BaseModel):
    image: str
    points: list[SamPoint] = []
    boxes: list[SamBox] = []


@router.post("/sam")
async def sam(body: SamRequest, user: CurrentUser, db: DbSession) -> dict[str, str]:
    if not body.points and not body.boxes:
        raise HTTPException(status_code=400, detail="Provide at least one point or box prompt")
    try:
        mask = await fal.sam_mask(
            _fal_key(user.id, db),
            _decode(body.image),
            [p.model_dump() for p in body.points],
            [b.model_dump() for b in body.boxes],
        )
    except ProviderError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    return {"data_url": _encode(mask)}
