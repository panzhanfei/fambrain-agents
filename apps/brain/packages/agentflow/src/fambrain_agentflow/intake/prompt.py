from __future__ import annotations

from pathlib import Path

_PROMPT_PATH = Path(__file__).with_name("prompt.txt")


def intake_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")
