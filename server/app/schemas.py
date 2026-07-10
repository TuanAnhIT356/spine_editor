"""Pydantic request/response shapes for the REST API."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotRequest(BaseModel):
    email: EmailStr


class ResetRequest(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=200)


class UserOut(BaseModel):
    id: int
    email: str


class AuthOut(BaseModel):
    access_token: str
    user: UserOut


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    data: dict[str, Any]
    thumbnail: str = ""


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    data: dict[str, Any] | None = None
    thumbnail: str | None = None


class ProjectSummary(BaseModel):
    id: int
    name: str
    thumbnail: str
    created_at: datetime
    updated_at: datetime


class ProjectOut(ProjectSummary):
    data: dict[str, Any]


class ApiKeyIn(BaseModel):
    key: str = Field(min_length=4, max_length=500)


class ApiKeyOut(BaseModel):
    provider: str
    last4: str
    created_at: datetime
