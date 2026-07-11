"""Chat API: conversation CRUD (REST) + the chat WebSocket. Messages store
anthropic content blocks verbatim so reopening a conversation replays exact
context."""

import asyncio
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..chat.backend import ChatSetupError, make_backend
from ..chat.loop import run_turn
from ..db import SessionLocal
from ..deps import CurrentUser, DbSession
from ..models import Conversation, Message
from ..security import decode_access_token

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


@router.websocket("/ws")
async def chat_ws(ws: WebSocket) -> None:
    await ws.accept()
    try:
        user_id = decode_access_token(ws.query_params.get("token") or "")
    except HTTPException:
        await ws.close(code=4001)
        return

    db = SessionLocal()
    try:
        conv_param = ws.query_params.get("conversation")
        if conv_param:
            conv = owned_conversation(db, user_id, int(conv_param))
            if conv is None:
                await ws.close(code=4003)
                return
        else:
            conv = Conversation(user_id=user_id)
            db.add(conv)
            db.commit()
            db.refresh(conv)

        hello = await ws.receive_json()
        if hello.get("type") != "hello" or not isinstance(hello.get("tools"), list):
            await ws.close(code=4002)
            return
        tools = hello["tools"]
        await ws.send_json({"type": "ready", "conversation": conv.id, "title": conv.title})

        pending: dict[int, asyncio.Future] = {}
        stop_event = asyncio.Event()
        inbox: asyncio.Queue[dict] = asyncio.Queue()
        next_id = 0

        async def reader() -> None:
            try:
                while True:
                    msg = await ws.receive_json()
                    if msg.get("type") == "op_result":
                        fut = pending.pop(msg.get("id"), None)
                        if fut is not None and not fut.done():
                            fut.set_result(msg)
                    elif msg.get("type") == "stop":
                        stop_event.set()
                    elif msg.get("type") == "user":
                        await inbox.put(msg)
            except WebSocketDisconnect:
                stop_event.set()
                for fut in pending.values():
                    if not fut.done():
                        fut.set_exception(ConnectionError("editor disconnected"))
                await inbox.put({"type": "_disconnected"})

        async def request_op(tool: str, params: dict, timeout: int) -> tuple[bool, list | str]:
            nonlocal next_id
            next_id += 1
            op_id = next_id
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            pending[op_id] = fut
            await ws.send_json({"type": "op", "id": op_id, "tool": tool, "params": params})
            try:
                msg = await asyncio.wait_for(fut, timeout=timeout)
            except TimeoutError:
                pending.pop(op_id, None)
                return False, f"tool '{tool}' timed out after {timeout}s"
            except ConnectionError as err:
                return False, str(err)
            if msg.get("ok"):
                return True, msg.get("content") or []
            return False, msg.get("error") or "unknown editor error"

        reader_task = asyncio.create_task(reader())
        try:
            while True:
                msg = await inbox.get()
                if msg.get("type") == "_disconnected":
                    break
                stop_event.clear()
                try:
                    backend = make_backend(db, user_id)
                except ChatSetupError as err:
                    await ws.send_json({"type": "error", "message": str(err)})
                    continue
                try:
                    await run_turn(
                        db,
                        conv,
                        msg["text"],
                        tools,
                        backend,
                        ws.send_json,
                        request_op,
                        stop_event,
                    )
                except WebSocketDisconnect:
                    break
                except Exception as err:  # anthropic/API errors → surface, keep ws alive
                    await ws.send_json({"type": "error", "message": str(err)[:300]})
        finally:
            reader_task.cancel()
    finally:
        db.close()
