from __future__ import annotations

import uuid

from uuid_utils import uuid7


def new_id() -> uuid.UUID:
    return uuid.UUID(str(uuid7()))
