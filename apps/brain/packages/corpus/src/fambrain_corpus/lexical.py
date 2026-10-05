from __future__ import annotations

import re
from dataclasses import dataclass

from fambrain_corpus.doc_kind import infer_doc_kind, kinds_for_query
from fambrain_corpus.paths import is_noise_path, repo_path, user_corpus_root

_CJK = re.compile(r"[\u4e00-\u9fff]")
_LATIN = re.compile(r"[A-Za-z][A-Za-z0-9+#.]{1,}")


@dataclass(frozen=True)
class CorpusHit:
    path: str
    excerpt: str
    score: float


def _terms(query: str) -> list[str]:
    terms = [match.group(0).lower() for match in _LATIN.finditer(query)]
    chars = _CJK.findall(query)
    terms.extend(chars[index] + chars[index + 1] for index in range(len(chars) - 1))
    return [term for term in terms if term.strip()]


def _path_boost(relative: str, query_type: str, topics: list[str]) -> float:
    lowered = relative.lower()
    boost = 1.0
    topic_set = {topic.lower() for topic in topics}
    if query_type == "identity" or "personal" in topic_set or "resume" in topic_set:
        if "/personal/" in lowered:
            boost += 2.0
    if query_type == "relations" or "family" in topic_set:
        if "family" in lowered or "关系" in relative or "亲友" in relative:
            boost += 2.5
        elif "/personal/" in lowered:
            boost += 0.4
    if "experience" in topic_set and "/experience/" in lowered:
        boost += 1.5
    if "project" in topic_set and ("/projects/" in lowered or "/project/" in lowered):
        boost += 1.5
    if "/imports/" in lowered:
        boost -= 0.8
    if query_type == "identity" and ("亲友" in relative or "family" in lowered):
        boost -= 2.0
    if query_type == "identity" and "简历" in relative:
        boost += 3.0
    return boost


def search_lexical(
    corpus_user_id: str,
    search_query: str,
    *,
    query_type: str = "default",
    topics: list[str] | None = None,
    limit: int = 6,
) -> list[CorpusHit]:
    root = user_corpus_root(corpus_user_id)
    if not root.is_dir():
        return []
    terms = _terms(search_query)
    topic_list = topics or []
    allowed = kinds_for_query(query_type, topic_list)
    ranked: list[CorpusHit] = []
    for path in root.rglob("*.md"):
        relative = repo_path(path)
        if path.name.startswith("_") or is_noise_path(relative):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        kind = infer_doc_kind(relative, text)
        if allowed is not None and kind not in allowed:
            continue
        haystack = text.lower()
        overlap = sum(1 for term in terms if term.lower() in haystack)
        structural_identity = (
            query_type == "identity" and kind == "identity_card" and "简历" in path.name and overlap == 0
        )
        if terms and overlap == 0 and not structural_identity:
            continue
        base = 1.0 if structural_identity else overlap / max(len(terms), 1)
        score = base * _path_boost("/" + relative, query_type, topic_list)
        if score <= 0:
            continue
        excerpt = text.strip().replace("\n", " ")[:500]
        ranked.append(CorpusHit(path=relative, excerpt=excerpt, score=score))
    ranked.sort(key=lambda hit: hit.score, reverse=True)
    if ranked:
        return ranked[:limit]
    if query_type != "identity":
        return []
    personal = root / "personal"
    if not personal.is_dir():
        return []
    fallback: list[CorpusHit] = []
    for path in personal.rglob("*.md"):
        relative = repo_path(path)
        if is_noise_path(relative):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        score = 2.0 if "简历" in path.name else 1.0
        excerpt = text.strip().replace("\n", " ")[:500]
        fallback.append(CorpusHit(path=relative, excerpt=excerpt, score=score))
    fallback.sort(key=lambda hit: hit.score, reverse=True)
    return fallback[:limit]


def list_corpus_entries(
    corpus_user_id: str,
    list_kind: str,
    *,
    exclude_hint: str | None = None,
) -> list[CorpusHit]:
    folder = "experience" if list_kind == "experience" else "projects"
    root = user_corpus_root(corpus_user_id) / folder
    if not root.is_dir():
        return []
    hits: list[CorpusHit] = []
    for path in sorted(root.glob("*.md")):
        relative = repo_path(path)
        if is_noise_path(relative):
            continue
        if exclude_hint and exclude_hint in path.stem:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        hits.append(CorpusHit(path=relative, excerpt=text.strip().replace("\n", " ")[:240], score=1.0))
    return hits
