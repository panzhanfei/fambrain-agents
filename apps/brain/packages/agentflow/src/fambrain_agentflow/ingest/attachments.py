from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field


@dataclass
class StagedFile:
    file_name: str
    ok: bool
    text: str = ""
    error: str | None = None
    format: str | None = None


@dataclass
class AttachmentBatch:
    batch_id: str
    actor_user_id: str
    created_at: float
    files: list[StagedFile] = field(default_factory=list)


_STORE: dict[str, AttachmentBatch] = {}
_TTL_SEC = 60 * 30


def _sweep() -> None:
    now = time.time()
    expired = [key for key, batch in _STORE.items() if now - batch.created_at > _TTL_SEC]
    for key in expired:
        _STORE.pop(key, None)


def stage_batch(actor_user_id: str, files: list[StagedFile]) -> AttachmentBatch:
    _sweep()
    batch = AttachmentBatch(
        batch_id=str(uuid.uuid4()),
        actor_user_id=actor_user_id,
        created_at=time.time(),
        files=files,
    )
    _STORE[batch.batch_id] = batch
    return batch


def attachment_text(batch_id: str, actor_user_id: str) -> str:
    batch = _STORE.get(batch_id)
    if batch is None or batch.actor_user_id != actor_user_id:
        return ""
    parts = [item.text.strip() for item in batch.files if item.ok and item.text.strip()]
    return "\n\n".join(parts)
