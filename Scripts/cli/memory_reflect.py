#!/usr/bin/env python3
"""
Generate analysis memory reflections from past fund analyses.

stdin: {
  "fundCode": "019667",
  "limit": 5,
  "analyses": [{"rating": "buy", "thesis": "...", "actual_return": 12.5}, ...]
}
stdout: {"success": true, "data": {"reflections": [{"fund_code": "...", "reflection": "..."}]}}
"""
import json
import os
import sys

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.dirname(os.path.abspath(__file__)), _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _template import run_script, read_stdin


def main():
    params = read_stdin()
    analyses = params.get("analyses", [])

    if not analyses:
        return {"reflections": []}

    reflections = []
    for a in analyses:
        rating = a.get("rating", "")
        thesis = a.get("thesis", "")
        actual_return = a.get("actual_return")

        if actual_return is not None and thesis:
            correct = (rating == "buy" and actual_return > 0) or (rating == "sell" and actual_return < 0)
            reflection = (
                f"分析{'正确' if correct else '偏差'}: 评级{rating}, "
                f"实际收益{actual_return:+.2f}%, "
                f"核心论据: {thesis[:100]}"
            )
            reflections.append({
                "fund_code": a.get("fund_code"),
                "analysis_date": a.get("analysis_date"),
                "rating": rating,
                "actual_return": actual_return,
                "thesis": thesis,
                "reflection": reflection,
                "correct": correct,
            })

    return {"reflections": reflections}


if __name__ == "__main__":
    run_script(main)
