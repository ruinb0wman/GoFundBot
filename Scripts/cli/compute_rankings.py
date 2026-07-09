#!/usr/bin/env python3
"""
Compute peer rankings from a list of funds.

stdin: {"funds": [{"fund_code":"019667","fund_type":"指数型","return_1y":12.5}, ...]}
stdout: {"success": true, "data": {"rankings": [{"fund_code":"019667","rank_pct_1y":5.2}, ...]}}
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
    funds = params.get("funds", [])

    if not funds:
        return {"error": "No funds provided. Pass stdin: {\"funds\": [...]}"}

    by_type = {}
    for f in funds:
        ft = f.get("fund_type", "未知")
        if ft not in by_type:
            by_type[ft] = []
        by_type[ft].append(f)

    rankings = []
    for fund_type, type_funds in by_type.items():
        with_return = [f for f in type_funds if f.get("return_1y") is not None]
        with_return.sort(key=lambda x: x["return_1y"], reverse=True)
        total = len(with_return)

        for rank_pos, f in enumerate(with_return):
            pct = round((rank_pos + 1) / total * 100, 2) if total > 0 else 0
            rankings.append({
                "fund_code": f["fund_code"],
                "fund_type": fund_type,
                "rank_pct_1y": pct,
                "pass_4433": 1 if pct <= 25 else 0,
            })

    return {"rankings": rankings, "total": len(rankings)}


if __name__ == "__main__":
    run_script(main)
