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

try:
    import pandas as pd
except ImportError:
    pd = None

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.dirname(os.path.abspath(__file__)), _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Suppress akshare's internal tqdm progress bars that pollute stdout
os.environ['TQDM_DISABLE'] = '1'

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


def fetch_concept_sectors():
    """Fetch concept sector (概念板块) data via akshare THS."""
    if not ak:
        return {"data_status": "unavailable", "items": [], "note": "akshare not installed"}
    try:
        df = ak.stock_board_concept_summary_ths()
        if df is None or df.empty:
            df = ak.stock_board_concept_name_ths()
            if df is None or df.empty:
                return {"data_status": "unavailable", "items": [], "note": "概念板块数据为空"}
            items = [{"name": str(r.get("name", "")), "code": str(r.get("code", ""))} for _, r in df.head(100).iterrows()]
            return {"data_status": "available", "items": items, "count": len(items),
                    "note": "仅返回概念板块名称列表，实时涨跌幅数据当前不可用"}
        items = []
        for _, row in df.iterrows():
            items.append({
                "name": str(row.get("概念名称", "")),
                "code": "",
                "stock_count": int(row.get("成分股数量", 0)),
                "driver_event": str(row.get("驱动事件", "")),
                "leader_stock": str(row.get("龙头股", "")),
            })
        return {"data_status": "available", "items": items, "count": len(items),
                "note": "概念板块概览数据（不含实时涨跌幅），数据日期: " + str(df.iloc[0].get("日期", ""))}
    except Exception as e:
        print(f"Error fetching concept sectors: {e}", file=sys.stderr)
        return {"data_status": "error", "items": [], "note": str(e)}


def fetch_north_flow():
    """Fetch north-bound capital flow (北向资金) via akshare."""
    if not ak:
        return {"data_status": "unavailable", "note": "akshare not installed"}
    try:
        df = ak.stock_hsgt_fund_flow_summary_em()
        if df is None or df.empty:
            return {"data_status": "unavailable", "note": "北向资金实时数据暂不可用"}
        north = df[df["资金方向"] == "北向"]
        if north.empty:
            return {"data_status": "unavailable", "note": "北向资金数据为空"}
        data_date = str(north.iloc[0]["交易日"])
        sh_row = north[north["板块"] == "沪股通"]
        sz_row = north[north["板块"] == "深股通"]
        result = {"data_status": "available", "date": data_date}
        sh_net = sz_net = 0.0
        if not sh_row.empty:
            r = sh_row.iloc[0]
            result["sh_up_count"] = int(r.get("上涨数", 0))
            result["sh_down_count"] = int(r.get("下跌数", 0))
            sh_net = float(r.get("成交净买额", 0))
        if not sz_row.empty:
            r = sz_row.iloc[0]
            result["sz_up_count"] = int(r.get("上涨数", 0))
            result["sz_down_count"] = int(r.get("下跌数", 0))
            sz_net = float(r.get("成交净买额", 0))
        result["sh_net_inflow"] = round(sh_net, 2)
        result["sz_net_inflow"] = round(sz_net, 2)
        result["total_net_inflow"] = round(sh_net + sz_net, 2)
        return result
    except Exception as e:
        print(f"Error fetching north flow: {e}", file=sys.stderr)
        return {"data_status": "error", "note": str(e)}


def fetch_market_breadth():
    """Fetch market breadth (涨跌统计) via akshare Sina source."""
    if not ak:
        return {"data_status": "unavailable", "up_count": 0, "down_count": 0, "flat_count": 0, "limit_up": 0, "limit_down": 0, "total": 0, "note": "akshare not installed"}
    try:
        df = ak.stock_zh_a_spot()
        if df is None or df.empty:
            return {"data_status": "unavailable", "up_count": 0, "down_count": 0, "flat_count": 0, "limit_up": 0, "limit_down": 0, "total": 0, "note": "A股行情数据为空"}
        change_col = "涨跌幅"
        if change_col not in df.columns:
            change_col = "pctChg"
        if change_col not in df.columns:
            return {"data_status": "unavailable", "up_count": 0, "down_count": 0, "flat_count": 0, "limit_up": 0, "limit_down": 0, "total": 0, "note": f"找不到涨跌幅列: {list(df.columns)}"}
        df[change_col] = pd.to_numeric(df[change_col], errors="coerce")
        total = len(df)
        up = int((df[change_col] > 0).sum())
        down = int((df[change_col] < 0).sum())
        flat = int((df[change_col] == 0).sum())
        limit_up = int((df[change_col] >= 9.9).sum())
        limit_down = int((df[change_col] <= -9.9).sum())
        return {
            "data_status": "available",
            "up_count": up, "down_count": down, "flat_count": flat,
            "limit_up": limit_up, "limit_down": limit_down, "total": total,
        }
    except Exception as e:
        print(f"Error fetching breadth: {e}", file=sys.stderr)
        return {"data_status": "error", "up_count": 0, "down_count": 0, "flat_count": 0, "limit_up": 0, "limit_down": 0, "total": 0, "note": str(e)}


def fetch_main_flow():
    """Fetch main capital flow (主力资金) via akshare.

    Note: `stock_market_fund_flow()` and `stock_main_fund_flow()` both
    use eastmoney APIs that are blocked from this network. We try both
    and report unavailable if both fail.
    """
    if not ak:
        return {"data_status": "unavailable", "note": "akshare not installed"}
    candidates = [("stock_market_fund_flow", getattr(ak, "stock_market_fund_flow", None)),
                  ("stock_main_fund_flow", getattr(ak, "stock_main_fund_flow", None))]
    for name, fn in candidates:
        if fn is None:
            continue
        try:
            df = fn()
            if df is not None and not df.empty:
                for idx in range(len(df) - 1, -1, -1):
                    row = df.iloc[idx]
                    main_raw = float(row.get("主力净流入-净额", 0) or 0)
                    if main_raw == 0:
                        continue
                    data_date = str(row.get("日期", ""))
                    if not data_date:
                        continue
                    super_large = float(row.get("超大单净流入-净额", 0) or 0)
                    large = float(row.get("大单净流入-净额", 0) or 0)
                    medium = float(row.get("中单净流入-净额", 0) or 0)
                    small = float(row.get("小单净流入-净额", 0) or 0)
                    return {
                        "data_status": "available",
                        "date": data_date,
                        "source": name,
                        "super_large_net_inflow": round(super_large / 1e8, 2),
                        "large_net_inflow": round(large / 1e8, 2),
                        "medium_net_inflow": round(medium / 1e8, 2),
                        "small_net_inflow": round(small / 1e8, 2),
                        "main_net_inflow": round((super_large + large) / 1e8, 2),
                    }
            print(f"[{name}] returned empty data", file=sys.stderr)
        except Exception as e:
            err_str = str(e)
            if "ProxyError" in err_str or "Max retries" in err_str:
                print(f"[{name}] data source unavailable (network): {err_str[:80]}", file=sys.stderr)
            else:
                print(f"[{name}] error: {err_str}", file=sys.stderr)
    return {"data_status": "unavailable", "note": "主力资金数据暂不可用（数据源网络限制）"}


def main():
    parser = argparse.ArgumentParser(description="Fetch market data")
    parser.add_argument("--type", choices=["index", "sector", "gold", "concept-sector", "north-flow", "breadth", "main-flow", "all"],
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
    if args.type in ("concept-sector", "all"):
        result["concept_sectors"] = fetch_concept_sectors()
    if args.type in ("north-flow", "all"):
        result["north_flow"] = fetch_north_flow()
    if args.type in ("breadth", "all"):
        result["breadth"] = fetch_market_breadth()
    if args.type in ("main-flow", "all"):
        result["main_flow"] = fetch_main_flow()
    return result


if __name__ == "__main__":
    run_script(main)
