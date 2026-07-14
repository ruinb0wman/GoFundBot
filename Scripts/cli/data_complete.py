#!/usr/bin/env python3
"""
Data completion: fetch supplementary data (stock list, industry mappings, sector spot, kline).

args:
  --source [akshare|eastmoney]   Data source
  --type [stocks|industry|sector_spot|kline]  Data type
  --code                         Index code (required for --type kline, e.g. sh000001)
  --start_date                   Start date YYYYMMDD (optional, kline only)
  --end_date                     End date YYYYMMDD (optional, kline only)

stdout: {"success": true, "data": {"stocks": [...], "industries": [...], "sector_spot": [...], "kline": [...]}}
"""

import argparse
import os
import sys

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.dirname(os.path.abspath(__file__)), _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    import akshare as ak
except ImportError:
    ak = None

from _template import run_script  # noqa: E402


def complete_kline(code: str, start_date: str = "", end_date: str = ""):
    """
    Fetch index daily kline from akshare.
    Returns list of kline data sorted by date ascending.
    """
    if not ak:
        return []
    try:
        df = ak.stock_zh_index_daily(symbol=code)
        if df is None or df.empty:
            return []

        dtype = df["date"].dtype
        if hasattr(dtype, "__frozen__") or "datetime" in str(dtype).lower():
            df["date"] = df["date"].dt.strftime("%Y-%m-%d")
        else:
            df["date"] = df["date"].astype(str)

        if start_date or end_date:
            df["_sort"] = df["date"].str.replace("-", "")
            if start_date:
                df = df[df["_sort"] >= start_date.replace("-", "")]
            if end_date:
                df = df[df["_sort"] <= end_date.replace("-", "")]
            df = df.drop(columns=["_sort"])

        df = df.sort_values("date")

        result = []
        prev_close = None
        for _, row in df.iterrows():
            close_val = float(row["close"])
            if prev_close is not None:
                delta = close_val - prev_close
                pct = (delta / prev_close) * 100 if prev_close != 0 else 0.0
            else:
                delta = 0.0
                pct = 0.0

            result.append(
                {
                    "code": code,
                    "date": str(row["date"]),
                    "open": float(row["open"]),
                    "close": close_val,
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "volume": int(row["volume"]),
                    "amount": None,
                    "change": round(delta, 4),
                    "changePercent": round(pct, 4),
                }
            )
            prev_close = close_val

        return result
    except Exception as e:
        print(f"akshare kline failed: {e}", file=sys.stderr)
        return []


def complete_stock_list():
    if not ak:
        return []
    try:
        df = ak.stock_zh_a_spot_em()
        stocks = []
        for _, row in df.iterrows():
            code = str(row.get("代码", ""))
            stocks.append(
                {
                    "code": code,
                    "name": str(row.get("名称", "")),
                    "market": "SH" if code.startswith("6") else "SZ",
                }
            )
        return stocks
    except Exception as e:
        print(f"akshare stock list failed: {e}", file=sys.stderr)
    return []


def complete_industry_mapping():
    if not ak:
        return []
    try:
        df = ak.stock_board_industry_name_ths()
        industries = []
        for _, row in df.iterrows():
            industries.append(
                {
                    "code": str(row.get("板块代码", "")),
                    "name": str(row.get("板块名称", "")),
                }
            )
        return industries
    except Exception as e:
        print(f"akshare industry mapping failed: {e}", file=sys.stderr)
    return []


def complete_sector_spot():
    """
    Fetch real-time sector/industry board spot data from akshare (THS source).
    Returns list of sectors sorted by change percent descending.
    """
    if not ak:
        return []
    try:
        df = ak.stock_board_industry_summary_ths()
        rows = []
        for _, row in df.iterrows():
            chg = row.get("涨跌幅")
            if chg is None:
                continue
            inflow = row.get("净流入") or 0
            raw_inflow = float(inflow) * 1e8  # convert 亿 to raw yuan
            raw_chg = float(chg)
            rows.append(
                {
                    "name": str(row.get("板块", "")),
                    "code": "",
                    "change_pct": f"{'+' if raw_chg >= 0 else ''}{raw_chg:.2f}%",
                    "main_inflow": f"{'+' if raw_inflow >= 0 else ''}{float(inflow):.2f}亿",
                    "raw_change": raw_chg,
                    "raw_main_inflow": raw_inflow,
                }
            )
        return rows
    except Exception as e:
        print(f"akshare sector spot failed: {e}", file=sys.stderr)
    return []


def main():
    parser = argparse.ArgumentParser(description="Data completion")
    parser.add_argument("--source", choices=["akshare", "eastmoney"], default="akshare")
    parser.add_argument("--type", choices=["stocks", "industry", "sector_spot", "kline", "all"], default="all")
    parser.add_argument("--code", type=str, default="")
    parser.add_argument("--start_date", type=str, default="")
    parser.add_argument("--end_date", type=str, default="")
    args = parser.parse_args()

    if args.source == "akshare" and ak is None:
        return {"error": "akshare not installed. Run: pip install akshare"}

    result = {}
    if args.type in ("stocks", "all"):
        result["stocks"] = complete_stock_list()
    if args.type in ("industry", "all"):
        result["industry"] = complete_industry_mapping()
    if args.type in ("sector_spot", "all"):
        result["sector_spot"] = complete_sector_spot()
    if args.type == "kline":
        if not args.code:
            return {"error": "--code is required for --type kline"}
        result["kline"] = complete_kline(args.code, args.start_date, args.end_date)
    return result


if __name__ == "__main__":
    run_script(main)
