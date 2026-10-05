from __future__ import annotations

import re
from datetime import date
from pathlib import Path

import httpx
from fambrain_kernel.config import find_repo_root

from fambrain_agentflow.corpus.search import CorpusHit
from fambrain_agentflow.tools.invoke import age_from_hits

_URL = re.compile(r"https?://[^\s)>\]]+")
_NAME_ROW = re.compile(r"姓名\s*\|\s*([^|\n]+)")


def extract_identity(hits: list[CorpusHit], field: str | None) -> str | None:
    blob = "\n".join(hit.excerpt for hit in hits)
    if field == "name":
        match = _NAME_ROW.search(blob)
        if match:
            return match.group(1).strip()
    if field in {"phone", "email"}:
        if field == "phone":
            found = re.search(r"1[3-9]\d{9}", blob)
            return found.group(0) if found else None
        found = re.search(r"[\w.+-]+@[\w.-]+", blob)
        return found.group(0) if found else None
    if field == "birthYear":
        found = re.search(r"(19|20)\d{2}", blob)
        return found.group(0) if found else None
    return None


def extract_links(hits: list[CorpusHit]) -> list[str]:
    found: list[str] = []
    for hit in hits:
        for match in _URL.findall(hit.excerpt):
            if match not in found:
                found.append(match)
    return found


def workspace_root(corpus_user_id: str) -> Path:
    root = (
        find_repo_root()
        / "data"
        / "doc"
        / "users"
        / corpus_user_id
        / "vault"
        / "originals"
        / "workspace"
    )
    root.mkdir(parents=True, exist_ok=True)
    return root


def run_vault(corpus_user_id: str, params: dict | None) -> str:
    body = params or {}
    operation = str(body.get("operation") or "list")
    root = workspace_root(corpus_user_id)
    target = str(body.get("targetPath") or "").strip().lstrip("/")
    destination = (root / target).resolve() if target else root
    if root.resolve() not in destination.parents and destination != root.resolve():
        return "路径超出原文库。"
    if operation == "list":
        names = sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file())
        if not names:
            return "原文库是空的。"
        return "原文库文件：" + "、".join(names)
    if operation == "open":
        if not destination.is_file():
            return "没有这个文件。"
        return destination.read_text(encoding="utf-8", errors="ignore")[:2000]
    if operation == "create_file":
        name = str(body.get("name") or "note.txt")
        parent = destination if destination.is_dir() else destination.parent
        parent.mkdir(parents=True, exist_ok=True)
        file = parent / name
        file.write_text(str(body.get("afterContent") or ""), encoding="utf-8")
        return f"已创建 {file.relative_to(root).as_posix()}"
    if operation == "create_folder":
        name = str(body.get("name") or "folder")
        folder = (destination if destination.is_dir() else destination.parent) / name
        folder.mkdir(parents=True, exist_ok=True)
        return f"已创建文件夹 {folder.relative_to(root).as_posix()}"
    if operation == "update":
        if not destination.is_file():
            return "没有这个文件。"
        destination.write_text(str(body.get("afterContent") or ""), encoding="utf-8")
        return f"已更新 {destination.relative_to(root).as_posix()}"
    if operation in {"delete_file", "delete_folder"}:
        if destination == root.resolve() or not destination.exists():
            return "没有这个路径。"
        if destination.is_file():
            destination.unlink()
        else:
            for child in sorted(destination.rglob("*"), reverse=True):
                if child.is_file():
                    child.unlink()
            destination.rmdir()
        return f"已删除 {target}"
    return "不支持的原文库操作。"


async def run_weather(place: str) -> str:
    if not place.strip():
        return "未提供地点"
    async with httpx.AsyncClient(timeout=20) as client:
        geo = await client.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": place, "count": 1, "language": "zh"},
        )
        geo.raise_for_status()
        results = geo.json().get("results") or []
        if not results:
            return f"没有找到地点 {place}"
        top = results[0]
        forecast = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": top["latitude"],
                "longitude": top["longitude"],
                "current": "temperature_2m,weather_code",
            },
        )
        forecast.raise_for_status()
        current = forecast.json().get("current") or {}
    temp = current.get("temperature_2m")
    return f"{top.get('name', place)} 当前气温 {temp}°C（Open-Meteo）"


def age_line(hits: list[CorpusHit], as_of: date) -> str | None:
    years = age_from_hits([hit.excerpt for hit in hits], as_of)
    if years is None:
        return None
    return f"{years} 岁"
