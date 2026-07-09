#!/usr/bin/env python3
"""Check that no Python file in Scripts/ exceeds MAX_LINES (non-blank, non-comment)."""

import sys
from pathlib import Path

MAX_LINES = 500
EXCLUDE_DIRS = {".venv", "__pycache__", "Data", "migrations"}
BACKEND_ROOT = Path(__file__).resolve().parent.parent

violations: list[tuple[str, int]] = []

for py_file in sorted(BACKEND_ROOT.rglob("*.py")):
    if any(part in EXCLUDE_DIRS for part in py_file.parts):
        continue
    lines = py_file.read_text(encoding="utf-8").splitlines()
    effective = 0
    for line in lines:
        stripped = line.strip()
        if stripped == "" or stripped.startswith("#"):
            continue
        effective += 1
    if effective > MAX_LINES:
        violations.append((str(py_file.relative_to(BACKEND_ROOT)), effective))

if violations:
    print(f"ERROR: {len(violations)} file(s) exceed {MAX_LINES} lines of effective code:")
    for path, count in sorted(violations, key=lambda x: -x[1]):
        print(f"  {count:>5} lines  {path}")
    sys.exit(1)

print(f"OK: all Backend Python files within {MAX_LINES} lines of effective code.")
