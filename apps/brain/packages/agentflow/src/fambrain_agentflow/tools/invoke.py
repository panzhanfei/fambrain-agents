from __future__ import annotations

import re
from datetime import date

from fambrain_agentflow.tools.catalog import PIPELINE_TOOL_TRANSPORT, TOOL_RUN_IDS

_ISO_DATE = re.compile(r"(?<!\d)((?:18|19|20)\d{2})-(\d{2})-(\d{2})(?!\d)")
_YEAR = re.compile(r"(?<!\d)((?:18|19|20)\d{2})(?!\d)")


def age_from_hits(excerpts: list[str], as_of: date) -> int | None:
    for text in excerpts:
        iso = _ISO_DATE.search(text)
        if iso:
            year, month, day = int(iso.group(1)), int(iso.group(2)), int(iso.group(3))
            try:
                born = date(year, month, day)
            except ValueError:
                continue
            years = as_of.year - born.year
            if (as_of.month, as_of.day) < (born.month, born.day):
                years -= 1
            return years
        year_match = _YEAR.search(text)
        if year_match:
            return as_of.year - int(year_match.group(1))
    return None


def invoke_tool(tool_id: str, payload: dict | None = None) -> dict:
    body = payload or {}
    if tool_id == "get_current_date":
        return {"toolId": tool_id, "status": "ok", "date": date.today().isoformat()}
    if tool_id not in TOOL_RUN_IDS:
        return {"toolId": tool_id, "status": "unknown"}
    if tool_id == "compute_age_from_hits":
        excerpts = body.get("excerpts")
        texts = [str(item) for item in excerpts] if isinstance(excerpts, list) else []
        as_of = body.get("asOf")
        if isinstance(as_of, date):
            on_date = as_of
        elif isinstance(as_of, str):
            on_date = date.fromisoformat(as_of)
        else:
            on_date = date.today()
        age = age_from_hits(texts, on_date)
        if age is None:
            return {"toolId": tool_id, "status": "empty"}
        return {"toolId": tool_id, "status": "ok", "age": age}
    return {
        "toolId": tool_id,
        "status": "registered",
        "transport": PIPELINE_TOOL_TRANSPORT[tool_id],
    }
