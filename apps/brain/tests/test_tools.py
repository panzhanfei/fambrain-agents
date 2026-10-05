from datetime import date

from fambrain_agentflow.corpus.qdrant import EMBEDDING_MODEL, corpus_collection_name
from fambrain_agentflow.tools.catalog import resolve_identity_field
from fambrain_agentflow.tools.invoke import age_from_hits, invoke_tool


def test_identity_field_maps_to_executor():
    spec = resolve_identity_field("age")
    assert spec is not None
    assert spec["toolId"] == "compute_age_from_hits"
    assert resolve_identity_field("education")["toolId"] is None
    assert resolve_identity_field(None) is None


def test_age_from_iso_excerpt():
    age = age_from_hits(["出生日期 1990-05-01"], date(2026, 10, 5))
    assert age == 36


def test_age_empty_when_excerpt_has_no_date():
    assert age_from_hits(["没有日期"], date(2026, 10, 5)) is None


def test_invoke_registered_transport():
    result = invoke_tool("search_web")
    assert result["status"] == "registered"
    assert result["transport"] == "http"
    assert invoke_tool("not_a_tool")["status"] == "unknown"


def test_corpus_collection_name():
    assert corpus_collection_name("user-1") == "fambrain_corpus_user-1"
    assert EMBEDDING_MODEL == "nomic-embed-text"
