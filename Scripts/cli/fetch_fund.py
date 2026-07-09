#!/usr/bin/env python3
"""
Fetch fund data from eastmoney API.

args:
  --code 019667    Fetch single fund
  --all            Fetch all available funds

stdout: {"success": true, "data": {"funds": [{"fund_code":"019667","fund_name":"...","net_worth_trend":[...]}]}}
"""
import argparse
import json
import os
import re
import sys

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.dirname(os.path.abspath(__file__)), _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _template import run_script

import requests


EASTMONEY_FUND_DETAIL_URL = "https://fund.eastmoney.com/pingzhongdata/{code}.js"
EASTMONEY_FUND_LIST_URL = "https://fund.eastmoney.com/js/fundcode_search.js"

_REQUESTS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://fund.eastmoney.com/",
}


def fetch_fund_detail_js(code):
    url = EASTMONEY_FUND_DETAIL_URL.format(code=code)
    resp = requests.get(url, timeout=30, headers=_REQUESTS_HEADERS)
    resp.raise_for_status()
    return resp.text


def parse_js_variable(script, var_name):
    pattern = re.compile(rf"var\s+{re.escape(var_name)}\s*=\s*(\[[\s\S]*?\])\s*;", re.MULTILINE)
    match = pattern.search(script)
    if match:
        raw = match.group(1)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    pattern2 = re.compile(rf"var\s+{re.escape(var_name)}\s*=\s*(\S[^;]+)", re.MULTILINE)
    match2 = pattern2.search(script)
    if match2:
        raw = match2.group(1)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return None


def fetch_fund(code):
    script = fetch_fund_detail_js(code)
    result = {"fund_code": code}

    name_match = re.search(r'"fundName":"([^"]+)"', script)
    if name_match:
        result["fund_name"] = name_match.group(1)

    type_match = re.search(r'"fundType":"([^"]+)"', script)
    if type_match:
        result["fund_type"] = type_match.group(1)

    net_worth_trend = parse_js_variable(script, "Data_netWorthTrend")
    if net_worth_trend:
        result["net_worth_trend"] = net_worth_trend

    accumulated = parse_js_variable(script, "Data_ACWorthTrend")
    if accumulated:
        result["accumulated_net_worth"] = accumulated

    equity_return = parse_js_variable(script, "Data_equityReturn")
    if equity_return:
        result["performance"] = equity_return

    return result


def fetch_fund_list():
    resp = requests.get(EASTMONEY_FUND_LIST_URL, timeout=30, headers=_REQUESTS_HEADERS)
    resp.raise_for_status()
    match = re.search(r"var\s+r\s*=\s*(\[[\s\S]*?\])\s*;", resp.text)
    if not match:
        return []
    try:
        data = json.loads(match.group(1))
        return [{"fund_code": item[0], "fund_name": item[2], "fund_type": item[3]} for item in data]
    except json.JSONDecodeError:
        return []


def main():
    parser = argparse.ArgumentParser(description="Fetch fund data from eastmoney")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--code", help="Single fund code")
    group.add_argument("--all", action="store_true", help="Fetch all funds")
    args = parser.parse_args()

    if args.code:
        funds = [fetch_fund(args.code)]
    else:
        fund_list = fetch_fund_list()
        funds = []
        for f in fund_list:
            try:
                detail = fetch_fund(f["fund_code"])
                if detail.get("fund_name"):
                    funds.append(detail)
            except Exception as e:
                print(f"Error fetching {f['fund_code']}: {e}", file=sys.stderr)
                continue

    return {"funds": funds, "total": len(funds)}


if __name__ == "__main__":
    run_script(main)
