from __future__ import annotations

from dataclasses import dataclass


@dataclass
class TurnEntry:
    actor_user_id: str
    conversation_id: str
    cancelled: bool = False
    paused: bool = False
    abort_reason: str = "cancelled"


class TurnRegistry:
    def __init__(self) -> None:
        self._turns: dict[str, TurnEntry] = {}

    def start(self, turn_id: str, *, actor_user_id: str, conversation_id: str) -> None:
        self._turns[turn_id] = TurnEntry(
            actor_user_id=actor_user_id,
            conversation_id=conversation_id,
        )

    def get(self, turn_id: str) -> TurnEntry | None:
        return self._turns.get(turn_id)

    def pause(self, turn_id: str) -> bool:
        entry = self._turns.get(turn_id)
        if entry is None or entry.paused or entry.cancelled:
            return False
        entry.paused = True
        entry.abort_reason = "paused"
        return True

    def cancel(self, turn_id: str, reason: str) -> bool:
        entry = self._turns.get(turn_id)
        if entry is None or entry.cancelled:
            return False
        entry.cancelled = True
        entry.abort_reason = reason
        return True

    def is_cancelled(self, turn_id: str) -> bool:
        entry = self._turns.get(turn_id)
        return bool(entry and (entry.cancelled or entry.paused))

    def reason(self, turn_id: str) -> str | None:
        entry = self._turns.get(turn_id)
        if entry is None:
            return None
        return entry.abort_reason

    def finish(self, turn_id: str) -> None:
        self._turns.pop(turn_id, None)
