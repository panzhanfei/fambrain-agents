from __future__ import annotations

import json
from pathlib import Path

from fambrain_kernel.config import find_repo_root


def _path() -> Path:
    directory = find_repo_root() / "data" / "memory" / "py"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "facts.json"


def _load() -> dict:
    file = _path()
    if not file.is_file():
        return {}
    try:
        return json.loads(file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save(data: dict) -> None:
    _path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def remember_fact(corpus_user_id: str, key: str, value: str, label: str | None = None) -> None:
    data = _load()
    bucket = data.setdefault(corpus_user_id, {})
    bucket[key] = {"value": value, "label": label or key}
    _save(data)
    try:
        from fambrain_memory.qdrant_store import add_user_memory

        add_user_memory(corpus_user_id, f"{label or key}是{value}", {"userFactKey": key})
    except Exception:
        return


def recall_fact(corpus_user_id: str, key: str) -> dict | None:
    bucket = _load().get(corpus_user_id) or {}
    found = bucket.get(key)
    return found if isinstance(found, dict) else None
