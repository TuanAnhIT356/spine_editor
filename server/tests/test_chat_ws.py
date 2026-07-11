import json

import pytest
from starlette.websockets import WebSocketDisconnect

FAKE_TOOL_RESULTS = {
    "generate_image": {"name": "gen-1", "width": 8, "height": 8, "galleryId": 1},
    "segment_image": {"assets": ["head"], "slots": ["head"], "warnings": []},
    "rig_from_parts": {"bones": ["hip", "spine"], "ik": ["ik_arm_l"], "slots": ["torso"]},
    "apply_preset_animation": {"animation": "walk", "tracks": 8, "keys": 30},
    "screenshot_viewport": {"dataUrl": "data:image/png;base64,AAAA"},
}

HELLO = {
    "type": "hello",
    "tools": [
        {"name": n, "description": "d" * 12, "input_schema": {"type": "object", "properties": {}}}
        for n in FAKE_TOOL_RESULTS
    ],
}


def token_of(auth_client) -> str:
    return auth_client.headers["authorization"].split(" ", 1)[1]


def drive_turn(ws, text: str) -> tuple[list[str], str]:
    """Send a user message, answer every op, return (tools called, stop reason)."""
    ws.send_json({"type": "user", "text": text})
    called: list[str] = []
    while True:
        msg = ws.receive_json()
        if msg["type"] == "op":
            called.append(msg["tool"])
            result = FAKE_TOOL_RESULTS.get(msg["tool"], {"ok": True})
            ws.send_json(
                {
                    "type": "op_result",
                    "id": msg["id"],
                    "ok": True,
                    "content": [{"type": "text", "text": json.dumps(result)}],
                }
            )
        elif msg["type"] == "turn_done":
            return called, msg["stopReason"]
        elif msg["type"] == "error":
            raise AssertionError(f"chat error: {msg['message']}")


def test_ws_rejects_bad_token(client):
    with (
        pytest.raises(WebSocketDisconnect) as err,
        client.websocket_connect("/api/chat/ws?token=nope") as ws,
    ):
        ws.receive_json()
    assert err.value.code == 4001


def test_ws_requires_hello_first(client, auth_client):
    with (
        pytest.raises(WebSocketDisconnect) as err,
        client.websocket_connect(f"/api/chat/ws?token={token_of(auth_client)}") as ws,
    ):
        ws.send_json({"type": "user", "text": "hi"})
        ws.receive_json()
    assert err.value.code == 4002


def test_ws_foreign_conversation_closes_4003(client, auth_client):
    with (
        pytest.raises(WebSocketDisconnect) as err,
        client.websocket_connect(
            f"/api/chat/ws?token={token_of(auth_client)}&conversation=999999"
        ) as ws,
    ):
        ws.receive_json()
    assert err.value.code == 4003


def test_fake_turn_runs_pipeline_and_persists(client, auth_client):
    with client.websocket_connect(f"/api/chat/ws?token={token_of(auth_client)}") as ws:
        ws.send_json(HELLO)
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        conv_id = ready["conversation"]

        called, stop = drive_turn(ws, "make a knight and make it walk")
        assert called == [
            "generate_image",
            "segment_image",
            "rig_from_parts",
            "apply_preset_animation",
            "screenshot_viewport",
        ]
        assert stop == "end_turn"

        # title message arrives after the first turn
        title_msg = ws.receive_json()
        assert title_msg["type"] == "title"
        assert title_msg["text"].startswith("make a knight")

        # second turn in the same ws: fake echoes (history-aware resume path)
        called2, stop2 = drive_turn(ws, "thanks")
        assert called2 == []
        assert stop2 == "end_turn"

    msgs = auth_client.get(f"/api/chat/conversations/{conv_id}/messages").json()
    roles = [m["role"] for m in msgs]
    assert roles[0] == "user" and roles[-1] == "assistant"
    tool_uses = [
        b for m in msgs if m["role"] == "assistant" for b in m["content"] if b["type"] == "tool_use"
    ]
    assert [t["name"] for t in tool_uses] == called
    tool_results = [
        b
        for m in msgs
        if m["role"] == "user"
        for b in m["content"]
        if isinstance(b, dict) and b.get("type") == "tool_result"
    ]
    assert len(tool_results) == 5
    convs = auth_client.get("/api/chat/conversations").json()
    assert any(c["id"] == conv_id and c["title"].startswith("make a knight") for c in convs)


def test_op_error_becomes_tool_result_error(client, auth_client):
    with client.websocket_connect(f"/api/chat/ws?token={token_of(auth_client)}") as ws:
        ws.send_json(HELLO)
        ws.receive_json()
        ws.send_json({"type": "user", "text": "go"})
        first_op = ws.receive_json()
        while first_op["type"] != "op":  # skip streamed text deltas
            first_op = ws.receive_json()
        ws.send_json({"type": "op_result", "id": first_op["id"], "ok": False, "error": "boom"})
        # fake keeps following its script; drain remaining ops then finish
        while True:
            msg = ws.receive_json()
            if msg["type"] == "op":
                ws.send_json(
                    {
                        "type": "op_result",
                        "id": msg["id"],
                        "ok": True,
                        "content": [{"type": "text", "text": "{}"}],
                    }
                )
            elif msg["type"] == "turn_done":
                break


def test_missing_key_without_fake(client, auth_client, monkeypatch):
    monkeypatch.delenv("SPINE_SERVER_CHAT_FAKE", raising=False)
    with client.websocket_connect(f"/api/chat/ws?token={token_of(auth_client)}") as ws:
        ws.send_json(HELLO)
        ws.receive_json()
        ws.send_json({"type": "user", "text": "hi"})
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert "anthropic" in msg["message"].lower()
