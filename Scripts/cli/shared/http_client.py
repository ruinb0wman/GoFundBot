#!/usr/bin/env python3
"""Shared HTTP client for all scripts — wraps requests with sensible defaults."""
import json
import time
from typing import Any, Optional

import requests

_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
})
_SESSION.trust_env = False


def fetch_json(url: str, params: Optional[dict] = None, timeout: int = 30) -> dict:
    resp = _SESSION.get(url, params=params, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def fetch_text(url: str, params: Optional[dict] = None, timeout: int = 30) -> str:
    resp = _SESSION.get(url, params=params, timeout=timeout)
    resp.raise_for_status()
    return resp.text


def fetch_jsonp(url: str, timeout: int = 30) -> str:
    resp = _SESSION.get(url, timeout=timeout)
    resp.raise_for_status()
    text = resp.text.strip()
    # Strip JSONP wrapper if present
    if text.startswith("jsonp(") or text.startswith("jQuery"):
        start = text.index("(") + 1
        end = text.rindex(")")
        text = text[start:end]
    return text
