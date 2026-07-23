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

import requests

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.dirname(os.path.abspath(__file__)), _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    import akshare as ak
except ImportError:
    ak = None

try:
    import baostock as bs
except ImportError:
    bs = None

from _template import run_script  # noqa: E402

from cli.shared.file_cache import file_cache  # noqa: E402

_REQUESTS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://data.eastmoney.com/",
}


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


def complete_kline_baostock(code: str, start_date: str = "", end_date: str = ""):
    """
    Fetch index daily kline from baostock (socket protocol, no HTTP anti-crawl issues).
    Code format: sh000001 or sh.000001 both accepted.
    """
    if not bs:
        return []
    try:
        dot_code = code if "." in code else code[:2] + "." + code[2:]
        lg = bs.login()
        if lg.error_code != "0":
            return []

        try:

            def _fmt(v: str) -> str:
                v = v.replace("-", "")
                if len(v) == 8:
                    return f"{v[:4]}-{v[4:6]}-{v[6:]}"
                return v

            rs = bs.query_history_k_data_plus(
                dot_code,
                "date,open,close,high,low,volume,amount,pctChg",
                start_date=_fmt(start_date) if start_date else "",
                end_date=_fmt(end_date) if end_date else "",
                frequency="d",
                adjustflag="3",
            )

            result = []
            prev_close = None
            while rs.next():
                row = rs.get_row_data()
                fields = rs.fields if hasattr(rs, "fields") else []
                d = dict(zip(fields, row))

                date_val = d.get("date", "")
                if not date_val or date_val == "":
                    continue

                try:
                    close_val = float(d["close"])
                except (ValueError, TypeError):
                    continue

                if prev_close is not None:
                    delta = close_val - prev_close
                    pct = (delta / prev_close) * 100 if prev_close != 0 else 0.0
                else:
                    delta = 0.0
                    pct = 0.0

                result.append(
                    {
                        "code": code,
                        "date": date_val,
                        "open": _safe_float(d.get("open")),
                        "close": close_val,
                        "high": _safe_float(d.get("high")),
                        "low": _safe_float(d.get("low")),
                        "volume": int(_safe_float(d.get("volume", "0"))),
                        "amount": _safe_float(d.get("amount")),
                        "change": round(delta, 4),
                        "changePercent": round(pct, 4),
                    }
                )
                prev_close = close_val

            return result
        finally:
            bs.logout()
    except Exception as e:
        print(f"baostock kline failed: {e}", file=sys.stderr)
        return []


def _safe_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


@file_cache(key="stock_list", ttl_hours=24)
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


@file_cache(key="industry_mapping", ttl_hours=24)
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


@file_cache(key="sector_spot", ttl_hours=1)
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


def complete_north_flow():
    """
    Fetch northbound capital flow (北向资金) data from eastmoney datacenter API.
    Uses a different endpoint than the Node.js provider (datacenter-web vs push2),
    providing genuine fallback diversity.
    Returns dict with keys: total, sh, sz, each containing date, fund_inflow, net_deal_amt, deal_amt.
    """
    types = {
        "005": "total",
        "001": "sh",
        "003": "sz",
    }
    result = {}
    for type_code, key in types.items():
        try:
            url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
            params = {
                "reportName": "RPT_MUTUAL_DEAL_HISTORY",
                "columns": "TRADE_DATE,FUND_INFLOW,NET_DEAL_AMT,DEAL_AMT,BUY_AMT,SELL_AMT",
                "filter": f'(MUTUAL_TYPE="{type_code}")',
                "sortColumns": "TRADE_DATE",
                "sortTypes": "-1",
                "pageSize": "1",
                "pageNumber": "1",
                "source": "WEB",
                "client": "WEB",
            }
            resp = requests.get(url, params=params, timeout=30, headers=_REQUESTS_HEADERS)
            data = resp.json()
            items = data.get("result", {}).get("data", [])
            if items:
                item = items[0]
                result[key] = {
                    "date": (item.get("TRADE_DATE") or "")[:10],
                    "fund_inflow": item.get("FUND_INFLOW"),
                    "net_deal_amt": item.get("NET_DEAL_AMT"),
                    "deal_amt": item.get("DEAL_AMT"),
                }
            else:
                result[key] = {"date": "", "fund_inflow": None, "net_deal_amt": None, "deal_amt": None}
        except Exception as e:
            print(f"north_flow {key} failed: {e}", file=sys.stderr)
            result[key] = {"date": "", "fund_inflow": None, "net_deal_amt": None, "deal_amt": None}
    return result


def complete_market_money_flow():
    """
    Fetch daily market money flow (主力资金流向) from akshare.
    Returns latest trading day: date, mainNetInflow, superLargeNetInflow,
    largeNetInflow, mediumNetInflow, smallNetInflow (all in raw yuan).
    Matches MarketMoneyFlowDto interface.
    """
    if not ak:
        return {}
    try:
        df = ak.stock_market_fund_flow()
        if df is None or df.empty:
            return {}
        latest = df.iloc[-1]
        return {
            "date": str(latest["日期"]),
            "mainNetInflow": float(latest["主力净流入-净额"]),
            "superLargeNetInflow": float(latest["超大单净流入-净额"]),
            "largeNetInflow": float(latest["大单净流入-净额"]),
            "mediumNetInflow": float(latest["中单净流入-净额"]),
            "smallNetInflow": float(latest["小单净流入-净额"]),
        }
    except Exception as e:
        print(f"akshare market money flow failed: {e}", file=sys.stderr)
        return {}


def main():
    parser = argparse.ArgumentParser(description="Data completion")
    parser.add_argument("--source", choices=["akshare", "eastmoney", "baostock"], default="akshare")
    parser.add_argument(
        "--type",
        choices=["stocks", "industry", "sector_spot", "kline", "north_flow", "money_flow", "all"],
        default="all",
    )
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
        if args.source == "baostock":
            result["kline"] = complete_kline_baostock(args.code, args.start_date, args.end_date)
        else:
            result["kline"] = complete_kline(args.code, args.start_date, args.end_date)
    if args.type == "north_flow":
        result["north_flow"] = complete_north_flow()
    if args.type == "money_flow":
        result["money_flow"] = complete_market_money_flow()
    return result


if __name__ == "__main__":
    run_script(main)
