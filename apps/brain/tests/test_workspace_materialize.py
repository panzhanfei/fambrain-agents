import json
from pathlib import Path

import httpx
import pytest
from fambrain_corpus.qdrant import DENSE_VECTOR_SIZE
from fambrain_corpus.workspace import (
    corpus_md_repo_path,
    materialize_workspace_txt,
    purge_workspace_txts,
    workspace_markdown,
)


class _Settings:
    resolved_qdrant_url = "http://qdrant.test"


def _patch_roots(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr("fambrain_corpus.workspace.user_corpus_root", lambda corpus_user_id: tmp_path)
    monkeypatch.setattr("fambrain_corpus.workspace.get_settings", lambda: _Settings())


def test_markdown_wraps_title_and_body() -> None:
    assert workspace_markdown("家/亲属.txt", "我的儿子叫小名\n") == "# 亲属\n\n我的儿子叫小名\n"
    assert corpus_md_repo_path("user-1", "家/亲属.txt") == (
        "users/user-1/corpus/personal/imports/workspace/家/亲属.md"
    )


def test_materialize_upserts_only_this_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_roots(monkeypatch, tmp_path)
    monkeypatch.setattr(
        "fambrain_corpus.workspace.embed_texts",
        lambda texts, timeout=180: [[0.2] * DENSE_VECTOR_SIZE],
    )
    seen: list[tuple[str, str, dict | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        seen.append((request.method, request.url.path, body))
        if request.method == "GET":
            return httpx.Response(404)
        return httpx.Response(200, json={"status": "ok"})

    result = materialize_workspace_txt(
        "user-1",
        "亲属.txt",
        txt_body="我的儿子叫小名",
        transport=httpx.MockTransport(handler),
    )
    markdown = (tmp_path / "personal/imports/workspace/亲属.md").read_text(encoding="utf-8")
    assert result.ok is True
    assert markdown == "# 亲属\n\n我的儿子叫小名\n"
    assert [item[0] for item in seen].count("DELETE") == 0
    points = next(body for method, path, body in seen if method == "PUT" and path.endswith("/points"))
    point = points["points"][0]
    repo_path = "users/user-1/corpus/personal/imports/workspace/亲属.md"
    assert point["payload"]["path"] == repo_path
    assert point["payload"]["sourcePath"] == "vault/originals/workspace/亲属.txt"
    assert point["payload"]["body"] == markdown
    assert point["payload"]["docKind"] == "uncategorized"
    assert len(point["vector"]["dense"]) == DENSE_VECTOR_SIZE
    deleted = next(body for method, path, body in seen if method == "POST" and path.endswith("/points/delete"))
    assert deleted["filter"]["must"][0]["match"]["value"] == repo_path


def test_embed_failure_keeps_markdown_and_skips_qdrant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_roots(monkeypatch, tmp_path)
    request = httpx.Request("POST", "http://ollama.test/api/embed")
    response = httpx.Response(404, text='model "bge-m3" not found', request=request)

    def _embed(texts: list[str], timeout: float = 180) -> list[list[float]]:
        del texts, timeout
        raise httpx.HTTPStatusError("missing", request=request, response=response)

    monkeypatch.setattr("fambrain_corpus.workspace.embed_texts", _embed)

    def handler(call: httpx.Request) -> httpx.Response:
        raise AssertionError(f"should not call qdrant: {call.method} {call.url}")

    result = materialize_workspace_txt(
        "user-1",
        "亲属.txt",
        txt_body="我的儿子叫小名",
        transport=httpx.MockTransport(handler),
    )
    assert result.ok is False
    assert "bge-m3" in result.detail
    assert (tmp_path / "personal/imports/workspace/亲属.md").is_file()


def test_purge_removes_markdown_and_points(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_roots(monkeypatch, tmp_path)
    md_path = tmp_path / "personal/imports/workspace/家/亲属.md"
    md_path.parent.mkdir(parents=True)
    md_path.write_text("# 亲属\n\n爸爸\n", encoding="utf-8")
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        return httpx.Response(200, json={"status": "ok"})

    result = purge_workspace_txts(
        "user-1",
        ["家/亲属.txt"],
        transport=httpx.MockTransport(handler),
    )
    assert result.ok is True
    assert result.detail == "已删除对应语料与向量"
    assert not md_path.exists()
    assert seen == [("POST", "/collections/fambrain_corpus_user-1/points/delete")]
