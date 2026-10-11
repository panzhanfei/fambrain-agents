from pathlib import Path

import httpx
from fambrain_agentflow.ingest.docling import parse_to_markdown
from fambrain_api.routes.documents import _category_summary


def test_pdf_convert_form_encodes_as_multipart(tmp_path: Path, monkeypatch) -> None:
    captured: dict = {}

    class _Response:
        status_code = 200

        def json(self) -> dict:
            return {"document": {"md_content": "抽出的正文"}}

    def fake_post(url: str, **kwargs):
        request = httpx.Request(
            "POST",
            url,
            files=kwargs["files"],
            data=kwargs["data"],
        )
        captured["data"] = kwargs["data"]
        captured["body"] = request.read()
        return _Response()

    monkeypatch.setattr("fambrain_agentflow.ingest.docling.httpx.post", fake_post)
    path = tmp_path / "note.pdf"
    path.write_bytes(b"%PDF-1.4\n")

    assert parse_to_markdown(path) == "抽出的正文"
    assert isinstance(captured["data"], dict)
    assert "ocr_lang" not in captured["data"]
    body = captured["body"]
    assert b'name="to_formats"' in body
    assert b'name="do_ocr"' in body


def test_category_summary_keeps_empty_buckets() -> None:
    summary = _category_summary(
        [
            {"ok": False, "category": "personal"},
            {"ok": True, "category": "projects"},
        ]
    )
    assert summary == {"personal": 0, "projects": 1, "experience": 0}
