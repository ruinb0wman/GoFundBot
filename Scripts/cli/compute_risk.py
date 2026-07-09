#!/usr/bin/env python3
"""
Compute risk metrics (Sharpe, drawdown, volatility) from NAV history.

stdin: {"navHistory": [{"date":"2025-01-01","nav":1.0}, ...]}
stdout: {"success": true, "data": {"max_drawdown_1y": -15.3, "sharpe_ratio_1y": 0.85, ...}}

No SQLite dependency — pure stdin/stdout computation.
"""
import json
import math
import os
import sys
from datetime import datetime

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.dirname(os.path.abspath(__file__)), _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _template import run_script, read_stdin


def compute_risk(nav_history):
    points = []
    for item in nav_history:
        date = item.get("date")
        nav = item.get("nav") or item.get("net_worth")
        if date and nav:
            points.append({"date": date, "nav": float(nav)})

    if len(points) < 10:
        return {"error": "Need at least 10 NAV data points"}

    points.sort(key=lambda x: x["date"])
    navs = [p["nav"] for p in points]
    dates = [p["date"] for p in points]
    now = datetime.now()

    def _slice(days):
        cutoff = now.timestamp() - days * 86400
        return [n for i, n in enumerate(navs) if dates[i] and datetime.strptime(dates[i], "%Y-%m-%d").timestamp() > cutoff]

    def _max_drawdown(nav_seq):
        if len(nav_seq) < 2:
            return 0
        peak = nav_seq[0]
        dd = 0
        for n in nav_seq:
            if n > peak:
                peak = n
            dd = max(dd, (peak - n) / peak * 100)
        return round(-dd, 2)

    def _volatility(nav_seq):
        if len(nav_seq) < 5:
            return None
        daily_returns = []
        for i in range(1, len(nav_seq)):
            r = nav_seq[i] / nav_seq[i - 1] - 1
            if abs(r) < 0.5:
                daily_returns.append(r)
        if len(daily_returns) < 5:
            return None
        mean = sum(daily_returns) / len(daily_returns)
        var = sum((r - mean) ** 2 for r in daily_returns) / (len(daily_returns) - 1)
        return round(math.sqrt(var) * math.sqrt(252) * 100, 2)

    def _annual_return(nav_seq, days):
        if len(nav_seq) < 2 or days <= 0:
            return None
        total_ret = nav_seq[-1] / nav_seq[0] - 1
        years = days / 365.25
        if years <= 0 or total_ret <= -1:
            return None
        return round((pow(1 + total_ret, 1 / years) - 1) * 100, 2)

    def _sharpe(nav_seq, risk_free_annual):
        vol = _volatility(nav_seq)
        if not vol or vol == 0 or len(nav_seq) < 2:
            return None
        total_ret = nav_seq[-1] / nav_seq[0] - 1
        years = len(nav_seq) / 252
        if years <= 0:
            return None
        annual_ret = pow(1 + total_ret, 1 / years) - 1
        annual_vol = vol / 100
        return round((annual_ret - risk_free_annual) / annual_vol, 2) if annual_vol > 0 else None

    return {
        "max_drawdown_3m": _max_drawdown(_slice(90)),
        "max_drawdown_6m": _max_drawdown(_slice(180)),
        "max_drawdown_1y": _max_drawdown(_slice(365)),
        "max_drawdown_3y": _max_drawdown(_slice(1095)),
        "max_drawdown_all": _max_drawdown(navs),
        "sharpe_ratio_1y": _sharpe(_slice(365), 0.02),
        "sharpe_ratio_3y": _sharpe(_slice(1095), 0.02),
        "volatility_1y": _volatility(_slice(365)),
        "volatility_3y": _volatility(_slice(1095)),
        "annual_return_1y": _annual_return(_slice(365), 365),
        "annual_return_3y": _annual_return(_slice(1095), 1095),
    }


def main():
    params = read_stdin()
    nav_history = params.get("navHistory", params.get("nav_history", []))
    if not nav_history:
        return {"error": "No NAV history provided. Pass as stdin JSON: {\"navHistory\": [...]}"}
    return compute_risk(nav_history)


if __name__ == "__main__":
    run_script(main)
