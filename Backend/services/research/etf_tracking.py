from datetime import datetime

import requests
from sqlalchemy import desc

from core.logging import get_logger
from models import FundEtfTracking
from services.helpers import _avg, _json_dumps, _median, _normalize_fund_code, _positive_rate, _to_float

from . import _fund_type_matches, _research_base_rows, _research_fund_row

logger = get_logger(__name__)


def _row_value(row, index, *names):
    for name in names:
        try:
            value = row.get(name)
            if value is not None:
                return value
        except Exception:
            pass
    try:
        return row.iloc[index]
    except Exception:
        return None


def _parse_etf_trade_time(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    try:
        num = int(float(value))
        if num > 1000000000:
            return datetime.fromtimestamp(num)
    except Exception:
        pass
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return None


def _refresh_etf_tracking_from_akshare(db, limit=500):
    field_names = "f12,f14,f2,f441,f402,f4,f3,f5,f6,f17,f15,f16,f18,f7,f8,f10,f30,f31,f32,f38,f21,f20,f297,f124"
    params = {
        "pn": "1",
        "pz": str(max(limit, 100)),
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f12",
        "fs": "b:MK0021,b:MK0022,b:MK0023,b:MK0024,b:MK0827",
        "fields": field_names,
    }
    rows = []
    source = "eastmoney.push2"
    try:
        response = requests.get(
            "https://88.push2.eastmoney.com/api/qt/clist/get",
            params=params,
            timeout=8,
        )
        response.raise_for_status()
        payload = response.json()
        rows = (payload.get("data") or {}).get("diff") or []
    except Exception as direct_exc:
        logger.error(f"ETF tracking: eastmoney direct unavailable: {direct_exc}")
        try:
            import akshare as ak

            df = ak.fund_etf_spot_em()
            if df is None or getattr(df, "empty", True):
                rows = []
            else:
                rows = [
                    {
                        "f12": _row_value(row, 0, "代码"),
                        "f14": _row_value(row, 1, "名称"),
                        "f2": _row_value(row, 2, "最新价"),
                        "f441": _row_value(row, 3, "IOPV实时估值"),
                        "f402": _row_value(row, 4, "折价率"),
                        "f4": _row_value(row, 5, "涨跌额"),
                        "f3": _row_value(row, 6, "涨跌幅"),
                        "f5": _row_value(row, 7, "成交量"),
                        "f6": _row_value(row, 8, "成交额"),
                        "f8": _row_value(row, 14, "换手率"),
                        "f38": _row_value(row, 32, "最新份额"),
                        "f20": _row_value(row, 34, "总市值"),
                        "f124": _row_value(row, 36, "更新时间"),
                    }
                    for _, row in df.head(limit).iterrows()
                ]
                source = "akshare.eastmoney"
        except Exception as ak_exc:
            raise RuntimeError(f"eastmoney and akshare unavailable: {direct_exc}; {ak_exc}")

    if not rows:
        return 0

    saved = 0
    now = datetime.now()
    for row in rows[:limit]:
        code = _normalize_fund_code(row.get("f12") if isinstance(row, dict) else _row_value(row, 0, "代码"))
        if not code:
            continue

        record = db.query(FundEtfTracking).filter(FundEtfTracking.fund_code == code).first()
        if not record:
            record = FundEtfTracking(fund_code=code)
            db.add(record)

        record.fund_name = str(row.get("f14") or record.fund_name or "")
        record.latest_price = _to_float(row.get("f2"))
        record.iopv = _to_float(row.get("f441"))
        record.discount_rate = _to_float(row.get("f402"))
        record.change_amount = _to_float(row.get("f4"))
        record.change_percent = _to_float(row.get("f3"))
        record.volume = _to_float(row.get("f5"))
        record.amount = _to_float(row.get("f6"))
        record.turnover_rate = _to_float(row.get("f8"))
        record.fund_share = _to_float(row.get("f38"))
        record.market_value = _to_float(row.get("f20"))
        record.trade_time = _parse_etf_trade_time(row.get("f124")) or now
        record.source = source
        record.detail_json = _json_dumps({"fields": field_names.split(",")})
        record.updated_time = now
        saved += 1

    return saved


def _build_etf_tracking_from_cache(limit=80):
    from fund_list_cache import get_fund_list_cache

    cache = get_fund_list_cache()
    funds = []
    for fund in getattr(cache, "fund_list", []) or []:
        name = fund.get("NAME") or fund.get("name") or ""
        code = _normalize_fund_code(fund.get("CODE") or fund.get("code"))
        if code and "ETF" in name.upper():
            funds.append(
                {
                    "fund_code": code,
                    "fund_name": name,
                    "fund_type": "ETF",
                    "estimate_change": None,
                    "return_1y": None,
                    "nav_date": None,
                    "source": "fund_list_cache",
                }
            )

    return {
        "items": funds[:limit],
        "categories": [],
        "summary": {
            "total": len(funds),
            "with_estimate": 0,
            "avg_estimate_change": None,
            "positive_estimate_rate": None,
            "net_flow_available": False,
            "source": "fund_list_cache",
            "stale": True,
            "net_flow_note": "已从本地基金列表识别 ETF 池；实时行情需要刷新 AkShare/东方财富快照后显示。",
        },
    }


def _build_etf_tracking_snapshot(db, limit=80, refresh=False):
    source_error = None
    if refresh or db.query(FundEtfTracking).count() == 0:
        try:
            _refresh_etf_tracking_from_akshare(db, limit=max(limit, 300))
            db.commit()
        except Exception as exc:
            db.rollback()
            source_error = str(exc)
            logger.error(f"ETF tracking: akshare unavailable: {exc}")

    rows = db.query(FundEtfTracking).order_by(desc(FundEtfTracking.change_percent)).limit(limit).all()
    if not rows:
        payload = _build_etf_tracking_from_cache(limit=limit)
        payload["summary"]["source_error"] = source_error
        return payload

    items = []
    for row in rows:
        items.append(
            {
                "fund_code": row.fund_code,
                "fund_name": row.fund_name,
                "fund_type": "ETF",
                "latest_price": row.latest_price,
                "iopv": row.iopv,
                "discount_rate": row.discount_rate,
                "estimate_change": row.change_percent,
                "change_percent": row.change_percent,
                "change_amount": row.change_amount,
                "volume": row.volume,
                "amount": row.amount,
                "turnover_rate": row.turnover_rate,
                "fund_share": row.fund_share,
                "market_value": row.market_value,
                "return_1y": None,
                "nav_date": row.trade_time.date().isoformat() if row.trade_time else None,
                "updated_time": row.updated_time.isoformat() if row.updated_time else None,
                "source": row.source,
            }
        )

    categories = {}
    for item in items:
        name = item.get("fund_name") or ""
        if any(word in name for word in ["债", "货币"]):
            category = "债券/货币 ETF"
        elif any(word in name for word in ["港", "纳斯达克", "标普", "日经", "德国", "QDII"]):
            category = "跨境 ETF"
        elif any(word in name for word in ["黄金", "商品", "能源", "豆粕"]):
            category = "商品 ETF"
        elif any(word in name for word in ["医药", "消费", "芯片", "半导体", "证券", "银行", "军工", "AI", "机器人"]):
            category = "行业主题 ETF"
        else:
            category = "宽基/普通指数 ETF"
        stat = categories.setdefault(category, {"category": category, "count": 0, "estimate_values": []})
        stat["count"] += 1
        stat["estimate_values"].append(item.get("estimate_change"))

    category_items = [
        {
            "category": stat["category"],
            "count": stat["count"],
            "estimate_change_avg": _avg(stat["estimate_values"]),
            "return_1y_median": None,
            "net_flow": None,
        }
        for stat in categories.values()
    ]
    category_items.sort(key=lambda x: x["count"], reverse=True)

    latest_update = max((item.get("updated_time") for item in items if item.get("updated_time")), default=None)
    return {
        "items": items,
        "categories": category_items,
        "summary": {
            "total": db.query(FundEtfTracking).count(),
            "with_estimate": sum(1 for item in items if item.get("estimate_change") is not None),
            "avg_estimate_change": _avg(item.get("estimate_change") for item in items),
            "positive_estimate_rate": _positive_rate(item.get("estimate_change") for item in items),
            "net_flow_available": False,
            "source": "funds.db:fund_etf_tracking",
            "source_error": source_error,
            "latest_update": latest_update,
            "net_flow_note": "ETF 实时行情来自 AkShare/东方财富免费源；资金净流入暂未接入。",
        },
    }


def _build_research_etf_tracking(db, limit=80):
    rows = _research_base_rows(db)
    etf_items = []
    for basic, risk, rank, estimate in rows:
        if _fund_type_matches(basic.fund_type, basic.fund_name, ["ETF", "交易型开放式指数", "指数"]):
            etf_items.append(_research_fund_row(basic, risk, rank, estimate))

    etf_items.sort(
        key=lambda x: (
            x.get("estimate_change") if x.get("estimate_change") is not None else -999,
            x.get("return_1y") if x.get("return_1y") is not None else -999,
        ),
        reverse=True,
    )

    snapshot_count = db.query(FundEtfTracking).count()
    estimate_count = sum(1 for item in etf_items if item.get("estimate_change") is not None)
    if snapshot_count > 0 or not etf_items or estimate_count < max(5, int(len(etf_items) * 0.05)):
        return _build_etf_tracking_snapshot(db, limit=limit)

    category_stats = {}
    for item in etf_items:
        name = item.get("fund_name") or ""
        fund_type = item.get("fund_type") or ""
        if "债" in name or "债" in fund_type:
            category = "债券ETF/指数"
        elif "港" in name or "QDII" in fund_type.upper() or "纳斯达克" in name or "标普" in name:
            category = "跨境ETF/指数"
        elif "黄金" in name or "商品" in name:
            category = "商品ETF/指数"
        elif "行业" in fund_type or any(
            word in name for word in ["医药", "消费", "芯片", "半导体", "证券", "银行", "军工"]
        ):
            category = "行业主题ETF/指数"
        else:
            category = "宽基/普通指数"
        stat = category_stats.setdefault(
            category,
            {
                "category": category,
                "count": 0,
                "estimate_values": [],
                "return_1y_values": [],
            },
        )
        stat["count"] += 1
        stat["estimate_values"].append(item.get("estimate_change"))
        stat["return_1y_values"].append(item.get("return_1y"))

    categories = []
    for stat in category_stats.values():
        categories.append(
            {
                "category": stat["category"],
                "count": stat["count"],
                "estimate_change_avg": _avg(stat["estimate_values"]),
                "return_1y_median": _median(stat["return_1y_values"]),
                "net_flow": None,
            }
        )
    categories.sort(key=lambda x: x["count"], reverse=True)

    return {
        "items": etf_items[:limit],
        "categories": categories,
        "summary": {
            "total": len(etf_items),
            "with_estimate": sum(1 for item in etf_items if item.get("estimate_change") is not None),
            "avg_estimate_change": _avg(item.get("estimate_change") for item in etf_items),
            "positive_estimate_rate": _positive_rate(item.get("estimate_change") for item in etf_items),
            "net_flow_available": False,
            "net_flow_note": "当前数据源尚未接入 ETF 日/周/月资金净流入。",
        },
    }
