"""Shared shapes for the segmentation pipeline (strategy B)."""

from dataclasses import dataclass

from pydantic import BaseModel, Field


class Point(BaseModel):
    x: int
    y: int
    label: int = Field(ge=0, le=1, description="1=foreground, 0=background")


class Box(BaseModel):
    x0: int
    y0: int
    x1: int
    y1: int


class PartPrompt(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    points: list[Point] = []
    box: Box | None = None


class PartCut(BaseModel):
    """One cut-out part: RGBA PNG data URL + its origin in the source image
    (pixels, top-left origin)."""

    name: str
    image: str
    x: int
    y: int
    width: int
    height: int


@dataclass
class PoseResult:
    """Landmarks in PIXEL coordinates: name -> (x, y, visibility)."""

    landmarks: dict[str, tuple[float, float, float]]
    width: int
    height: int
