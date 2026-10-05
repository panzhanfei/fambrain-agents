from __future__ import annotations

from dataclasses import dataclass

from fambrain_corpus.doc_kind import infer_doc_kind


@dataclass(frozen=True)
class CorpusChunk:
    corpus_user_id: str
    path: str
    title: str
    body: str
    chunk_index: int
    doc_kind: str


def _title(file_name: str, body: str) -> str:
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip() or file_name.removesuffix(".md")
    return file_name.removesuffix(".md")


def split_markdown(corpus_user_id: str, repo_path: str, body: str, file_name: str) -> list[CorpusChunk]:
    trimmed = body.strip()
    if not trimmed:
        return []
    title = _title(file_name, trimmed)
    doc_kind = infer_doc_kind(repo_path, trimmed)
    sections = trimmed.split("\n## ")
    if len(sections) <= 1:
        return [
            CorpusChunk(
                corpus_user_id=corpus_user_id,
                path=repo_path,
                title=title,
                body=trimmed,
                chunk_index=0,
                doc_kind=doc_kind,
            )
        ]
    chunks: list[CorpusChunk] = []
    for index, raw in enumerate(sections):
        text = raw.strip()
        if not text:
            continue
        if index > 0:
            text = f"## {text}"
        chunks.append(
            CorpusChunk(
                corpus_user_id=corpus_user_id,
                path=repo_path,
                title=title,
                body=text,
                chunk_index=len(chunks),
                doc_kind=doc_kind,
            )
        )
    return chunks
