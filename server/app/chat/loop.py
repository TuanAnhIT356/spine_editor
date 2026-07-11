"""One chat turn: persist the user message, stream the model, dispatch every
tool_use to the editor over the ws (via request_op), feed tool_results back,
repeat until the model stops. All tool_results of a round go in ONE user
message. pause_turn auto-continues; refusal surfaces as an error."""

import asyncio
import json
from collections.abc import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Conversation, Message, utcnow
from .backend import ChatBackend
from .prompt import SYSTEM_PROMPT

MAX_ROUNDS = 40
OP_TIMEOUT_S = 120
SLOW_OPS = {"generate_image", "segment_image"}
SLOW_OP_TIMEOUT_S = 300

SendFn = Callable[[dict], Awaitable[None]]
# request_op(tool, params, timeout_s) -> (ok, content_blocks_or_error_string)
RequestOpFn = Callable[[str, dict, int], Awaitable[tuple[bool, list | str]]]


class TurnCancelledError(Exception):
    pass


def _persist(db: Session, conv: Conversation, role: str, content: list[dict]) -> None:
    db.add(Message(conversation_id=conv.id, role=role, content=json.dumps(content)))
    conv.updated_at = utcnow()
    db.commit()


def _load_messages(db: Session, conv: Conversation) -> list[dict]:
    rows = db.scalars(
        select(Message).where(Message.conversation_id == conv.id).order_by(Message.id)
    ).all()
    return [{"role": m.role, "content": json.loads(m.content)} for m in rows]


def _title_from(text: str) -> str:
    if len(text) <= 60:
        return text
    cut = text[:60]
    return cut.rsplit(" ", 1)[0] if " " in cut else cut


async def run_turn(
    db: Session,
    conv: Conversation,
    user_text: str,
    tools: list[dict],
    backend: ChatBackend,
    send: SendFn,
    request_op: RequestOpFn,
    stop_event: asyncio.Event,
) -> None:
    first_turn = len(_load_messages(db, conv)) == 0
    _persist(db, conv, "user", [{"type": "text", "text": user_text}])

    for _round in range(MAX_ROUNDS):
        messages = _load_messages(db, conv)
        content: list[dict] = []
        stop_reason = "end_turn"
        try:
            async for event in backend.stream_turn(SYSTEM_PROMPT, messages, tools):
                if stop_event.is_set():
                    raise TurnCancelledError()
                if event["kind"] == "text":
                    await send({"type": "delta", "text": event["text"]})
                elif event["kind"] == "thinking":
                    await send({"type": "thinking", "text": event["text"]})
                else:
                    content = event["content"]
                    stop_reason = event["stop_reason"]
        except TurnCancelledError:
            if content:
                _persist(db, conv, "assistant", content)
            await send({"type": "turn_done", "stopReason": "cancelled"})
            return

        _persist(db, conv, "assistant", content)

        if stop_reason == "pause_turn":
            continue
        if stop_reason == "refusal":
            await send({"type": "error", "message": "The model declined this request."})
            break
        if stop_reason != "tool_use":
            await send({"type": "turn_done", "stopReason": stop_reason})
            break

        tool_uses = [b for b in content if b.get("type") == "tool_use"]
        results: list[dict] = []
        cancelled = False
        for tu in tool_uses:
            if stop_event.is_set() or cancelled:
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tu["id"],
                        "content": [{"type": "text", "text": "cancelled by user"}],
                        "is_error": True,
                    }
                )
                cancelled = True
                continue
            timeout = SLOW_OP_TIMEOUT_S if tu["name"] in SLOW_OPS else OP_TIMEOUT_S
            ok, payload = await request_op(tu["name"], tu.get("input") or {}, timeout)
            if ok:
                results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": payload})
            else:
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tu["id"],
                        "content": [{"type": "text", "text": str(payload)}],
                        "is_error": True,
                    }
                )
        _persist(db, conv, "user", results)
        if cancelled or stop_event.is_set():
            await send({"type": "turn_done", "stopReason": "cancelled"})
            return
    else:
        await send({"type": "error", "message": "Loop limit reached (40 rounds)."})

    if first_turn:
        conv.title = _title_from(user_text)
        db.commit()
        await send({"type": "title", "text": conv.title})
