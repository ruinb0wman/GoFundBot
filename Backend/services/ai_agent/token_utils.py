"""Token estimation utility — rough heuristic for Chinese/English mixed text."""

import os
from typing import Any


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    cjk = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    ascii_count = sum(1 for c in text if ord(c) < 128)
    other = len(text) - cjk - ascii_count
    return int(cjk / 1.5 + ascii_count / 4 + other / 2.5)


def estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    return sum(estimate_tokens(str(m.get("content", ""))) for m in messages)


def get_max_context_tokens() -> int:
    return int(os.getenv("MAX_CONTEXT_TOKENS", "100000"))
