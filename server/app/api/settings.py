"""Per-user settings: a single JSON object the frontend owns the shape of."""

import json
from typing import Any

from fastapi import APIRouter

from ..deps import CurrentUser, DbSession
from ..models import UserSettings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def get_settings(user: CurrentUser, db: DbSession) -> dict[str, Any]:
    record = db.get(UserSettings, user.id)
    return json.loads(record.data) if record else {}


@router.put("")
def put_settings(body: dict[str, Any], user: CurrentUser, db: DbSession) -> dict[str, Any]:
    record = db.get(UserSettings, user.id)
    if record is None:
        record = UserSettings(user_id=user.id)
        db.add(record)
    record.data = json.dumps(body)
    db.flush()
    return body
