from typing import Any


def _board_to_legacy(b: dict[str, Any]) -> dict[str, Any]:
    raw_change = b.get("changePercent", 0)
    raw_inflow = b.get("mainNetInflow", 0)
    raw_amount = b.get("amount", 0)
    inflow_pct = (raw_inflow / raw_amount * 100) if raw_amount else 0
    if b.get("mainNetInflowPercent"):
        inflow_pct = b["mainNetInflowPercent"]

    return {
        "name": b.get("name", ""),
        "code": b.get("code", ""),
        "change_pct": f"{round(raw_change, 2)}%",
        "main_inflow": _format_amount_yi(raw_inflow),
        "main_inflow_pct": f"{round(inflow_pct, 2)}%",
        "raw_change": raw_change,
        "raw_main_inflow": raw_inflow,
        "rise_count": b.get("riseCount", 0),
        "fall_count": b.get("fallCount", 0),
        "leading_stock": b.get("leadingStock", ""),
        "leading_pct": b.get("leadingStockChangePercent", 0),
    }


def _format_amount_yi(value: float) -> str:
    if not value:
        return "0\u4ebf"
    return f"{round(value / 1e8, 2)}\u4ebf"


def _format_pct(value: float) -> str:
    return f"{round(value, 2)}%"


def _safe_float(val, default=0.0):
    try:
        if val in (None, "", "-", "--"):
            return default
        return float(val)
    except (ValueError, TypeError):
        return default


def _safe_float_str(val, default: str = "0.00") -> str:
    try:
        if val in (None, "", "-", "--"):
            return default
        return f"{float(val):.2f}"
    except (ValueError, TypeError):
        return default


def _format_kline_date(val) -> str:
    from datetime import date as dt_date
    from datetime import datetime as dt_datetime

    if isinstance(val, (dt_datetime, dt_date)):
        return val.strftime("%Y%m%d")
    s = str(val).strip()
    if "-" in s:
        return s.replace("-", "")
    if s.isdigit() and len(s) == 8:
        return s
    return s


def _to_date_dash(date_str: str) -> str:
    if not date_str:
        return ""
    s = str(date_str).strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return s
