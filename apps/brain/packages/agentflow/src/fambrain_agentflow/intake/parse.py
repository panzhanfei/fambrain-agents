from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

_KINDS = {"km", "list", "mem", "tool", "summarize", "dag", "vault_workspace"}
_INTENTS = {
    "retrieve_and_answer",
    "summarize_content",
    "direct_answer",
    "clarify",
    "chitchat",
    "out_of_scope",
    "remember_user_fact",
    "recall_user_fact",
}
_QUERY_TYPES = {"identity", "enumeration", "tech", "external_link", "relations", "default"}


class PlanStep(BaseModel):
    id: str
    kind: str
    label: str = ""
    search_query: str = ""
    query_type: str = "default"
    topics: list[str] = Field(default_factory=list)
    identity_field: str | None = None
    tool_id: str | None = None
    data_source: str | None = None
    user_fact_key: str | None = None
    user_fact_label: str | None = None
    user_fact_value: str | None = None
    target_lang: str | None = None
    source_lang: str | None = None
    enumeration: dict[str, Any] | None = None
    params: dict[str, Any] | None = None
    nodes: list[dict[str, Any]] | None = None


class IntakePlan(BaseModel):
    intent: str = "clarify"
    search_query: str = ""
    clarifying_question: str | None = None
    brief_reply: str | None = None
    compose_mode: str = "qa"
    steps: list[PlanStep] = Field(default_factory=list)
    user_fact_key: str | None = None
    user_fact_label: str | None = None
    user_fact_value: str | None = None
    coreference: str = "none"


def _pick(raw: dict, *names: str) -> Any:
    for name in names:
        if name in raw:
            return raw[name]
    return None


def _step(raw: dict, index: int) -> PlanStep | None:
    kind = str(_pick(raw, "kind", "pathKind", "path_kind") or "").strip()
    if kind not in _KINDS:
        return None
    query_type = str(_pick(raw, "queryType", "query_type") or "default")
    if query_type not in _QUERY_TYPES:
        query_type = "default"
    topics_raw = raw.get("topics") or []
    topics = [str(item) for item in topics_raw] if isinstance(topics_raw, list) else []
    enumeration = _pick(raw, "enumerationControl", "enumeration_control")
    return PlanStep(
        id=str(raw.get("id") or f"step-{index}"),
        kind=kind,
        label=str(raw.get("label") or ""),
        search_query=str(_pick(raw, "searchQuery", "search_query") or ""),
        query_type=query_type,
        topics=topics,
        identity_field=_as_str(_pick(raw, "identityField", "identity_field")),
        tool_id=_as_str(_pick(raw, "toolId", "tool_id")),
        data_source=_as_str(_pick(raw, "dataSource", "data_source")),
        user_fact_key=_as_str(_pick(raw, "userFactKey", "user_fact_key")),
        user_fact_label=_as_str(_pick(raw, "userFactLabel", "user_fact_label")),
        user_fact_value=_as_str(_pick(raw, "userFactValue", "user_fact_value")),
        target_lang=_as_str(_pick(raw, "targetLang", "target_lang")),
        source_lang=_as_str(_pick(raw, "sourceLang", "source_lang")),
        enumeration=enumeration if isinstance(enumeration, dict) else None,
        params=raw.get("params") if isinstance(raw.get("params"), dict) else None,
        nodes=raw.get("nodes") if isinstance(raw.get("nodes"), list) else None,
    )


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_intake(payload: object) -> IntakePlan:
    if isinstance(payload, str):
        start = payload.find("{")
        end = payload.rfind("}")
        if start < 0 or end < start:
            return IntakePlan(intent="clarify", clarifying_question="请把问题说得更具体一些。")
        try:
            payload = json.loads(payload[start : end + 1])
        except json.JSONDecodeError:
            return IntakePlan(intent="clarify", clarifying_question="请把问题说得更具体一些。")
    if not isinstance(payload, dict):
        return IntakePlan(intent="clarify", clarifying_question="请把问题说得更具体一些。")
    intent = str(_pick(payload, "intent") or "clarify")
    if intent not in _INTENTS:
        intent = "clarify"
    path_plan = _pick(payload, "pathPlan", "path_plan") or {}
    raw_steps = path_plan.get("steps") if isinstance(path_plan, dict) else []
    steps: list[PlanStep] = []
    if isinstance(raw_steps, list):
        for index, item in enumerate(raw_steps):
            if isinstance(item, dict):
                step = _step(item, index)
                if step is not None:
                    steps.append(step)
    if intent == "retrieve_and_answer" and not steps:
        intent = "clarify"
    compose = str(_pick(payload, "composeMode", "compose_mode") or "qa")
    if compose not in {"qa", "composite", "summarize"}:
        compose = "composite" if len(steps) > 1 else "qa"
    return IntakePlan(
        intent=intent,
        search_query=str(_pick(payload, "searchQuery", "search_query") or ""),
        clarifying_question=_as_str(_pick(payload, "clarifyingQuestion", "clarifying_question")),
        brief_reply=_as_str(_pick(payload, "briefReply", "brief_reply")),
        compose_mode=compose,
        steps=steps,
        user_fact_key=_as_str(_pick(payload, "userFactKey", "user_fact_key")),
        user_fact_label=_as_str(_pick(payload, "userFactLabel", "user_fact_label")),
        user_fact_value=_as_str(_pick(payload, "userFactValue", "user_fact_value")),
        coreference=str(payload.get("coreference") or "none"),
    )
