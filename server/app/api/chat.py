"""Chat API: conversation CRUD (REST) + the chat WebSocket. Messages store
anthropic content blocks verbatim so reopening a conversation replays exact
context."""

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import CurrentUser, DbSession
from ..models import Conversation, Message

router = APIRouter(prefix="/api/chat", tags=["chat"])


def owned_conversation(db: Session, user_id: int, conv_id: int) -> Conversation | None:
    return db.scalar(
        select(Conversation).where(Conversation.id == conv_id, Conversation.user_id == user_id)
    )


class ConversationOut(BaseModel):
    id: int
    title: str
    project_id: int | None
    updated_at: str


class ConversationCreate(BaseModel):
    project_id: int | None = None


def _out(c: Conversation) -> ConversationOut:
    return ConversationOut(
        id=c.id, title=c.title, project_id=c.project_id, updated_at=c.updated_at.isoformat()
    )


@router.get("/conversations")
def list_conversations(
    user: CurrentUser, db: DbSession, project_id: int | None = None
) -> list[ConversationOut]:
    q = select(Conversation).where(Conversation.user_id == user.id)
    if project_id is not None:
        q = q.where(Conversation.project_id == project_id)
    rows = db.scalars(q.order_by(Conversation.updated_at.desc())).all()
    return [_out(c) for c in rows]


@router.post("/conversations")
def create_conversation(
    body: ConversationCreate, user: CurrentUser, db: DbSession
) -> ConversationOut:
    conv = Conversation(user_id=user.id, project_id=body.project_id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _out(conv)


@router.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: int, user: CurrentUser, db: DbSession) -> dict[str, bool]:
    conv = owned_conversation(db, user.id, conv_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    for m in db.scalars(select(Message).where(Message.conversation_id == conv.id)):
        db.delete(m)
    db.delete(conv)
    db.commit()
    return {"ok": True}


@router.get("/conversations/{conv_id}/messages")
def list_messages(conv_id: int, user: CurrentUser, db: DbSession) -> list[dict]:
    conv = owned_conversation(db, user.id, conv_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    rows = db.scalars(
        select(Message).where(Message.conversation_id == conv.id).order_by(Message.id)
    ).all()
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": json.loads(m.content),
            "created_at": m.created_at.isoformat(),
        }
        for m in rows
    ]
