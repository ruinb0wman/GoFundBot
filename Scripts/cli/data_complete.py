#!/usr/bin/env python3
"""
Data completion: fetch supplementary data (stock list, industry mappings).

args:
  --source [akshare|eastmoney]   Data source
  --type [stocks|industry]       Data type

stdout: {"success": true, "data": {"stocks": [...], "industries": [...]}}
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


def complete_stock_list():
    if not ak:
        return []
    try:
        df = ak.stock_zh_a_spot_em()
        stocks = []
        for _, row in df.iterrows():
            code = str(row.get("代码", ""))
            stocks.append({
                "code": code,
                "name": str(row.get("名称", "")),
                "market": "SH" if code.startswith("6") else "SZ",
            })
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
            industries.append({
                "code": str(row.get("板块代码", "")),
                "name": str(row.get("板块名称", "")),
            })
        return industries
    except Exception as e:
        print(f"akshare industry mapping failed: {e}", file=sys.stderr)
    return []


def main():
    parser = argparse.ArgumentParser(description="Data completion")
    parser.add_argument("--source", choices=["akshare", "eastmoney"], default="akshare")
    parser.add_argument("--type", choices=["stocks", "industry", "all"], default="all")
    args = parser.parse_args()

    if args.source == "akshare" and ak is None:
        return {"error": "akshare not installed. Run: pip install akshare"}

    result = {}
    if args.type in ("stocks", "all"):
        result["stocks"] = complete_stock_list()
    if args.type in ("industry", "all"):
        result["industry"] = complete_industry_mapping()
    return result


if __name__ == "__main__":
    run_script(main)
