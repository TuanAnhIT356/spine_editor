"""Auth endpoints: register, login, refresh (rotation), logout, forgot/reset password.

The access token is a short-lived JWT the client keeps in memory; the refresh token
is an opaque value in an httpOnly cookie whose sha256 is stored server-side so
sessions can be revoked (logout, password reset).
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select

from ..config import config
from ..deps import CurrentUser, DbSession
from ..mailer import send_password_reset
from ..models import PasswordReset, RefreshToken, User
from ..schemas import (
    AuthOut,
    ForgotRequest,
    LoginRequest,
    RegisterRequest,
    ResetRequest,
    UserOut,
)
from ..security import (
    auth_rate_limiter,
    create_access_token,
    hash_password,
    hash_token,
    new_opaque_token,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

REFRESH_COOKIE = "spine_refresh"


def _issue_session(response: Response, db: DbSession, user: User) -> AuthOut:
    token, token_hash = new_opaque_token()
    db.add(
        RefreshToken(
            token_hash=token_hash,
            user_id=user.id,
            expires_at=datetime.now(UTC) + timedelta(days=config.refresh_token_days),
        )
    )
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=config.refresh_token_days * 86400,
        httponly=True,
        samesite="lax",
        secure=config.cookie_secure,
        path="/api/auth",
    )
    return AuthOut(
        access_token=create_access_token(user.id), user=UserOut(id=user.id, email=user.email)
    )


def _valid_refresh(db: DbSession, cookie: str | None) -> RefreshToken:
    if not cookie:
        raise HTTPException(status_code=401, detail="No refresh token")
    record = db.get(RefreshToken, hash_token(cookie))
    now = datetime.now(UTC)
    if (
        record is None
        or record.revoked
        or record.expires_at.replace(tzinfo=record.expires_at.tzinfo or UTC) < now
    ):
        raise HTTPException(status_code=401, detail="Session expired")
    return record


@router.post("/register", response_model=AuthOut)
def register(body: RegisterRequest, request: Request, response: Response, db: DbSession) -> AuthOut:
    auth_rate_limiter.check(request, "register")
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=email, password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    return _issue_session(response, db, user)


@router.post("/login", response_model=AuthOut)
def login(body: LoginRequest, request: Request, response: Response, db: DbSession) -> AuthOut:
    auth_rate_limiter.check(request, "login")
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return _issue_session(response, db, user)


@router.post("/refresh", response_model=AuthOut)
def refresh(request: Request, response: Response, db: DbSession) -> AuthOut:
    record = _valid_refresh(db, request.cookies.get(REFRESH_COOKIE))
    user = db.get(User, record.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Unknown user")
    record.revoked = 1  # rotation: each refresh token is single-use
    return _issue_session(response, db, user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DbSession) -> None:
    cookie = request.cookies.get(REFRESH_COOKIE)
    if cookie and (record := db.get(RefreshToken, hash_token(cookie))):
        record.revoked = 1
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return UserOut(id=user.id, email=user.email)


@router.post("/forgot", status_code=202)
def forgot(body: ForgotRequest, request: Request, db: DbSession) -> dict[str, str]:
    """Always answers 202 so the response doesn't reveal whether the email exists."""
    auth_rate_limiter.check(request, "forgot")
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is not None:
        token, token_hash = new_opaque_token()
        db.add(
            PasswordReset(
                token_hash=token_hash,
                user_id=user.id,
                expires_at=datetime.now(UTC) + timedelta(minutes=config.reset_token_minutes),
            )
        )
        send_password_reset(user.email, token)
    return {"status": "If that email exists, a reset mail was sent"}


@router.post("/reset", status_code=204)
def reset(body: ResetRequest, request: Request, db: DbSession) -> None:
    auth_rate_limiter.check(request, "reset")
    record = db.get(PasswordReset, hash_token(body.token))
    now = datetime.now(UTC)
    if (
        record is None
        or record.used
        or record.expires_at.replace(tzinfo=record.expires_at.tzinfo or UTC) < now
    ):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    user = db.get(User, record.user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    record.used = 1
    user.password_hash = hash_password(body.password)
    # A password reset ends every existing session.
    for token in db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id)):
        token.revoked = 1
