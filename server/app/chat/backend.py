"""Chat model backends. The loop consumes an async iterator of events:
{"kind": "text"|"thinking", "text": str} deltas, then exactly one
{"kind": "final", "content": [...anthropic blocks...], "stop_reason": str}.
"""

import json
import os
from collections.abc import AsyncIterator
from typing import Protocol

from anthropic import AsyncAnthropic
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import ApiKey
from ..security import decrypt_secret


def chat_model() -> str:
    return os.environ.get("SPINE_SERVER_CHAT_MODEL", "claude-opus-4-8")


def chat_fake_enabled() -> bool:
    return os.environ.get("SPINE_SERVER_CHAT_FAKE") == "1"


class ChatSetupError(Exception):
    pass


class ChatBackend(Protocol):
    def stream_turn(
        self, system: str, messages: list[dict], tools: list[dict]
    ) -> AsyncIterator[dict]: ...


class AnthropicBackend:
    def __init__(self, api_key: str) -> None:
        self._client = AsyncAnthropic(api_key=api_key)

    async def stream_turn(
        self, system: str, messages: list[dict], tools: list[dict]
    ) -> AsyncIterator[dict]:
        async with self._client.messages.stream(
            model=chat_model(),
            max_tokens=8192,
            system=system,
            thinking={"type": "adaptive", "display": "summarized"},
            tools=tools,
            messages=messages,
        ) as stream:
            async for event in stream:
                if event.type == "content_block_delta":
                    if event.delta.type == "text_delta":
                        yield {"kind": "text", "text": event.delta.text}
                    elif event.delta.type == "thinking_delta":
                        yield {"kind": "thinking", "text": event.delta.thinking}
            final = await stream.get_final_message()
        yield {
            "kind": "final",
            "content": [b.model_dump(exclude_none=True) for b in final.content],
            "stop_reason": final.stop_reason or "end_turn",
        }


FAKE_SCRIPT = [
    (
        "generate_image",
        lambda prev, user: {"provider": "mock", "prompt": user, "transparent": True},
    ),
    (
        "segment_image",
        lambda prev, user: {
            "asset": (prev or {}).get("name", "gen"),
            "backend": "mock",
            "place_on_canvas": True,
        },
    ),
    ("rig_from_parts", lambda prev, user: {}),
    ("apply_preset_animation", lambda prev, user: {"preset": "walk"}),
    ("screenshot_viewport", lambda prev, user: {}),
]


def _plain_user_texts(messages: list[dict]) -> list[str]:
    """User messages that are real human input (not tool_result carriers)."""
    out = []
    for m in messages:
        if m["role"] != "user":
            continue
        blocks = m["content"]
        if isinstance(blocks, list) and blocks and blocks[0].get("type") == "text":
            out.append(blocks[0]["text"])
    return out


def _last_tool_result(messages: list[dict]) -> dict | None:
    for m in reversed(messages):
        if m["role"] != "user" or not isinstance(m["content"], list):
            continue
        for b in m["content"]:
            if isinstance(b, dict) and b.get("type") == "tool_result":
                content = b.get("content") or []
                if content and content[0].get("type") == "text":
                    try:
                        return json.loads(content[0]["text"])
                    except (ValueError, TypeError):
                        return None
        return None
    return None


class FakeBackend:
    """Deterministic scripted 'model': the first turn walks the full pipeline
    (one tool per round), later turns echo. No key, no network."""

    async def stream_turn(
        self, system: str, messages: list[dict], tools: list[dict]
    ) -> AsyncIterator[dict]:
        users = _plain_user_texts(messages)
        user_text = users[-1] if users else ""
        if len(users) > 1:
            yield {"kind": "text", "text": f"fake: {user_text}"}
            yield {
                "kind": "final",
                "content": [{"type": "text", "text": f"fake: {user_text}"}],
                "stop_reason": "end_turn",
            }
            return
        rounds = sum(1 for m in messages if m["role"] == "assistant")
        if rounds < len(FAKE_SCRIPT):
            name, make_params = FAKE_SCRIPT[rounds]
            content: list[dict] = []
            if rounds == 0:
                intro = "Bắt đầu tạo nhân vật..."
                yield {"kind": "text", "text": intro}
                content.append({"type": "text", "text": intro})
            params = make_params(_last_tool_result(messages), user_text)
            content.append(
                {"type": "tool_use", "id": f"toolu_fake_{rounds}", "name": name, "input": params}
            )
            yield {"kind": "final", "content": content, "stop_reason": "tool_use"}
            return
        outro = "Xong — nhân vật đang đi bộ."
        yield {"kind": "text", "text": outro}
        yield {
            "kind": "final",
            "content": [{"type": "text", "text": outro}],
            "stop_reason": "end_turn",
        }


def make_backend(db: Session, user_id: int) -> ChatBackend:
    if chat_fake_enabled():
        return FakeBackend()
    record = db.scalar(
        select(ApiKey).where(ApiKey.user_id == user_id, ApiKey.provider == "anthropic")
    )
    if record is None:
        raise ChatSetupError(
            "No anthropic API key stored — add it in the Server dialog (API keys)."
        )
    return AnthropicBackend(decrypt_secret(record.key_encrypted))
