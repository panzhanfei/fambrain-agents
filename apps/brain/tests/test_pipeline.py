from fambrain_agentflow.chat.client import ScriptedChat
from fambrain_agentflow.pipeline.graph import build_pipeline
from fambrain_agentflow.types import IntakeDecision

from tests.conftest import bearer, parse_sse, seed_active_user


async def test_clarify_uses_model_reply():
    chat = ScriptedChat(IntakeDecision(route="clarify", reply="再说具体一点"), "不应出现")
    graph = build_pipeline(chat)
    result = await graph.ainvoke({"question": "随便", "display_name": "甲"})
    assert result["answer"] == "再说具体一点"


async def test_empty_question_clarifies_without_model_text():
    chat = ScriptedChat(IntakeDecision(route="answer", reply=""), "不应出现")
    graph = build_pipeline(chat)
    result = await graph.ainvoke({"question": "   ", "display_name": "甲"})
    assert result["answer"] == "请把问题说得更具体一些。"


async def test_pipeline_stream_matches_sse_contract(client, app):
    user_id = seed_active_user()
    response = await client.post(
        "/pipeline/stream",
        headers=bearer(app, user_id),
        json={
            "history": [{"role": "user", "content": "家里的情况"}],
            "context": {
                "actorUserId": user_id,
                "corpusUserId": user_id,
                "displayName": "展飞",
                "conversationId": "conv-1",
            },
        },
    )
    assert response.status_code == 200
    events = parse_sse(response.text)
    names = [name for name, _ in events]
    assert "pipeline_done" in names
    done = next(payload for name, payload in events if name == "pipeline_done")
    assert done["answer"] == "测试回答"
    assert done["aborted"] is False
    assistant = [
        payload
        for _, payload in events
        if payload.get("type") == "assistant" and payload.get("text") == "测试回答"
    ]
    assert assistant


async def test_pipeline_rejects_other_actor(client, app):
    user_id = seed_active_user()
    response = await client.post(
        "/pipeline/stream",
        headers=bearer(app, user_id),
        json={
            "history": [{"role": "user", "content": "家里的情况"}],
            "context": {
                "actorUserId": "00000000-0000-0000-0000-000000000001",
                "corpusUserId": "00000000-0000-0000-0000-000000000001",
                "displayName": "展飞",
                "conversationId": "conv-1",
            },
        },
    )
    assert response.status_code == 403


async def test_cancel_unknown_turn(client, app):
    user_id = seed_active_user()
    response = await client.post(
        "/pipeline/cancel",
        headers=bearer(app, user_id),
        json={"turnId": "11111111-1111-1111-1111-111111111111", "reason": "cancelled"},
    )
    assert response.status_code == 200
    assert response.json()["aborted"] is False
