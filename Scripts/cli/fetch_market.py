#!/usr/bin/env python3
"""
Fetch market data (indices, sectors, gold, news) via akshare.

args:
  --type [index|sector|gold|news]   Data type to fetch

stdout: {"success": true, "data": {"indices": [...], "sectors": [...], "gold": [...]}}
"""
import argparse
import json
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

from _template import run_script


def fetch_indices():
    if not ak:
        return []
    try:
        df = ak.stock_zh_index_spot_sina()
        indices = []
        for _, row in df.iterrows():
            code = str(row.get("代码") or "")
            name = str(row.get("名称") or "")
            price = float(row.get("最新价") or 0)
            change_pct = float(row.get("涨跌幅") or 0)
            change_amount = float(row.get("涨跌额") or 0)
            prefix = code[:2].lower() if code else ""
            if prefix == "sh":
                market = "上海"
            elif prefix == "sz":
                market = "深圳"
            elif prefix == "bj":
                market = "北京"
            else:
                market = "A股"
            indices.append({
                "code": code,
                "name": name,
                "price": price,
                "change_pct": change_pct,
                "change_amount": change_amount,
                "market": market,
                "volume": float(row.get("成交量") or 0),
                "amount": float(row.get("成交额") or 0),
            })
        return indices
    except Exception as e:
        print(f"Error fetching indices: {e}", file=sys.stderr)
        return []


def fetch_sectors():
    if not ak:
        return []
    try:
        df = ak.stock_board_industry_summary_ths()
        sectors = []
        for _, row in df.iterrows():
            name = str(row.get("板块") or row.get("板块名称") or row.get("名称") or "")
            code = str(row.get("板块代码") or row.get("代码") or "")
            raw_change = float(row.get("涨跌幅") or 0)
            raw_inflow = float(row.get("净流入") or 0)
            sign = "+" if raw_change >= 0 else ""
            inflow_sign = "+" if raw_inflow >= 0 else ""
            sectors.append({
                "name": name,
                "code": code,
                "change_pct": f"{sign}{raw_change:.2f}%",
                "main_inflow": f"{inflow_sign}{raw_inflow:.2f}亿",
                "raw_change": raw_change,
                "raw_main_inflow": raw_inflow,
                "up_count": int(row.get("上涨家数") or 0),
                "down_count": int(row.get("下跌家数") or 0),
            })
        return sectors
    except Exception as e:
        print(f"Error fetching sectors: {e}", file=sys.stderr)
        return []


def fetch_gold():
    return []


def main():
    parser = argparse.ArgumentParser(description="Fetch market data")
    parser.add_argument("--type", choices=["index", "sector", "gold", "all"],
                        default="all", help="Data type to fetch")
    args = parser.parse_args()

    if ak is None:
        return {"error": "akshare not installed. Run: pip install akshare"}

    result = {}
    if args.type in ("index", "all"):
        result["indices"] = fetch_indices()
    if args.type in ("sector", "all"):
        result["sectors"] = fetch_sectors()
    if args.type in ("gold", "all"):
        result["gold"] = fetch_gold()
    return result


if __name__ == "__main__":
    run_script(main)
