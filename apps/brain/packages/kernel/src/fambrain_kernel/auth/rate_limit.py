from __future__ import annotations

import time


class WindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}

    def allow(self, key: str, max_hits: int, window_s: float) -> tuple[bool, int]:
        now = time.monotonic()
        hits = [stamp for stamp in self._hits.get(key, []) if now - stamp < window_s]
        if len(hits) >= max_hits:
            retry = int(window_s - (now - hits[0])) + 1
            self._hits[key] = hits
            return False, max(retry, 1)
        hits.append(now)
        self._hits[key] = hits
        return True, 0
