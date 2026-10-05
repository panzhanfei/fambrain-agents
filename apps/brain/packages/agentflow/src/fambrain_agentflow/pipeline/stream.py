from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator

from fambrain_agentflow.chat.client import ChatCompleter
from fambrain_agentflow.execution.turns import TurnRegistry
from fambrain_agentflow.pipeline.execute import iter_full_turn
from fambrain_agentflow.pipeline.graph import build_pipeline
from fambrain_agentflow.types import ChatTurn, PipelineContext, latest_user_text

_NODE_STEP = {
    "intake": "intake",
    "analyst": "analyst",
    "finish": "intake",
}


async def iter_pipeline_events(
    history: list[ChatTurn],
    context: PipelineContext,
    chat: ChatCompleter,
    turns: TurnRegistry,
) -> AsyncIterator[tuple[str, dict]]:
    if not getattr(chat, "scripted", False):
        async for event in iter_full_turn(history, context, chat, turns):
            yield event
        return
    turn_id = context.turn_id or str(uuid.uuid4())
    question = latest_user_text(history)
    turns.start(
        turn_id,
        actor_user_id=context.actor_user_id,
        conversation_id=context.conversation_id,
    )
    started = time.perf_counter()
    answer = ""
    aborted = False
    abort_reason = "cancelled"
    steps: list[dict] = []
    logs: list[dict] = []
    try:
        yield _step("prepare_turn_start", "running")
        yield _step("prepare_turn_start", "done", 0)
        steps.append({"name": "prepare_turn_start", "status": "done", "durationMs": 0})
        graph = build_pipeline(chat)
        async for update in graph.astream(
            {"question": question, "display_name": context.display_name},
            stream_mode="updates",
        ):
            if turns.is_cancelled(turn_id):
                aborted = True
                abort_reason = turns.reason(turn_id) or "cancelled"
                yield (
                    "aborted",
                    {"type": "aborted", "turnId": turn_id, "reason": abort_reason},
                )
                break
            for node_name, partial in update.items():
                step_name = _NODE_STEP.get(node_name, "analyst")
                yield _step(step_name, "running")
                yield _step(step_name, "done", 0)
                steps.append({"name": step_name, "status": "done", "durationMs": 0})
                if isinstance(partial, dict) and partial.get("answer"):
                    answer = str(partial["answer"])
        if answer and not aborted:
            yield ("assistant", {"type": "assistant", "text": answer})
            logs.append(
                {
                    "id": str(uuid.uuid4()),
                    "at": "",
                    "agent": "analyst",
                    "direction": "out",
                    "label": "answer",
                    "preview": answer[:180],
                }
            )
    except Exception as exc:
        message = str(exc) or "Agent pipeline failed"
        yield ("error", {"type": "error", "message": message})
        answer = ""
    finally:
        turns.finish(turn_id)
    total_ms = int((time.perf_counter() - started) * 1000)
    timing = {"totalMs": total_ms, "ttftMs": None, "nodes": {}}
    if answer and not aborted:
        yield (
            "assistant_message",
            {
                "type": "assistant_message",
                "message": {"plainText": answer, "blocks": [], "citations": []},
            },
        )
    yield ("pipeline_timing", {"type": "pipeline_timing", "timing": timing})
    yield (
        "pipeline_done",
        {
            "answer": "" if aborted else answer,
            "blocks": [],
            "citations": [],
            "timing": timing,
            "logs": logs,
            "steps": steps,
            "aborted": aborted,
            "abortReason": abort_reason if aborted else None,
            "turnId": turn_id,
        },
    )


def _step(name: str, status: str, duration_ms: int | None = None) -> tuple[str, dict]:
    payload: dict = {"type": "step", "name": name, "status": status}
    if duration_ms is not None and status == "done":
        payload["durationMs"] = duration_ms
    return "step", payload
