#!/usr/bin/env python3
"""
Script execution contract:
  stdin:  JSON (complex parameters) or empty (if CLI args suffice)
  stdout: JSON single line: {"success": true, "data": {...}}
  stderr: Log/progress info (only read by Express on exit code != 0)
  exit code: 0 = success, non-zero = failure
  timeout: 120s (backtest), 30s (others)
"""
import json
import os
import sys
import traceback

# Ensure Scripts/ and scripts/ are on sys.path
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_SCRIPT_DIR)
for _p in (_SCRIPT_DIR, _BACKEND_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)


def run_script(main_fn):
    try:
        result = main_fn()
        print(json.dumps({"success": True, "data": result}, default=str, ensure_ascii=False))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(e)}), file=sys.stderr)
        sys.exit(1)


def read_stdin():
    if sys.stdin.isatty():
        return {}
    return json.load(sys.stdin)
