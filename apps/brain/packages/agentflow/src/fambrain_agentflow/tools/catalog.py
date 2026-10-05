from __future__ import annotations

from typing import Literal

ToolRunId = Literal[
    "retrieve_corpus",
    "list_corpus_entries",
    "compute_age_from_hits",
    "compute_tenure_from_hits",
    "extract_identity_from_hits",
    "extract_external_links_from_hits",
    "compose_enumeration",
    "search_web",
    "translate_text",
    "synthesize_merge",
    "get_weather",
]

TOOL_RUN_IDS: tuple[str, ...] = (
    "retrieve_corpus",
    "list_corpus_entries",
    "compute_age_from_hits",
    "compute_tenure_from_hits",
    "extract_identity_from_hits",
    "extract_external_links_from_hits",
    "compose_enumeration",
    "search_web",
    "translate_text",
    "synthesize_merge",
    "get_weather",
)

POST_RETRIEVAL_TOOL_IDS: frozenset[str] = frozenset(
    {
        "retrieve_corpus",
        "list_corpus_entries",
        "compute_age_from_hits",
        "compute_tenure_from_hits",
        "extract_identity_from_hits",
        "extract_external_links_from_hits",
        "compose_enumeration",
    }
)

PIPELINE_TOOL_TRANSPORT: dict[str, str] = {
    "retrieve_corpus": "local",
    "list_corpus_entries": "local",
    "compute_age_from_hits": "local",
    "compute_tenure_from_hits": "local",
    "extract_identity_from_hits": "local",
    "extract_external_links_from_hits": "local",
    "compose_enumeration": "local",
    "search_web": "http",
    "translate_text": "http",
    "synthesize_merge": "local",
    "get_weather": "mcp",
}

IDENTITY_FIELD_BY_ID: dict[str, dict[str, str | bool | None]] = {
    "age": {"id": "age", "toolId": "compute_age_from_hits", "requiresCompute": True},
    "birthYear": {
        "id": "birthYear",
        "toolId": "extract_identity_from_hits",
        "requiresCompute": False,
    },
    "name": {"id": "name", "toolId": "extract_identity_from_hits", "requiresCompute": False},
    "education": {"id": "education", "toolId": None, "requiresCompute": False},
    "career": {"id": "career", "toolId": None, "requiresCompute": False},
    "tenure": {"id": "tenure", "toolId": "compute_tenure_from_hits", "requiresCompute": True},
    "email": {"id": "email", "toolId": None, "requiresCompute": False},
    "phone": {"id": "phone", "toolId": None, "requiresCompute": False},
}


def resolve_identity_field(identity_field: str | None) -> dict | None:
    if not identity_field:
        return None
    return IDENTITY_FIELD_BY_ID.get(identity_field)


def is_post_retrieval_tool_id(tool_id: str | None) -> bool:
    return bool(tool_id and tool_id in POST_RETRIEVAL_TOOL_IDS)
