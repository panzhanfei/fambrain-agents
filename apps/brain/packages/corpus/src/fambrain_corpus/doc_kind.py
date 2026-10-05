from __future__ import annotations

import re

DOC_KINDS = ("identity_card", "experience", "project", "relations", "uncategorized")
_NAME_LABELS = ("姓名", "名字")
_EMPTY = re.compile(r"[-—–/\s]*")
_SEPARATOR = re.compile(r"[-:]+")


def _tables(text: str) -> list[list[list[str]]]:
    tables: list[list[list[str]]] = []
    current: list[list[str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            if len(cells) >= 2 and all(_SEPARATOR.fullmatch(cell or "-") for cell in cells):
                continue
            if len(cells) >= 2:
                current.append(cells)
                continue
        if current:
            tables.append(current)
            current = []
    if current:
        tables.append(current)
    return tables


def is_relations_roster(text: str) -> bool:
    name_rows = 0
    for table in _tables(text):
        header = table[0]
        name_col = next(
            (index for index, cell in enumerate(header) if any(label in cell for label in _NAME_LABELS)),
            -1,
        )
        if name_col >= 0 and len(table) >= 2:
            filled = [
                row
                for row in table[1:]
                if name_col < len(row) and row[name_col] and not _EMPTY.fullmatch(row[name_col])
            ]
            if len(filled) >= 2:
                return True
        for row in table:
            label = row[0] if row else ""
            value = row[1] if len(row) > 1 else ""
            if any(token in label for token in _NAME_LABELS) and value and not _EMPTY.fullmatch(value):
                name_rows += 1
    return name_rows >= 2


def infer_doc_kind(repo_path: str, body: str = "") -> str:
    lowered = repo_path.replace("\\", "/").lower()
    if "/experience/" in lowered:
        return "experience"
    if "/projects/" in lowered:
        return "project"
    if "/personal/imports/" in lowered or "/learned/" in lowered:
        return "uncategorized"
    if "/personal/" in lowered:
        if "亲友" in repo_path or is_relations_roster(body):
            return "relations"
        return "identity_card"
    return "uncategorized"


def kinds_for_query(query_type: str, topics: list[str] | None = None) -> set[str] | None:
    topic_set = {topic.lower() for topic in topics or []}
    if query_type == "identity":
        if topic_set & {"tenure", "career"}:
            return {"identity_card", "experience"}
        return {"identity_card"}
    if query_type == "tech":
        return {"project", "experience"}
    if query_type == "enumeration":
        return {"experience", "project"}
    if query_type == "external_link":
        return {"project", "experience", "identity_card"}
    if query_type == "relations" or "family" in topic_set:
        return {"relations"}
    if "experience" in topic_set or "career" in topic_set:
        kinds = {"experience"}
        if "project" in topic_set:
            kinds.add("project")
        return kinds
    if "project" in topic_set:
        return {"project"}
    return None
