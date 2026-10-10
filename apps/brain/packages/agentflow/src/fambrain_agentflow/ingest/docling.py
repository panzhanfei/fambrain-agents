"""Turn PDF and Office files into markdown through Docling Serve."""

from __future__ import annotations

from pathlib import Path

import httpx
from fambrain_kernel.config import get_settings

_PLAIN_TEXT = {".md", ".txt", ".markdown"}


def parse_to_markdown(path: Path) -> str:
    """Plain text is read directly. PDF and Office go through Docling Serve."""
    suffix = path.suffix.lower()
    if suffix in _PLAIN_TEXT:
        return path.read_text(encoding="utf-8", errors="ignore")
    settings = get_settings()
    url = f"{settings.docling_serve_url.rstrip('/')}/v1/convert/file"
    try:
        with path.open("rb") as handle:
            response = httpx.post(
                url,
                files={"files": (path.name, handle, "application/octet-stream")},
                data=[
                    ("to_formats", "md"),
                    ("image_export_mode", "placeholder"),
                    ("include_images", "false"),
                    ("do_ocr", "true"),
                    ("ocr_lang", "zh"),
                    ("ocr_lang", "en"),
                ],
                timeout=180,
            )
    except httpx.HTTPError as exc:
        raise RuntimeError("Docling 服务未就绪，先执行 docker compose up -d docling") from exc
    if response.status_code >= 400:
        detail = response.text.strip()[:300] or "Docling 解析失败"
        raise RuntimeError(detail)
    body = response.json()
    document = body.get("document") if isinstance(body, dict) else None
    markdown = document.get("md_content") if isinstance(document, dict) else None
    if isinstance(markdown, str) and markdown.strip():
        return markdown
    errors = body.get("errors") if isinstance(body, dict) else None
    detail = str(errors) if errors else "Docling 没有抽出文本"
    raise RuntimeError(detail)
