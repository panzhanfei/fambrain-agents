from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

_CJK_RUN = re.compile(r"^[\u4e00-\u9fff]+$")


def tokenize_for_recall(*parts: str) -> list[str]:
    raw = " ".join(parts).lower()
    segments = [token for token in re.split(r"[^a-z0-9\u4e00-\u9fff]+", raw) if len(token) >= 2]
    expanded: list[str] = []
    for token in segments:
        expanded.append(token)
        if _CJK_RUN.fullmatch(token) and len(token) > 2:
            expanded.extend(token[index : index + 2] for index in range(len(token) - 1))
    return list(dict.fromkeys(expanded))


def token_to_sparse_index(token: str) -> int:
    digest = hashlib.sha256(token.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big")


@dataclass(frozen=True)
class SparseVector:
    indices: list[int]
    values: list[float]

    def as_query(self) -> dict:
        return {"indices": self.indices, "values": self.values}


def text_to_sparse_vector(*parts: str) -> SparseVector:
    counts: dict[int, float] = {}
    for token in tokenize_for_recall(*parts):
        index = token_to_sparse_index(token)
        counts[index] = counts.get(index, 0) + 1
    indices = sorted(counts)
    return SparseVector(indices=indices, values=[counts[index] for index in indices])
