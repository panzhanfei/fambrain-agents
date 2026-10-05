from __future__ import annotations

from pathlib import Path


def parse_to_markdown(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".md", ".txt", ".markdown"}:
        return path.read_text(encoding="utf-8", errors="ignore")
    try:
        from docling.document_converter import DocumentConverter
    except ImportError as exc:
        raise RuntimeError("解析该格式需要安装 docling") from exc
    converted = DocumentConverter().convert(str(path))
    return converted.document.export_to_markdown()
